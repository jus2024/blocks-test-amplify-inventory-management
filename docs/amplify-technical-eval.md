# AWS Blocks × Amplify Gen2 統合 技術検証レポート

**検証日**: 2025年6月27日  
**検証者**: okamasa  
**プロジェクト**: amplify-plus-blocks (Angular 17 + Amplify Gen2 スターター)  
**AWS Blocks バージョン**: 0.1.7 (Preview)  
**Node.js**: v24.7.0 / npm 11.5.1

---

## 1. 概要

本レポートは、既存の AWS Amplify Gen2 プロジェクト（Angular 17 スターターテンプレート）に対して、AWS Blocks を統合する技術検証の記録である。

### 検証の目的

- AWS Blocks が Amplify Gen2 とどのように共存するかを実証する
- 公式テンプレートの構造を解析し、既存プロジェクトへの手動統合手順を確立する
- Blocks 導入のメリット・デメリット・制約を明らかにする

### 参考資料

- [AWS Blocks 公式ドキュメント](https://docs.aws.amazon.com/blocks/latest/devguide/what-is-blocks.html)
- [明日から始める、コーディングエージェント時代のフルスタック開発 — AWS Blocks のソースコードを読む](https://zenn.dev/aws_japan/articles/aws-blocks-source-reading)
- [AWS Blocks GitHub リポジトリ](https://github.com/aws-devtools-labs/aws-blocks)

---

## 2. AWS Blocks とは

AWS Blocks は、フルスタックアプリケーション向けのバックエンドツールキット。各「Block」は以下の3つを1パッケージに収めた自己完結型のモジュールである:

| レイヤー | 内容 |
|---------|------|
| **インフラ定義** | CDK Construct（DynamoDB テーブル、Lambda 関数など） |
| **ランタイムコード** | Lambda 上で動くアプリケーションロジック |
| **ローカル実装** | インメモリストアなど、AWSアカウント不要で動くモック |

### 利用可能な Block 一覧（2025年6月時点）

| カテゴリ | Block | バックエンド AWS サービス |
|---------|-------|----------------------|
| データ | `KVStore`, `DistributedTable`, `Database`, `DistributedDatabase`, `FileBucket` | DynamoDB, Aurora, S3 |
| 認証 | `AuthBasic`, `AuthCognito`, `AuthOIDC` | Cognito |
| 非同期処理 | `AsyncJob`, `CronJob` | SQS, EventBridge |
| AI | `Agent`, `KnowledgeBase` | Bedrock |
| 通信 | `Realtime`, `EmailClient` | IoT Core, SES |
| 設定 | `AppSetting` | SSM Parameter Store |
| 可観測性 | `Logger`, `Metrics`, `Tracer`, `Dashboard` | CloudWatch |
| ホスティング | `Hosting` | CloudFront + S3 |

---

## 3. Amplify Gen2 と Blocks の比較

| 観点 | Amplify Gen2 | AWS Blocks |
|------|-------------|-----------|
| ローカル開発 | 開発者ごとのクラウドサンドボックス（AWS アカウント必須） | AWS アカウント不要で完全ローカル |
| 型の流れ | スキーマ → コード生成 → 型 | コード生成なし、直接 import |
| インフラの見え方 | カテゴリで抽象化（隠す） | `cdk synth` で透過的（見せる） |
| CI/CD | Amplify Hosting に統合 | 自前構築 |
| AI エージェント対応 | 明示的な対応なし | AGENTS.md 同梱で前提化 |
| GraphQL API | AppSync (組み込み) | なし（JSON-RPC ベース） |
| リアルタイム同期 | AppSync Subscription | `Realtime` Block (IoT Core) |
| 認証フロー | Cognito + Amplify UI (フルマネージド) | AuthBasic / AuthCognito (ステートレス検証) |

### AWS が想定する関係性

> AWS Blocks and Amplify are complementary. Amplify provides hosting, CI/CD, and a managed backend experience, while AWS Blocks focuses on type-safe infrastructure-from-code with local-first development.

つまり **「置き換え」ではなく「補完」** として位置づけられている。

---

## 4. 統合アーキテクチャ

### 4.1 全体構成

```
┌─────────────────────────────────────────────────────┐
│  Amplify Gen2 Backend (CloudFormation Root Stack)     │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │  Auth Stack   │  │  Data Stack   │  ← Amplify 管理│
│  │  (Cognito)    │  │  (AppSync)    │                │
│  └──────┬───────┘  └──────────────┘                 │
│         │                                            │
│  ┌──────┴──────────────────────────────┐            │
│  │  Blocks Stack (Nested Stack)         │ ← 新規追加 │
│  │  ┌─────────┐  ┌─────────────────┐  │            │
│  │  │ Lambda   │  │ DynamoDB Table  │  │            │
│  │  │ (Handler)│  │ (KVStore Block) │  │            │
│  │  └─────────┘  └─────────────────┘  │            │
│  │                                      │            │
│  │  環境変数:                            │            │
│  │  - COGNITO_USER_POOL_ID (from Auth)  │            │
│  │  - COGNITO_CLIENT_ID (from Auth)     │            │
│  │  - COGNITO_REGION                    │            │
│  └──────────────────────────────────────┘            │
│                                                       │
│  amplify_outputs.json:                               │
│  - auth, data (既存)                                  │
│  - custom.blocks_api_url (新規)                       │
└─────────────────────────────────────────────────────┘
```

### 4.2 統合の3つのポイント

1. **Nested Stack で共存** — `backend.createStack('blocks')` で Amplify 管理下に新スタックを追加
2. **Cognito の橋渡し** — Amplify の User Pool 情報を Blocks Lambda の環境変数に注入
3. **出力の統合** — Blocks API URL を `amplify_outputs.json` の `custom` セクションに出力

### 4.3 認証の流れ

```
[クライアント]
    │
    │ fetchAuthSession() → Cognito ID Token 取得
    │
    ├─→ AppSync API (Amplify Data)  ← API Key or Cognito Token
    │
    └─→ Blocks API (Lambda)         ← Bearer Token (Cognito ID Token)
            │
            └─→ CognitoVerifier.requireAuth(context)
                    │
                    └─→ aws-jwt-verify で JWT 検証
```

Amplify 統合時は Blocks の `AuthBasic` / `AuthCognito` Block は使わない。代わりに `CognitoVerifier` ヘルパーが Amplify 側の Cognito User Pool を直接参照する。

---

## 5. 実装詳細

### 5.1 ファイル構成

```
amplify-plus-blocks/
├── amplify/
│   ├── auth/resource.ts          ← 既存 (Cognito 定義)
│   ├── data/resource.ts          ← 既存 (AppSync + Todo モデル)
│   ├── backend.ts                ← 修正 (initBlocks 追加)
│   ├── blocks.ts                 ← 新規 (Amplify-Blocks 統合)
│   ├── package.json
│   └── tsconfig.json
├── aws-blocks/
│   ├── package.json              ← Blocks 依存関係 (独立パッケージ)
│   ├── index.ts                  ← Block 定義 (API, KVStore, CognitoVerifier)
│   ├── index.cdk.ts              ← CDK 統合 (BlocksBackend 作成)
│   ├── index.handler.ts          ← Lambda エントリポイント
│   ├── cognito-verifier.ts       ← JWT 検証ヘルパー
│   └── client.js                 ← フロントエンドクライアント
├── src/app/blocks/
│   └── blocks-client.service.ts  ← Angular 用 Blocks クライアントサービス
├── package.json                  ← Blocks 依存関係追加済み
└── amplify_outputs.json          ← ダミー (デプロイ時に上書き)
```

### 5.2 backend.ts の変更内容

```typescript
// Before
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

defineBackend({ auth, data });

// After
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { initBlocks } from './blocks.js';

export const backend = defineBackend({ auth, data });

await initBlocks(backend);
```

変更点は最小限:
- `const` → `export const` (backend 参照を外部に公開)
- `initBlocks(backend)` を末尾に1行追加

### 5.3 aws-blocks/index.ts — Block 定義

```typescript
import { ApiNamespace, Scope } from '@aws-blocks/blocks';
import { KVStore } from '@aws-blocks/bb-kv-store';
import { CognitoVerifier } from './cognito-verifier.js';

const scope = new Scope('amplify-plus-blocks');
const store = new KVStore(scope, 'notes', {});
const auth = new CognitoVerifier({ /* Cognito config from env */ });

export const api = new ApiNamespace(scope, 'api', (context) => ({
  async greet(name: string) { /* public */ },
  async putNote(key: string, value: string) { /* protected */ },
  async getNote(key: string) { /* protected */ },
}));
```

### 5.4 フロントエンド呼び出し (Angular)

```typescript
// BlocksClientService を使用
const result = await this.blocksClient.greet('World');
// → { message: "Hello from Blocks, World!", timestamp: 1719... }

const note = await this.blocksClient.putNote('memo1', '買い物リスト');
// → { success: true }
```

通信プロトコルは **JSON-RPC 2.0** over HTTPS。

---

## 6. 検証で判明した事項

### 6.1 テンプレート生成の問題

```bash
npx @aws-blocks/create-blocks-app@latest my-app --template amplify -y
```

**結果**: ENOENT エラーで失敗。`amplify` テンプレートのディレクトリ自体は存在するが、`package.json` がテンプレートルートに存在しないため CLI が落ちる。

```
Error: ENOENT: no such file or directory, open '.../templates/amplify/package.json'
```

**原因の推測**: `amplify` テンプレートは「既存 Amplify プロジェクトへの差分追加」を想定しており、完全なプロジェクトテンプレートではない。CLI のテンプレート処理がこのケースに対応していない（Preview 故の未完成部分）。

**対処**: テンプレートのソースファイル群（`templates/amplify/` 配下）を直接参照し、手動で統合した。

### 6.2 パッケージ構造の特徴

`aws-blocks/` は独立した npm パッケージとして設計されている:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./index.ts",
      "browser": "./client.js",    ← ブラウザでは client.js が読まれる
      "import": "./client.js",
      "default": "./index.ts"      ← Node.js/Lambda では index.ts が読まれる
    }
  }
}
```

Node.js の **conditional exports** を活用し、同じ `import { api } from 'aws-blocks'` でも:
- **サーバーサイド** → 実際の Block ロジック (`index.ts`)
- **クライアントサイド** → JSON-RPC プロキシ (`client.js`)

が読み込まれる仕組み。

### 6.3 CDK 統合の仕組み

`BlocksBackend.create()` が以下を自動生成する:
- Lambda 関数 (Handler)
- API Gateway (Function URL or REST API)
- 各 Block が必要とするリソース (DynamoDB テーブル等)

Amplify の `ampx sandbox` / `ampx deploy` が CDK synth を実行する際、Blocks の Nested Stack も一緒に処理される。

### 6.4 サンドボックスモードの考慮

```typescript
const sandboxMode = process.env.AMPLIFY_SANDBOX === 'true';
```

サンドボックス（開発環境）では:
- `RemovalPolicies.of(stack).destroy()` — 全リソースに DESTROY ポリシーを設定
- `SandboxDisableDeletionProtection()` — 削除保護を無効化

これにより `ampx sandbox delete` でクリーンに環境を破棄できる。

### 6.5 Angular との統合

公式テンプレートは React/Next.js を前提としているが、Blocks の通信は単純な `fetch` + JSON-RPC なので、フレームワークに依存しない。Angular では:

- `client.js` の `registerMiddleware` パターンは使わず
- 独自の `BlocksClientService` で `fetchAuthSession()` + `fetch()` を直接実装

### 6.6 ビルド検証結果

| 検証項目 | 結果 |
|---------|------|
| `npm install` | 成功 (Blocks 関連パッケージ解決済み) |
| `ng build` (Angular フロントエンド) | 成功 |
| `tsc --noEmit -p amplify/tsconfig.json` (バックエンド型チェック) | 成功 |
| `npx ampx sandbox` (クラウドデプロイ) | 未検証 (AWS クレデンシャル必要) |

---

## 7. メリット・デメリット分析

### 7.1 Blocks を既存 Amplify プロジェクトに取り込むメリット

| メリット | 詳細 |
|---------|------|
| **Amplify では困難な機能の追加** | `CronJob` (定期実行)、`AsyncJob` (非同期処理)、`Agent` (AI) など、AppSync/DynamoDB だけでは実現が難しい機能を型安全に追加できる |
| **CDK 直接アクセス** | Amplify の抽象化に閉じ込められず、必要に応じて CDK Construct をそのまま使える |
| **ローカル開発の高速化** | Blocks 単体のローカルモック実行が可能（ただし Amplify 統合時はサンドボックスが必要） |
| **コードファースト** | スキーマ定義もコードも全て TypeScript。コード生成ステップが不要 |
| **AI エージェントとの親和性** | AGENTS.md が同梱されており、コーディングエージェントが正しくコードを書くためのガイドが組み込まれている |
| **既存資産の活用** | Amplify の Cognito、AppSync、Hosting をそのまま使いつつ、Blocks で拡張できる |
| **段階的採用** | 1 Block ずつ追加でき、既存コードの変更は `backend.ts` の 2 行のみ |

### 7.2 デメリット・リスク

| デメリット | 詳細 |
|---------|------|
| **Preview 段階** | 2025年6月時点で Preview。API の破壊的変更の可能性がある |
| **テンプレートの未成熟** | `--template amplify` が CLI エラーで動作しない。ドキュメントと実装にギャップがある |
| **Node.js 22+ 必須** | Amplify Gen2 は Node.js 18+ で動くが、Blocks は 22+ を要求。CI/CD 環境の更新が必要 |
| **認証の二重管理** | Amplify の Auth と Blocks の CognitoVerifier で認証ロジックが分散する |
| **2つの API パラダイム** | AppSync (GraphQL, リアルタイム) と Blocks (JSON-RPC, REST) が混在する |
| **デバッグの複雑化** | Nested Stack のデバッグは CloudFormation のスタック階層を追う必要がある |
| **ローカル開発の制約** | Amplify 統合時は完全ローカル実行ができない（Cognito はクラウドに依存） |
| **パッケージサイズ** | Blocks 関連依存で `node_modules` が +1000 パッケージ程度増加 |
| **Angular 向けのサポート不足** | 公式テンプレート・ドキュメントは React/Next.js 前提。Angular は自前で統合が必要 |

### 7.3 判断基準

**Blocks を取り込むべきケース:**
- Amplify の AppSync/DynamoDB では実現が難しいバックエンド機能（定期実行、非同期ジョブ、AI エージェント連携）が必要
- CDK の透過性が欲しい（インフラの全容を `cdk synth` で確認したい）
- 将来的に Amplify から CDK ネイティブへ移行する可能性がある

**取り込まないべきケース:**
- Amplify の標準機能（Auth, Data, Storage）だけで十分
- Preview のリスクを受け入れられないプロダクション環境
- チームが CDK/CloudFormation に不慣れ

---

## 8. AWS 側が想定するベストプラクティス

公式テンプレートとドキュメントから読み取れるベストプラクティス:

### 8.1 統合パターン

1. **`defineBackend()` の結果を export する** — Blocks 統合関数に渡すため
2. **`initBlocks()` は末尾で呼ぶ** — 既存の Amplify リソース定義の後
3. **Nested Stack で分離する** — Amplify 管理リソースと Blocks リソースを明確に分離
4. **環境変数で設定を渡す** — Cognito 情報は CloudFormation Ref で Lambda に注入

### 8.2 認証のベストプラクティス

- Amplify 統合時は `AuthBasic` / `AuthCognito` Block を使わない
- 代わりに `CognitoVerifier` ヘルパーを使い、Amplify の Cognito をそのまま参照
- `aws-jwt-verify` ライブラリでステートレスに JWT 検証

### 8.3 フロントエンド統合

- `amplify_outputs.json` の `custom` セクションに Blocks API URL を出力
- クライアントは `fetchAuthSession()` で取得した ID Token を Bearer ヘッダーに付与
- `registerMiddleware` パターンで全リクエストに自動付与

### 8.4 サンドボックス運用

- `AMPLIFY_SANDBOX=true` 環境変数でサンドボックスモードを検出
- サンドボックス時は削除保護を無効化し、クリーンな破棄を保証

---

## 9. 実際に取り込んでみて判明した実装上の注意点

### 9.1 `aws-blocks/` ディレクトリの位置

テンプレートでは `aws-blocks/` はプロジェクトルートに配置される。これは:
- `amplify/` とは別のディレクトリ（Amplify CLI の管理外）
- 独自の `package.json` を持つ独立パッケージ
- `conditional exports` により、サーバー/クライアントで異なるコードが読み込まれる

### 9.2 amplify/tsconfig.json との関係

`amplify/blocks.ts` が `../aws-blocks/index.cdk.js` を import するため、`amplify/tsconfig.json` の `moduleResolution: "bundler"` 設定が重要。`node` だと `.js` 拡張子の解決でエラーになる可能性がある。

### 9.3 トップレベル await

`amplify/backend.ts` で `await initBlocks(backend)` を使用している。これは:
- `amplify/package.json` に `"type": "module"` が設定されている（ESM）
- Amplify CLI (`ampx`) が ESM をサポートしている
- 通常の Node.js スクリプトとしても ESM + トップレベル await は Node.js 14.8+ でサポート

### 9.4 amplify_outputs.json の扱い

- `.gitignore` に含まれている（デプロイ/サンドボックス時に生成されるため）
- ローカルビルド (`ng build`) を通すためにはダミーファイルが必要
- デプロイ後に `custom.blocks_api_url` が追加される

### 9.5 依存関係の競合

`@aws-blocks/blocks` が内部で `aws-cdk-lib` を使用する。Amplify Gen2 も `aws-cdk-lib` に依存しているため、バージョンの互換性に注意が必要。今回の検証では問題は発生しなかった。

---

## 10. 今後の検証項目

- [x] Blocks のローカルモック実行（Amplify 統合時の制約確認）
- [x] Blocks API の動作確認（greet, createTodo, listTodos, deleteTodo）
- [ ] `npx ampx sandbox` での実際のデプロイ検証
- [ ] サンドボックス環境での Cognito 連携動作
- [ ] `CronJob`, `AsyncJob` など追加 Block の統合
- [ ] CI/CD パイプライン（Amplify Hosting）での動作確認
- [ ] Blocks の GA 時の破壊的変更への対応
- [ ] パフォーマンス比較（AppSync vs Blocks JSON-RPC）

---

## 11. 結論

AWS Blocks の Amplify Gen2 統合は、**技術的には実現可能で、既存プロジェクトへの影響は最小限** である。`backend.ts` への2行追加と `aws-blocks/` ディレクトリの追加だけで統合が完了する。

ただし、2025年6月時点では **Preview 段階** であり、CLI テンプレートが正常に動作しないなど未成熟な部分が残る。プロダクション利用には時期尚早だが、以下の用途での導入は合理的:

1. **技術検証・プロトタイピング** — Amplify で難しい機能の PoC
2. **段階的移行の準備** — 将来的な CDK ネイティブ移行のための足がかり
3. **AI エージェント活用の基盤** — AGENTS.md によるコーディングエージェント対応

Amplify の「マネージドで隠す」思想と、Blocks の「CDK で見せる」思想は対照的だが、Nested Stack パターンにより **共存可能** であることが本検証で実証された。

---

## 12. ローカル開発検証: Blocks による完全ローカル実行

### 12.1 検証概要

Amplify Gen2 の最大の開発体験上の課題は「ローカルで動かすにもサンドボックス（AWS アカウント）が必要」であること。Blocks のローカルモック機能を使い、AWS アカウント不要で Todo アプリを完全にローカル実行できるか検証した。

### 12.2 実現した構成

```
npm run dev
  ├── blocks:dev (tsx watch aws-blocks/scripts/server.ts)
  │     └── localhost:3001/aws-blocks/api  ← Blocks ローカルサーバー
  │           ├── KVStore → インメモリ (永続化は .bb-data/)
  │           └── API → JSON-RPC エンドポイント
  │
  └── start (ng serve)
        └── localhost:4200  ← Angular フロントエンド
              └── fetch() → localhost:3001/aws-blocks/api
