@AGENTS.md

## プロジェクト概要
- バックエンド：Django（apl/ 配下、uv でパッケージ管理）
- フロントエンド：Next.js（React、frontend/ 配下）

## よく使うコマンド
- uv run python manage.py runserver
- npm run dev

## コーディング規約
- Python は PEP 8 準拠、型ヒントを付ける
- フロントは TypeScript + ESLint に従う
- 設定値・シークレットは環境変数で管理する
- パッケージ追加は uv add / npm install を使う（直接編集しない）

## 注意点
- manage.py は apl/ 内にある（実行パスに注意）
- モデル変更時は makemigrations → migrate を忘れない
- githubにコミットは実行しない
- hackathon_0711より上の階層のファイルやフォルダーにはアクセスしない

## 要件定義
- 要件定義はproject.mdを参照してください。

## ドキュメント
- docs/overview.md : コンセプト / ターゲット / 提供価値 / 用語
- docs/requirements.md : 機能要件・非機能要件・安全要件
- docs/emotion-routing.md : 感情 → ルートのマッピング仕様（コアロジック）
- docs/roadmap.md : MVP とフェーズ分け

## 開発の原則
- コアバリューは「無駄な時間を、感情のケアに変える」こと。効率化・時短の提案はしない。
- 安全性（特に夜間）は最優先。docs/requirements.md の安全要件を必ず満たす。
- 「最短で帰る」導線は常に 1 タップで残す。
- 感情テキストと位置情報は機微データ。むやみに永続化・外部送信しない。
