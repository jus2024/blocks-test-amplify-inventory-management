# Implementation Plan: Cognito Auth Integration

## Overview

AuthBasic を廃止し、Amazon Cognito を唯一の認証プロバイダとして統合する。バックエンドでは CognitoVerifier を API コンテキストレベルで適用し、フロントエンドでは lit-html ベースの Cognito Auth UI を新規作成する。E2E テストはローカルモード（認証バイパス）で動作するよう更新する。

## Tasks

- [x] 1. Backend: AuthBasic 削除と CognitoVerifier 統合
  - [x] 1.1 Remove AuthBasic and authApi from backend
    - `aws-blocks/index.ts` から `AuthBasic` の import、インスタンス生成、`export const authApi` を削除する
    - `ApiNamespace` のコールバックを `async (context)` に変更し、先頭で `await cognitoAuth.requireAuth(context)` を呼び出す
    - `AuthBasic` の import を `@aws-blocks/blocks` の import リストから除去する
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Write property tests for CognitoVerifier bypass and rejection
    - **Property 1: Local Development Bypass** — `userPoolId` 未設定時に任意のヘッダーで `requireAuth()` が成功する
    - **Property 3: Invalid Token Rejection** — 設定済み時に不正トークンで "Unauthorized" エラーが投げられる
    - `test/auth-properties.test.ts` に fast-check を使用して実装
    - **Validates: Requirements 3.2, 3.3, 3.4, 6.2, 7.1**

- [x] 2. E2E テストの Cognito 対応
  - [x] 2.1 Update E2E tests to remove authApi dependency
    - `test/e2e.test.ts` から `authApi` の import と使用を完全に削除する
    - `test.before()` のサーバー起動待機を `api.listMaterials()` 等のヘルスチェックに変更する
    - auth テスト (`auth: sign up and sign in`) を削除する（AuthBasic 固有のため）
    - ローカルモードでは認証なしでそのまま API を呼び出す（CognitoVerifier がバイパスするため）
    - sandbox モード対応: `COGNITO_TEST_USER` 環境変数がある場合は `signIn` で認証する構造を追加
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 3. Checkpoint - Backend と E2E テスト
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Frontend: Cognito Auth UI の作成
  - [x] 4.1 Create src/auth-ui.ts with lit-html based Cognito auth forms
    - `aws-amplify/auth` の `signIn`, `signUp`, `signOut`, `confirmSignUp`, `getCurrentUser` を使用
    - lit-html で signIn / signUp / confirmSignUp フォームをレンダリング
    - 状態遷移: signIn → authenticated, signUp → confirmSignUp → signIn, authenticated → signOut → signIn
    - エラーハンドリング: 不正認証情報時にエラーメッセージ表示
    - `createAuthUI(container, onAuthenticated)` と `handleSignOut()` を export
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 4.2 Write unit tests for auth-ui state transitions
    - signIn 成功時に onAuthenticated コールバックが呼ばれること
    - signUp → confirmSignUp 遷移が正しく動作すること
    - エラー時にエラーメッセージが表示されること
    - **Validates: Requirements 1.2, 1.3, 1.5**

- [x] 5. Frontend: src/index.ts の Auth UI 統合
  - [x] 5.1 Replace Blocks UI auth components with Cognito Auth UI
    - `AccountMenuBar`, `AuthenticatedContent`, `onAuthChange` の import を削除する
    - `@aws-blocks/blocks/ui` からの import を完全に除去する
    - `authApi` の import を `aws-blocks` から削除する
    - `amplify_outputs.json` の `auth.user_pool_id` 有無で分岐: ある場合は `createAuthUI` を使用、ない場合はローカル開発モードとして直接アプリ表示
    - サインアウトボタンを authenticated 状態のナビゲーションに追加
    - _Requirements: 1.4, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.4, 7.2, 7.3_

  - [x] 5.2 Write property test for Auth Middleware token attachment
    - **Property 4: Middleware Token Attachment** — 認証済みセッションの ID Token が Bearer ヘッダーに正確に付与される
    - `test/auth-properties.test.ts` に追加
    - **Validates: Requirements 4.1**

- [x] 6. Checkpoint - 全テスト確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- CognitoVerifier (`aws-blocks/cognito-verifier.ts`) は変更不要 — 既存実装をそのまま使用
- `aws-blocks/client.js` は Blocks dev server が自動生成する。`authApi` 削除後、次回 `npm run dev` 時に再生成される
- ローカル開発モード: `COGNITO_USER_POOL_ID` 未設定 → CognitoVerifier は全リクエスト許可
- Property tests use fast-check (already in devDependencies)
- E2E テストは既存の 41 テストのうち auth テスト 1 件を削除し、残り 40 件はそのまま動作する

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2"] }
  ]
}
```
