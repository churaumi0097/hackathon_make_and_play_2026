"""安全要件（docs/requirements.md「安全要件（最優先）」）の実装。

夜間の孤立スポット回避・遠回り時間の上限・危険 POI の除外を担う。
閾値はすべて定数にまとめ、調整可能にする。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time

# ---------------------------------------------------------------------------
# 調整可能な安全パラメータ（すべてここに集約）
# ---------------------------------------------------------------------------

# 夜間とみなす時間帯（ローカル時刻）。この間は制約を厳しくする。
NIGHT_START = time(19, 0)   # 19:00
NIGHT_END = time(6, 0)      # 翌 06:00

# 遠回りの総追加時間の上限（分）。昼と夜で分ける。
MAX_EXTRA_MINUTES_DAY = 40
MAX_EXTRA_MINUTES_NIGHT = 15

# 遠回りの総追加距離の上限（メートル）。
MAX_EXTRA_DISTANCE_DAY_M = 3500
MAX_EXTRA_DISTANCE_NIGHT_M = 1500

# 夜間に避けたい「孤立・水辺・暗所」系の Places タグ。
NIGHT_AVOID_TAGS = {
    "river",
    "waterfront",
    "scenic_lookout",
    "promenade",
    "garden",
}

# 悪天候時に避けたい POI（水辺など）。
BAD_WEATHER_AVOID_TAGS = {"river", "waterfront", "promenade"}

# 夜間、経由地は「明るく人通りのある場所」を優先するため、
# レビュー総数がこの値未満の“孤立しすぎ”スポットは夜は避ける。
NIGHT_MIN_RATINGS_TOTAL = 20


@dataclass(frozen=True)
class SafetyContext:
    """1リクエストぶんの安全判定コンテキスト。"""

    is_night: bool
    bad_weather: bool = False

    @property
    def max_extra_minutes(self) -> int:
        return MAX_EXTRA_MINUTES_NIGHT if self.is_night else MAX_EXTRA_MINUTES_DAY

    @property
    def max_extra_distance_m(self) -> int:
        return (
            MAX_EXTRA_DISTANCE_NIGHT_M if self.is_night else MAX_EXTRA_DISTANCE_DAY_M
        )


def is_night_now(now: datetime | None = None) -> bool:
    """現在（またはローカル指定時刻）が夜間かどうか。"""
    if now is None:
        import datetime as dt
        # 日本時間 (UTC+9) を明示的に取得
        jst = dt.timezone(dt.timedelta(hours=9))
        now = dt.datetime.now(jst)
    t = now.time()
    if NIGHT_START <= NIGHT_END:
        return NIGHT_START <= t < NIGHT_END
    # 日をまたぐ（19:00〜翌6:00）ケース
    return t >= NIGHT_START or t < NIGHT_END


def build_context(
    *, is_night: bool | None = None, bad_weather: bool = False
) -> SafetyContext:
    """安全コンテキストを生成。is_night 未指定なら現在時刻から判定。"""
    if is_night is None:
        is_night = is_night_now()
    return SafetyContext(is_night=is_night, bad_weather=bad_weather)


def filter_tags(tags: list[str], ctx: SafetyContext) -> list[str]:
    """夜間・悪天候で危険な探索タグを落とす。全滅時は安全なフォールバックを返す。"""
    result = list(tags)
    if ctx.is_night:
        result = [t for t in result if t not in NIGHT_AVOID_TAGS]
    if ctx.bad_weather:
        result = [t for t in result if t not in BAD_WEATHER_AVOID_TAGS]
    if not result:
        # 夜間でも安全側の「灯りのある」タグにフォールバック。
        result = ["convenience_store", "cafe"]
    return result


def is_spot_safe(spot: dict, ctx: SafetyContext) -> bool:
    """個々のスポットが安全条件を満たすか。

    spot は places.py が正規化した dict を想定:
      {"user_ratings_total": int, "tags": list[str], ...}
    """
    if ctx.is_night:
        # 夜は孤立しすぎ（レビュー極少）の場所を避ける。
        if spot.get("user_ratings_total", 0) < NIGHT_MIN_RATINGS_TOTAL:
            return False
        # 夜に避けたいタグを含む場所は除外。
        if set(spot.get("tags", [])) & NIGHT_AVOID_TAGS:
            return False
    if ctx.bad_weather and (set(spot.get("tags", [])) & BAD_WEATHER_AVOID_TAGS):
        return False
    return True


def clamp_extra_minutes(target_extra_minutes: int, ctx: SafetyContext) -> int:
    """遠回りの目標追加時間を安全上限でクランプ。"""
    return min(target_extra_minutes, ctx.max_extra_minutes)
