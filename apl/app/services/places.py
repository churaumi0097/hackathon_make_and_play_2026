"""スポット選定（最短ルート沿い探索 ＆ 徹底ノイズ排除フィルタ）。

1. Directions API で実際の徒歩ルート（最短）を引く
2. そのルート上の 35% 地点、75% 地点を中心に Places API で検索する
3. 病院、会社、不動産などの「エモくない雑居ビル」を名前で弾く
"""

from __future__ import annotations

import logging
import math
from dataclasses import asdict, dataclass

import requests
from django.conf import settings

from . import safety

logger = logging.getLogger(__name__)

# --- 調整可能な選定閾値 ---
SEARCH_RADIUS_M = 400  # ルート上から探すので、半径は400m程度で十分届く
MAX_USER_RATINGS_TOTAL = 800
MIN_USER_RATINGS_TOTAL = 3  # 個人商店は口コミが少ないので下限を下げる
MIN_RATING = 3.6

_TIMEOUT_SEC = 6
_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"

_WALKING_MPS = 1.33
_M_PER_DEG = 111_000.0

# 雑居ビル・実用施設を弾くためのNGワードリスト
EXCLUDE_WORDS = [
    "歯科", "クリニック", "病院", "薬局", "整骨院", "鍼灸", 
    "株式会社", "有限会社", "不動産", "パーキング", "駐車場", 
    "ビル", "マンション", "ハイツ", "アパート", "教室", "スクール"
]

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
    # ↓追加：個人商店や商店街を狙うタグ
    "local_shop": {"type": "store", "keyword": "商店街 OR 個人商店"},
}

@dataclass
class Spot:
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


# --- ルート計算ヘルパー（Directions API） ---