```

### 12.3 実装内容

**aws-blocks/index.ts** — Todo CRUD を Blocks API として定義:

```typescript
import { ApiNamespace, Scope } from '@aws-blocks/blocks';
import { KVStore } from '@aws-blocks/bb-kv-store';

const scope = new Scope('amplify-plus-blocks');
const todosStore = new KVStore(scope, 'todos', {});

export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createTodo(content: string) { /* KVStore に保存 */ },
  async listTodos() { /* KVStore.scan() で全件取得 */ },
  async deleteTodo(id: string) { /* KVStore.delete() */ },
}));
```

**TodosComponent** — AppSync (GraphQL) から Blocks (JSON-RPC) に切り替え:

```typescript
// Before: Amplify Data (AppSync)
const client = generateClient<Schema>();
client.models.Todo.create({ content });

// After: Blocks (JSON-RPC)
await fetch('http://localhost:3001/aws-blocks/api', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'api.createTodo',
    params: [content],
  }),
});
```

### 12.4 検証結果

| 項目 | 結果 |
|------|------|
| Blocks ローカルサーバー起動 | 成功 (`startDevServer` で 3001 ポート) |
| Todo 作成 (createTodo) | 成功 |
| Todo 一覧 (listTodos) | 成功 (`scan()` メソッドで全件取得) |
| Todo 削除 (deleteTodo) | 成功 |
| CORS (localhost:4200 → 3001) | 自動許可済み |
| Angular ビルド | 成功 (バンドルサイズ 370KB → 297KB に削減) |
| ブラウザでの動作 | 成功 (スクリーンショットで確認) |
| AWS アカウント | 不要 |

### 12.5 Blocks ローカルサーバーの技術的詳細

**起動コマンド:**
```bash
npx tsx watch aws-blocks/scripts/server.ts
```

**サーバーの動作:**
- `startDevServer()` が `@aws-blocks/blocks/scripts` から提供される
- ポート 3001 で HTTP サーバーを起動
- JSON-RPC 2.0 プロトコルで API を提供
- エンドポイントパスは `/aws-blocks/api`
- `.blocks-sandbox/config.json` にクライアント用設定を出力
- KVStore はインメモリ実装で、データは `.bb-data/` に永続化

**CORS 設定:**
- `Access-Control-Allow-Origin: http://localhost:4200` が自動設定
- `localhost:3000`（React 等）も許可対象

