---
inclusion: always
---

# Blocks ローカル開発・テストルール

## 開発ループ

本プロジェクトでは AWS Blocks のローカルサーバーを活用し、AWS アカウント不要で高速にフィードバックループを回す。

### テスト駆動の実装フロー

1. バックエンド (`aws-blocks/index.ts`) またはフロントエンド (`src/`) を変更する
2. **変更後は必ず `npm run test:e2e` を実行** して動作を確認する
3. テストが失敗した場合は、修正してテストが通るまで繰り返す
4. テストが全て通ったらタスク完了とする

### 高速イテレーション

- `npm run dev &` でバックグラウンドにサーバーを起動すると、`npm run test:e2e` が既存サーバーを再利用して高速になる
- `npm run test:e2e` は未起動の場合も自動でサーバーを立ち上げるので、手動起動は必須ではない

## タスク完了の定義

**タスクが「完了」と見なされる条件:**

1. 実装コードが書かれている
2. `npm run test:e2e` が全テスト通過する
3. 型エラーがない（`npm run typecheck` がパスする、または IDE 上でエラーなし）

テストが通らない状態でタスクを完了としてはいけない。

## DistributedDatabase (Aurora DSQL) の注意事項

### DSQL 固有の制約

- **外部キー制約 (FOREIGN KEY) は使えない** — アプリケーション層で参照整合性を担保する
- **SERIAL / SEQUENCE は使えない** — UUID (`gen_random_uuid()`) を主キーに使う
- **OCC (楽観的同時実行制御)** — トランザクション競合時はリトライロジックを実装する

### マイグレーション

- SQL マイグレーションファイルは `aws-blocks/dsql-migrations/` に配置
- ファイル名は `0001_initial.sql`, `0002_add_indexes.sql` のように番号付き
- Blocks のマイグレーションランナーが番号順に実行する

### クエリの書き方

- JOINs、SUM/GROUP BY など標準 SQL は使用可能
- パラメータバインディングを使い SQL インジェクションを防ぐ
- 集計クエリ（在庫数量の計算など）は `SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END)` パターンで書く

## Building Blocks の使い方

### 使用する Block を追加するとき

1. `node_modules/@aws-blocks/blocks/docs/<package-name>.md` を読んで API を確認する
2. `aws-blocks/index.ts` に import して Scope に追加する
3. テストを書いて動作確認する

### 禁止事項

- ローカルファイル、インメモリ配列、ローカル DB を永続化に使わない
- JSON-RPC ペイロードを手動で構築しない（型付き API クライアントを使う）
- curl/fetch で直接 API を叩かない（トラブルシュート時を除く）

## テストの書き方

### パターン

```typescript
// test/e2e.test.ts に追加
import { test } from 'node:test';
import assert from 'node:assert';

test('機能名: テストケース説明', async () => {
  // 1. テストデータの準備
  // 2. API 呼び出し
  // 3. アサーション
});
```

### ルール

- `authApi` で認証してから `api.*` メソッドを呼ぶ
- 各テストは独自のテストデータを作成し、他テストの実行順に依存しない
- HTTP リクエストや RPC ペイロードを手動構築しない — 型付きクライアントを使う

## CronJob / AsyncJob

- **CronJob**: 定期実行タスク。ローカルでは手動トリガーまたはテストから直接ハンドラを呼び出して検証する
- **AsyncJob**: 非同期タスク。キューイング → ハンドラ実行のフローを検証する
- いずれも `aws-blocks/index.ts` 内で Block として定義し、ハンドラロジックを実装する
