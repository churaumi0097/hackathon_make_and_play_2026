// バックエンド API クライアント。
// シークレットは扱わない。呼ぶのは公開 API のみ。

import type {
  LatLng,
  ResultResponse,
  RouteRequest,
  RouteResponse,
} from "./types";

// ブラウザからDjangoへ直接接続せず、Next.jsの同一オリジンプロキシを使う。
// これにより本番のCORS、HTTPS mixed-content、ビルド時NEXT_PUBLIC_*依存を避ける。
const API_BASE = "/api/backend";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(`API ${path} failed (${res.status}) ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`health failed ${res.status}`);
  return res.json();
}

export function fetchRoute(req: RouteRequest): Promise<RouteResponse> {
  return postJSON<RouteResponse>("/route", req);
}

export async function fetchGeocode(query: string): Promise<LatLng> {
  const params = new URLSearchParams({ query });
  const res = await fetch(`${API_BASE}/geocode?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`geocode failed (${res.status})`);
  }

  const data = (await res.json()) as {
    lat?: unknown;
    lng?: unknown;
    location?: { lat?: unknown; lng?: unknown };
  };
  const lat = Number(data.lat ?? data.location?.lat);
  const lng = Number(data.lng ?? data.location?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("geocode response does not contain valid coordinates");
  }

  return { lat, lng };
}

export function fetchResult(req: {
  text: string;
  extra_minutes: number;
  valence?: number;
  arousal?: number;
}): Promise<ResultResponse> {
  return postJSON<ResultResponse>("/result", req);
}
