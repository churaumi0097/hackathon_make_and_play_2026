"""API エンドポイント。

- GET  /api/health   … ヘルスチェック
- POST /api/analyze  … 感情解析（Gemini→フォールバック）
- POST /api/route    … 感情解析＋スポット選定＋ルート算出の一連フロー
- POST /api/result   … 皮肉と労いのリザルトメッセージ生成

シークレット（API キー）はサーバー側でのみ使用し、レスポンスに含めない。
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import (
    AnalyzeSerializer,
    ResultSerializer,
    RouteSerializer,
)
from .services import directions, emotion_routing as er, gemini, places, safety


@api_view(["GET"])
def health(request):
    """フロントの疎通確認用。"""
    return Response({"status": "ok", "service": "anti-shortcut-api"})


@api_view(["POST"])
def analyze(request):
    """感情テキスト → {valence, arousal, route_theme, places_tags}。"""
    ser = AnalyzeSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data

    analysis = gemini.analyze_emotion(data["text"], preset=data.get("preset"))
    return Response(analysis.to_dict())


@api_view(["POST"])
def route(request):
    """感情＋現在地/目的地 → 遠回りルート＋最短ルート＋差分時間。"""
    ser = RouteSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data

    origin = dict(data["origin"])
    destination = dict(data["destination"])

    # 1) 感情解析（Gemini→フォールバック）
    analysis = gemini.analyze_emotion(data["text"], preset=data.get("preset"))

    # 2) 安全コンテキスト（夜間/悪天候）
    ctx = safety.build_context(
        is_night=data.get("is_night"),
        bad_weather=data.get("bad_weather", False),
    )

    # 3) 遠回り強度 → 目標追加時間（安全上限でクランプ）
    intensity = er.resolve_intensity(data.get("intensity"))
    profile = er.INTENSITY_PROFILE[intensity]
    target_extra = safety.clamp_extra_minutes(
        profile["target_extra_minutes"], ctx
    )

    # 4) スポット選定（アンチ量産型＋安全フィルタ）
    spots = places.select_spots(
        origin, destination, analysis.places_tags, ctx,
        target_extra_minutes=target_extra,
    )
    # ダミーの余韻ピンがあれば一旦リストから退避させる
    dummy_spot = None
    if spots and spots[-1].get("place_id") == "dummy-afterglow-pin":
        dummy_spot = spots.pop()

    # 夜間は経由スポットを 1 件までに絞る（安全側）。
    max_spots = 1 if ctx.is_night else profile["poi_count"]
    spots = spots[:max_spots]

    # 退避させておいた余韻ピンを最後尾に戻す
    if dummy_spot:
        spots.append(dummy_spot)

    # 5) ルート算出（最短＋遠回り＋差分）
    routes = directions.build_routes(origin, destination, spots)

    # 6) 安全上限を「実ルート」にも適用（docs: 総時間に上限／満たせなければ強度を落とす）。
    #    実測の遠回り時間が上限を超えたら、経由地を減らして再計算する。
    while routes["extra_minutes"] > ctx.max_extra_minutes and spots:
        spots = spots[:-1]
        routes = directions.build_routes(origin, destination, spots)
        spots = routes["waypoints"]

    return Response(
        {
            "emotion": analysis.to_dict(),
            "intensity": intensity,
            "target_extra_minutes": target_extra,
            "safety": {
                "is_night": ctx.is_night,
                "bad_weather": ctx.bad_weather,
                "max_extra_minutes": ctx.max_extra_minutes,
                "max_extra_distance_m": ctx.max_extra_distance_m,
            },
            "spots": spots,
            "shortest": routes["shortest"],
            "detour": routes["detour"],
            "extra_minutes": routes["extra_minutes"],
            "extra_distance_m": routes["extra_distance_m"],
            "route_source": routes["source"],
        }
    )


@api_view(["POST"])
def result(request):
    """感情＋無駄時間 → 皮肉と労いのメッセージ。"""
    ser = ResultSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data

    # 感情ベクトルが渡っていればそれを使い、無ければテキストから再解析。
    if data.get("valence") is not None and data.get("arousal") is not None:
        valence = er.clamp_unit(data["valence"])
        arousal = er.clamp_unit(data["arousal"])
        arch = er._archetype_or_neutral(valence, arousal)
        analysis = er.EmotionAnalysis(
            valence=valence,
            arousal=arousal,
            route_theme=arch.route_theme,
            places_tags=arch.places_tags,
            archetype=arch.key,
            source="client",
        )
    else:
        analysis = gemini.analyze_emotion(data["text"])

    message = gemini.generate_result_message(
        analysis, data["extra_minutes"], emotion_text=data["text"]
    )
    return Response(
        {
            "message": message["message"],
            "message_source": message["source"],
            "extra_minutes": data["extra_minutes"],
            "emotion": analysis.to_dict(),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
def geocode(request):
    """地名テキスト → {lat, lng, formatted_address}。"""
    query = request.query_params.get("query", "").strip()
    if not query:
        return Response(
            {"error": "query parameter is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # サービス層からジオコーディングを実行
    from .services import geocoder

    res = geocoder.geocode_address(query)
    if not res:
        return Response(
            {"error": f"Could not geocode query '{query}'"},
            status=status.HTTP_404_NOT_FOUND,
        )

    return Response(res)

