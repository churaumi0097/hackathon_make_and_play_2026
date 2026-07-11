"use client";

// 感情入力画面（requirements ①）。
// ペルソナ「アオイ」向け：複雑な設定・細かい文字を避け、大きく・少ない選択で。
// フリーテキスト＋プリセット感情＋遠回り強度＋現在地(Geolocation)。
// 目的地は既定で自動、必要な人だけ任意で開く。

import { useEffect, useState } from "react";
import type { Intensity, LatLng } from "../lib/types";

// label はアオイ向けのやさしい表示、value はバックエンドのプリセット感情キー。
const PRESETS: { label: string; emoji: string; value: string }[] = [
  { label: "つかれた", emoji: "😮‍💨", value: "疲労" },
  { label: "もやもや", emoji: "🌀", value: "不安" },
  { label: "へこんだ", emoji: "😔", value: "悲しみ" },
  { label: "うれしい", emoji: "😊", value: "歓喜" },
  { label: "ほっとした", emoji: "🍵", value: "安堵" },
  { label: "いらいら", emoji: "😤", value: "怒り" },
];

const INTENSITY_LABELS: { key: Intensity; label: string; emoji: string; sub: string }[] = [
  { key: "light", label: "ちょっと", emoji: "🍃", sub: "5分くらい" },
  { key: "medium", label: "ほどよく", emoji: "🌿", sub: "15分くらい" },
  { key: "deep", label: "たっぷり", emoji: "🌳", sub: "30分くらい" },
];

export type EmotionSubmit = {
  text: string;
  preset: string | null;
  intensity: Intensity;
  origin: LatLng;
  destination: LatLng;
};

type GeoState =
  | { status: "loading" }
  | { status: "ready"; coords: LatLng }
  | { status: "error"; message: string };

