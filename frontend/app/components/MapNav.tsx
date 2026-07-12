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
import styles from "./MapNav.module.css";

const BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";
const AFTERGLOW_PLACE_ID = "dummy-afterglow-pin";

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
      strokeColor: "#2f80ed",
      strokeOpacity: detourActive ? 0.7 : 0.95,
      strokeWeight: detourActive ? 4 : 7,
      map,
    });
    const detour = new google.maps.Polyline({
      path: route.detour.path,
      strokeColor: "#e94c35",
      strokeOpacity: detourActive ? 1 : 0.4,
      strokeWeight: detourActive ? 6 : 3,
      map,
    });
    overlaysRef.current.push(shortest, detour);

    const infoWindow = new google.maps.InfoWindow();

    route.spots.filter((s) => s.place_id !== AFTERGLOW_PLACE_ID).forEach((s) => {
      const m = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng },
        map,
        title: s.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#e94c35",
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

export function RouteMapView({
  route,
  active = "detour",
  current = null,
}: {
  route: RouteResponse;
  active?: "shortest" | "detour";
  current?: LatLng | null;
}) {
  const [mapsFailed, setMapsFailed] = useState(false);
  const center = route.detour.path[Math.floor(route.detour.path.length / 2)];

  if (!BROWSER_KEY || mapsFailed) {
    return <RouteMapSVG route={route} active={active} current={current} />;
  }

  return (
    <APIProvider apiKey={BROWSER_KEY} onError={() => setMapsFailed(true)}>
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
  );
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
  const [spotIndex, setSpotIndex] = useState(0);

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

  const activeLeg = active === "detour" ? route.detour : route.shortest;
  const visibleSpots = route.spots.filter((spot) => spot.place_id !== AFTERGLOW_PLACE_ID);

  return (
    <div
      className={styles.mapPage}
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg-0)",
      }}
    >
      {/* 地図本体（全画面フルブリード） */}
      <div className={styles.mapCanvas} style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <RouteMapView route={route} active={active} current={current} />
      </div>

      {/* 上部：フローティングのテーマカード（中央寄せ） */}
      <div
        className={styles.sideTop}
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
          className={`floating-card ${styles.sideCard}`}
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
      {visibleSpots.length > 0 && (
        <section className={styles.spotCarousel} aria-label="今回の寄りたいポイント">
          <div className={styles.spotHeading}>
            <div>
              <span>DETOUR SPOT</span>
              <h2>今回の寄りたいポイント</h2>
            </div>
            <span className={styles.spotCount}>{spotIndex + 1} / {visibleSpots.length}</span>
          </div>
          <div className={styles.spotViewport}>
            <div className={styles.spotTrack} style={{ transform: `translateX(-${spotIndex * 100}%)` }}>
              {visibleSpots.map((spot) => (
                <article className={styles.spotCard} key={spot.place_id || spot.name}>
                  <span className={styles.spotPin} aria-hidden="true">●</span>
                  <div>
                    <h3>{spot.name}</h3>
                    {spot.rating > 0 ? (
                      <p>評価: <strong>★ {spot.rating.toFixed(1)}</strong>（{spot.user_ratings_total}件のレビュー）</p>
                    ) : (
                      <p>ルート上のおすすめポイント</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          {visibleSpots.length > 1 && (
            <div className={styles.spotControls}>
              <button type="button" onClick={() => setSpotIndex((index) => (index - 1 + visibleSpots.length) % visibleSpots.length)} aria-label="前のポイント">←</button>
              <div className={styles.spotDots} aria-hidden="true">
                {visibleSpots.map((spot, index) => <span className={index === spotIndex ? styles.activeDot : ""} key={spot.place_id || `${spot.name}-${index}`} />)}
              </div>
              <button type="button" onClick={() => setSpotIndex((index) => (index + 1) % visibleSpots.length)} aria-label="次のポイント">→</button>
            </div>
          )}
        </section>
      )}

      <div
        className={styles.sideBottom}
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
          className={`sheet ${styles.sideSheet}`}
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
            className={`btn ${styles.arriveButton}`}
            style={{ minHeight: 48, fontSize: 15 }}
            onClick={() => onArrive(actualExtra)}
          >
            目的地についた
          </button>

          {/* 常設の安全導線：最短で帰る（1タップ） */}
          <div style={{ display: "flex", gap: 10 }}>
            {active === "detour" ? (
              <button
                className={`btn-danger ${styles.shortestButton}`}
                style={{ flex: 1, minHeight: 44, fontSize: 14 }}
                onClick={() => setActive("shortest")}
              >
                最短で帰る
              </button>
            ) : (
              <button
                className={`btn-ghost ${styles.detourButton}`}
                style={{ flex: 1, minHeight: 44, fontSize: 14 }}
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
