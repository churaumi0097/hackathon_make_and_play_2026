"""スポット選定（docs/spot_selection「2. アンチ量産型フィルタリング」）。

Places API で現在地〜目的地の周辺を探索し、
「open_now かつ 量産型でない“知る人ぞ知る”」スポットを 1〜2 件選ぶ。

閾値はすべて先頭の定数に集約し、調整可能にする。
Google Maps サーバーキー未設定時は、決め打ちのフォールバック経由地を返す
（オフラインでも一連のフローが通るようにするため）。
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass

import requests
from django.conf import settings

from . import safety

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 調整可能な選定閾値（アンチ量産型フィルタ）
# ---------------------------------------------------------------------------

# 探索半径（メートル）。現在地〜目的地の中点まわりを探す。
SEARCH_RADIUS_M = 1200

# 「量産型（メジャーすぎ）」を弾く上限。これを超える口コミ数は除外。
MAX_USER_RATINGS_TOTAL = 800

# 「知る人ぞ知る」を担保する下限。口コミが少なすぎる（＝実体不明）も避ける。
MIN_USER_RATINGS_TOTAL = 5

# rating の下限。これ未満は“外れ”として除外。
MIN_RATING = 3.6

# 最終的に採用するスポット数の範囲。
MIN_SPOTS = 1
MAX_SPOTS = 2

# Places Nearby Search タイムアウト（秒）。
_TIMEOUT_SEC = 6
_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

# セマンティックタグ → Places 検索クエリ（type or keyword）。
# 実在しない Places type は keyword 検索にフォールバックする。
TAG_TO_QUERY: dict[str, dict[str, str]] = {
    "park": {"type": "park"},
    "cafe": {"type": "cafe"},
    "convenience_store": {"type": "convenience_store"},
    "landmark": {"type": "tourist_attraction"},
    "garden": {"type": "park", "keyword": "庭園"},
    "river": {"keyword": "川沿い 遊歩道"},
    "waterfront": {"keyword": "水辺 散歩"},
    "promenade": {"keyword": "遊歩道"},
    "bench": {"keyword": "ベンチ 休憩"},
    "residential": {"keyword": "静かな通り"},
    "scenic_lookout": {"keyword": "見晴らし 展望"},
    "tree_lined_avenue": {"keyword": "並木道"},
}


@dataclass
class Spot:
    """正規化済みの経由スポット。"""

    name: str
    lat: float
    lng: float
    rating: float
    user_ratings_total: int
    place_id: str
    tags: list[str]
    source_tag: str

    def to_dict(self) -> dict:
        return asdict(self)


def _midpoint(origin: dict, destination: dict) -> tuple[float, float]:
    return (
        (origin["lat"] + destination["lat"]) / 2.0,
        (origin["lng"] + destination["lng"]) / 2.0,
    )


def _nearby_search(lat: float, lng: float, query: dict) -> list[dict]:
    """Places Nearby Search（open_now のみ）。失敗時は空リスト。"""
    params = {
        "location": f"{lat},{lng}",
        "radius": SEARCH_RADIUS_M,
        "opennow": "true",  # docs: open_now:true のみ抽出
        "language": "ja",
        "key": settings.GOOGLE_MAPS_SERVER_KEY,
    }
    params.update(query)
    try:
        resp = requests.get(_NEARBY_URL, params=params, timeout=_TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status")
        if status not in ("OK", "ZERO_RESULTS"):
            logger.warning("Places API status=%s error=%s", status,
                           data.get("error_message"))
            return []
        return data.get("results", [])
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Places nearby search failed: %s", exc)
        return []


def _normalize(raw: dict, source_tag: str) -> Spot | None:
    try:
        loc = raw["geometry"]["location"]
        return Spot(
            name=raw.get("name", "名もなきスポット"),
            lat=loc["lat"],
            lng=loc["lng"],
            rating=float(raw.get("rating", 0.0)),
            user_ratings_total=int(raw.get("user_ratings_total", 0)),
            place_id=raw.get("place_id", ""),
            tags=list(raw.get("types", [])) + [source_tag],
            source_tag=source_tag,
        )
    except (KeyError, TypeError, ValueError):
        return None


def _passes_anti_massproduced(spot: Spot) -> bool:
    """アンチ量産型フィルタの中核。"""
    if spot.rating < MIN_RATING:
        return False
    if spot.user_ratings_total > MAX_USER_RATINGS_TOTAL:
        return False  # メジャーすぎ（誰でも同じ体験）を排除
    if spot.user_ratings_total < MIN_USER_RATINGS_TOTAL:
        return False  # 実体不明すぎる場所も避ける
    return True


def _hidden_gem_score(spot: Spot) -> float:
    """“知る人ぞ知る”度合い。高 rating × 少なめレビューを上位に。"""
    # rating を主軸に、レビューが少ないほど加点（量産型ペナルティの逆）。
    scarcity = 1.0 - min(spot.user_ratings_total, MAX_USER_RATINGS_TOTAL) / MAX_USER_RATINGS_TOTAL
    return spot.rating + scarcity * 1.5


def select_spots(
    origin: dict,
    destination: dict,
    places_tags: list[str],
    ctx: safety.SafetyContext,
    target_extra_minutes: int = 15,
) -> list[dict]:
    """周辺探索 → アンチ量産型 + 安全フィルタ → 1〜2 件を選定。

    origin/destination は {"lat": float, "lng": float}。
    Places キー未設定・結果ゼロ時はフォールバック経由地を返す。
    target_extra_minutes はフォールバック合成時の遠回り量の目安に使う。
    """
    if not settings.GOOGLE_MAPS_SERVER_KEY:
        return _fallback_spots(origin, destination, places_tags, ctx,
                               target_extra_minutes)

    lat, lng = _midpoint(origin, destination)
    # 安全上、夜間・悪天候で危険なタグは探索前に落とす。
    safe_tags = safety.filter_tags(places_tags, ctx)

    seen: set[str] = set()
    candidates: list[Spot] = []
    for tag in safe_tags:
        query = TAG_TO_QUERY.get(tag, {"keyword": tag})
        for raw in _nearby_search(lat, lng, query):
            spot = _normalize(raw, tag)
            if not spot or spot.place_id in seen:
                continue
            if not _passes_anti_massproduced(spot):
                continue
            if not safety.is_spot_safe(spot.to_dict(), ctx):
                continue
            seen.add(spot.place_id)
            candidates.append(spot)

    if not candidates:
        return _fallback_spots(origin, destination, places_tags, ctx)

    if len(candidates) < MIN_SPOTS:
        return _fallback_spots(origin, destination, places_tags, ctx,
                               target_extra_minutes)

    candidates.sort(key=_hidden_gem_score, reverse=True)
    chosen = candidates[:MAX_SPOTS]
    return [s.to_dict() for s in chosen]


# ---------------------------------------------------------------------------
# フォールバック（キー未設定・探索ゼロ時）
#   中点から少しずらした合成経由地を返し、下流の Directions を成立させる。
# ---------------------------------------------------------------------------
# 徒歩速度（directions.py と揃える）。フォールバックの分↔距離換算に使う。
_WALKING_MPS = 1.33
# 緯度1度 ≒ 111km。経度も日本付近の概算として同値で扱う（合成用途に十分）。
_M_PER_DEG = 111_000.0


def _fallback_spots(
    origin: dict,
    destination: dict,
    places_tags: list[str],
    ctx: safety.SafetyContext,
    target_extra_minutes: int = 15,
) -> list[dict]:
    import math

    dlat = destination["lat"] - origin["lat"]
    dlng = destination["lng"] - origin["lng"]
    norm = math.hypot(dlat, dlng) or 1e-6

    # 目標追加分 → 追加距離(m) → 三角形の頂点までの直交オフセット h を逆算する。
    #   最短直線 D に対し、中点で h だけ膨らむと detour ≒ 2*sqrt((D/2)^2 + h^2)。
    #   extra = detour - D を target に合わせて h を解く。
    direct_m = norm * _M_PER_DEG
    extra_m = max(target_extra_minutes, 1) * 60 * _WALKING_MPS
    half = direct_m / 2.0
    h_m = math.sqrt(max((half + extra_m / 2.0) ** 2 - half**2, 0.0))
    # h を degree に。進行方向 (dlat,dlng) の直交単位ベクトルは (-dlng, dlat)/norm。
    offset_deg = h_m / _M_PER_DEG
    perp_lat = -dlng / norm * offset_deg
    perp_lng = dlat / norm * offset_deg

    safe_tags = safety.filter_tags(places_tags, ctx) or ["park"]
    tag = safe_tags[0]
    count = 1 if ctx.is_night else min(MAX_SPOTS, 2)

    # 経由スポットは「同じ側」に配置して 1 つのふくらみ（bump）を作る。
    # 1件なら中点、2件なら 42%/58% 地点に置き、頂点付近で 2 スポットを通す。
    fractions = [0.5] if count == 1 else [0.42, 0.58]

    # タグごとに 2 つの呼び名を用意し、複数スポットが重複しないようにする。
    labels = {
        "park": ["静かな小さな公園", "誰もいない児童公園"],
        "cafe": ["路地裏の喫茶店", "灯りの残るカフェ"],
        "convenience_store": ["灯りのコンビニ", "夜更けのコンビニ"],
        "river": ["川沿いの遊歩道", "橋のたもとの水辺"],
        "waterfront": ["水辺のベンチ", "静かな岸辺"],
        "promenade": ["誰もいない遊歩道", "街灯の並ぶ小道"],
        "garden": ["小さな庭園", "手入れされた植え込み"],
        "scenic_lookout": ["小さな見晴らし", "坂の上の眺め"],
        "tree_lined_avenue": ["名もなき並木道", "銀杏の裏通り"],
        "bench": ["路地のベンチ", "木陰のベンチ"],
        "residential": ["静かな住宅街", "灯りのともる路地"],
    }
    names = labels.get(tag, ["寄り道スポット", "もうひとつの寄り道"])
    spots: list[dict] = []
    for i, frac in enumerate(fractions):
        base_lat = origin["lat"] + dlat * frac
        base_lng = origin["lng"] + dlng * frac
        spot = Spot(
            name=names[i % len(names)],
            lat=base_lat + perp_lat,
            lng=base_lng + perp_lng,
            rating=round(4.1 + 0.2 * i, 1),
            user_ratings_total=42 - 9 * i,
            place_id=f"fallback-{tag}-{i}",
            tags=[tag],
            source_tag=tag,
        )
        spots.append(spot.to_dict())
    return spots