export default function EmotionInput({
  onSubmit,
}: {
  onSubmit: (v: EmotionSubmit) => void;
}) {
  const [text, setText] = useState("");
  const [preset, setPreset] = useState<string | null>(null);
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [geo, setGeo] = useState<GeoState>({ status: "loading" });
  const [showDest, setShowDest] = useState(false);
  const [destText, setDestText] = useState("");

  const runGeolocation = () => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "位置情報が使えないみたい" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGeo({
          status: "ready",
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }),
      () => setGeo({ status: "error", message: "現在地をオンにしてね" }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const requestLocation = () => {
    setGeo({ status: "loading" });
    runGeolocation();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runGeolocation();
  }, []);

  const parseDestination = (origin: LatLng): LatLng => {
    const m = destText.trim().match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // 既定：現在地の少し先（おうち方向のデモ地点）。
    return { lat: origin.lat + 0.012, lng: origin.lng + 0.011 };
  };

  const canSubmit = geo.status === "ready";

  const handleSubmit = () => {
    if (geo.status !== "ready") return;
    onSubmit({
      text: text.trim(),
      preset,
      intensity,
      origin: geo.coords,
      destination: parseDestination(geo.coords),
    });
  };

  return (
    <div className="shell" style={{ padding: "36px 22px 44px" }}>
      <header className="fade-in" style={{ marginBottom: 30 }}>
        <div style={{ fontSize: 30, marginBottom: 12 }} aria-hidden>
          🌙
        </div>
        <h1
          className="serif"
          style={{ fontSize: 32, lineHeight: 1.45, margin: 0, fontWeight: 700 }}
        >
          おつかれさま。
          <br />
          いま、どんな気分？
        </h1>
        <p style={{ color: "var(--ink-muted)", fontSize: 16, margin: "12px 0 0" }}>
          最短ルートは、いったん忘れていいよ。
        </p>
      </header>

      {/* プリセット感情（大きめタップ・絵文字つき） */}
      <section className="fade-in" style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {PRESETS.map((p) => {
            const active = preset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreset(active ? null : p.value)}
                style={{
                  border: `1.5px solid ${active ? "var(--ember)" : "var(--line)"}`,
                  background: active ? "var(--ember-glow)" : "transparent",
                  color: active ? "var(--ember-strong)" : "var(--ink)",
                  borderRadius: 999,
                  padding: "12px 20px",
                  fontSize: 17,
                  minHeight: 52,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 20 }}>{p.emoji}</span>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* 言葉にしたい人だけ書ける、任意の自由入力 */}
        <textarea
          className="field"
          style={{ marginTop: 14, fontSize: 17 }}
          placeholder="言葉にできたら、ここに書いてもいいよ。"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
      </section>

      {/* 遠回り強度 */}
      <section className="fade-in" style={{ marginBottom: 26 }}>
        <label
          style={{ display: "block", color: "var(--ink)", fontSize: 17, marginBottom: 12 }}
        >
          どれくらい、寄り道する？
        </label>
        <div style={{ display: "flex", gap: 10 }}>
          {INTENSITY_LABELS.map((it) => {
            const active = intensity === it.key;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => setIntensity(it.key)}
                className="card"
                style={{
                  flex: 1,
                  padding: "18px 8px",
                  border: `1.5px solid ${active ? "var(--ember)" : "var(--line)"}`,
                  boxShadow: active ? "0 8px 24px var(--ember-glow)" : "none",
                  background: active
                    ? "linear-gradient(180deg, rgba(240,169,92,0.18), rgba(240,169,92,0.05))"
                    : undefined,
                }}
              >
                <div style={{ fontSize: 26 }} aria-hidden>
                  {it.emoji}
                </div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    marginTop: 6,
                    color: active ? "var(--ember-strong)" : "var(--ink)",
                  }}
                >
                  {it.label}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 2 }}>
                  {it.sub}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 現在地：生の数値は見せず、状態だけ大きく */}
      <section className="fade-in" style={{ marginBottom: 24 }}>
        <div
          className="card"
          style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}
        >
          <span style={{ fontSize: 22 }} aria-hidden>
            📍
          </span>
          <div style={{ flex: 1 }}>
            {geo.status === "ready" && (
              <span style={{ fontSize: 16, color: "var(--ok)" }}>現在地、つかめたよ ✓</span>
            )}
            {geo.status === "loading" && (
              <span style={{ fontSize: 16, color: "var(--ink-muted)" }}>現在地をさがしてるね…</span>
            )}
            {geo.status === "error" && (
              <span style={{ fontSize: 16, color: "var(--danger)" }}>{geo.message}</span>
            )}
          </div>
          {geo.status !== "ready" && (
            <button
              type="button"
              className="btn-ghost"
              onClick={requestLocation}
              style={{ borderRadius: 10, padding: "10px 14px", fontSize: 15, width: "auto" }}
            >
              もう一度
            </button>
          )}
        </div>

        {/* 目的地は「任意」。ふだんは開かない。 */}
        <button
          type="button"
          onClick={() => setShowDest((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: "var(--ink-faint)",
            fontSize: 14,
            padding: "10px 2px 0",
          }}
        >
          {showDest ? "行き先を閉じる" : "行き先をきめる（なくてもOK）"}
        </button>
        {showDest && (
          <input
            className="field"
            style={{ marginTop: 8, fontSize: 16 }}
            placeholder="緯度,経度（例: 35.690,139.700）"
            value={destText}
            onChange={(e) => setDestText(e.target.value)}
            inputMode="text"
          />
        )}
      </section>

      <button
        className="btn"
        style={{ minHeight: 64, fontSize: 19 }}
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {canSubmit ? "さあ、歩きにいこう" : "現在地をさがしてるね…"}
      </button>
      <p
        style={{
          textAlign: "center",
          color: "var(--ink-faint)",
          fontSize: 13,
          marginTop: 16,
        }}
      >
        気持ちも居場所も、あなたのスマホの中だけ。
      </p>
    </div>
  );
}