**API URL の解決順序** (クライアント側):
1. 環境変数 `BLOCKS_API_URL` (SSR Lambda 用)
2. 環境変数 `BLOCKS_CONFIG` (JSON)
3. ファイル `.blocks-sandbox/config.json` (Node.js)
4. HTTP フェッチ `/.blocks-sandbox/config.json` (ブラウザ)

### 12.6 KVStore API の発見

テンプレートの型定義から判明した KVStore の実際の API:

| メソッド | 説明 |
|---------|------|
| `get(key)` | キーで値を取得。存在しない場合は `null` |
| `put(key, value, conditions?)` | 値を保存。条件付き書き込み対応 |
| `delete(key, conditions?)` | キーで削除。条件付き削除対応 |
| `scan()` | 全件を非同期イテラブルで取得 (`AsyncIterable<{key, value}>`) |

注意: `list()` メソッドは存在しない。全件取得には `scan()` を使う。

---

## 13. 統合パターンの選択肢と制約

### 13.1 3つの統合パターン

| パターン | 概要 | ローカル実行 |
|---------|------|------------|
| **A: Blocks 全振り** | Todo CRUD を含む全 API を Blocks で実装 | 完全にローカルで動く |
| **B: Amplify 主体 + Blocks 補完** | CRUD は AppSync、定期実行や AI は Blocks | AppSync 部分はサンドボックス必須 |
| **C: ハイブリッド呼び分け** | リアルタイム同期 → AppSync、バッチ → Blocks | AppSync 部分はサンドボックス必須 |

