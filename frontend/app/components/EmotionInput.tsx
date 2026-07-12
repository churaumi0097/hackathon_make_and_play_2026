"use client";

import { useEffect, useRef, useState } from "react";
import type { Intensity, LatLng } from "../lib/types";
import styles from "./EmotionInput.module.css";

const PRESETS = [
  { label: "つかれた", description: "ひと息つきたい", emoji: "😮‍💨", value: "疲労", tone: "blue" },
  { label: "もやもや", description: "頭を整理したい", emoji: "🌀", value: "不安", tone: "purple" },
  { label: "へこんだ", description: "静かに歩きたい", emoji: "😔", value: "悲しみ", tone: "navy" },
  { label: "うれしい", description: "気分を広げたい", emoji: "😊", value: "歓喜", tone: "yellow" },
  { label: "ほっとした", description: "ゆっくり味わいたい", emoji: "🍵", value: "安堵", tone: "green" },
  { label: "いらいら", description: "気持ちを切り替えたい", emoji: "😤", value: "怒り", tone: "red" },
];

const INTENSITIES: { key: Intensity; label: string; minutes: string }[] = [
  { key: "light", label: "ちょっと", minutes: "+5分" },
  { key: "medium", label: "ほどよく", minutes: "+15分" },
  { key: "deep", label: "たっぷり", minutes: "+30分" },
];

export type EmotionSubmit = {
  text: string;
  preset: string | null;
  intensity: Intensity;
  origin: LatLng;
  destination: LatLng | string;
};

type GeoState =
  | { status: "loading" }
  | { status: "ready"; coords: LatLng }
  | { status: "error"; message: string };

