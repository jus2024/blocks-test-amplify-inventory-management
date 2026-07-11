# 統合テスト手順書

**対象システム**: 資材在庫管理システム (Inventory Management System)  
**作成日**: 2025年6月28日  
**前提**: AWS Blocks × Amplify Gen2 統合環境

---

## 概要

本手順書は、以下の2つの環境における手動統合テストのポイントと手順を定義する。

| 環境 | コマンド | 認証方式 | データストア |
|------|---------|---------|------------|
| ローカル開発 | `npm run dev` | AuthBasic (cookie) | ローカル PostgreSQL |
| Amplify Sandbox | `npx ampx sandbox` | Cognito (Bearer token) | Aurora DSQL |

---

## 前提条件

### 共通

```bash
node --version   # v22 以上
npm install      # aws-amplify 含む全依存パッケージ
```

### Amplify Sandbox 追加要件

- AWS CLI 設定済み（`aws configure` or 環境変数）
- Amplify CLI インストール済み（`npm install -g @aws-amplify/cli`）

---

## Phase 1: ローカル開発環境 (`npm run dev`)

### 1.1 起動

```bash
npm run dev
```

ブラウザで http://localhost:3100 を開く。

### 1.2 自動テスト（事前確認）

```bash
npm run test:e2e
```

全35テストがパスすることを確認。パスしない場合は手動テストに進まない。

---

### 1.3 認証テスト

| # | 手順 | 期待結果 |
|---|------|---------|
| A-1 | 画面右上の「Sign In」をクリック | ログインモーダルが表示される |
| A-2 | Sign Up: `test@example.com` / `TestPass123!` で登録 | サインイン状態になる |
| A-3 | Sign Out → Sign In で再ログイン | サインイン状態に戻る |
| A-4 | 別タブで同じURLを開く | サインイン状態がクロスタブ同期される |
| A-5 | Sign Out | 全タブでサインアウト状態になる |

---

### 1.4 資材マスタテスト

| # | 手順 | 期待結果 |
|---|------|---------|
| M-1 | 「資材管理」タブを選択 | 資材一覧テーブルが表示される |
| M-2 | フォームに入力: 品名=`テスト資材`, SKU=`TEST-001`, 単位=`個`, カテゴリ=`原材料`, 閾値=`50` → 登録 | 一覧に追加される |
| M-3 | 同じ SKU で別資材を登録 | エラー表示「SKU already exists」 |
| M-4 | 作成した資材の「編集」→ 品名を変更 → 更新 | 一覧に反映される |
| M-5 | 作成した資材の「削除」 | 一覧から消える |
| M-6 | 品名を空にして登録 | エラー表示「Validation error」 |
| M-7 | SKU に `!@#` を含めて登録 | エラー表示「Validation error」 |

---

### 1.5 倉庫マスタテスト

| # | 手順 | 期待結果 |
|---|------|---------|
| W-1 | 「倉庫管理」タブを選択 | 倉庫一覧テーブルが表示される |
| W-2 | 倉庫名=`本社倉庫`, 所在地=`東京都千代田区` → 登録 | 一覧に追加される |
| W-3 | 編集 → 所在地を変更 → 更新 | 一覧に反映される |
| W-4 | 在庫がない倉庫を削除 | 一覧から消える |
| W-5 | 倉庫名を空にして登録 | エラー表示「Validation error」 |

---

### 1.6 入出庫テスト

| # | 手順 | 期待結果 |
|---|------|---------|
| T-1 | 「入出庫」タブを選択 | 資材・倉庫のドロップダウンが表示される |
| T-2 | 入庫: 資材=`テスト資材`, 倉庫=`本社倉庫`, 数量=`100` → 記録 | エラーなく完了 |
| T-3 | 出庫: 同資材・同倉庫, 数量=`30` → 記録 | エラーなく完了 |
| T-4 | 出庫: 同資材・同倉庫, 数量=`200` → 記録 | エラー表示「Insufficient stock」 |
| T-5 | 数量=`0` で入庫を試みる | エラー表示「Validation error」 |

---

### 1.7 在庫照会テスト

| # | 手順 | 期待結果 |
|---|------|---------|
| S-1 | 「在庫照会」タブを選択 | 全在庫が表示される |
| S-2 | T-2, T-3 を実行済みの状態で確認 | テスト資材 × 本社倉庫 = 70 |
| S-3 | 倉庫フィルタで `本社倉庫` を選択 | 本社倉庫の在庫のみ表示 |
| S-4 | 資材フィルタで `テスト資材` を選択 | テスト資材の在庫のみ表示 |
| S-5 | 在庫がない組み合わせでフィルタ | 「データなし」と表示 |

