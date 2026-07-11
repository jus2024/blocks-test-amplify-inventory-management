# Requirements Document

## Introduction

既存の資材在庫管理システム（Blocks + Aurora DSQL バックエンド）に加え、AWS AppSync と DynamoDB を活用したユーザー固有データ管理機能を追加する。Amplify Gen 2 の `defineData` を用いてデータスキーマを定義し、`owner` 認可ルールによりログインユーザーごとのデータ分離を実現する。`ampx sandbox` によるローカル開発・動作検証が可能であることを前提とする。

## Glossary

- **Data_Schema**: Amplify Gen 2 の `defineData` で定義される AppSync + DynamoDB のデータモデル定義
- **AppSync_API**: AWS AppSync が提供する GraphQL API エンドポイント
- **Owner_Auth**: Cognito ユーザー ID に基づき、データの所有者のみがアクセスできる認可ルール
- **User_Preference**: ログインユーザー固有の設定情報（表示設定、お気に入りなど）を格納するデータモデル
- **User_Note**: ログインユーザーが任意に作成・管理するメモデータを格納するデータモデル
- **Sandbox**: `ampx sandbox` コマンドで起動される Amplify Gen 2 のローカル開発環境
- **Backend_Definition**: `amplify/backend.ts` で定義される Amplify バックエンドリソースの構成

## Requirements

### Requirement 1: データスキーマ定義

**User Story:** As a 開発者, I want to Amplify Gen 2 の defineData でデータスキーマを定義する, so that AppSync + DynamoDB ベースのユーザー固有データストアが利用できる

#### Acceptance Criteria

1. THE Data_Schema SHALL `amplify/data/resource.ts` ファイルにて `defineData` を使用して定義され、エクスポートされる
2. THE Data_Schema SHALL User_Preference モデルと User_Note モデルを `a.model()` で定義し、各モデルに少なくとも1つ以上のフィールドと認可ルールを含む
3. THE Backend_Definition SHALL `amplify/backend.ts` の `defineBackend` 呼び出しにおいて、auth リソースと data リソース（Data_Schema）の両方を引数として含む
4. WHEN `ampx sandbox` を実行した場合, THE Sandbox SHALL Data_Schema に基づいて AppSync API と DynamoDB テーブルをプロビジョニングし、`ampx_outputs.json` にエンドポイント情報を出力する
5. IF `amplify/data/resource.ts` に構文エラーまたはスキーマ定義エラーがある場合, THEN THE Sandbox SHALL プロビジョニングを中断し、エラーの内容を示すメッセージを出力する

### Requirement 2: オーナー認可によるデータ分離

**User Story:** As a ログインユーザー, I want to 自分のデータだけにアクセスできる, so that 他のユーザーのデータが見えず安全に利用できる

#### Acceptance Criteria

1. THE Data_Schema SHALL User_Preference モデルおよび User_Note モデルの各モデルに Owner_Auth ルールを適用する
2. WHEN 認証済みユーザーがデータを作成した場合, THE AppSync_API SHALL 作成者の Cognito ユーザー ID を owner フィールドに自動設定する
3. WHEN 認証済みユーザーがデータを取得した場合, THE AppSync_API SHALL 該当ユーザーが所有するデータのみを返却する
4. WHEN 認証済みユーザーが他ユーザー所有のデータを取得・更新・削除しようとした場合, THE AppSync_API SHALL 該当データを返さず、認可エラーを示すエラーレスポンスを返却する
5. WHEN 未認証のリクエストが送信された場合, THE AppSync_API SHALL 認証エラーを示すエラーレスポンスを返却しデータを一切返さない
6. IF 認証済みユーザーが既存レコードの owner フィールドを変更しようとした場合, THEN THE AppSync_API SHALL 更新を拒否し認可エラーを示すエラーレスポンスを返却する

### Requirement 3: User_Preference モデル

**User Story:** As a ログインユーザー, I want to 表示設定やお気に入り情報を保存する, so that ログイン時に自分の設定が復元される

#### Acceptance Criteria

1. THE User_Preference モデル SHALL owner と key（設定キー）の組み合わせで一意のレコードとして管理される
2. THE User_Preference モデル SHALL key（設定キー、文字列型、最大128文字）と value（設定値、文字列型、最大2048文字）のフィールドを持つ
3. WHEN ユーザーが設定を保存した場合, THE AppSync_API SHALL 同一 owner かつ同一 key のレコードが存在すれば value を更新し、存在しなければ新規レコードを作成する
4. WHEN ユーザーが設定を取得した場合, THE AppSync_API SHALL 該当ユーザーの全設定レコードを返却する（設定が0件の場合は空リストを返却する）
5. WHEN ユーザーが設定を削除した場合, THE AppSync_API SHALL 該当 key のレコードを削除する
6. IF 存在しない key を指定して個別取得した場合, THEN THE AppSync_API SHALL レコードが存在しないことを示す空の結果を返却する

### Requirement 4: User_Note モデル

**User Story:** As a ログインユーザー, I want to 任意のメモを作成・編集・削除する, so that 業務に関する覚え書きを管理できる

