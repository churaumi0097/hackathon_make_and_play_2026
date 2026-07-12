"""Gemini API 連携（感情解析・リザルトメッセージ生成）。

- REST エンドポイント（generativelanguage.googleapis.com）を requests で叩く。
- 失敗（キー未設定・タイムアウト・パース不能・レート制限）時は必ず
  フォールバックへ委譲し、例外を上位に投げない（requirements ②の受け入れ条件）。
"""

from __future__ import annotations

import json
import logging

import requests
from django.conf import settings

from . import emotion_routing as er

logger = logging.getLogger(__name__)

_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_TIMEOUT_SEC = 8

_ANALYZE_SYSTEM = (
    "あなたは感情ナビ『Anti-ShortCut（人類のための遠回りマップ）』の感情解析エンジンです。"
    "ユーザーの生々しい感情テキストを読み、散歩ルートの性格を決めるためのメタデータを返します。"
    "必ず日本語で、指定の JSON スキーマだけを出力してください。"
)

# 象限とタグの候補を提示して、解析を安定させる。
_ANALYZE_INSTRUCTION = """次の感情テキストを解析し、JSON だけを出力してください（前後の説明・マークダウン禁止）。

出力スキーマ:
{
  "valence": number,   // -1.0(ネガティブ) 〜 1.0(ポジティブ)
  "arousal": number,   // -1.0(エネルギー低) 〜 1.0(エネルギー高)
  "route_theme": string, // ルートの性格を表す短い日本語（例: 頭を冷やす / そっと寄り添う / 余韻のウイニングラン / 静かに味わう）
  "places_tags": string[] // Google Places 探索に使う英語タグ。次から2〜4個選ぶ:
                          // park, river, waterfront, promenade, garden, convenience_store,
                          // cafe, bench, residential, scenic_lookout, tree_lined_avenue, landmark
}

参考（象限→テーマ→タグ）:
- 高arousal×ネガ（焦燥・怒り）: 発散/クールダウン → park, river, waterfront, promenade
- 低arousal×ネガ（後悔・疲労）: 慰め → convenience_store, cafe, bench, residential
- 高arousal×ポジ（歓喜）: 余韻/祝祭 → scenic_lookout, tree_lined_avenue, landmark
- 低arousal×ポジ（安堵）: 沈静 → park, promenade, waterfront, garden

感情テキスト:
""".strip()


def _endpoint(action: str) -> str:
    model = settings.GEMINI_MODEL
    key = settings.GEMINI_API_KEY
    return f"{_API_BASE}/{model}:{action}?key={key}"


def _call_generate(prompt: str, *, system: str | None = None,
                   temperature: float = 0.4, max_tokens: int = 512) -> str | None:
    """Gemini generateContent を叩いてテキストを返す。失敗時 None。"""
    if not settings.GEMINI_API_KEY:
        return None

    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    try:
        resp = requests.post(
            _endpoint("generateContent"),
            json=body,
            timeout=_TIMEOUT_SEC,
        )
        resp.raise_for_status()
        data = resp.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])
        )
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
        logger.warning("Gemini generateContent failed: %s", exc)
        return None


def _extract_json(text: str) -> dict | None:
    """テキストから JSON オブジェクトを抽出（```json ブロック等に強い）。"""
    text = text.strip()
    if text.startswith("```"):
        # ```json ... ``` のフェンスを剥がす
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# 1. 感情解析
# ---------------------------------------------------------------------------
def analyze_emotion(text: str, preset: str | None = None) -> er.EmotionAnalysis:
    """感情テキスト → {valence, arousal, route_theme, places_tags}。

    Gemini 失敗時はキーワードベースのフォールバックへ委譲する。
    """
    input_parts = []
    if preset:
        input_parts.append(f"選択された気分ボタン: {preset}")
    if text:
        input_parts.append(f"自由記述テキスト: {text}")
    
    input_text = "\n".join(input_parts) if input_parts else "（未入力）"

    raw = _call_generate(
        _ANALYZE_INSTRUCTION + "\n" + input_text,
        system=_ANALYZE_SYSTEM,
        temperature=0.3,
    )
    parsed = _extract_json(raw) if raw else None
    if not parsed:
        return er.fallback_analyze(text, preset=preset)

    try:
        valence = er.clamp_unit(parsed.get("valence", 0.0))
        arousal = er.clamp_unit(parsed.get("arousal", 0.0))
        route_theme = str(parsed.get("route_theme") or "").strip()
        tags = parsed.get("places_tags") or []
        tags = [str(t).strip() for t in tags if str(t).strip()]
        arch = er._archetype_or_neutral(valence, arousal)
        if not route_theme:
            route_theme = arch.route_theme
        if not tags:
            tags = arch.places_tags
        return er.EmotionAnalysis(
            valence=valence,
            arousal=arousal,
            route_theme=route_theme,
            places_tags=tags[:4],
            archetype=arch.key,
            source="gemini",
        )
    except (TypeError, ValueError) as exc:
        logger.warning("Gemini analyze parse error: %s", exc)
        return er.fallback_analyze(text, preset=preset)


# ---------------------------------------------------------------------------
# 2. リザルトメッセージ（皮肉と労い）
# ---------------------------------------------------------------------------
def _fallback_result_message(analysis: er.EmotionAnalysis, extra_minutes: int) -> str:
    """Gemini 不在時の定型メッセージ（象限のトーンに寄せる）。"""
    m = extra_minutes
    key = analysis.archetype
    table = {
        "cooldown": f"最短より＋{m}分。AIの正解を蹴って、熱をちゃんと逃がしてきましたね。効率? 知りません。",
        "comfort": f"＋{m}分の遠回り。近道では拾えなかった灯りに、少しは慰められましたか。よくがんばりました。",
        "afterglow": f"わざわざ＋{m}分。最短ルートには一生見えない景色を、勝者の顔で歩いてきましたね。最高に無駄で最高です。",
        "savor": f"＋{m}分、急がずに。地図が示す一直線を無視して、静けさをちゃんと味わえました。上出来です。",
        "neutral": f"＋{m}分の素晴らしい非効率。最短を選ばなかった今日のあなたに、花丸を。",
    }
    return table.get(key, table["neutral"])


def generate_result_message(
    analysis: er.EmotionAnalysis,
    extra_minutes: int,
    emotion_text: str = "",
) -> dict:
    """感情＋無駄時間 → 皮肉と労いのメッセージ。

    返り値: {"message": str, "source": "gemini"|"fallback"}
    """
    tone = er._archetype_or_neutral(analysis.valence, analysis.arousal).message_tone
    prompt = f"""あなたはアンチ・ナビゲーションアプリ『Anti-ShortCut』のリザルト・ナレーターです。
ユーザーは最短ルートをあえて拒否し、感情に寄り添う遠回りを歩き切りました。
その「素晴らしい非効率」を、皮肉とねぎらいを効かせて称える一言メッセージを、日本語で90文字以内・1〜2文で書いてください。
トーン指針: {tone}
禁止: 効率化・時短を勧める言葉、説教、絵文字の多用。JSON やマークダウンは不要。本文だけを返す。

感情テキスト: {emotion_text or "（未入力）"}
感情ベクトル: valence={analysis.valence:.2f}, arousal={analysis.arousal:.2f}
最短より余計にかけた時間: {extra_minutes}分
""".strip()

    raw = _call_generate(prompt, temperature=0.9, max_tokens=256)
    if raw:
        msg = raw.strip().strip('"').strip()
        if msg:
            return {"message": msg, "source": "gemini"}
    return {
        "message": _fallback_result_message(analysis, extra_minutes),
        "source": "fallback",
    }
