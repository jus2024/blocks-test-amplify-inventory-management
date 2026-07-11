# Requirements Document

## Introduction

現在の資材在庫管理システムは認証に Blocks の `AuthBasic`（cookie ベース）を使用しているが、AppSync（DynamoDB の UserPreference / UserNote モデル）には Cognito User Pool トークンが必要である。本機能では AuthBasic を廃止し、Amazon Cognito を唯一の認証プロバイダとして統合することで、Blocks API と AppSync の両方が同一の Cognito アイデンティティで動作するようにする。

## Glossary

- **Cognito_Auth_Provider**: Amazon Cognito User Pool を使用したフロントエンド認証コンポーネント。Amplify UI の Authenticator を利用してサインイン・サインアップ・サインアウト UI を提供する
- **JWT_Verifier**: バックエンド Lambda が受け取った Cognito ID Token を検証するモジュール（既存の `CognitoVerifier` クラスを拡張）
- **Blocks_API**: aws-blocks/index.ts で定義された ApiNamespace。Aurora DSQL に対する CRUD 操作を提供するバックエンド API
- **AppSync_Client**: Amplify Data Client。Cognito User Pool トークンを使って DynamoDB の UserPreference / UserNote モデルにアクセスする
- **Auth_Middleware**: フロントエンドの HTTP クライアントミドルウェア。Cognito セッションから ID Token を取得し、Blocks API リクエストの Authorization ヘッダに付与する
- **AuthBasic**: Blocks フレームワーク提供の cookie ベース認証。本機能で廃止対象
- **E2E_Test_Suite**: test/e2e.test.ts で定義されたエンドツーエンドテスト群

## Requirements

### Requirement 1: Cognito によるフロントエンド認証 UI の提供

**User Story:** As a user, I want to sign in using Cognito (email/password), so that I can access the inventory management system with a unified identity.

#### Acceptance Criteria

1. WHEN the application loads, THE Cognito_Auth_Provider SHALL render a sign-in form that accepts email and password
2. WHEN a user submits valid credentials, THE Cognito_Auth_Provider SHALL authenticate the user via Cognito User Pool and display the authenticated application content
3. WHEN a user submits invalid credentials, THE Cognito_Auth_Provider SHALL display an error message describing the authentication failure
4. WHEN a user is not authenticated, THE Cognito_Auth_Provider SHALL hide all application sections (materials, warehouses, transactions, stock inquiry, alerts, notes, settings)
5. WHEN a user clicks sign-out, THE Cognito_Auth_Provider SHALL terminate the Cognito session and return to the sign-in form
6. THE Cognito_Auth_Provider SHALL support new user sign-up with email verification via Cognito User Pool

### Requirement 2: AuthBasic の廃止

**User Story:** As a developer, I want to remove the AuthBasic dependency, so that the system uses a single authentication mechanism (Cognito).

#### Acceptance Criteria

1. THE Blocks_API SHALL NOT depend on AuthBasic for authentication or session management
2. THE Blocks_API SHALL NOT export authApi from the backend module
3. WHEN the frontend loads, THE Cognito_Auth_Provider SHALL replace AccountMenuBar and AuthenticatedContent components that previously depended on AuthBasic
4. THE frontend SHALL NOT import AccountMenuBar, AuthenticatedContent, or onAuthChange from @aws-blocks/blocks/ui

### Requirement 3: Blocks API の Cognito JWT 検証

**User Story:** As a developer, I want the Blocks API to validate Cognito JWT tokens, so that only authenticated Cognito users can access backend resources.

#### Acceptance Criteria

1. WHEN a request with a valid Cognito ID Token in the Authorization header is received, THE JWT_Verifier SHALL allow the request to proceed
2. WHEN a request with an invalid or expired Cognito ID Token is received, THE JWT_Verifier SHALL reject the request with an "Unauthorized" error
3. WHEN a request without an Authorization header is received in cloud deployment, THE JWT_Verifier SHALL reject the request with an "Unauthorized" error
4. WHILE COGNITO_USER_POOL_ID environment variable is not set (local development), THE JWT_Verifier SHALL allow all requests without token validation
5. THE JWT_Verifier SHALL verify that the token's audience claim matches the COGNITO_CLIENT_ID environment variable

### Requirement 4: フロントエンドからの Cognito トークン付与

**User Story:** As a frontend application, I want to attach Cognito ID tokens to Blocks API requests, so that the backend can authenticate the caller.

#### Acceptance Criteria

1. WHEN a user is authenticated via Cognito, THE Auth_Middleware SHALL attach the Cognito ID Token as a Bearer token in the Authorization header of every Blocks API request
2. WHEN a user's Cognito session has expired, THE Auth_Middleware SHALL attempt to refresh the session before making the API request
3. IF the session refresh fails, THEN THE Auth_Middleware SHALL redirect the user to the sign-in form
4. WHILE no Cognito session exists (user not signed in), THE Auth_Middleware SHALL NOT send API requests

### Requirement 5: AppSync と Blocks API の統一アイデンティティ

**User Story:** As a user, I want my notes and preferences (AppSync/DynamoDB) and inventory data (Blocks API/DSQL) to be accessible with the same Cognito session, so that I have a seamless experience.

#### Acceptance Criteria

1. THE AppSync_Client SHALL use the same Cognito User Pool tokens as the Blocks_API for authorization
2. WHEN a user is authenticated, THE AppSync_Client SHALL be able to perform CRUD operations on UserNote and UserPreference models
3. WHEN a user is authenticated, THE Blocks_API SHALL be able to perform CRUD operations on materials, warehouses, transactions, and alerts
4. THE system SHALL use a single Cognito sign-in session for both AppSync and Blocks API access

### Requirement 6: E2E テストの Cognito 対応

**User Story:** As a developer, I want E2E tests to work with Cognito authentication, so that the test suite validates the system under realistic authentication conditions.

#### Acceptance Criteria

1. THE E2E_Test_Suite SHALL authenticate using Cognito credentials instead of AuthBasic's setAuthState
2. WHEN tests run in local development mode (no COGNITO_USER_POOL_ID set), THE JWT_Verifier SHALL bypass authentication so that tests can run without a Cognito User Pool
3. THE E2E_Test_Suite SHALL maintain the same test coverage as the existing 41 tests (materials CRUD, warehouses CRUD, transactions, stock inquiry, alerts, CSV import)
4. WHEN tests run against a sandbox environment, THE E2E_Test_Suite SHALL authenticate using a pre-configured test user in the Cognito User Pool

### Requirement 7: ローカル開発環境の互換性

**User Story:** As a developer, I want local development (npm run dev) to work without requiring a live Cognito User Pool, so that I can develop and test offline.

#### Acceptance Criteria

1. WHILE COGNITO_USER_POOL_ID is not set, THE JWT_Verifier SHALL skip token validation and allow all requests (open access mode)
2. WHEN running `npm run dev`, THE system SHALL start and serve the frontend without requiring Amplify sandbox or Cognito configuration
3. WHILE running in local development mode, THE frontend SHALL either auto-authenticate without Cognito or display a bypass mechanism for development purposes
4. WHEN `ampx sandbox` is running, THE system SHALL use the deployed Cognito User Pool for full authentication flow during local frontend development
