# 実装計画: AppSync + DynamoDB ユーザーデータ管理

## 概要

Amplify Gen 2 の `defineData` を使用して AppSync + DynamoDB ベースのユーザー固有データ管理機能を実装する。データスキーマ定義、バックエンド統合、フロントエンドバリデーション、UI コンポーネントを段階的に構築し、既存の Blocks バックエンドとの共存を維持する。

## タスク

- [x] 1. データスキーマ定義とバックエンド統合
  - [x] 1.1 `amplify/data/resource.ts` を作成し UserPreference / UserNote モデルを定義する
    - `@aws-amplify/backend` から `a`, `defineData`, `ClientSchema` をインポート
    - `UserPreference` モデル: `key`(string, required), `value`(string, required), owner 認可ルール
    - `UserNote` モデル: `title`(string, required), `content`(string, optional), owner 認可ルール
    - `authorizationModes.defaultAuthorizationMode: 'userPool'` を設定
    - `Schema` 型と `data` をエクスポート
    - _Requirements: 1.1, 1.2, 2.1_
  - [x] 1.2 `amplify/backend.ts` に data リソースを追加する
    - `./data/resource` から `data` をインポート
    - `defineBackend({ auth, data })` に変更（既存の auth と initBlocks は変更しない）
    - _Requirements: 1.3, 6.1, 6.2_
  - [x] 1.3 型チェックで Data Schema 定義の正当性を確認する
    - `npm run typecheck` を実行して `amplify/data/resource.ts` と `amplify/backend.ts` に型エラーがないことを確認
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. バリデーションユーティリティの実装
  - [x] 2.1 `src/lib/validation.ts` にバリデーション関数を作成する
    - `validatePreferenceKey(key: string): { valid: boolean; error?: string }` — 1〜128文字、空白のみ不可
    - `validatePreferenceValue(value: string): { valid: boolean; error?: string }` — 1〜2048文字
    - `validateNoteTitle(title: string): { valid: boolean; error?: string }` — 1〜200文字、空白のみ不可
    - `validateNoteContent(content: string): { valid: boolean; error?: string }` — 最大10000文字（空文字許可）
    - _Requirements: 3.2, 4.1, 4.7_
  - [x] 2.2 Property テスト: バリデーション関数の正確性
    - **Property 2: フィールドバリデーションの正確性**
    - **Validates: Requirements 3.2, 4.1, 4.7**
    - fast-check で任意の文字列を生成し、範囲内の入力は accepted、範囲外は rejected を検証
    - テストファイル: `test/validation.property.test.ts`

- [x] 3. チェックポイント - バリデーションロジック確認
  - [x] 3.1 型チェックとプロパティテストの実行確認
    - 型チェックとプロパティテストが通ることを確認する
    - 問題があればユーザーに質問する

- [x] 4. フロントエンド Amplify クライアント設定
  - [x] 4.1 `src/index.ts` に Amplify configure と Data クライアントを追加する
    - `Amplify.configure(outputs)` を既存の import 群の直後に追加（`amplify_outputs.json` を使用）
    - `generateClient<Schema>()` で型安全な Data クライアントを生成
    - 既存の Blocks API クライアントと共存させる（Amplify configure は1回のみ呼び出し）
    - _Requirements: 5.1, 5.2, 6.4, 7.3_

- [x] 5. UserPreference CRUD ロジックの実装
  - [x] 5.1 `src/lib/preferences.ts` に Preference 操作モジュールを作成する
    - `upsertPreference(key, value)`: 既存レコードを検索し、存在すれば update、なければ create
    - `listPreferences()`: 全設定レコードを取得
    - `deletePreference(id)`: 指定 ID のレコードを削除
    - `getPreferenceByKey(key)`: key で検索して1件取得（存在しなければ null）
    - AppSync API 呼び出しに 10 秒タイムアウト処理を含める
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 5.5_
  - [x] 5.2 Property テスト: Preference upsert の冪等性
    - **Property 1: Preference upsert の冪等性**
    - **Validates: Requirements 3.1, 3.3**
    - fast-check で任意の key/value ペアを生成し、2回 upsert 後にレコードが1件かつ最後の value であることを検証
    - テストファイル: `test/preferences.property.test.ts`
  - [x] 5.3 Property テスト: Preference CRUD ラウンドトリップ
    - **Property 3: Preference CRUD ラウンドトリップ**
    - **Validates: Requirements 3.4, 3.5, 7.4, 7.5**
    - N 件の key/value ペアを作成し list で N 件返却されること、1件削除で N-1 件になることを検証
    - テストファイル: `test/preferences.property.test.ts`