def _get_points_along_route(origin: dict, destination: dict, fractions: list[float]) -> list[tuple[float, float]]:
    """Directions APIで最短ルートを引き、指定した割合(例: 0.35)にある緯度経度を返す"""
    params = {
        "origin": f"{origin['lat']},{origin['lng']}",
        "destination": f"{destination['lat']},{destination['lng']}",
        "mode": "walking",
        "language": "ja",
        "key": settings.GOOGLE_MAPS_SERVER_KEY,
    }
    try:
        resp = requests.get(_DIRECTIONS_URL, params=params, timeout=_TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("routes"):
            return []
        
        # ルートの全ステップ（曲がり角ごとの区間）を取得
        steps = data["routes"][0]["legs"][0]["steps"]
        total_dist = sum(step["distance"]["value"] for step in steps)
        
        results = []
        for frac in fractions:
            target_dist = total_dist * frac
            current_dist = 0
            # 目標距離に到達するステップを探す
            for step in steps:
                step_dist = step["distance"]["value"]
                if current_dist + step_dist >= target_dist:
                    # そのステップの開始地点を拠点として採用
                    loc = step["start_location"]
                    results.append((loc["lat"], loc["lng"]))
                    break
                current_dist += step_dist
                
        return results
    except Exception as exc:
        logger.warning("Directions route fetch failed: %s", exc)
        return []


def _get_orthogonal_offset(origin: dict, destination: dict, offset_m: float) -> tuple[float, float]:
    dlat = destination["lat"] - origin["lat"]
    dlng = destination["lng"] - origin["lng"]
    norm = math.hypot(dlat, dlng) or 1e-6
    offset_deg = offset_m / _M_PER_DEG
    return (-dlng / norm * offset_deg, dlat / norm * offset_deg)


# --- API 通信・評価 ---

def _nearby_search(lat: float, lng: float, query: dict) -> list[dict]:
    params = {
        "location": f"{lat},{lng}",
        "radius": SEARCH_RADIUS_M,
        "opennow": "true",
        "language": "ja",
        "key": settings.GOOGLE_MAPS_SERVER_KEY,
    }
    params.update(query)
    try:
        resp = requests.get(_NEARBY_URL, params=params, timeout=_TIMEOUT_SEC)
        resp.raise_for_status()
        return resp.json().get("results", [])
    except Exception:
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
    if spot.rating < MIN_RATING:
        return False
    if not (MIN_USER_RATINGS_TOTAL <= spot.user_ratings_total <= MAX_USER_RATINGS_TOTAL):
        return False
        
    # 【最重要】エモくない雑居ビル・病院・会社を名前で徹底排除
    if any(ng_word in spot.name for ng_word in EXCLUDE_WORDS):
        return False
        
    return True

def _hidden_gem_score(spot: Spot) -> float:
    scarcity = 1.0 - min(spot.user_ratings_total, MAX_USER_RATINGS_TOTAL) / MAX_USER_RATINGS_TOTAL
    return spot.rating + scarcity * 2.0  # マイナー度合いの評価を少し強める


def _search_best_spot(lat: float, lng: float, tag: str, ctx: safety.SafetyContext, seen: set) -> Spot | None:
    query = TAG_TO_QUERY.get(tag, {"keyword": tag})
    candidates = []
    for raw in _nearby_search(lat, lng, query):
        spot = _normalize(raw, tag)
        if not spot or spot.place_id in seen:
            continue
        if not _passes_anti_massproduced(spot):
            continue
        if not safety.is_spot_safe(spot.to_dict(), ctx):
            continue
        candidates.append(spot)
    
    if not candidates:
        return None
        
    candidates.sort(key=_hidden_gem_score, reverse=True)
    best = candidates[0]
    seen.add(best.place_id)
    return best


# --- メインロジック ---

def select_spots(
    origin: dict,
    destination: dict,
    places_tags: list[str],
    ctx: safety.SafetyContext,
    target_extra_minutes: int = 15,
) -> list[dict]:
    
    if not settings.GOOGLE_MAPS_SERVER_KEY:
        return _fallback_zigzag(origin, destination, places_tags, ctx, target_extra_minutes)

    safe_tags = safety.filter_tags(places_tags, ctx) or ["park", "local_shop"]
    has_conv = "convenience_store" in safe_tags

    # 最大スポット数を割り出す（夜間または目標追加時間が5分以下の場合は最大1件、それ以外は最大2件）
    max_spots = 1 if (ctx.is_night or target_extra_minutes <= 5) else 2

    seen_ids: set[str] = set()
    spots_obj: list[Spot] = []

    if has_conv:
        # 1. コンビニがある場合は 35%（序盤）, 50%（中盤）, 75%（終盤）の3点を取得
        route_points = _get_points_along_route(origin, destination, [0.35, 0.50, 0.75])
        if not route_points or len(route_points) < 3:
            return _fallback_zigzag(origin, destination, safe_tags, ctx, target_extra_minutes)

        lat_a, lng_a = route_points[0]
        lat_mid, lng_mid = route_points[1]
        lat_b, lng_b = route_points[2]

        other_tags = [t for t in safe_tags if t != "convenience_store"]
        if not other_tags:
            other_tags = ["park"]
        tag_a = other_tags[0]
        tag_b = other_tags[1] if len(other_tags) > 1 else other_tags[0]

        if max_spots == 1:
            # 1件のみの場合は、中盤(50%)のコンビニのみを採用
            spot_mid = _search_best_spot(lat_mid, lng_mid, "convenience_store", ctx, seen_ids)
            if spot_mid:
                spots_obj.append(spot_mid)
            else:
                spot_alt = _search_best_spot(lat_mid, lng_mid, tag_a, ctx, seen_ids)
                if spot_alt:
                    spots_obj.append(spot_alt)
        else:
            # 2件の場合は、「中盤(50%)にコンビニ ＋ 終盤(75%)に他スポット」の順で並べる（序盤・終盤のコンビニを回避）
            spot_mid = _search_best_spot(lat_mid, lng_mid, "convenience_store", ctx, seen_ids)
            spot_b = _search_best_spot(lat_b, lng_b, tag_b, ctx, seen_ids)

            if spot_mid and spot_b:
                spots_obj.append(spot_mid)
                spots_obj.append(spot_b)
            elif spot_mid:
                # 終盤が見つからない場合は [序盤の他スポット, 中盤のコンビニ] とする
                spot_a = _search_best_spot(lat_a, lng_a, tag_a, ctx, seen_ids)
                if spot_a:
                    spots_obj.append(spot_a)
                spots_obj.append(spot_mid)
            elif spot_b:
                # コンビニが見つからない場合は通常の [序盤, 終盤] とする
                spot_a = _search_best_spot(lat_a, lng_a, tag_a, ctx, seen_ids)
                if spot_a:
                    spots_obj.append(spot_a)
                spots_obj.append(spot_b)
            else:
                # どちらも見つからない場合は [序盤] のみ
                spot_a = _search_best_spot(lat_a, lng_a, tag_a, ctx, seen_ids)
                if spot_a:
                    spots_obj.append(spot_a)
    else:
        # コンビニがない通常の場合は 35%（序盤）, 75%（終盤）の2点を取得
        route_points = _get_points_along_route(origin, destination, [0.35, 0.75])
        if not route_points or len(route_points) < 2:
            return _fallback_zigzag(origin, destination, safe_tags, ctx, target_extra_minutes)

        lat_a, lng_a = route_points[0]
        lat_b, lng_b = route_points[1]

        tag_a = safe_tags[0]
        tag_b = safe_tags[1] if len(safe_tags) > 1 else safe_tags[0]

        spot_a = _search_best_spot(lat_a, lng_a, tag_a, ctx, seen_ids)
        if spot_a:
            spots_obj.append(spot_a)

        if max_spots == 2:
            spot_b = _search_best_spot(lat_b, lng_b, tag_b, ctx, seen_ids)
            if spot_b:
                spots_obj.append(spot_b)

    if not spots_obj:
        return _fallback_zigzag(origin, destination, safe_tags, ctx, target_extra_minutes)

    # 4. 余韻ピン（目的地直前のダミーピン）
    extra_m = max(target_extra_minutes, 1) * 60 * _WALKING_MPS
    offset_m = min(extra_m / 4.0, 300) 
    lat_c = origin["lat"] + (destination["lat"] - origin["lat"]) * 0.90
    lng_c = origin["lng"] + (destination["lng"] - origin["lng"]) * 0.90
    perp_lat, perp_lng = _get_orthogonal_offset(origin, destination, offset_m)
    
    dummy_afterglow = Spot(
        name="余韻の路地",
        lat=lat_c + perp_lat, 
        lng=lng_c + perp_lng,
        rating=0.0,
        user_ratings_total=0,
        place_id="dummy-afterglow-pin",
        tags=["residential"],
        source_tag="residential"
    )
    spots_obj.append(dummy_afterglow)

    return [s.to_dict() for s in spots_obj]


def _fallback_zigzag(
    origin: dict,
    destination: dict,
    safe_tags: list[str],
    ctx: safety.SafetyContext,
    target_extra_minutes: int,
) -> list[dict]:
    tag = safe_tags[0] if safe_tags else "residential"
    extra_m = max(target_extra_minutes, 1) * 60 * _WALKING_MPS
    amplitude_m = extra_m / 4.0 
    perp_lat, perp_lng = _get_orthogonal_offset(origin, destination, amplitude_m)
    
    waypoints = [
        {"frac": 0.25, "mult": 1.0, "name": "静かな曲がり角"},
        {"frac": 0.50, "mult": -1.0, "name": "裏路地の入り口"},
        {"frac": 0.75, "mult": 1.0, "name": "名もなき細道"},
    ]
    if ctx.is_night:
        waypoints = [{"frac": 0.50, "mult": 1.0, "name": "夜の寄り道"}]
        
    spots: list[dict] = []
    for i, wp in enumerate(waypoints):
        base_lat = origin["lat"] + (destination["lat"] - origin["lat"]) * wp["frac"]
        base_lng = origin["lng"] + (destination["lng"] - origin["lng"]) * wp["frac"]
        spot = Spot(
            name=wp["name"],
            lat=base_lat + (perp_lat * wp["mult"]),
            lng=base_lng + (perp_lng * wp["mult"]),
            rating=4.0,
            user_ratings_total=10,
            place_id=f"zigzag-fallback-{i}",
            tags=[tag],
            source_tag=tag,
        )
        spots.append(spot.to_dict())
        
    return spots