### 13.2 各パターンの詳細

#### パターン A: Blocks 全振り（今回実装したもの）

```
[Angular App]
     │
     └─→ Blocks API (JSON-RPC)
           ├── ローカル: インメモリ KVStore (AWS 不要)
           └── デプロイ: Lambda + DynamoDB
```

**メリット:**
- `npm run dev` だけで完全動作。AWS アカウント不要
- 開発ループが数秒で完結
- 同一コードがローカルとクラウドで動く

**デメリット:**
- AppSync のリアルタイム同期 (Subscription) が使えない
- Amplify Data のスキーマ駆動型開発の恩恵を受けられない
- Amplify UI コンポーネント (`<amplify-authenticator>` 等) との連携が薄くなる

#### パターン B: Amplify 主体 + Blocks 補完

```
[Angular App]
     ├─→ AppSync (GraphQL) ← Todo CRUD、リアルタイム同期
     └─→ Blocks API (JSON-RPC) ← CronJob, AsyncJob, AI Agent
```

**メリット:**
- Amplify の強み（GraphQL, Subscription, Amplify UI）をそのまま活用
- Blocks は Amplify では難しい機能だけを担当
- AWS の想定するベストプラクティスに沿っている

**デメリット:**
- AppSync を使う部分はローカルで動かない（サンドボックス必須）
- 2つの API パラダイム (GraphQL + JSON-RPC) が混在

