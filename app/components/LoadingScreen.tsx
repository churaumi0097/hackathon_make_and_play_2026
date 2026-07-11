"use client";

// API 待ち中の演出（非機能要件：待ち時間を飽きさせない）。
// 「AIの最適解を破壊中…」等のメッセージを切り替え、破壊アニメを見せる。

import { useEffect, useState } from "react";

const MESSAGES = [
  "AIの最適解を破壊中…",
  "最短ルートを、そっと拒否しています…",
  "あなたの感情に、道を訊いています…",
  "誰も通らない裏路地を、探しています…",
  "「無駄」を「余韻」に翻訳中…",
  "量産型のスポットを、ふるい落としています…",
];

export default function LoadingScreen({ error }: { error?: string | null }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % MESSAGES.length), 1600);
    return () => clearInterval(t);
  }, [error]);

  return (
    <div
      className="shell"
      style={{
        minHeight: "78dvh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      {!error ? (
        <>
          {/* 破壊されていく最短ルートの円環 */}
          <div className="destroy-orbit" aria-hidden>
            <span className="shard s1" />
            <span className="shard s2" />
            <span className="shard s3" />
            <span className="core" />
          </div>
          <p
            key={idx}
            className="serif loading-msg"
            style={{ fontSize: 20, marginTop: 40, minHeight: 56, color: "var(--ink)" }}
          >
            {MESSAGES[idx]}
          </p>
          <p style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: 4 }}>
            少しだけ、待っていてください。
          </p>
        </>
      ) : (
        <div className="card fade-in" style={{ padding: 24, maxWidth: 360 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🌙</div>
          <p className="serif" style={{ fontSize: 18, margin: "0 0 8px" }}>
            道を描けませんでした
          </p>
          <p style={{ color: "var(--ink-muted)", fontSize: 14, margin: 0 }}>{error}</p>
        </div>
      )}

      <style>{`
        .destroy-orbit {
          position: relative;
          width: 120px;
          height: 120px;
        }
        .destroy-orbit .core {
          position: absolute;
          inset: 44px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--ember-strong), var(--ember));
          box-shadow: 0 0 40px var(--ember-glow);
          animation: pulse 1.6s ease-in-out infinite;
        }
        .destroy-orbit .shard {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px dashed var(--cold-faint);
          animation: spin-out 2.4s linear infinite;
        }
        .destroy-orbit .s1 { animation-duration: 2.2s; opacity: 0.8; }
        .destroy-orbit .s2 { inset: 14px; animation-duration: 3s; animation-direction: reverse; opacity: 0.5; }
        .destroy-orbit .s3 { inset: 28px; animation-duration: 3.6s; opacity: 0.3; }
        @keyframes spin-out {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.82); opacity: 0.75; }
        }
        .loading-msg { animation: float-in 0.5s ease both; }
      `}</style>
    </div>
  );
}
