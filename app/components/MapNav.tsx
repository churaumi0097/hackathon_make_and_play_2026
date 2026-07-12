"use client";

// 地図描画・ナビ（task 5）。
// - ブラウザキーがあれば @vis.gl/react-google-maps で実地図を表示。
// - 無ければ SVG フォールバック地図（RouteMapSVG）。
// - 最短ルート＝薄い線 / 遠回りルート＝強調線。
// - 現在地トラッキング（watchPosition）。
// - 「最短で帰る」を常時表示（1タップで最短ルートへ切替＝安全要件）。

import { useEffect, useRef, useState } from "react";
import {
  APIProvider,
  ColorScheme,
  Map,
  useMap,
} from "@vis.gl/react-google-maps";
import RouteMapSVG from "./RouteMapSVG";
import type { LatLng, RouteResponse } from "../lib/types";

const BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

// 実地図に重ねる polyline / marker を命令的に描画する内部コンポーネント。
function GoogleOverlays({
  route,
  active,
  current,
}: {
  route: RouteResponse;
  active: "shortest" | "detour";
  current: LatLng | null;
}) {
  const map = useMap();
  const overlaysRef = useRef<google.maps.MVCObject[]>([]);
  const curMarkerRef = useRef<google.maps.Marker | null>(null);

  // ルート・スポット描画（active 変化で線の強調を切替）。
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    overlaysRef.current.forEach((o) => (o as google.maps.Polyline).setMap(null));
    overlaysRef.current = [];

    const detourActive = active === "detour";

    const shortest = new google.maps.Polyline({
      path: route.shortest.path,
      strokeColor: "#aab2bd",
      strokeOpacity: detourActive ? 0.7 : 0.95,
      strokeWeight: detourActive ? 4 : 7,
      map,
    });
    const detour = new google.maps.Polyline({
      path: route.detour.path,
      strokeColor: "#00b14f",
      strokeOpacity: detourActive ? 1 : 0.4,
      strokeWeight: detourActive ? 8 : 4,
      map,
    });
    overlaysRef.current.push(shortest, detour);

    const infoWindow = new google.maps.InfoWindow();

    route.spots.forEach((s) => {
      const m = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng },
        map,
        title: s.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#00b14f",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });

      m.addListener("click", () => {
        let content = "";
        if (s.place_id === "dummy-afterglow-pin") {
          content = `
            <div style="color: #16181c; font-family: sans-serif; padding: 4px 8px;">
              <div style="font-weight: 700; font-size: 14px;">${s.name}</div>
              <div style="font-size: 12px; color: #656d76; margin-top: 2px;">もうすぐ目的地。最後の余韻を楽しんでね。</div>
            </div>
          `;
        } else {
          content = `
            <div style="color: #16181c; font-family: sans-serif; padding: 4px 8px;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">${s.name}</div>
              <div style="font-size: 12px; color: #656d76;">
                評価: ⭐️${s.rating.toFixed(1)} (${s.user_ratings_total}件のレビュー)
              </div>
            </div>
          `;
        }
        infoWindow.setContent(content);
        infoWindow.open(map, m);
      });

      overlaysRef.current.push(m as unknown as google.maps.MVCObject);
    });

    // 出発地・目的地
    const origin = route.detour.path[0];
    const dest = route.detour.path[route.detour.path.length - 1];
    [origin, dest].forEach((p, i) => {
      const m = new google.maps.Marker({
        position: p,
        map,
        label: {
          text: i === 0 ? "出発" : "目的地",
          color: "#16181c",
          fontSize: "11px",
          fontWeight: "700",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: i === 0 ? "#16181c" : "#ffffff",
          fillOpacity: 1,
          strokeColor: i === 0 ? "#ffffff" : "#16181c",
          strokeWeight: 2,
        },
      });
      overlaysRef.current.push(m as unknown as google.maps.MVCObject);
    });

    // 全体が収まるよう調整
    const bounds = new google.maps.LatLngBounds();
    route.detour.path.forEach((p) => bounds.extend(p));
    route.shortest.path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 60);

    return () => {
      overlaysRef.current.forEach((o) => (o as google.maps.Polyline).setMap(null));
      overlaysRef.current = [];
      infoWindow.close();
    };
  }, [map, route, active]);

  // 現在地マーカー
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    if (!current) return;
    if (!curMarkerRef.current) {
      curMarkerRef.current = new google.maps.Marker({
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#1a73e8",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        zIndex: 999,
      });
    }
    curMarkerRef.current.setPosition(current);
  }, [map, current]);

  return null;
}

