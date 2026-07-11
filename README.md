<<<<<<< HEAD
<<<<<<< HEAD
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
=======
=======
>>>>>>> 5df0d87a4e69171a3ca32cd381bb5053a857d4ac
# Anti-ShortCut ／ 人類のための遠回りマップ

AIが提示する最短ルートをあえて拒否し、いまの「感情」に寄り添う“意味のある遠回り”を
提案するアンチ・ナビゲーションアプリ。無駄にした時間を「感情に使った時間」へ再フレームする。

- コンセプト等の詳細は [`apl/docs/`](apl/docs) を参照。
- コアバリューは「無駄な時間を、感情のケアに変える」こと（効率化・時短の提案はしない）。

## 構成

| レイヤ | 技術 | 場所 |
|--------|------|------|
| バックエンド | Django 6 + Django REST framework（uv 管理） | [`apl/`](apl) |
| フロントエンド | Next.js 16（App Router / React / TypeScript） | [`frontend/`](frontend) |

外部 API：Gemini（感情解析・メッセージ生成）、Google Places / Directions（スポット選定・ルート）。
**API キーはすべてサーバー側（`apl/.env`）で管理し、フロントには出しません。**
地図表示用の Google Maps *ブラウザキー* だけは性質上ブラウザに露出するため、Places/Directions
用のサーバーキーとは別に用意し、リファラ制限をかけてください（未設定でも SVG 地図で動きます）。

## セットアップ

### 1. バックエンド（Django + DRF）

```bash
cd apl
cp .env.example .env          # 必要に応じてキーを設定（未設定でもフォールバックで動作）
uv sync
uv run python manage.py migrate
uv run python manage.py runserver 8000
```

`.env`（`apl/.env`）で設定できるキー：

| 変数 | 用途 |
|------|------|
| `GEMINI_API_KEY` | 感情解析・リザルトメッセージ生成。未設定ならキーワード＋定型文へフォールバック |
| `GEMINI_MODEL` | 既定 `gemini-2.5-flash` |
| `GOOGLE_MAPS_SERVER_KEY` | Places / Directions。未設定なら合成スポット・合成ルートへフォールバック |
| `DEBUG` / `ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS` | Django 設定 |

> キーが 1 つも無くても、フォールバック経路で一連のフロー（解析→選定→ルート→メッセージ）が
> 通るように作ってあります。デモや開発をキー無しで始められます。

### 2. フロントエンド（Next.js）

```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_ のみ（露出前提の値だけ）
npm install
npm run dev                        # http://localhost:3000
```

`.env.local`：

| 変数 | 用途 |
|------|------|
| `NEXT_PUBLIC_API_BASE` | バックエンド API（既定 `http://localhost:8000/api`） |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | 地図表示専用のブラウザキー。未設定なら SVG フォールバック地図 |

## API エンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| GET  | `/api/health` | 疎通確認 |
| POST | `/api/analyze` | 感情テキスト → `{valence, arousal, route_theme, places_tags}`（Gemini→フォールバック） |
| POST | `/api/route` | 感情＋現在地/目的地 → 最短ルート＋遠回りルート＋差分時間（解析・スポット選定・Directions を統合） |
| POST | `/api/result` | 感情＋無駄時間 → 皮肉と労いのメッセージ |

### コアロジックの所在（`apl/app/services/`）

- `emotion_routing.py` — 感情 2 軸 → 象限 → ルートテーマ／優先 Places タグ、遠回り強度、フォールバック解析
- `gemini.py` — Gemini 連携（解析・メッセージ）と失敗時フォールバック
- `places.py` — アンチ量産型フィルタ（`open_now` / 口コミ数の上下限 / rating 下限）。閾値は先頭に定数化
- `directions.py` — 最短＋遠回りルート算出、polyline デコード、合成ルート
- `safety.py` — 安全要件（夜間・上限・危険 POI 除外）。閾値は先頭に定数化

## 安全要件（最優先）の対応状況

- 夜間は孤立／水辺／暗所系の POI を除外（`NIGHT_AVOID_TAGS` / `NIGHT_MIN_RATINGS_TOTAL`）
- 遠回りの総時間・総距離に上限（昼/夜で別値）。**実測ルートが上限を超えたら経由地を減らして再計算**
- 悪天候フラグ時は水辺 POI を除外（`BAD_WEATHER_AVOID_TAGS`）
- 徒歩ルート（歩道優先）で算出
- 「最短で帰る」をナビ画面に常設（1 タップで最短ルートへ切替）

既知の制約（今後）：実際の治安データ連携・幹線道路の路肩回避・天候 API 連携は未実装
（ロードマップ Phase 3 相当）。現状は POI 種別と孤立度で近似している。

## 注意
- `manage.py` は `apl/` 内にあります（実行パスに注意）。
- モデル変更時は `makemigrations` → `migrate`。
- 感情テキスト・位置情報は機微データ。ローカル保持を基本とし、LLM 送信は必要最小限。
<<<<<<< HEAD
>>>>>>> 5df0d87 (second commit)
=======
>>>>>>> 5df0d87a4e69171a3ca32cd381bb5053a857d4ac