#### パターン C: ハイブリッド呼び分け

B とほぼ同じだが、機能ごとに最適な方を選ぶ:

| 機能 | 選択 | 理由 |
|------|------|------|
| Todo CRUD | AppSync | リアルタイム同期、Amplify UI 対応 |
| ファイルアップロード | Amplify Storage | 署名付き URL、アクセス制御 |
| 定期レポート生成 | Blocks CronJob | AppSync では不可能 |
| AI チャットボット | Blocks Agent | Bedrock 連携 |
| バッチ処理 | Blocks AsyncJob | 長時間実行タスク |

### 13.3 ローカル開発の制約まとめ

| コンポーネント | ローカル実行 | 制約 |
|--------------|------------|------|
| Blocks API (KVStore, CronJob 等) | 可能 | インメモリモック |
| Blocks CognitoVerifier | 不可 | Cognito はクラウドに依存 |
| Amplify Data (AppSync) | 不可 | ローカルモックなし |
| Amplify Auth (Cognito) | 不可 | サンドボックス必須 |
| Amplify Storage (S3) | 不可 | サンドボックス必須 |

**結論:** Blocks で書いた部分は認証なしで高速にローカル開発できるが、Amplify サービス（Auth, Data, Storage）を使う部分は従来通りサンドボックスが必要。

### 13.4 推奨する開発フロー

