"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import EmotionInput, { type EmotionSubmit } from "./components/EmotionInput";
import LoadingScreen from "./components/LoadingScreen";
import MapNav from "./components/MapNav";
import ResultScreen from "./components/ResultScreenV2";
import { fetchGeocode, fetchHealth, fetchRoute } from "./lib/api";
import type { RouteResponse } from "./lib/types";
import styles from "./page.module.css";

type Phase = "landing" | "input" | "loading" | "nav" | "result";
type Health = "checking" | "ok" | "down";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("checking");
  const [formStep, setFormStep] = useState<0 | 1>(0);

  useEffect(() => {
    fetchHealth().then((response) => setHealth(response.status === "ok" ? "ok" : "down")).catch(() => setHealth("down"));
  }, []);

  const handleSubmit = async (value: EmotionSubmit) => {
    setError(null);
    setPhase("loading");
    try {
      const destination = typeof value.destination === "string" ? await fetchGeocode(value.destination) : value.destination;
      const response = await fetchRoute({ text: value.text, preset: value.preset, intensity: value.intensity, origin: value.origin, destination });
      setRoute(response);
      setPhase("nav");
    } catch {
      setError("うまくつながらなかったみたい。少し待って、もう一度ためしてみてね。");
    }
  };

  const handleRestart = () => {
    setRoute(null); setError(null); setExtraMinutes(0); setFormStep(0); setPhase("input");
  };

  if (phase === "landing") return <LandingPage onStart={() => setPhase("input")} />;
  if (phase === "nav" && route) return <><HealthBadge health={health} /><MapNav route={route} onArrive={(minutes) => { setExtraMinutes(minutes); setPhase("result"); }} onRestart={handleRestart} /></>;
  if (phase === "result" && route) return <><HealthBadge health={health} /><ResultScreen route={route} extraMinutes={extraMinutes} onRestart={handleRestart} /></>;

  return (
    <AppFrame onHome={() => setPhase("landing")} panelMode={formStep === 1 ? "route" : "mood"}>
      <HealthBadge health={health} />
      {phase === "input" && <EmotionInput onSubmit={handleSubmit} onStepChange={setFormStep} />}
      {phase === "loading" && <LoadingScreen error={error} />}
      {phase === "loading" && error && <div className="safe-exit"><button className="btn btn-ghost" onClick={handleRestart}>入力に戻る</button></div>}
    </AppFrame>
  );
}

function LandingPage({ onStart }: { onStart: () => void }) {
  return <main className={styles.landing}>
    <nav className={styles.nav} aria-label="メインナビゲーション"><button className={styles.logo} type="button" aria-label="トップへ"><span className={styles.logoMark} aria-hidden="true">↗</span><span>Anti-shortcut</span></button></nav>
    <section className={styles.hero}>
      <Image className={styles.heroImage} src="/anti-shortcut-hero-v7.png" alt="寄り道ルートを示す街並みと、スマートフォンを見ながら歩く人物のイラスト" fill priority unoptimized sizes="100vw" />
      <div className={styles.imageShade} aria-hidden="true" />
      <div className={styles.heroContent}>
        <p className={styles.kicker}>寄り道ナビゲーション</p>
        <h1><span>いつもとは違う道に、</span><span>今日だけの発見を。</span></h1>
        <p className={styles.lead}>気分と時間を選ぶだけ。いつもの最短ルートから少し外れて、あなたにちょうどいい寄り道を提案します。</p>
        <div className={styles.actions}><button className={styles.primaryCta} type="button" onClick={onStart}>今日の寄り道をはじめる<span aria-hidden="true">→</span></button><span className={styles.timeNote}>約1分でルート提案</span></div>
      </div>
    </section>
  </main>;
}

function AppFrame({ children, onHome, panelMode }: { children: React.ReactNode; onHome: () => void; panelMode: "mood" | "route" }) {
  return <div className="frame"><aside className={`frame-brand ${panelMode === "route" ? "frame-brand-route" : ""}`}>
    <button className={styles.appLogo} type="button" onClick={onHome}><span className="brand-badge" aria-hidden="true">↗</span><span className="brand-name">Anti-shortcut</span></button>
    <div className="brand-full"><h2 className={styles.frameTitle}>その寄り道が、<br />今日を少し変える。</h2><p className={styles.frameCopy}>最短ルートを、あえて選ばない。<br />いまの気分に寄り添う道を提案します。</p></div>
  </aside><main className="frame-content">{children}</main></div>;
}

function HealthBadge({ health }: { health: Health }) {
  const label = { checking: "接続確認中", ok: "サーバー接続OK", down: "サーバー未接続" }[health];
  return <span className={`${styles.health} ${styles[health]}`} title={label} />;
}
