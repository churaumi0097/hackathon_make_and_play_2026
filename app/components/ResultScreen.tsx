"use client";

// リザルト画面（task 6）＋ シェア画像（task 7）。
// - /api/result で皮肉と労いのメッセージを生成。
// - 「＋〇〇分の素晴らしい非効率」を主役に表示。
// - Canvas でリザルトカードを1枚の画像に出力し、X へシェア。

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchResult } from "../lib/api";
import { boundsOf, projector } from "../lib/geo";
import type { ResultResponse, RouteResponse } from "../lib/types";

const CARD_W = 1080;
const CARD_H = 1350;
const SHARE_HASHTAG = "#AntiShortCut";

export default function ResultScreen({
  route,
  emotionText,
  extraMinutes,
  onRestart,
}: {
  route: RouteResponse;
  emotionText: string;
  extraMinutes: number;
  onRestart: () => void;
}) {
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetchResult({
      text: emotionText,
      extra_minutes: extraMinutes,
      valence: route.emotion.valence,
      arousal: route.emotion.arousal,
    })
      .then((r) => alive && setResult(r))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [emotionText, extraMinutes, route.emotion]);

  // ---- Canvas 描画 ----
  const drawCard = useCallback(
    (canvas: HTMLCanvasElement, message: string) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = CARD_W;
      canvas.height = CARD_H;

      // 背景（白＋上部にほんのり緑）
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CARD_W, CARD_H);
      const rg = ctx.createRadialGradient(CARD_W / 2, 80, 40, CARD_W / 2, 80, 760);
      rg.addColorStop(0, "rgba(0,177,79,0.12)");
      rg.addColorStop(1, "rgba(0,177,79,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, CARD_W, CARD_H);

      const pad = 90;
      ctx.textBaseline = "top";

      // eyebrow
      ctx.fillStyle = "#00b14f";
      ctx.font = "700 30px 'Hiragino Sans','Noto Sans JP',sans-serif";
      ctx.fillText("A N T I - S H O R T C U T", pad, 90);

      // 大見出し：＋N分
      ctx.fillStyle = "#00b14f";
      ctx.font = "800 200px 'Hiragino Sans','Noto Sans JP',sans-serif";
      ctx.fillText(`＋${extraMinutes}`, pad, 150);
      const numW = ctx.measureText(`＋${extraMinutes}`).width;
      ctx.font = "700 60px 'Hiragino Sans',sans-serif";
      ctx.fillStyle = "#5f6b76";
      ctx.fillText("分", pad + numW + 10, 300);

      ctx.fillStyle = "#16181c";
      ctx.font = "800 62px 'Hiragino Sans','Noto Sans JP',sans-serif";
      ctx.fillText("今日も、意外とがんばった。", pad, 410);

      // 区切り線
      ctx.strokeStyle = "rgba(16,24,40,0.10)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, 520);
      ctx.lineTo(CARD_W - pad, 520);
      ctx.stroke();

      // メッセージ（皮肉と労い）
      ctx.fillStyle = "#2a2f36";
      ctx.font = "500 44px 'Hiragino Sans','Noto Sans JP',sans-serif";
      wrapText(ctx, message, pad, 570, CARD_W - pad * 2, 64);

      // ミニルート図
      drawMiniRoute(ctx, route, pad, 830, CARD_W - pad * 2, 320);

      // フッター
      ctx.fillStyle = "#98a2ad";
      ctx.font = "600 34px 'Hiragino Sans',sans-serif";
      ctx.fillText(`${route.emotion.route_theme}`, pad, CARD_H - 130);
      ctx.fillStyle = "#00b14f";
      ctx.font = "700 34px 'Hiragino Sans',sans-serif";
      ctx.fillText(`${SHARE_HASHTAG}　人類のための遠回りマップ`, pad, CARD_H - 80);
    },
    [route, extraMinutes],
  );

  useEffect(() => {
    if (result && canvasRef.current) {
      drawCard(canvasRef.current, result.message);
    }
  }, [result, drawCard]);

  const shareText = result
    ? `今日も、意外とがんばった。\n最短より＋${extraMinutes}分、自分のために歩いた。\n${result.message} ${SHARE_HASHTAG}`
    : "";

  const canvasToBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const c = canvasRef.current;
      if (!c) return resolve(null);
      c.toBlob((b) => resolve(b), "image/png");
    });

  // シェア：可能なら Web Share（画像添付）、無理なら X 投稿画面＋画像DL。
  const handleShare = async () => {
    const blob = await canvasToBlob();
    const file = blob
      ? new File([blob], "anti-shortcut.png", { type: "image/png" })
      : null;

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    if (
      file &&
      nav.canShare &&
      nav.canShare({ files: [file] }) &&
      navigator.share
    ) {
      try {
        await navigator.share({ files: [file], text: shareText });
        return;
      } catch {
        /* キャンセル時は下の導線へ */
      }
    }
    // フォールバック：画像を保存 → X の投稿画面をひらく（自動投稿はしない）
    if (blob) downloadBlob(blob, "anti-shortcut.png");
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      shareText,
    )}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDownload = async () => {
    const blob = await canvasToBlob();
    if (blob) downloadBlob(blob, "anti-shortcut.png");
  };

  return (
    <div className="shell" style={{ padding: "34px 22px 44px" }}>
      {/* 主役：自己肯定のひとこと（アオイ向け） */}
      <div className="fade-in" style={{ margin: "6px 0 4px" }}>
        <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden>
          🌙✨
        </div>
        <h1
          className="serif"
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            fontWeight: 700,
            margin: 0,
            color: "var(--ink)",
          }}
        >
          今日も、意外と
          <br />
          がんばったじゃん。
        </h1>
      </div>

      {/* ＋N分を「自分にあげた時間」として温かく提示 */}
      <div
        className="fade-in"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          margin: "22px 0 6px",
        }}
      >
        <span
          className="serif"
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "var(--ember-strong)",
            lineHeight: 1,
          }}
        >
          ＋{extraMinutes}
        </span>
        <span style={{ fontSize: 22, color: "var(--ink-muted)" }}>分</span>
      </div>
      <p
        style={{
          fontSize: 17,
          color: "var(--ink-muted)",
          margin: "0 0 22px",
          lineHeight: 1.7,
        }}
      >
        最短より、それだけ長く歩いた。
        <br />
        効率じゃなくて、自分のために使った時間。
      </p>

      {/* Gemini メッセージ */}
      <div className="card fade-in" style={{ padding: 22, minHeight: 120 }}>
        {!result && !error && (
          <p style={{ color: "var(--ink-faint)", margin: 0 }}>
            言葉を、選んでいます…
          </p>
        )}
        {error && (
          <p style={{ color: "var(--danger)", margin: 0, fontSize: 14 }}>
            メッセージを取得できませんでした。{error}
          </p>
        )}
        {result && (
          <p
            className="serif"
            style={{ fontSize: 21, lineHeight: 1.95, margin: 0, color: "var(--ink)" }}
          >
            {result.message}
          </p>
        )}
      </div>

      {/* 拾いもの（通過スポット） */}
      {route.spots.length > 0 && (
        <div className="fade-in" style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px", color: "var(--ink)" }}>
            今日、出会えた場所
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {route.spots.map((s, i) => (
              <div
                key={s.place_id || i}
                className="card"
                style={{
                  padding: "16px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <span style={{ fontSize: 22 }}>✨</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, color: "var(--ink)" }}>{s.name}</div>
                  <div style={{ fontSize: 14, color: "var(--ink-muted)", marginTop: 2 }}>
                    寄り道しなきゃ、通らなかった場所。
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* シェアカード プレビュー */}
      <div className="fade-in" style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px", color: "var(--ink)" }}>
          がんばりを、残そう
        </h2>
        <div
          className="card"
          style={{ padding: 10, overflow: "hidden", borderRadius: 16 }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "auto", display: "block", borderRadius: 10 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button
          className="btn"
          style={{ flex: 2, minHeight: 62, fontSize: 18 }}
          onClick={handleShare}
          disabled={!result}
        >
          Xで自慢する
        </button>
        <button
          className="btn-ghost"
          style={{ flex: 1, minHeight: 62, borderRadius: 12 }}
          onClick={handleDownload}
          disabled={!result}
        >
          保存
        </button>
      </div>

      <button
        onClick={onRestart}
        style={{
          background: "none",
          border: "none",
          color: "var(--ink-faint)",
          fontSize: 13,
          padding: 14,
          marginTop: 8,
        }}
      >
        もう一度、遠回りする
      </button>
    </div>
  );
}

// ---- Canvas ヘルパー ----
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  // 日本語は文字単位で折り返す。
  let line = "";
  let cy = y;
  for (const ch of text) {
    if (ch === "\n") {
      ctx.fillText(line, x, cy);
      line = "";
      cy += lineHeight;
      continue;
    }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = ch;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

function drawMiniRoute(
  ctx: CanvasRenderingContext2D,
  route: RouteResponse,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save();
  // 地図パネル（薄いグレーの下地＋枠）
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = "#eef2f6";
  ctx.fill();
  ctx.strokeStyle = "rgba(16,24,40,0.10)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  const box = boundsOf([route.shortest.path, route.detour.path]);
  const project = projector(box, w, h, 40);
  const off = (p: { lat: number; lng: number }): [number, number] => {
    const [px, py] = project(p);
    return [x + px, y + py];
  };

  // 最短：薄い破線（グレー）
  ctx.setLineDash([3, 12]);
  ctx.strokeStyle = "#aab2bd";
  ctx.lineWidth = 5;
  strokePath(ctx, route.shortest.path, off);

  // 遠回り：Grabグリーンで強調
  ctx.setLineDash([]);
  ctx.strokeStyle = "#00b14f";
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0,177,79,0.35)";
  ctx.shadowBlur = 14;
  strokePath(ctx, route.detour.path, off);
  ctx.shadowBlur = 0;

  // スポット（緑＋白フチ）
  route.spots.forEach((s) => {
    const [sx, sy] = off(s);
    ctx.fillStyle = "#00b14f";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  path: { lat: number; lng: number }[],
  off: (p: { lat: number; lng: number }) => [number, number],
) {
  ctx.beginPath();
  path.forEach((p, i) => {
    const [px, py] = off(p);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
