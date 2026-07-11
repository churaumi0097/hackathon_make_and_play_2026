"""感情 → ルート マッピングのコアロジック。

docs/emotion_routing.md / docs/spot_selection の仕様を実装する。

- 感情を valence（ネガ↔ポジ）× arousal（低↔高）の2軸で捉える。
- 象限から「ルートテーマ」と「優先 Places タグ」を決める。
- Gemini が使えない場合のキーワードベース・フォールバックもここに持つ。

このモジュールは外部 API に依存しない純粋ロジックなので、
Gemini/Places/Directions のいずれが落ちても最低限のルート生成ができる。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# ---------------------------------------------------------------------------
# 遠回り強度（docs/emotion_routing.md「遠回り強度との掛け合わせ」）
# ---------------------------------------------------------------------------
Intensity = Literal["light", "medium", "deep"]

# 強度 → (目標追加分, POI 数)。安全上限は safety.py 側で別途クランプする。
INTENSITY_PROFILE: dict[str, dict[str, int]] = {
    "light": {"target_extra_minutes": 5, "poi_count": 1},   # 少しだけ
    "medium": {"target_extra_minutes": 15, "poi_count": 2},  # しっかり
    "deep": {"target_extra_minutes": 30, "poi_count": 2},    # とことん（上限内）
}
DEFAULT_INTENSITY: Intensity = "medium"


@dataclass(frozen=True)
class Archetype:
    """象限ごとのルート性格。"""

    key: str
    route_theme: str          # 人間向けのテーマ名（フロント表示にも使う）
    description: str          # ルートの性格
    places_tags: list[str]   # Places API で探索するタグ（優先 POI）
    message_tone: str        # リザルトのメッセージトーン指針


# 象限キー: (valence>=0? "pos":"neg", arousal>=0? "high":"low")
ARCHETYPES: dict[tuple[str, str], Archetype] = {
    ("neg", "high"): Archetype(
        key="cooldown",
        route_theme="頭を冷やす",
        description="長く開けた直線、空や水辺、分岐少なめ。発散・クールダウン。",
        places_tags=["park", "river", "waterfront", "promenade"],
        message_tone="皮肉は軽め、熱を逃がすような労い。",
    ),
    ("neg", "low"): Archetype(
        key="comfort",
        route_theme="そっと寄り添う",
        description="短め・囲まれた・明るい道。慰め・ぬくもり。",
        places_tags=["convenience_store", "cafe", "bench", "residential"],
        message_tone="皮肉は控えめ、労い強め。",
    ),
    ("pos", "high"): Archetype(
        key="afterglow",
        route_theme="余韻のウイニングラン",
        description="景色の良い道、少しの高低差。祝祭・余韻。",
        places_tags=["scenic_lookout", "tree_lined_avenue", "landmark"],
        message_tone="皮肉多め、祝祭感のある一言。",
    ),
    ("pos", "low"): Archetype(
        key="savor",
        route_theme="静かに味わう",
        description="静かでゆるやか、自然多め。沈静・味わい。",
        places_tags=["park", "promenade", "waterfront", "garden"],
        message_tone="皮肉は少なめ、穏やかな労い。",
    ),
}

# ニュートラル（感情未入力時のデフォルト。requirements ①の受け入れ条件）
NEUTRAL_ARCHETYPE = Archetype(
    key="neutral",
    route_theme="すこし寄り道",
    description="無理のない範囲で景色の変わる道を選ぶ。",
    places_tags=["park", "cafe", "promenade"],
    message_tone="やわらかい皮肉と労いを半々で。",
)


def archetype_for(valence: float, arousal: float) -> Archetype:
    """感情ベクトルから象限のアーキタイプを返す。"""
    v_key = "pos" if valence >= 0 else "neg"
    a_key = "high" if arousal >= 0 else "low"
    return ARCHETYPES[(v_key, a_key)]


# ---------------------------------------------------------------------------
# キーワードベースのフォールバック感情解析
#   Gemini が使えない / 失敗した場合に使用（requirements ②の受け入れ条件）。
# ---------------------------------------------------------------------------
@dataclass
class EmotionAnalysis:
    """/api/analyze が返す解析結果。"""

    valence: float
    arousal: float
    route_theme: str
    places_tags: list[str] = field(default_factory=list)
    archetype: str = ""
    source: str = "gemini"  # "gemini" | "fallback"

    def to_dict(self) -> dict:
        return {
            "valence": round(self.valence, 3),
            "arousal": round(self.arousal, 3),
            "route_theme": self.route_theme,
            "places_tags": self.places_tags,
            "archetype": self.archetype,
            "source": self.source,
        }


# プリセット感情（requirements ①のプリセットボタンにも対応）。
# name -> (valence, arousal)
PRESET_EMOTIONS: dict[str, tuple[float, float]] = {
    "後悔": (-0.6, -0.4),
    "悲しみ": (-0.7, -0.5),
    "疲労": (-0.4, -0.7),
    "焦燥": (-0.5, 0.7),
    "怒り": (-0.7, 0.8),
    "不安": (-0.5, 0.4),
    "歓喜": (0.8, 0.7),
    "興奮": (0.7, 0.8),
    "安堵": (0.6, -0.4),
    "充足": (0.7, -0.3),
    "ニュートラル": (0.0, 0.0),
}

# フォールバック用キーワード辞書（部分一致）。valence, arousal を寄せる。
_FALLBACK_KEYWORDS: list[tuple[tuple[str, ...], tuple[float, float]]] = [
    (("怒", "むかつ", "イライラ", "腹立"), (-0.7, 0.8)),
    (("焦", "急", "追われ", "せか"), (-0.5, 0.7)),
    (("不安", "こわ", "怖", "心配"), (-0.5, 0.4)),
    (("後悔", "しくじ", "失敗", "やらかし"), (-0.6, -0.3)),
    (("悲し", "つら", "泣", "さみし", "寂し"), (-0.7, -0.4)),
    (("疲", "しんど", "だる", "へとへと", "くたびれ"), (-0.4, -0.7)),
    (("嬉し", "うれし", "最高", "やった", "歓喜"), (0.8, 0.7)),
    (("興奮", "わくわく", "たのし", "楽し"), (0.7, 0.6)),
    (("安心", "ほっと", "安堵", "落ち着"), (0.6, -0.4)),
    (("満た", "充実", "しあわせ", "幸せ", "満足"), (0.7, -0.2)),
]


def fallback_analyze(text: str, preset: str | None = None) -> EmotionAnalysis:
    """LLM を使わずに感情ベクトルを推定する。

    1. プリセットが指定されていればそれを最優先。
    2. テキストのキーワードから valence/arousal を合成。
    3. 何も当たらなければニュートラル。
    """
    if preset and preset in PRESET_EMOTIONS:
        valence, arousal = PRESET_EMOTIONS[preset]
        arch = _archetype_or_neutral(valence, arousal)
        return EmotionAnalysis(
            valence=valence,
            arousal=arousal,
            route_theme=arch.route_theme,
            places_tags=arch.places_tags,
            archetype=arch.key,
            source="fallback",
        )

    text = (text or "").strip()
    hits: list[tuple[float, float]] = []
    for keywords, vec in _FALLBACK_KEYWORDS:
        if any(k in text for k in keywords):
            hits.append(vec)

    if not hits:
        arch = NEUTRAL_ARCHETYPE
        return EmotionAnalysis(
            valence=0.0,
            arousal=0.0,
            route_theme=arch.route_theme,
            places_tags=arch.places_tags,
            archetype=arch.key,
            source="fallback",
        )

    valence = sum(v for v, _ in hits) / len(hits)
    arousal = sum(a for _, a in hits) / len(hits)
    arch = _archetype_or_neutral(valence, arousal)
    return EmotionAnalysis(
        valence=valence,
        arousal=arousal,
        route_theme=arch.route_theme,
        places_tags=arch.places_tags,
        archetype=arch.key,
        source="fallback",
    )


def _archetype_or_neutral(valence: float, arousal: float) -> Archetype:
    if valence == 0 and arousal == 0:
        return NEUTRAL_ARCHETYPE
    return archetype_for(valence, arousal)


def clamp_unit(value: float) -> float:
    """-1.0〜1.0 にクランプ。"""
    return max(-1.0, min(1.0, float(value)))


def resolve_intensity(intensity: str | None) -> Intensity:
    if intensity in INTENSITY_PROFILE:
        return intensity  # type: ignore[return-value]
    return DEFAULT_INTENSITY