---

### 1.8 アラートテスト

| # | 手順 | 期待結果 |
|---|------|---------|
| AL-1 | 「アラート」タブを選択 | アラート一覧が表示される（初期は空） |
| AL-2 | 閾値 100 の資材を作成し、50 だけ入庫 | — |
| AL-3 | ターミナルから低在庫チェックを実行（後述） | アラートタブに新規アラートが表示される |
| AL-4 | アラートの「確認」ボタンをクリック | アラートが一覧から消える |

**低在庫チェックのトリガー方法（ローカル）:**

ローカルサーバー起動中（`npm run dev`）にターミナルから以下を実行:

```bash
npx tsx -C browser -e "
const { api, authApi } = await import('aws-blocks');
const { installCookieJar } = await import('@aws-blocks/blocks/utils');
installCookieJar();
await authApi.setAuthState({ action: 'signIn', username: 'YOUR_USERNAME', password: 'YOUR_PASSWORD' });
const result = await api.triggerLowStockCheck();
console.log(result);
"
```

成功時の出力:
```
[Blocks] Using API (config.json file): http://localhost:3000/aws-blocks/api
{ ok: true }
```

> **注意**: `-C browser` フラグが必要（`package.json` の `test:e2e` と同じ条件登録）。`-e` のみでは top-level await が動作しないため、`await import(...)` の動的 import 形式を使う。

---

## Phase 2: Amplify Sandbox (`npx ampx sandbox`)

### 2.1 起動

```bash
NODE_OPTIONS="--conditions=cdk" npx ampx sandbox
```

> **重要**: `--conditions=cdk` が必要。Blocks の CDK コンストラクトは Node.js の条件付きエクスポートを使用しており、このフラグがないとモック実装がロードされてデプロイに失敗する。`npm run sandbox`（Blocks 単体）では自動設定されるが、`ampx sandbox`（Amplify CLI）では手動指定が必要。

初回はスタックのデプロイに5〜10分かかる。完了後、`amplify_outputs.json` が生成される。

> **注意**: `npm run sandbox` は **実行しない**。`ampx sandbox` が `amplify/blocks.ts` の `initBlocks` 経由で Blocks バックエンド (Lambda + API Gateway + DSQL) も一体でデプロイするため、別途 Blocks 単体デプロイは不要。

デプロイ完了後、フロントエンドのローカル開発サーバーを起動:

```bash
npx vite
```

ブラウザで http://localhost:5173 を開く。

Blocks API のエンドポイントをクラウドに向ける:

```bash
cat > .blocks-sandbox/config.json << 'EOF'
{
  "apiUrl": "<amplify_outputs.json の custom.blocks_api_url の値>",
  "environment": "sandbox"
}
EOF
```

`amplify_outputs.json` 内の `custom.blocks_api_url` の値を確認して設定する。例:
```json
{
  "apiUrl": "https://xxxxx.execute-api.us-west-2.amazonaws.com/prod/aws-blocks/api",
  "environment": "sandbox"
}
```

> **ローカルに戻すとき**: `npm run dev` を実行すれば `.blocks-sandbox/config.json` は自動的に `localhost:3000` に戻る。

### 2.2 確認ポイント（デプロイ確認）

| # | 確認項目 | 手順 | 期待結果 |
|---|---------|------|---------|
| D-1 | CloudFormation スタック作成 | AWS Console → CloudFormation | `amplify-*-blocks` ネストスタックが存在 |
| D-2 | Lambda 関数作成 | AWS Console → Lambda | Blocks ハンドラ関数が存在 |
| D-3 | Aurora DSQL クラスター | AWS Console → RDS | DSQL クラスターが作成されている |
| D-4 | Cognito User Pool | AWS Console → Cognito | User Pool が作成されている |

---

### 2.3 認証統合テスト（Cognito）

| # | 手順 | 期待結果 |
|---|------|---------|
| CA-1 | ブラウザで sandbox URL を開く | Amplify Auth のログイン画面が表示される |
| CA-2 | Cognito でユーザー登録（メール認証あり） | 確認コード入力画面に遷移 |
| CA-3 | メールで受信した確認コードを入力 | サインイン完了、在庫管理画面が表示 |
| CA-4 | ページリロード | セッションが維持されている |
| CA-5 | Sign Out → Sign In | 再ログインできる |

**重要な確認ポイント:**
- Cognito の ID Token が Blocks API リクエストの `Authorization: Bearer ...` ヘッダーに付与されていること（DevTools Network タブで確認）
- `CognitoVerifier` が JWT を正しく検証していること（API エラーが出ないこと）

