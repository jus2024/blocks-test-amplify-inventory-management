# 資材在庫管理システム

AWS Blocks × Amplify Gen 2 で構築した資材在庫管理システム。

資材マスタ・倉庫マスタの管理、入出庫記録、在庫照会、低在庫アラート、CSV一括インポートを提供する。ユーザー固有のメモ・設定は Amplify Data (AppSync + DynamoDB) で管理し、業務データは Aurora DSQL に永続化する。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | TypeScript, lit-html, Vite |
| バックエンド API | AWS Blocks (ApiNamespace, JSON-RPC) |
| 業務データ | Aurora DSQL (DistributedDatabase) |
| ユーザーデータ | Amplify Data (AppSync + DynamoDB) |
| 認証 | Amazon Cognito (Amplify Auth) |
| 非同期処理 | AsyncJob (SQS), CronJob (EventBridge) |
| インフラ | AWS CDK (Amplify Gen 2 統合) |

## プロジェクト構成

```
aws-blocks/
  index.ts              # バックエンド: API定義、ビジネスロジック
  dsql-migrations/      # DSQL マイグレーション SQL
  cognito-verifier.ts   # Cognito JWT 検証
amplify/
  backend.ts            # Amplify バックエンド定義
  blocks.ts             # Blocks ↔ Amplify 統合
  auth/resource.ts      # Cognito 設定
  data/resource.ts      # AppSync スキーマ
src/
  index.ts              # フロントエンド UI
  auth-ui.ts            # 認証 UI コンポーネント
  lib/                  # ユーザーデータ操作 (notes, preferences)
test/
  e2e.test.ts           # E2Eテスト
docs/
  integration-test-plan.md   # 統合テスト手順書
  inventory-implementation-report.md  # 実装レポート
```

## セットアップ

```bash
npm install
```

Node.js 22 以上が必要。

## 開発コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | ローカル開発サーバー (モック、AWS不要) |
| `npm run test:e2e` | E2Eテスト実行 |
| `npm run typecheck` | TypeScript 型チェック |
| `npm run build` | フロントエンドビルド |

## AWS デプロイ

### Sandbox (開発用)

```bash
NODE_OPTIONS="--conditions=cdk" npx ampx sandbox
```

別ターミナルでフロントエンドを起動:

```bash
npx vite
```

ブラウザで http://localhost:5173 を開く。

> `--conditions=cdk` は Blocks の CDK コンストラクトを正しくロードするために必須。省略するとビルドエラーになる。

### Amplify Hosting (本番)

1. GitHub リポジトリを Amplify Hosting に接続
2. 環境変数を設定: `NODE_OPTIONS` = `--conditions=cdk`
3. push で自動デプロイ

### クリーンアップ

```bash
npx ampx sandbox delete    # Sandbox リソース削除
```

## 機能一覧

- 資材マスタ CRUD (SKU ユニーク制約)
- 倉庫マスタ CRUD (参照整合性チェック)
- 入出庫記録 (OCC リトライ、在庫不足チェック)
- 在庫照会 (資材×倉庫の集計、フィルタ)
- 低在庫アラート (CronJob で定期検出、確認機能)
- CSV 一括インポート (AsyncJob で非同期処理)
- ユーザーメモ・設定 (Cognito ユーザー別にデータ分離)

## ドキュメント

- [統合テスト手順書](docs/integration-test-plan.md)
- [実装レポート](docs/inventory-implementation-report.md)
