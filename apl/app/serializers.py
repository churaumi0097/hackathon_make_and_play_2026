"""リクエストのバリデーション用シリアライザ。"""

from __future__ import annotations

from rest_framework import serializers


class LatLngSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)


class AnalyzeSerializer(serializers.Serializer):
    text = serializers.CharField(required=False, allow_blank=True, default="")
    preset = serializers.CharField(required=False, allow_blank=True, allow_null=True,
                                   default=None)


class RouteSerializer(serializers.Serializer):
    text = serializers.CharField(required=False, allow_blank=True, default="")
    preset = serializers.CharField(required=False, allow_blank=True, allow_null=True,
                                   default=None)
    intensity = serializers.ChoiceField(
        choices=["light", "medium", "deep"], required=False, default="medium"
    )
    origin = LatLngSerializer()
    destination = LatLngSerializer()
    # クライアント側で夜間/悪天候を明示指定できる（未指定はサーバー時刻で判定）。
    is_night = serializers.BooleanField(required=False, allow_null=True, default=None)
    bad_weather = serializers.BooleanField(required=False, default=False)


class ResultSerializer(serializers.Serializer):
    text = serializers.CharField(required=False, allow_blank=True, default="")
    extra_minutes = serializers.IntegerField(min_value=0)
    # analyze 済みの感情ベクトルがあれば渡す（無ければ text から再解析）。
    valence = serializers.FloatField(required=False, allow_null=True, default=None)
    arousal = serializers.FloatField(required=False, allow_null=True, default=None)