---

### 2.4 データ永続性テスト（Aurora DSQL）

| # | 手順 | 期待結果 |
|---|------|---------|
| PD-1 | 資材を作成 | 成功 |
| PD-2 | `npm run sandbox` を再起動 | — |
| PD-3 | 在庫照会で先ほどの資材を確認 | データが保持されている |
| PD-4 | 別ブラウザ（シークレットモード）で同じユーザーでログイン | 同じデータが見える |

---

### 2.5 業務フロー統合テスト

Phase 1 のテスト（M-1〜AL-4）を sandbox 環境で同様に実施する。

追加で確認すべき sandbox 固有ポイント:

| # | 確認項目 | 期待結果 |
|---|---------|---------|
| SF-1 | 入出庫のトランザクション整合性 | 同時に同じ資材の出庫を試みた場合、OCC リトライで整合性が保たれる |
| SF-2 | DSQL のマイグレーション | 初回デプロイ時に `dsql-migrations/` のSQLが適用される |
| SF-3 | CronJob のスケジュール確認 | EventBridge ルールが作成されている（AWS Console） |
| SF-4 | AsyncJob のキュー確認 | SQS キューが作成されている（AWS Console） |

---

### 2.6 CSV インポートテスト（AsyncJob）

| # | 手順 | 期待結果 |
|---|------|---------|
| CSV-1 | 事前に資材・倉庫を登録 | — |
| CSV-2 | 以下の CSV テキストをインポート | jobId が返される |
| CSV-3 | ジョブ結果を取得 | successCount=1, failedCount=1 |
| CSV-4 | 在庫照会で確認 | 有効行の入庫が反映されている |

テスト CSV:
```csv
material_sku,warehouse_name,type,quantity,note
TEST-001,本社倉庫,in,100,一括入荷
INVALID-SKU,本社倉庫,in,50,存在しないSKU
```

---

## Phase 3: Amplify Hosting デプロイ（本番相当）

### 3.1 前提知識: `--conditions=cdk` が必要な理由

Blocks の各 Building Block パッケージは Node.js の **Conditional Exports** を使い、2つの実装を切り替えている：

- **通常の `"import"` condition** → モック/クライアント用の軽量実装
- **`"cdk"` condition** → CDK コンストラクト（実際の AWS リソース定義）

`--conditions=cdk` なしで CDK synth が実行されると、Building Block がモック実装に解決され、CloudFormation テンプレートにインフラが含まれない。Blocks のコードには明示的なチェックがあり、条件が未設定の場合はビルドエラー (`Missing --conditions=cdk`) で停止する。

`npm run sandbox` や `npm run deploy`（Blocks CLI）では自動設定されるが、**Amplify Hosting の CI/CD パイプラインでは手動設定が必要**。

---

### 3.2 デプロイ手順

#### 1. GitHub リポジトリに push

```bash
git add -A && git commit -m "deploy to amplify hosting"
git push origin main
```

#### 2. Amplify Hosting アプリを作成（初回のみ）

1. AWS Console → Amplify → 「New app」→「Host web app」
2. GitHub リポジトリを接続
3. ブランチ `main` を選択

#### 3. 環境変数を設定（重要）

Amplify Console → 対象アプリ → 「Hosting」→「Environment variables」で以下を追加：

| Key | Value |
|-----|-------|
| `NODE_OPTIONS` | `--conditions=cdk` |

> **これを設定しないとどうなるか**: ビルドフェーズで `BlocksBackend.create()` 内の `assertCdkConditionActive()` チェックに引っかかり、以下のエラーでビルドが失敗する:
> ```
> Missing --conditions=cdk: Building Blocks will silently load mock implementations instead of CDK constructs.
> ```
> サイレントに壊れることはない（デプロイは止まる）ので安全。

#### 4. ビルド設定の確認

Amplify Gen 2 のデフォルトビルド設定で動作する。カスタム `amplify.yml` を使用している場合は、backend フェーズの環境に `NODE_OPTIONS` が渡されることを確認する。

#### 5. デプロイ実行

push 後に自動的に CI/CD パイプラインが起動。または Amplify Console から手動で「Redeploy this version」。

---

### 3.3 デプロイ確認