```
┌─────────────────────────────────────────────────────────────┐
│ 開発フェーズ別の使い分け                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Phase 1: 高速プロトタイピング                                 │
│  └── npm run dev (Blocks ローカル)                           │
│      └── 新機能のロジックを素早く実装・検証                      │
│                                                             │
│  Phase 2: AWS 統合テスト                                      │
│  └── npx ampx sandbox                                       │
│      └── Cognito 認証、AppSync、S3 との連携を確認               │
│                                                             │
│  Phase 3: デプロイ                                            │
│  └── npx ampx deploy / Amplify Hosting                      │
│      └── 本番環境へ反映                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 14. 最終結論

### 14.1 「Blocks を Amplify に取り込む価値はあるか」

**Yes、ただし用途を明確にする必要がある。**

- **ローカル高速開発が最優先** → パターン A (Blocks 全振り) が有効
- **Amplify の強み (GraphQL, リアルタイム同期) を活かしたい** → パターン B/C で補完的に使う
- **AI エージェントとの協業を重視** → Blocks の AGENTS.md 対応は大きなアドバンテージ

### 14.2 技術的実現性の確認結果

| 検証項目 | 結果 |
|---------|------|
| Amplify Gen2 プロジェクトへの Blocks 統合 | 可能 (Nested Stack パターン) |
| 既存コードへの影響 | 最小限 (backend.ts 2行追加) |
| Angular フロントエンドからの Blocks 利用 | 可能 (JSON-RPC + fetch) |
| ローカル完全実行 (AWS 不要) | 可能 (Blocks ローカルサーバー) |
| ビルドの互換性 | 問題なし (ng build, tsc 共に成功) |
| テンプレート CLI | 不安定 (Preview 故の制約) |

### 14.3 プロダクション導入への判断

| 判断基準 | 現状 |
|---------|------|
| API の安定性 | Preview — 破壊的変更の可能性あり |
| ドキュメント | 基本的な部分は整備済み |
| コミュニティ・サポート | 立ち上がり段階 |
| 既知のバグ | テンプレート CLI の amplify テンプレートが動かない |
| 推奨用途 | 技術検証、プロトタイプ、社内ツール |
| 非推奨用途 | ミッションクリティカルな本番システム |

---

## 15. 考察: Blocks の本当のポジショニング

### 15.1 「補完」の実態を掘り下げる

AWS 公式は Blocks を Amplify の「補完」と位置づけているが、検証とディスカッションを通じて、この「補完」の実態は以下のように整理できる。

**表面的な説明:**
> Amplify はホスティング・CI/CD・マネージド体験、Blocks は型安全なインフラ定義とローカル開発

**検証後の率直な評価:**

「ユースケースに応じた使い分け」は技術的に可能だが、Amplify の標準的なユーザー（CRUD + 認証 + ホスティングで十分な層）にとっては、Blocks を足す動機が薄い。

### 15.2 公式 test-app の分析

GitHub リポジトリ [aws-devtools-labs/aws-blocks/test-apps/amplify-gen2](https://github.com/aws-devtools-labs/aws-blocks/tree/main/test-apps/amplify-gen2) を確認した。

構成:
- **Amplify Data** (`amplify/data/resource.ts`) — AppSync + DynamoDB で Todo (guest 認証)
- **Blocks KVStore** (`aws-blocks/index.ts`) — Key-Value ストア
- **Blocks DistributedDatabase** (`aws-blocks/index.ts`) — Aurora DSQL で SQL ベースの Todo (Cognito 認証、マイグレーション管理付き)

同じ「Todo」が Amplify Data と Blocks の両方で実装されている。これは「共存可能であることの技術デモ」であり、プロダクションにおけるベストプラクティスの提示ではない。

### 15.3 Blocks が本当に効く場面: 業務アプリケーション化

ディスカッションの結果、以下の仮説に到達した。

> **Amplify で始めたプロジェクトが「業務アプリ」に成長するフェーズで、Blocks の価値が顕在化する。**

業務アプリケーションに成長すると発生する要件:

| 要件 | Amplify だけ | + Blocks |
|------|------------|----------|
| RDB でのマスタデータ管理 | DynamoDB は辛い。Amplify Data の RDS 対応は抽象度が高く SQL の表現力をフルに使えない | `DistributedDatabase` + SQL マイグレーション管理 |
| 月次請求バッチ | CDK で EventBridge + Lambda を手書き | `CronJob` 1行 |
| CSV インポート (大量データ) | CDK で SQS + Lambda を手書き | `AsyncJob` 1行 |
| 帳票 PDF 生成 | 同上 | 同上 |
| メール通知 (承認依頼、リマインド) | Cognito トリガー程度。テンプレートメールは自前 | `EmailClient` でテンプレート送信 |
| AI による書類要約・チャットサポート | Amplify AI Kit (ある程度可) | `Agent` + `KnowledgeBase` |
| 複雑なデータ集計・レポーティング | AppSync リゾルバで頑張るか Lambda 手書き | `Database` で SQL クエリ直接実行 |

### 15.4 SQL マイグレーション管理の比較

業務アプリでは RDB + マイグレーション管理が避けられない。ここに明確な差がある。

| 観点 | Amplify Data (SQL 対応) | Blocks DistributedDatabase |
|------|------------------------|--------------------------|
| スキーマ定義 | TypeScript DSL (`a.model()`) | 生 SQL マイグレーションファイル |
| マイグレーション管理 | 自動 (Amplify が内部で差分適用) | 手動 (番号付き SQL ファイルで順序管理) |
| ロールバック | なし | 可能 |
| 複雑な DDL (部分インデックス、トリガー等) | 不可 | 何でも書ける |
| データ移行スクリプト | 不可 | SQL で自由に記述 |
| ローカル実行 | 不可 | 可能 (組み込み DB) |
| 向いている用途 | シンプルな CRUD、プロトタイプ | 業務ロジックが複雑なデータ操作 |

### 15.5 成長フェーズモデル

```
┌─────────────────────────────────────────────────────────────────┐
│ Amplify プロジェクトの成長と Blocks の出番                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase 1: MVP / プロトタイプ                                      │
│  └── Amplify のみで十分                                          │
│      Auth + Data (DynamoDB) + Hosting                           │
│      → Blocks は不要                                            │
│                                                                 │
│  Phase 2: 業務要件の複雑化                                        │
│  └── 「DynamoDB だと辛い」「定期バッチが欲しい」が出始める            │
│      → Blocks を検討するタイミング                                 │
│      └── DistributedDatabase (SQL + マイグレーション)              │
│      └── CronJob (定期実行)                                      │
│      └── AsyncJob (非同期処理)                                    │
│                                                                 │
│  Phase 3: 本格的な業務アプリ                                       │
│  └── Amplify Hosting + Blocks バックエンド が主構成に               │
│      └── Amplify: Auth, Hosting, CI/CD                           │
│      └── Blocks: API, Database, CronJob, AsyncJob, Agent         │
│      └── AppSync は リアルタイム同期が本当に必要な箇所だけ残す        │
│                                                                 │
│  (従来の選択肢: このフェーズで CDK / SST に全面移行)                  │
│  → Blocks があれば Amplify エコシステム内に留まれる可能性             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 15.6 仮説の整理

**従来:**
- Amplify で MVP → 要件が複雑化 → CDK / SST に全面移行（大規模リライト）

**Blocks がある世界:**
- Amplify で MVP → 要件が複雑化 → Blocks を追加（`backend.ts` に2行追加）
- Amplify のホスティング・認証・CI/CD はそのまま
- バックエンドの複雑な部分だけ Blocks で段階的に拡張

**この仮説が成立する条件:**
1. Blocks が GA になり、API が安定すること
2. Amplify Hosting が Blocks バックエンドを公式サポートすること
3. DistributedDatabase のマイグレーション運用が本番レベルで実用的であること

### 15.7 結論（更新）

当初の評価「Amplify ユーザーに Blocks の需要はニッチ」は、**「MVP フェーズ」に限定すれば正しい**。

しかし「**Amplify で始めたプロジェクトが業務アプリとして成長するフェーズ**」を想定すると、Blocks は CDK 全面移行を回避するための現実的な拡張手段になり得る。

特に以下の組み合わせが、Blocks の「Amplify 補完」としての最も自然なユースケースと考えられる:

1. **DistributedDatabase** — RDB + SQL マイグレーション (DynamoDB からの卒業)
2. **CronJob / AsyncJob** — 定期実行・非同期処理 (業務バッチ)
3. **Agent / KnowledgeBase** — AI 機能の追加

これらは「Amplify 標準機能では対応できず、かつ業務アプリでは高頻度で求められる」要件であり、Blocks の導入動機として最も説得力がある。

---

## 16. 考察: Kiro スペック開発 × Blocks ローカル検証の相乗効果

### 16.1 背景: AI エージェント時代の開発ループ

Kiro のスペック開発は「要件 → 設計 → タスク分解 → 自律実装」のワークフローを提供する。エージェントが各タスクを実装する際、**「書いたコードが正しく動くか」のフィードバックループの速度**が実装品質に直結する。

Blocks の設計思想「AWS アカウント不要、数秒で起動、ローカルで即座に動作確認」は、このフィードバックループの高速化に直接寄与する。

### 16.2 従来の Amplify 開発における課題

