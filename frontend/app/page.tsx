"use client";

// アプリ全体のオーケストレーション。
// 感情入力 → (ローディング/route) → 地図ナビ → リザルト、の状態遷移を管理。
// 起動時にバックエンド /api/health を叩いて疎通を確認する（task 0）。

import { useEffect, useState } from "react";
import EmotionInput, { type EmotionSubmit } from "./components/EmotionInput";
import LoadingScreen from "./components/LoadingScreen";
import MapNav from "./components/MapNav";
import ResultScreen from "./components/ResultScreen";
import { fetchHealth, fetchRoute } from "./lib/api";
import type { RouteResponse } from "./lib/types";

type Phase = "input" | "loading" | "nav" | "result";
type Health = "checking" | "ok" | "down";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("input");
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [emotionText, setEmotionText] = useState("");
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("checking");

  // 起動時ヘルスチェック（フロント⇔バック疎通の確認）
  useEffect(() => {
    fetchHealth()
      .then((h) => setHealth(h.status === "ok" ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  const handleSubmit = async (v: EmotionSubmit) => {
    setEmotionText(v.text);
    setError(null);
    setPhase("loading");
    try {
      const localHour = new Date().getHours();
      const isNight = localHour >= 19 || localHour < 6;
      const res = await fetchRoute({
        text: v.text,
        preset: v.preset,
        intensity: v.intensity,
        origin: v.origin,
        destination: v.destination,
        is_night: isNight,
      });
      setRoute(res);
      setPhase("nav");
    } catch {
      setError(
        "うまくつながらなかったみたい。少し待って、もう一度ためしてね。",
      );
      // エラーは loading 画面に表示したままにする
    }
  };

  const handleArrive = (actualExtra: number) => {
    setExtraMinutes(actualExtra);
    setPhase("result");
  };

  const handleRestart = () => {
    setRoute(null);
    setError(null);
    setExtraMinutes(0);
    setPhase("input");
  };

  // 地図画面はフルブリード（全幅で地図を表示）。それ以外はブランドフレーム内。
  if (phase === "nav" && route) {
    return (
      <>
        <HealthBadge health={health} />
        <MapNav route={route} onArrive={handleArrive} onRestart={handleRestart} />
      </>
    );
  }

  return (
    <AppFrame>
      <HealthBadge health={health} />
      {phase === "input" && <EmotionInput onSubmit={handleSubmit} />}
      {phase === "loading" && <LoadingScreen error={error} />}
      {phase === "result" && route && (
        <ResultScreen
          route={route}
          emotionText={emotionText}
          extraMinutes={extraMinutes}
          onRestart={handleRestart}
        />
      )}

      {/* loading でエラーが出た場合の戻る導線 */}
      {phase === "loading" && error && (
        <div className="safe-exit">
          <button className="btn btn-ghost" onClick={handleRestart}>
            入力に戻る
          </button>
        </div>
      )}
    </AppFrame>
  );
}

// デスクトップ＝左ブランドヒーロー＋右コンテンツ、モバイル＝緑ヘッダー＋縦積み。
function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="frame">
      <aside className="frame-brand">
        <div className="brand-badge" aria-hidden>
          🍃
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">Anti-ShortCut</div>
          <div
            className="brand-full"
            style={{ marginTop: 20, maxWidth: 380 }}
          >
            <h2
              style={{
                fontSize: 30,
                fontWeight: 800,
                lineHeight: 1.4,
                margin: "0 0 14px",
                letterSpacing: "-0.01em",
              }}
            >
              その寄り道が、
              <br />
              今日のあなたを肯定する。
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.8, margin: 0, opacity: 0.92 }}>
              最短ルートを、あえて選ばない。
              <br />
              いまの気分に寄り添う遠回りを、そっと提案します。
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 26,
              }}
            >
              {["感情でルート", "夜間セーフガード", "がんばりを可視化"].map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "7px 14px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.16)",
                    border: "1px solid rgba(255,255,255,0.3)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>
      <main className="frame-content">{children}</main>
    </div>
  );
}

function HealthBadge({ health }: { health: Health }) {
  // アオイ向けに、細かい技術ラベルは出さず控えめなドットだけ（開発時の目印）。
  const color = {
    checking: "var(--ink-faint)",
    ok: "var(--ok)",
    down: "var(--danger)",
  }[health];
  const title = {
    checking: "接続確認中",
    ok: "サーバー接続OK",
    down: "サーバー未接続",
  }[health];
  return (
    <div
      title={title}
      style={{
        position: "fixed",
        top: 12,
        right: 14,
        zIndex: 100,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 8px ${color}`,
        opacity: 0.7,
        pointerEvents: "none",
      }}
    />
  );
}
