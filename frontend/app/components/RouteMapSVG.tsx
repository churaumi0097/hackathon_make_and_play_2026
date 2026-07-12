"use client";

// Google Maps ブラウザキーが無い場合の SVG フォールバック地図。
// 最短ルート＝薄い線、遠回りルート＝強調線で描画する（task 5 の要件を
// キー無しでも満たすため）。実地図と同じ配色ルールを使う。

import { useMemo } from "react";
import { boundsOf, projector, toPolyline } from "../lib/geo";
import type { LatLng, RouteResponse } from "../lib/types";

const W = 440;
const H = 460;

export default function RouteMapSVG({
  route,
  active,
  current,
}: {
  route: RouteResponse;
  active: "shortest" | "detour";
  current: LatLng | null;
}) {
  const { shortLine, detourLine, project } = useMemo(() => {
    const box = boundsOf([route.shortest.path, route.detour.path]);
    const project = projector(box, W, H, 34);
    return {
      shortLine: toPolyline(route.shortest.path, project),
      detourLine: toPolyline(route.detour.path, project),
      project,
    };
  }, [route]);

  const origin = route.detour.path[0];
  const dest = route.detour.path[route.detour.path.length - 1];
  const [ox, oy] = project(origin);
  const [dx, dy] = project(dest);
  const cur = current ? project(current) : null;

  const detourActive = active === "detour";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      style={{ display: "block", background: "#e8edf2" }}
      role="img"
      aria-label="ルート地図"
    >
      {/* うっすらグリッド（地図の下地） */}
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="rgba(20,40,60,0.06)"
            strokeWidth="1"
          />
        </pattern>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {/* 最短ルート：薄い破線（脇役） */}
      <polyline
        points={shortLine}
        fill="none"
        stroke="#2f80ed"
        strokeOpacity={detourActive ? 0.5 : 0.95}
        strokeWidth={detourActive ? 2.5 : 5}
        strokeDasharray="2 8"
        strokeLinecap="round"
      />

      {/* 遠回りルート：強調線（主役） */}
      <polyline
        points={detourLine}
        fill="none"
        stroke="var(--ember)"
        strokeOpacity={detourActive ? 1 : 0.4}
        strokeWidth={detourActive ? 5 : 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={detourActive ? "url(#glow)" : undefined}
      />

      {/* 経由スポット */}
      {route.spots.filter((s) => s.place_id !== "dummy-afterglow-pin").map((s, i) => {
        const [x, y] = project(s);
        return (
          <g key={s.place_id || i}>
            <circle cx={x} cy={y} r={7} fill="var(--ember-strong)" opacity={detourActive ? 1 : 0.5} />
            <circle cx={x} cy={y} r={13} fill="none" stroke="var(--ember)" strokeOpacity={0.4} />
          </g>
        );
      })}

      {/* 出発地・目的地 */}
      <circle cx={ox} cy={oy} r={8} fill="var(--ink)" />
      <text x={ox + 12} y={oy + 4} fill="var(--ink-muted)" fontSize="12">
        出発
      </text>
      <circle cx={dx} cy={dy} r={8} fill="none" stroke="var(--ink)" strokeWidth={2.5} />
      <text x={dx + 12} y={dy + 4} fill="var(--ink-muted)" fontSize="12">
        目的地
      </text>

      {/* 現在地 */}
      {cur && (
        <g>
          <circle cx={cur[0]} cy={cur[1]} r={16} fill="var(--ember-glow)">
            <animate attributeName="r" values="10;18;10" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx={cur[0]} cy={cur[1]} r={6} fill="var(--ember-strong)" />
        </g>
      )}
    </svg>
  );
}