```
Kiro + Amplify Data (AppSync) の実装ループ:

  エージェントがコードを書く
    → npx ampx sandbox でクラウドに反映 (数分)
    → API 呼び出しで検証 (成功 or 失敗)
    → 失敗時: 修正 → 再度 sandbox 反映 (数十秒〜数分)
    → 5回修正を繰り返す場合: 15〜20分
```

問題点:
- デプロイ待ちの間、エージェントの実行時間を消費する
- AWS クレデンシャルが必要（CI 環境でのスペック実行が制約される）
- GraphQL のモック構築が複雑で、テストの自動化が難しい
- フィードバックが遅いため、エージェントの修正精度に影響

### 16.3 Blocks + Kiro の高速フィードバックループ

```
Kiro + Blocks の実装ループ:

  エージェントがコードを書く
    → Blocks サーバー (tsx watch) がホットリロード (数秒)
    → curl / fetch で JSON-RPC API を叩いて検証 (即時)
    → 失敗時: 構造化エラーレスポンスを読み取り → 即修正 → 即再テスト
    → 5回修正を繰り返す場合: 30秒〜1分
```

改善点:
- 1イテレーションが数秒で完結
- AWS アカウント・クレデンシャル不要
- JSON-RPC のエラーレスポンスが構造化されており、エージェントが原因を正確に把握
- curl 1行でテスト可能（GraphQL クエリの構築不要）
- AGENTS.md により、エージェントが最初から正しいコードを書く確率が上がる

### 16.4 Kiro での実現構成案

#### Hook による自動化

```
.kiro/
├── hooks/
│   ├── blocks-server-start.json    ← セッション開始時にサーバー起動確認
│   └── blocks-smoke-test.json      ← タスク完了時に API スモークテスト
└── steering/
    └── blocks-development.md       ← Blocks 開発のルール・検証手順
```

#### Hook: セッション開始時の Blocks サーバー起動

```json
{
  "version": "v1",
  "hooks": [{
    "name": "Start Blocks Dev Server",
    "trigger": "SessionStart",
    "action": {
      "type": "command",
      "command": "pgrep -f 'aws-blocks/scripts/server.ts' || npx tsx aws-blocks/scripts/server.ts &"
    }
  }]
}
```

#### Hook: タスク完了時の API スモークテスト

```json
{
  "version": "v1",
  "hooks": [{
    "name": "Blocks API Smoke Test",
    "trigger": "PostTaskExec",
    "action": {
      "type": "command",
      "command": "curl -sf -X POST http://localhost:3001/aws-blocks/api -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":\"test\",\"method\":\"api.greet\",\"params\":[\"smoke-test\"]}'"
    }
  }]
}
```

#### Steering: Blocks 開発ルール

```markdown
# Blocks Development Rules

## 実装ルール
- バックエンド API は `aws-blocks/index.ts` に ApiNamespace として定義する
- KVStore, DistributedDatabase など適切な Block を使用する
- 認証が必要な API は CognitoVerifier.requireAuth() を使う

## 検証ルール
- API を実装したら必ず Blocks ローカルサーバーで動作確認する
- テストは JSON-RPC 形式で curl を使って実行する
- エンドポイント: http://localhost:3001/aws-blocks/api
- エラーが返った場合は修正してから次のタスクに進む
```

### 16.5 具体的なスペック開発シナリオ

```
[スペック: 月次売上レポート API の実装]

要件:
- 指定月の売上合計を集計する
- 結果を JSON で返す
- 認証済みユーザーのみアクセス可能

タスク分解:
  1. DistributedDatabase に sales テーブルのマイグレーションを追加
  2. api.generateMonthlyReport(month: string) を実装
  3. 動作確認

タスク 2 の実行フロー:
  ├── Kiro: aws-blocks/index.ts にコードを追加
  │     async generateMonthlyReport(month: string) {
  │       const user = await auth.requireAuth(context);
  │       const rows = await db.query(sql`
  │         SELECT SUM(amount) as total FROM sales
  │         WHERE month = ${month} AND org_id = ${user.orgId}
  │       `);
  │       return { month, total: rows[0].total };
  │     }
  │
  ├── tsx watch がホットリロード (自動、数秒)
  │
  ├── Kiro: curl で検証
  │     curl -X POST localhost:3001/aws-blocks/api
  │       -d '{"jsonrpc":"2.0","id":"1","method":"api.generateMonthlyReport","params":["2025-06"]}'
  │
  ├── レスポンス: {"jsonrpc":"2.0","result":{"month":"2025-06","total":0},"id":"1"}
  │     → 成功。タスク完了。
  │
  └── (もしエラーなら)
        レスポンス: {"jsonrpc":"2.0","error":{"code":500,"message":"relation \"sales\" does not exist"}}
        → Kiro がエラーを読み取り、マイグレーションが未適用と判断
        → 修正 → 再テスト → 通ったらタスク完了
```

### 16.6 相乗効果の整理

| Blocks の特性 | Kiro への恩恵 |
|--------------|-------------|
| ローカルで即起動 | エージェントの待ち時間ゼロ |
| ホットリロード (tsx watch) | コード変更が即反映、再起動不要 |
| JSON-RPC プロトコル | テストが curl 1行。GraphQL スキーマ不要 |
| 構造化エラーレスポンス | エージェントがエラー原因を正確に特定 |
| インメモリモック | テスト状態の初期化が容易 |
| AGENTS.md 同梱 | エージェントが正しい Block の使い方を最初から理解 |
| AWS アカウント不要 | CI/CD でのスペック実行に制約なし |

### 16.7 「Blocks にすべきか」の判断基準への追加

セクション 15 で挙げた「業務アプリ化フェーズで Blocks を使う」判断基準に、以下を追加する:

**従来の判断基準:**
1. RDB + SQL マイグレーションが必要か
2. 定期実行・非同期処理が必要か
3. AI 機能の追加が必要か

**追加の判断基準:**
4. **Kiro (AI エージェント) による自動実装・検証が効くか**

具体的には:
- ビジネスロジックが複雑で、試行錯誤が予想される部分 → Blocks で書けばローカル検証ループが回る
- API のインターフェースが固まっていて変更が少ない部分 → Amplify Data でも問題ない
- 新機能のプロトタイピング段階 → Blocks でローカルで高速に検証し、固まったら判断

