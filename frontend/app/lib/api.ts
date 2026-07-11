// バックエンド API クライアント。
// シークレットは扱わない。呼ぶのは公開 API のみ。

import type {
  ResultResponse,
  RouteRequest,
  RouteResponse,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";

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

export function fetchResult(req: {
  text: string;
  extra_minutes: number;
  valence?: number;
  arousal?: number;
}): Promise<ResultResponse> {
  return postJSON<ResultResponse>("/result", req);
}