- [x] 6. UserNote CRUD ロジックの実装
  - [x] 6.1 `src/lib/notes.ts` に Note 操作モジュールを作成する
    - `createNote(title, content?)`: 新規メモ作成
    - `updateNote(id, title, content?)`: メモ更新
    - `deleteNote(id)`: メモ削除
    - `listNotes()`: updatedAt 降順で全メモ取得
    - `getNote(id)`: ID で1件取得
    - AppSync API 呼び出しに 10 秒タイムアウト処理を含める
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.8, 5.5_
  - [x] 6.2 Property テスト: Note CRUD ラウンドトリップ
    - **Property 4: Note CRUD ラウンドトリップ**
    - **Validates: Requirements 4.3, 4.4, 4.5, 7.4, 7.5**
    - 有効な title/content で作成 → 取得で同一データ、更新後に新しい値が返却されること
    - テストファイル: `test/notes.property.test.ts`
  - [x] 6.3 Property テスト: Note 一覧のソート順保証
    - **Property 5: Note 一覧のソート順保証**
    - **Validates: Requirements 4.6, 5.3**
    - 複数 note 作成後、list 取得結果が updatedAt 降順であることを検証
    - テストファイル: `test/notes.property.test.ts`

- [x] 7. チェックポイント - データ操作ロジック確認
  - [x] 7.1 型チェックと CRUD ロジック確認
    - 型チェックが通ること、バリデーション・CRUD ロジックが正しく定義されていることを確認する
    - 問題があればユーザーに質問する

- [x] 8. メモ管理 UI の実装
  - [x] 8.1 `src/index.ts` にメモセクションの状態変数と UI テンプレートを追加する
    - `Section` 型に `'notes'` を追加
    - メモ一覧の状態変数: `notes`, `editingNote`, `isLoadingNotes`
    - `renderNotes()` 関数: 一覧表示、作成フォーム、編集フォーム、削除ボタン
    - ローディング状態表示（データ取得完了まで「読み込み中...」を表示）
    - エラーメッセージ表示（通信失敗時に入力データを保持）
    - ナビゲーションに「メモ」ボタンを追加
    - _Requirements: 5.3, 5.4, 5.5, 5.6_
  - [x] 8.2 メモ操作イベントハンドラを実装する
    - `loadNotes()`: notes モジュールを呼び出し一覧を取得、ローディング/エラー状態管理
    - `submitNote()`: バリデーション → 作成/更新 → 一覧リロード
    - `deleteNoteHandler(id)`: 削除 → 一覧リロード
    - フロントエンドバリデーション（title 必須チェック）を API 呼び出し前に実施
    - _Requirements: 5.4, 5.5, 5.6, 4.7_

- [x] 9. 設定管理 UI の実装
  - [x] 9.1 `src/index.ts` に設定セクションの状態変数と UI テンプレートを追加する
    - `Section` 型に `'settings'` を追加
    - 設定一覧の状態変数: `preferences`, `isLoadingPreferences`
    - `renderSettings()` 関数: 設定一覧表示、key/value 入力フォーム、削除ボタン
    - ローディング状態表示
    - ナビゲーションに「設定」ボタンを追加
    - _Requirements: 5.1, 5.2, 5.6_
  - [x] 9.2 設定操作イベントハンドラを実装する
    - `loadPreferences()`: preferences モジュールを呼び出し一覧取得
    - `submitPreference()`: バリデーション → upsert → 一覧リロード
    - `deletePreferenceHandler(id)`: 削除 → 一覧リロード
    - フロントエンドバリデーション（key/value 長さチェック）を API 呼び出し前に実施
    - _Requirements: 3.3, 3.4, 3.5, 5.5_

- [x] 10. チェックポイント - UI 統合確認
  - [x] 10.1 全体型チェックの実行確認
    - `npm run typecheck` で全体の型チェックが通ることを確認する
    - 問題があればユーザーに質問する

- [x] 11. エラーハンドリングと統合仕上げ
  - [x] 11.1 AppSync エラーハンドリングユーティリティを作成する
    - `src/lib/error-handler.ts` にエラー分類ロジックを実装
    - Unauthorized → ログインへリダイレクト促進メッセージ
    - NetworkError / Timeout → リトライ可能なエラーメッセージ
    - ValidationError → 入力フォームにエラー表示
    - notes.ts / preferences.ts からこのユーティリティを使用
    - _Requirements: 5.5_
  - [x] 11.2 `nav()` 関数を更新し新セクションのデータロードを統合する
    - `loadSection()` に notes と settings のロード処理を追加
    - セクション切り替え時の状態リセット処理を追加
    - _Requirements: 5.3, 5.4_

- [x] 12. 最終チェックポイント - 全体動作確認
  - [x] 12.1 全コンポーネント統合確認
    - `npm run typecheck` が通ること、全コンポーネントが正しく統合されていることを確認する
    - 問題があればユーザーに質問する

## 注意事項

- 各タスクは対応する requirements を参照し、トレーサビリティを確保
- チェックポイントで段階的に検証を行い、問題を早期検出する
- Property テストはデザインドキュメントの Correctness Properties に対応
- ユニットテストは具体例・エッジケースを検証
- AppSync API のテストは `ampx sandbox` 環境が必要なため、ローカルでは型チェックとバリデーションロジックのテストを中心に実施
- `fast-check` ライブラリの追加が必要（`npm install --save-dev fast-check`）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "4.1"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["5.1", "6.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.2", "6.3", "11.1"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["8.1", "9.1"] },
    { "id": 9, "tasks": ["8.2", "9.2", "11.2"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["12.1"] }
  ]
}
```
