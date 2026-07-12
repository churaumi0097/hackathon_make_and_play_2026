"use client";

import { useState } from "react";
import type { RouteResponse } from "../lib/types";
import { RouteMapView } from "./MapNav";
import styles from "./ResultScreenV2.module.css";

export default function ResultScreen({
  route,
  extraMinutes,
  onRestart,
}: {
  route: RouteResponse;
  extraMinutes: number;
  onRestart: () => void;
}) {
  const visibleSpots = route.spots.filter((spot) => spot.place_id !== "dummy-afterglow-pin");
  const [spotIndex, setSpotIndex] = useState(0);
  const spot = visibleSpots[spotIndex];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>ROUTE COMPLETE</p>
        <h1>今日も<br />本当におつかれさまでした</h1>
        <div className={styles.minutes}><strong>＋{extraMinutes}</strong><span>分</span></div>
        <p className={styles.lead}>自分のために、いつもより少しだけゆっくり歩けました。</p>
      </section>

      {spot && (
        <section className={styles.spots} aria-label="今日出会えた場所">
          <div className={styles.sectionHeading}>
            <div><p>MEMORY OF TODAY</p><h2>今日出会えた場所</h2></div>
            <span>{spotIndex + 1} / {visibleSpots.length}</span>
          </div>
          <div className={styles.spotCard}>
            <span className={styles.pin} aria-hidden="true">●</span>
            <div>
              <h3>{spot.name}</h3>
              {spot.rating > 0 && <p>★ {spot.rating.toFixed(1)} <span>（{spot.user_ratings_total}件のレビュー）</span></p>}
              <small>今日の寄り道で、ゆっくり出会えた場所。</small>
            </div>
          </div>
          {visibleSpots.length > 1 && (
            <div className={styles.controls}>
              <button type="button" onClick={() => setSpotIndex((index) => (index - 1 + visibleSpots.length) % visibleSpots.length)} aria-label="前の場所">←</button>
              <div>{visibleSpots.map((item, index) => <span className={index === spotIndex ? styles.activeDot : ""} key={item.place_id || `${item.name}-${index}`} />)}</div>
              <button type="button" onClick={() => setSpotIndex((index) => (index + 1) % visibleSpots.length)} aria-label="次の場所">→</button>
            </div>
          )}
        </section>
      )}

      <section className={styles.mapSection}>
        <div className={styles.sectionHeading}>
          <div><p>TODAY&apos;S ROUTE</p><h2>今日歩いた道</h2></div>
        </div>
        <div className={styles.map}><RouteMapView route={route} /></div>
      </section>

      <button className={styles.restart} type="button" onClick={onRestart}>もう一度、寄り道する</button>
    </main>
  );
}
