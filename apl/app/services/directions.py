"""ルート算出（docs/spot_selection「3. ルート化」）。

選定スポットを Waypoint として Directions API に渡し、
- 最短ルート（waypoint なし）
- 遠回りルート（選定スポット経由）
の座標・所要時間・距離を返す。差分時間も算出する。

Google Maps サーバーキー未設定時は合成ルートを返し、
オフラインでも一連のフローが通るようにする。
"""

from __future__ import annotations

import logging
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
_TIMEOUT_SEC = 6
_MODE = "walking"  # 徒歩ナビ前提


def _decode_polyline(encoded: str) -> list[dict]:
    """Google encoded polyline を [{lat,lng}, ...] にデコード。"""
    points: list[dict] = []
    index = lat = lng = 0
    length = len(encoded)
    while index < length:
        for coord in ("lat", "lng"):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if coord == "lat":
                lat += delta
            else:
                lng += delta
        points.append({"lat": lat / 1e5, "lng": lng / 1e5})
    return points


def _call_directions(
    origin: dict, destination: dict, waypoints: list[dict] | None
) -> dict[str, Any] | None:
    """Directions API を叩く。失敗時 None。"""
    params = {
        "origin": f"{origin['lat']},{origin['lng']}",
        "destination": f"{destination['lat']},{destination['lng']}",
        "mode": _MODE,
        "language": "ja",
        "key": settings.GOOGLE_MAPS_SERVER_KEY,
    }
    if waypoints:
        params["waypoints"] = "|".join(
            f"{w['lat']},{w['lng']}" for w in waypoints
        )
    try:
        resp = requests.get(_DIRECTIONS_URL, params=params, timeout=_TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "OK":
            logger.warning("Directions status=%s error=%s", data.get("status"),
                           data.get("error_message"))
            return None
        return data
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Directions request failed: %s", exc)
        return None


def _summarize_route(data: dict, kind: str) -> dict:
    """Directions レスポンスを {kind, duration_sec, distance_m, path} に集約。"""
    route = data["routes"][0]
    legs = route["legs"]
    duration_sec = sum(leg["duration"]["value"] for leg in legs)
    distance_m = sum(leg["distance"]["value"] for leg in legs)
    path = _decode_polyline(route["overview_polyline"]["points"])
    return {
        "kind": kind,
        "duration_sec": duration_sec,
        "duration_min": round(duration_sec / 60),
        "distance_m": distance_m,
        "path": path,
    }


def build_routes(
    origin: dict, destination: dict, spots: list[dict]
) -> dict[str, Any]:
    """最短ルートと遠回りルート、差分を返す。

    返り値:
    {
      "shortest": {...}, "detour": {...},
      "extra_minutes": int, "extra_distance_m": int,
      "waypoints": [...spots...], "source": "google"|"fallback"
    }
    """
    waypoints = [{"lat": s["lat"], "lng": s["lng"]} for s in spots]

    if settings.GOOGLE_MAPS_SERVER_KEY:
        shortest_raw = _call_directions(origin, destination, None)
        detour_raw = _call_directions(origin, destination, waypoints)
        if shortest_raw and detour_raw:
            shortest = _summarize_route(shortest_raw, "shortest")
            detour = _summarize_route(detour_raw, "detour")
            return _assemble(shortest, detour, spots, "google")

    # フォールバック（合成ルート）
    return _fallback_routes(origin, destination, spots)


def _assemble(shortest: dict, detour: dict, spots: list[dict], source: str) -> dict:
    extra_minutes = max(0, detour["duration_min"] - shortest["duration_min"])
    extra_distance_m = max(0, detour["distance_m"] - shortest["distance_m"])
    return {
        "shortest": shortest,
        "detour": detour,
        "extra_minutes": extra_minutes,
        "extra_distance_m": extra_distance_m,
        "waypoints": spots,
        "source": source,
    }


def _fallback_routes(origin: dict, destination: dict, spots: list[dict]) -> dict:
    """合成ルート。直線を折れ線化し、経由スポットを通す。"""
    import math

    def interp(a: dict, b: dict, n: int) -> list[dict]:
        return [
            {
                "lat": a["lat"] + (b["lat"] - a["lat"]) * i / n,
                "lng": a["lng"] + (b["lng"] - a["lng"]) * i / n,
            }
            for i in range(n + 1)
        ]

    def haversine_m(a: dict, b: dict) -> float:
        r = 6371000.0
        p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
        dp = math.radians(b["lat"] - a["lat"])
        dl = math.radians(b["lng"] - a["lng"])
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(math.sqrt(h))

    def path_len(path: list[dict]) -> float:
        return sum(haversine_m(path[i], path[i + 1]) for i in range(len(path) - 1))

    walking_mps = 1.33  # 徒歩 約 4.8km/h

    shortest_path = interp(origin, destination, 12)
    shortest_dist = path_len(shortest_path)
    shortest = {
        "kind": "shortest",
        "duration_sec": round(shortest_dist / walking_mps),
        "duration_min": max(1, round(shortest_dist / walking_mps / 60)),
        "distance_m": round(shortest_dist),
        "path": shortest_path,
    }

    detour_path: list[dict] = [origin]
    prev = origin
    for s in spots:
        wp = {"lat": s["lat"], "lng": s["lng"]}
        detour_path += interp(prev, wp, 6)[1:]
        prev = wp
    detour_path += interp(prev, destination, 6)[1:]
    detour_dist = path_len(detour_path)
    detour = {
        "kind": "detour",
        "duration_sec": round(detour_dist / walking_mps),
        "duration_min": max(1, round(detour_dist / walking_mps / 60)),
        "distance_m": round(detour_dist),
        "path": detour_path,
    }

    return _assemble(shortest, detour, spots, "fallback")