export default function MapNav({
  route,
  onArrive,
  onRestart,
}: {
  route: RouteResponse;
  // 到着時：実際に費やした「感情に使った時間(分)」を渡す。
  onArrive: (actualExtraMinutes: number) => void;
  onRestart: () => void;
}) {
  const [active, setActive] = useState<"shortest" | "detour">("detour");
  const [current, setCurrent] = useState<LatLng | null>(null);

  // 現在地トラッキング
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setCurrent({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // 到着時の「感情に使った時間」：遠回り継続なら差分、最短に切替済みなら 0。
  const actualExtra = active === "detour" ? route.extra_minutes : 0;

  const center = route.detour.path[Math.floor(route.detour.path.length / 2)];

  const activeLeg = active === "detour" ? route.detour : route.shortest;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg-0)",
      }}
    >
      {/* 地図本体（全画面フルブリード） */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        {BROWSER_KEY ? (
          <APIProvider apiKey={BROWSER_KEY}>
            <Map
              defaultCenter={center}
              defaultZoom={15}
              colorScheme={ColorScheme.LIGHT}
              disableDefaultUI
              gestureHandling="greedy"
              style={{ width: "100%", height: "100%" }}
            >
              <GoogleOverlays route={route} active={active} current={current} />
            </Map>
          </APIProvider>
        ) : (
          <div style={{ width: "100%", height: "100%" }}>
            <RouteMapSVG route={route} active={active} current={current} />
          </div>
        )}
      </div>

      {/* 上部：フローティングのテーマカード（中央寄せ） */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          padding: "16px 16px 0",
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          className="floating-card"
          style={{ width: "100%", maxWidth: 560, padding: "14px 18px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--ember)",
                flex: "none",
              }}
            />
            <div className="serif" style={{ fontSize: 20, fontWeight: 800 }}>
              {route.emotion.route_theme}ルート
            </div>
            <div
              style={{
                marginLeft: "auto",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--ember)",
                background: "var(--ember-glow)",
                padding: "4px 10px",
                borderRadius: 999,
              }}
            >
              ＋{route.extra_minutes}分
            </div>
          </div>
          {route.safety.is_night && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-muted)" }}>
              🌙 夜なので、安全にひかえめの寄り道にしたよ
            </div>
          )}
        </div>
      </div>

      {/* 下部：Grab風ボトムシート（中央寄せ・角丸・ハンドル） */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          className="sheet"
          style={{
            width: "100%",
            maxWidth: 560,
            padding: "12px 18px calc(18px + env(safe-area-inset-bottom))",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div className="sheet-handle" />
          <div
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "var(--ink-muted)",
            }}
          >
            {active === "detour" ? "ゆっくり寄り道してるよ" : "まっすぐ帰り道だよ"}
            {" ・ あと"}
            {activeLeg.duration_min}分ほど
          </div>

          {/* 到着（デモ：実歩行の代わりに到着を宣言） */}
          <button
            className="btn"
            style={{ minHeight: 60, fontSize: 18 }}
            onClick={() => onArrive(actualExtra)}
          >
            目的地についた
          </button>

          {/* 常設の安全導線：最短で帰る（1タップ） */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn-danger"
              style={{ flex: 1, minHeight: 54, fontSize: 16 }}
              onClick={() => setActive("shortest")}
              disabled={active === "shortest"}
            >
              {active === "shortest" ? "最短に切り替えたよ" : "最短で帰る"}
            </button>
            {active === "shortest" && (
              <button
                className="btn-ghost"
                style={{ flex: 1, minHeight: 54 }}
                onClick={() => setActive("detour")}
              >
                遠回りに戻す
              </button>
            )}
          </div>

          <button
            onClick={onRestart}
            style={{
              background: "none",
              border: "none",
              color: "var(--ink-faint)",
              fontSize: 13,
              padding: 4,
            }}
          >
            最初からやり直す
          </button>
        </div>
      </div>
    </div>
  );
}