#### Acceptance Criteria

1. THE User_Note モデル SHALL title（タイトル、必須、最大200文字）と content（本文、任意、最大10000文字）のフィールドを持つ
2. THE User_Note モデル SHALL createdAt と updatedAt のタイムスタンプフィールドを持つ
3. WHEN ユーザーが title を指定してメモを作成した場合, THE AppSync_API SHALL 新しい User_Note レコードを作成し、createdAt と updatedAt を自動設定して返却する
4. WHEN ユーザーがメモを更新した場合, THE AppSync_API SHALL 該当レコードの title と content を更新し updatedAt を現在時刻に更新する
5. WHEN ユーザーがメモを削除した場合, THE AppSync_API SHALL 該当レコードを削除する
6. WHEN ユーザーがメモ一覧を取得した場合, THE AppSync_API SHALL 該当ユーザーの全 User_Note レコードを updatedAt の降順で返却する
7. IF ユーザーが title を空または未指定でメモを作成・更新しようとした場合, THEN THE AppSync_API SHALL バリデーションエラーを返却しレコードを変更しない
8. IF ユーザーが存在しない ID のメモを更新・削除しようとした場合, THEN THE AppSync_API SHALL レコードが存在しないことを示すエラーを返却する

### Requirement 5: フロントエンド統合

**User Story:** As a ログインユーザー, I want to UIからユーザーデータ機能にアクセスする, so that メモの管理や設定の変更を行える

#### Acceptance Criteria

1. THE フロントエンド SHALL Amplify クライアントライブラリを使用して AppSync_API と通信する
2. THE フロントエンド SHALL 既存の Blocks API（資材管理等）と AppSync_API を同じアプリケーション内で併用する
3. WHEN ユーザーがメモセクションに遷移した場合, THE フロントエンド SHALL User_Note の一覧を updatedAt の降順（新しい順）で表示する
4. WHEN ユーザーがメモを作成・編集・削除した場合, THE フロントエンド SHALL AppSync_API を呼び出してデータを永続化し、操作完了後に一覧を最新状態に更新する
5. IF AppSync_API への通信が 10 秒以内に応答を返さないか、ネットワークエラーが発生した場合, THEN THE フロントエンド SHALL 操作が失敗したことを示すエラーメッセージをユーザーに表示し、入力中のデータを保持する
6. WHILE AppSync_API からのデータ取得が完了していない間, THE フロントエンド SHALL ローディング状態を表示する

### Requirement 6: 既存バックエンドとの共存

**User Story:** As a 開発者, I want to AppSync/DynamoDB 機能が既存の Blocks バックエンドに影響を与えない, so that 資材管理システムの安定性が維持される

#### Acceptance Criteria

1. THE Backend_Definition SHALL 既存の auth リソース定義と Blocks 統合の設定を変更せず、追加のみの形で Data_Schema を構成に含める
2. THE Backend_Definition SHALL Amplify outputs に AppSync エンドポイント URL、認証情報、およびリージョン情報を含める
3. WHEN Sandbox を起動した場合, THE Sandbox SHALL Blocks ローカルサーバーの API リクエスト受付と AppSync ローカル環境の GraphQL リクエスト受付の両方が同時に応答可能な状態になる
4. THE フロントエンド SHALL Amplify の `configure` で AppSync と Auth の両方のクライアント設定を単一の初期化呼び出しで設定する
5. IF Data_Schema のデプロイまたはプロビジョニングが失敗した場合, THEN THE Backend_Definition SHALL 既存の auth リソースおよび Blocks API の動作に影響を与えずにエラーを報告する

### Requirement 7: Sandbox でのローカル動作検証

**User Story:** As a 開発者, I want to ampx sandbox でローカルに動作確認する, so that AWS アカウントへの本番デプロイ前に機能を検証できる

#### Acceptance Criteria

1. WHEN `ampx sandbox` を実行した場合, THE Sandbox SHALL AppSync API をクラウドサンドボックス環境としてデプロイし、デプロイ完了までプロセスが正常終了コード（0）で完了する
2. WHEN Sandbox が起動完了した場合, THE Sandbox SHALL `ampx_outputs.json` に AppSync エンドポイント URL、AWS リージョン、および認証設定情報を含むファイルを出力する
3. WHEN フロントエンドアプリケーションが初期化される場合, THE フロントエンド SHALL `ampx_outputs.json` の情報を使用して Amplify クライアントを設定し AppSync_API に接続する
4. WHEN Sandbox 環境でデータを作成した場合, THE AppSync_API SHALL 作成したレコードを DynamoDB に永続化し、直後の取得リクエストで同一データが返却される
5. WHEN Sandbox 環境でデータを更新または削除した場合, THE AppSync_API SHALL 変更を DynamoDB に反映し、直後の取得リクエストで更新後の状態または削除済み（レコード非存在）が確認できる
6. IF `ampx sandbox` の実行が失敗した場合, THEN THE Sandbox SHALL 失敗原因を示すエラーメッセージを標準エラー出力に表示し、非ゼロの終了コードを返す
