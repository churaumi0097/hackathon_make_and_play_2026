// lat/lng のパスを 2D 描画座標へ投影するヘルパー。
// Google Maps ブラウザキーが無い時の SVG フォールバック地図や、
// リザルトのシェア画像（Canvas）で共有して使う。

import type { LatLng } from "./types";

export type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export function boundsOf(paths: LatLng[][]): Box {
  const pts = paths.flat();
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

// 与えた box を width×height（padding 込み）に収める投影関数を返す。
// 緯度は上が大きいので y を反転する。
export function projector(
  box: Box,
  width: number,
  height: number,
  padding = 24,
) {
  const latSpan = box.maxLat - box.minLat || 1e-6;
  const lngSpan = box.maxLng - box.minLng || 1e-6;
  // 緯度による経度圧縮を軽く補正（見た目の歪み低減）。
  const midLat = (box.maxLat + box.minLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180) || 1;

  const effLngSpan = lngSpan * lngScale;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(innerW / effLngSpan, innerH / latSpan);

  const drawW = effLngSpan * scale;
  const drawH = latSpan * scale;
  const offX = padding + (innerW - drawW) / 2;
  const offY = padding + (innerH - drawH) / 2;

  return (p: LatLng): [number, number] => {
    const x = offX + (p.lng - box.minLng) * lngScale * scale;
    const y = offY + (box.maxLat - p.lat) * scale;
    return [x, y];
  };
}

export function toPolyline(
  path: LatLng[],
  project: (p: LatLng) => [number, number],
): string {
  return path.map((p) => project(p).join(",")).join(" ");
}
