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
環境変数はリポジトリ直下の **`.env` 1ファイル** で管理します（Gitには含めません）。
地図表示用の Google Maps *ブラウザキー* だけは性質上ブラウザに露出するため、Places/Directions
用のサーバーキーとは別に用意し、リファラ制限をかけてください（未設定でも SVG 地図で動きます）。

## セットアップ

### 1. バックエンド（Django + DRF）

```bash
# リポジトリ直下の .env に必要な変数を設定
cd apl
uv sync
uv run python manage.py migrate
uv run python manage.py runserver 8000
```

リポジトリ直下の `.env` で設定できるバックエンド用キー：

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
npm install
npm run dev                        # http://localhost:3000
```

同じルート `.env` に設定するフロントエンド用変数：

| 変数 | 用途 |
|------|------|
| `BACKEND_API_URL` | Next.jsプロキシから接続するバックエンドURL（ローカル既定 `http://localhost:8000`） |
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

## Google Cloud へデプロイするとき

- フロントエンドサービスのルートディレクトリは **`frontend`** に設定する。リポジトリ直下には `package.json` がないため、直下をNodeアプリとしてビルドしない。
- バックエンドサービスのルートディレクトリは **`apl`** に設定する。
- フロントエンドの実行時環境変数 `BACKEND_API_URL` に、Djangoサービスの公開HTTPS URLを設定する（例: `https://backend-xxxxx.a.run.app`）。
- Django側には `GOOGLE_MAPS_SERVER_KEY`、`GEMINI_API_KEY`、`DEBUG=False`、`ALLOWED_HOSTS` を設定する。
- Google Maps JavaScript APIを使う場合、`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` はNext.jsのビルド時に設定し、キーのHTTPリファラー制限へ本番フロントエンドURLを追加する。
- `frontend/public` はフロントエンドのソースと一緒にデプロイする。画像URLは `/anti-shortcut-hero-v7.png` のように `/` 始まりで参照する。
