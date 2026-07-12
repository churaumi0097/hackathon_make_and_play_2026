from __future__ import annotations

import logging
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_TIMEOUT_SEC = 6


def geocode_address(address: str) -> dict | None:
    """地名や住所のテキストを緯度経度 {"lat": float, "lng": float} に変換する。失敗時は None を返す。"""
    if not settings.GOOGLE_MAPS_SERVER_KEY:
        logger.warning("Geocoder: GOOGLE_MAPS_SERVER_KEY is not set.")
        return None

    params = {
        "address": address,
        "key": settings.GOOGLE_MAPS_SERVER_KEY,
        "language": "ja",
    }

    try:
        resp = requests.get(_GEOCODE_URL, params=params, timeout=_TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status")

        if status != "OK":
            logger.warning(
                "Geocoding API status=%s error=%s",
                status,
                data.get("error_message"),
            )
            return None

        results = data.get("results", [])
        if not results:
            return None

        loc = results[0]["geometry"]["location"]
        return {
            "lat": float(loc["lat"]),
            "lng": float(loc["lng"]),
            "formatted_address": results[0].get("formatted_address", ""),
        }
    except (requests.RequestException, KeyError, ValueError, TypeError) as exc:
        logger.warning("Geocoding failed for '%s': %s", address, exc)
        return None