export default function EmotionInput({ onSubmit, onStepChange }: { onSubmit: (value: EmotionSubmit) => void; onStepChange?: (step: 0 | 1) => void }) {
  const [text, setText] = useState("");
  const [presets, setPresets] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [geo, setGeo] = useState<GeoState>({ status: "loading" });
  const [showDest, setShowDest] = useState(false);
  const [destText, setDestText] = useState("");
  const [step, setStep] = useState<0 | 1>(0);
  const touchStartX = useRef<number | null>(null);

  const runGeolocation = () => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "位置情報が使えないみたい" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setGeo({ status: "ready", coords: { lat: position.coords.latitude, lng: position.coords.longitude } }),
      () => setGeo({ status: "error", message: "現在地をオンにしてね" }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runGeolocation();
  }, []);

  useEffect(() => {
    const formPane = document.querySelector<HTMLElement>(".frame-content");
    formPane?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    onStepChange?.(step);
  }, [step, onStepChange]);

  const parseDestination = (origin: LatLng): LatLng | string => {
    const match = destText.trim().match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    if (destText.trim()) return destText.trim();
    return { lat: origin.lat + 0.012, lng: origin.lng + 0.011 };
  };

  const handleSubmit = () => {
    if (geo.status !== "ready") return;
    onSubmit({ text: text.trim(), preset: presets.length ? presets.join("、") : null, intensity, origin: geo.coords, destination: parseDestination(geo.coords) });
  };

  const handleTouchEnd = (endX: number) => {
    if (touchStartX.current === null) return;
    const distance = endX - touchStartX.current;
    if (distance < -55 && step === 0) setStep(1);
    if (distance > 55 && step === 1) setStep(0);
    touchStartX.current = null;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.step}>ROUTE SETTING</span>
        <h1>おつかれさま。<br />今日はどんな気分？</h1>
        <p>いまの気持ちに、ちょうどいい寄り道をつくります。</p>
      </header>

      <div className={styles.progress} aria-label={`入力ステップ ${step + 1}/2`}>
        <button type="button" className={step === 0 ? styles.currentStep : styles.doneStep} onClick={() => setStep(0)}><span>1</span>今の気分を選ぶ</button>
        <span className={styles.progressLine} />
        <button type="button" className={step === 1 ? styles.currentStep : ""} onClick={() => setStep(1)}><span>2</span>ルートを設定する</button>
      </div>

      <div className={styles.slider} onTouchStart={(event) => { touchStartX.current = event.changedTouches[0].clientX; }} onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0].clientX)}>
        <div className={styles.track} style={{ transform: `translateX(-${step * 50}%)` }}>
      <section className={`${styles.section} ${styles.slide}`} aria-labelledby="mood-title">
        <div className={styles.sectionHeading}>
          <div><span className={styles.number}>01</span><h2 id="mood-title">今の気分を選ぶ</h2></div>
          <span className={styles.optional}>複数選択できます</span>
        </div>
        <p className={styles.sectionLead}>いちばん近い気持ちはどれですか？</p>
        <div className={styles.moodGrid}>
          {PRESETS.map((item) => {
            const active = presets.includes(item.value);
            return (
              <button key={item.value} type="button" aria-pressed={active} onClick={() => setPresets((current) => active ? current.filter((value) => value !== item.value) : [...current, item.value])} className={`${styles.mood} ${active ? styles.selected : ""}`}>
                <span className={`${styles.moodEmoji} ${styles[item.tone]}`} aria-hidden="true">{item.emoji}</span>
                <span className={styles.moodText}><strong>{item.label}</strong><small>{item.description}</small></span>
                <span className={styles.check} aria-hidden="true">✓</span>
              </button>
            );
          })}
        </div>
        <label className={styles.noteLabel}>
          <span>言葉にしたいことがあれば</span><span className={styles.optional}>任意</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="ここに書いてもいいよ。" rows={2} />
        </label>
        <div className={styles.selectionSummary}>{presets.length > 0 ? `${presets.length}個の気分を選択中` : "気分を1つ以上選んでください"}</div>
        <button className={styles.next} type="button" onClick={() => setStep(1)} disabled={presets.length === 0}>ルート設定へ進む <span aria-hidden="true">→</span></button>
      </section>

      <section className={`${styles.section} ${styles.slide}`} aria-labelledby="route-title">
        <div className={styles.sectionHeading}>
          <div><span className={styles.number}>02</span><h2 id="route-title">ルートを設定する</h2></div>
        </div>

        <div className={styles.locationGrid}>
          <div className={styles.locationCard}>
            <span className={styles.locationIcon} aria-hidden="true">⌖</span>
            <div><span className={styles.locationLabel}>現在地</span>
              {geo.status === "ready" && <strong className={styles.ready}>取得しました</strong>}
              {geo.status === "loading" && <strong>確認しています…</strong>}
              {geo.status === "error" && <strong className={styles.error}>{geo.message}</strong>}
            </div>
            {geo.status !== "ready" && <button type="button" className={styles.retry} onClick={() => { setGeo({ status: "loading" }); runGeolocation(); }}>再取得</button>}
          </div>
          <button type="button" className={styles.locationCard} onClick={() => setShowDest((open) => !open)}>
            <span className={styles.locationIcon} aria-hidden="true">⌂</span>
            <div><span className={styles.locationLabel}>目的地</span><strong>{destText ? "指定済み" : "自動で設定"}</strong></div>
            <span className={styles.chevron} aria-hidden="true">{showDest ? "−" : "+"}</span>
          </button>
        </div>

        {showDest && <label className={styles.destination}><span>駅名・住所、または緯度経度</span><input value={destText} onChange={(event) => setDestText(event.target.value)} placeholder="例：東京駅 / 渋谷区役所 / 35.690, 139.700" inputMode="text" /></label>}

        <div className={styles.detourHeading}><span>寄り道する時間</span><strong>{INTENSITIES.find((item) => item.key === intensity)?.minutes}</strong></div>
        <div className={styles.intensity}>
          {INTENSITIES.map((item) => <button key={item.key} type="button" aria-pressed={intensity === item.key} onClick={() => setIntensity(item.key)} className={intensity === item.key ? styles.activeIntensity : ""}><span>{item.label}</span><small>{item.minutes}</small></button>)}
        </div>
        <button className={styles.submit} type="button" onClick={handleSubmit} disabled={geo.status !== "ready"}>
          <span>{geo.status === "ready" ? "今日の寄り道をつくる" : "現在地を確認しています"}</span><span aria-hidden="true">→</span>
        </button>
        <button className={styles.back} type="button" onClick={() => setStep(0)}><span aria-hidden="true">←</span> 気分を選び直す</button>
      </section>
        </div>
      </div>

      <p className={styles.privacy}>気持ちも居場所も、あなたのスマホの中だけ。</p>
    </div>
  );
}