| # | 確認項目 | 手順 | 期待結果 |
|---|---------|------|---------|
| HD-1 | ビルド成功 | Amplify Console → Build ログ | 全フェーズが緑で完了 |
| HD-2 | CloudFront URL にアクセス | Amplify が発行した URL を開く | ログイン画面が表示される |
| HD-3 | Cognito ユーザー登録 | 新規ユーザーで Sign Up | メール認証 → ログイン成功 |
| HD-4 | Blocks API 疎通 | 資材マスタを1件登録 | エラーなく登録される |
| HD-5 | DSQL データ永続性 | ブラウザリロード後に資材一覧を確認 | 登録した資材が表示される |

---

### 3.4 本番環境固有の確認

| # | 確認項目 | 期待結果 |
|---|---------|---------|
| HP-1 | CORS | CloudFront 経由（同一オリジン）なので CORS エラーは発生しない |
| HP-2 | HTTPS | CloudFront 配信のため自動的に HTTPS |
| HP-3 | 新しい DSQL クラスター | Sandbox とは別のクラスターが作成される（データは共有されない） |
| HP-4 | 新しい Cognito User Pool | Sandbox とは別の User Pool が作成される（ユーザーは共有されない） |
| HP-5 | DevTools Network タブ | API リクエストが `https://<cloudfront-domain>/aws-blocks/api` に送信されている |

---

### 3.5 Sandbox との違いまとめ

| 項目 | Sandbox (`ampx sandbox`) | Amplify Hosting |
|------|--------------------------|-----------------|
| 起動方法 | ローカルから `ampx sandbox` | GitHub push → CI/CD |
| フロントエンド | `npx vite` (localhost) | CloudFront (HTTPS) |
| API アクセス | `.blocks-sandbox/config.json` 経由 | Hosting が自動的にプロキシ設定 |
| `--conditions=cdk` | コマンドで手動指定 | Amplify 環境変数で設定 |
| データ | Sandbox 用 DSQL | 本番用 DSQL（別クラスター） |
| ユーザー | Sandbox 用 Cognito | 本番用 Cognito（別 User Pool） |

---

## Phase 4: クリーンアップ

### ローカル

```bash
# サーバー停止
Ctrl+C (または kill %1)

# ローカル DB データ削除（任意）
rm -rf .bb-data/
```

### Amplify Sandbox

```bash
npx ampx sandbox delete
```

全リソース（Cognito, DSQL, Lambda, SQS, EventBridge）が削除されることを確認。

### Amplify Hosting（本番）

本番環境を削除する場合:

1. Amplify Console → 対象アプリ → 「App settings」→「General」→「Delete app」
2. または特定ブランチのみ削除: 「Hosting」→ ブランチ → 「Delete branch」

> **注意**: 削除すると DSQL クラスターのデータも失われる。`deletionProtectionEnabled: true` が設定されている場合は、先に保護を解除する必要がある。

---

## テスト結果記録テンプレート

| Phase | テスト ID | 結果 | 備考 |
|-------|----------|------|------|
| 1 | A-1〜A-5 | ○/× | |
| 1 | M-1〜M-7 | ○/× | |
| 1 | W-1〜W-5 | ○/× | |
| 1 | T-1〜T-5 | ○/× | |
| 1 | S-1〜S-5 | ○/× | |
| 1 | AL-1〜AL-4 | ○/× | |
| 2 | D-1〜D-4 | ○/× | |
| 2 | CA-1〜CA-5 | ○/× | |
| 2 | PD-1〜PD-4 | ○/× | |
| 2 | SF-1〜SF-4 | ○/× | |
| 2 | CSV-1〜CSV-4 | ○/× | |
| 3 | HD-1〜HD-5 | ○/× | |
| 3 | HP-1〜HP-5 | ○/× | |
| 4 | クリーンアップ | ○/× | |

---

## 既知の注意事項

1. **ローカル ↔ Sandbox のデータは共有されない** — ローカルは `.bb-data/` 内の組み込み PostgreSQL、Sandbox は Aurora DSQL を使用
2. **Cognito はローカルでは動作しない** — ローカルでは AuthBasic（パスワードポリシーのみ）が認証を担う
3. **CronJob はローカルでは自動実行されない** — ターミナルから `npx tsx -C browser -e "..."` で `api.triggerLowStockCheck()` を手動呼び出しする（詳細は 1.8 アラートテスト参照）
4. **AsyncJob のローカル処理** — ローカルでは `setTimeout` でインプロセス処理、Sandbox では SQS 経由
5. **初回 `ampx sandbox` は時間がかかる** — DSQL クラスター作成に数分要する
6. **`ampx sandbox` には `NODE_OPTIONS="--conditions=cdk"` が必須** — Blocks の CDK コンストラクトを正しくロードするために必要。省略するとビルドエラー (`Missing --conditions=cdk`) になる