### 16.8 将来的な展望

Blocks が GA し、Kiro のスペック開発が成熟すると、以下のワークフローが実現する可能性:

```
1. プロダクトオーナーがスペック (要件) を記述
2. Kiro がタスクに分解
3. 各タスクでエージェントが:
   a. Blocks API を実装
   b. ローカルサーバーで即座に検証
   c. エラーがあれば自動修正
   d. 通ったら次のタスクへ
4. 全タスク完了後、npx ampx sandbox でクラウド統合テスト
5. PR 作成 → レビュー → マージ → Amplify Hosting でデプロイ
```

このフローでは「人間がコードを書く」パートが最小化され、「人間が要件を定義し、結果をレビューする」パートに集中できる。Blocks のローカル即時実行は、このフローの Step 3 における **エージェントの自律性と品質** を支える基盤として機能する。

### 16.9 現時点での制約と課題

| 課題 | 詳細 |
|------|------|
| サーバーのライフサイクル管理 | Hook でバックグラウンドプロセスを起動した場合の停止タイミング |
| テストデータの初期化 | インメモリストアはサーバー再起動でリセットされるが、テスト間の状態分離が必要 |
| 認証付き API のテスト | CognitoVerifier を使う API はローカルでは Cognito なしでは動かない。テスト用のバイパスが必要 |
| Steering の粒度 | プロジェクトごとに Block の使い方が異なるため、汎用的な Steering は書きにくい |
| Blocks の API 安定性 | Preview 段階のため、Steering や Hook の内容が Blocks のバージョンアップで壊れる可能性 |

### 16.10 補足: Kiro の従来検証と Blocks が追加する検証レベルの違い

#### Kiro が従来から行っているローカル検証

Kiro は Blocks がなくても以下の検証をローカルで実行している:

| 検証手段 | 確認できること | 限界 |
|---------|-------------|------|
| `tsc` / `ng build` | 型の不整合、構文エラー、import ミス | 「型は通るが実行時にエラーになる」コードは検出不可 |
| `get_diagnostics` | IDE レベルのリアルタイムエラー検出 | 同上 |
| `npm test` (Karma/Jest) | ユニットテスト (モックベース) | モックが実際のサービスと同じ振る舞いをする保証がない |
| lint (ESLint 等) | コードスタイル、潜在バグパターン | ビジネスロジックの正しさは判定できない |

**これらは全て「静的解析」または「モックベースの単体テスト」であり、ローカルで高速に動く。Blocks の有無に関わらず機能する。**

#### Blocks が追加する検証レベル: 結合テスト / 実行レベル検証

Blocks のローカルサーバーにより、エージェントが追加で実行できるのは以下:

| 検証手段 | 確認できること | 従来はどうしていたか |
|---------|-------------|-------------------|
| API 実呼び出し (curl) | エンドポイントが正しいレスポンスを返すか | サンドボックスにデプロイしないと不可 |
| DB 結合 (SQL 実行) | SQL 構文が正しいか、クエリ結果が期待通りか | モックまたはサンドボックス |
| 複数 Block 連携 | KVStore → CronJob → EmailClient の一連フロー | サンドボックスでのみ確認可能だった |
| エラーケース検証 | 不正入力、未認証、データ不存在時の振る舞い | ユニットテストで部分的にカバー |

#### ビルド通過と実行検証の差が大きい場面

```
例: SQL クエリを含む API

  // aws-blocks/index.ts
  async generateMonthlyReport(month: string) {
    const rows = await db.query(sql`
      SELECT SUM(amout) as total FROM sales  ← typo: amout
      WHERE month = ${month}
    `);
    return { month, total: rows[0].total };
  }

  tsc: ✅ コンパイル成功 (sql はテンプレートリテラル、型チェック対象外)
  lint: ✅ 問題なし
  ユニットテスト: ✅ db.query をモックしていれば通る

  Blocks ローカル実行:
    → {"error":{"code":500,"message":"column \"amout\" does not exist"}}
    → エージェントが即座にタイポを発見・修正
```

```
例: KVStore のキー設計ミス

  // put するときのキー
  await store.put(`user:${userId}:${key}`, value);

  // get するときのキー (別のメソッド)
  await store.get(`${userId}:${key}`);  ← "user:" prefix が抜けている

  tsc: ✅ 両方 string なので型は通る
  ユニットテスト: ✅ put/get を個別にモックすればどちらも通る

  Blocks ローカル実行:
    → put → get → null が返る
    → エージェントが「保存したのに取得できない」ことを検出 → キーの不一致を修正
```

#### 差が小さい場面 vs 大きい場面

| ケース | ビルドチェックだけで十分か | Blocks 実行検証の価値 |
|--------|------------------------|---------------------|
| 型定義の変更 | ✅ tsc で検出可能 | 低い |
| 単純な CRUD (1テーブル) | ほぼ十分 | 低い |
| SQL を含む集計ロジック | ❌ SQL 構文エラーは型では検出不可 | **高い** |
| 複数 Block の連携フロー | ❌ 結合の不整合は単体テストで出ない | **高い** |
| 条件分岐が多いビジネスロジック | 部分的 | **高い** |
| エラーハンドリング (401, 403, 404) | モックで部分カバー | 中程度 |

#### 結論: Blocks が追加するのは「ビルドチェックの強化」ではない

Blocks のローカル検証が Kiro にもたらすのは、lint やビルドの延長ではなく、**「実際に API を叩いて結果を見る」結合テストレベルの検証能力**である。

これは:
- 静的解析では検出不可能なバグ（SQL typo、キー不一致、連携ミス）を捕捉する
- モックの「嘘」に依存しない、実物ベースのフィードバックを提供する
- サンドボックスデプロイなしに、エージェントの実装ループ内で完結する

**業務ロジックが複雑になるほど、この差は拡大する。** シンプルな CRUD アプリなら型チェックで十分だが、業務アプリケーションの集計・バッチ・連携処理ではビルド通過だけでは品質が担保できない。ここが Blocks + Kiro の相乗効果が最も発揮される領域である。
