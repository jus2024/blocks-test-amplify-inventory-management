# Requirements Document

## Introduction

AWS Blocks の `DistributedDatabase` (Aurora DSQL) を活用した資材在庫管理システムのサンプルアプリケーション。DynamoDB では表現しにくいリレーショナルデータモデル・集計クエリ・業務ロジックを、Blocks のローカル開発環境で高速に検証することを目的とする。

本アプリケーションは技術検証用のサンプルであり、以下を実証する:
1. DistributedDatabase による SQL マイグレーション管理とリレーショナルデータ操作
2. JOINs・集計クエリによる在庫数量の計算
3. トランザクションによる在庫移動のビジネスロジック
4. CronJob による定期的な在庫アラートレポート
5. AsyncJob による CSV 一括インポート
6. Blocks ローカルサーバーでの高速フィードバックループ

## Glossary

- **Inventory_System**: 資材在庫管理システム全体。AWS Blocks 上に構築されるバックエンド API とフロントエンド UI の総称
- **Material**: 管理対象の資材マスタ。品名、SKU コード、単位、カテゴリなどの属性を持つ
- **Warehouse**: 資材を保管する倉庫。名称と所在地の属性を持つ
- **Stock_Transaction**: 在庫の入出庫を記録するトランザクションレコード。入庫(in)・出庫(out)の種別と数量を持つ
- **Current_Stock**: 特定の倉庫における特定の資材の現在庫数。Stock_Transaction の集計により算出される
- **Low_Stock_Threshold**: 在庫が不足していると判断する閾値。Material ごとに設定される
- **Stock_Alert**: 現在庫が Low_Stock_Threshold を下回った際に生成されるアラート情報
- **CSV_Import_Job**: CSV ファイルから一括で Stock_Transaction を登録する非同期ジョブ
- **API**: `aws-blocks/index.ts` に定義される JSON-RPC ベースのバックエンド API
- **User**: AuthBasic で認証されたシステム利用者

## Requirements

### Requirement 1: 資材マスタ管理

**User Story:** As a User, I want to register and manage materials (資材) in the system, so that I can track inventory for each material.

#### Acceptance Criteria

1. WHEN a User provides a name (1–100 characters), SKU code (1–50 characters, alphanumeric and hyphens), unit (1–20 characters), category (1–50 characters), and low stock threshold (integer, 0 to 999,999), THE API SHALL create a new Material record and return it with a generated UUID, the provided fields, and a creation timestamp
2. WHEN a User requests the material list, THE API SHALL return up to 200 Material records ordered by name in ascending order
3. WHEN a User provides a valid material ID and one or more updatable fields (name, unit, category, low stock threshold), THE API SHALL update only the specified fields on the Material record and return the complete updated record
4. WHEN a User provides a valid material ID for deletion, THE API SHALL delete the Material record and return the deleted material's ID as confirmation
5. IF a User attempts to create a Material with a duplicate SKU code, THEN THE API SHALL reject the request and return an error indicating the SKU already exists without creating a record
6. IF a User attempts to update, delete, or retrieve a non-existent material ID, THEN THE API SHALL return an error indicating the material was not found
7. IF a User attempts to create or update a Material with missing required fields or values outside the specified bounds, THEN THE API SHALL reject the request and return an error indicating which field failed validation

### Requirement 2: 倉庫マスタ管理

**User Story:** As a User, I want to register and manage warehouses (倉庫), so that I can track where materials are stored.

#### Acceptance Criteria

1. WHEN a User provides a name (1〜100 characters) and location (1〜200 characters), THE API SHALL create a new Warehouse record and return it with a generated UUID
2. WHEN a User requests the warehouse list, THE API SHALL return all Warehouse records ordered by name in ascending alphabetical order
3. WHEN a User provides a valid warehouse ID and updated fields (name and/or location), THE API SHALL update only the specified fields of the Warehouse record and return the updated data
4. WHEN a User provides a valid warehouse ID for deletion, THE API SHALL delete the Warehouse record and return a success confirmation
5. IF a User attempts to access a non-existent warehouse ID, THEN THE API SHALL return an error indicating the warehouse was not found
6. IF a User provides a name or location that is empty or exceeds the maximum length, THEN THE API SHALL reject the request and return an error indicating the validation failure
7. IF a User attempts to delete a Warehouse that is referenced by existing stock transactions, THEN THE API SHALL reject the deletion and return an error indicating the warehouse is in use

### Requirement 3: 入出庫処理

**User Story:** As a User, I want to record stock-in and stock-out transactions, so that I can maintain accurate inventory counts per warehouse.

#### Acceptance Criteria

1. WHEN a User provides a material ID, warehouse ID, transaction type (in/out), quantity, and optional note (maximum 500 characters), THE API SHALL create a Stock_Transaction record within a database transaction and return it with a generated UUID and timestamp
2. THE API SHALL validate that the quantity is a positive integer greater than zero and less than or equal to 999,999
3. WHILE processing a stock-out transaction, THE API SHALL calculate the Current_Stock for the specified material and warehouse by aggregating all prior Stock_Transactions
4. IF a stock-out transaction would result in a negative Current_Stock, THEN THE API SHALL reject the transaction and return an error indicating insufficient stock with the current available quantity
5. IF the specified material ID or warehouse ID does not exist, THEN THE API SHALL return an error indicating the referenced record was not found
6. WHEN a User requests the transaction history for a material and warehouse, THE API SHALL return a maximum of 100 Stock_Transaction records ordered by timestamp descending
7. IF a stock transaction fails due to a concurrency conflict (OCC serialization failure), THEN THE API SHALL retry the transaction up to 3 times before returning an error indicating a temporary conflict

### Requirement 4: 在庫照会

**User Story:** As a User, I want to view current stock levels, so that I can understand inventory status across all warehouses and materials.

#### Acceptance Criteria

1. WHEN a User requests current stock levels, THE API SHALL return a list of Current_Stock entries containing the net quantity for each unique combination of material and warehouse, calculated by aggregating all Stock_Transaction records (adding incoming quantities, subtracting outgoing quantities)
2. WHEN a User specifies a warehouse ID filter, THE API SHALL return Current_Stock entries only for that warehouse
3. WHEN a User specifies a material ID filter, THE API SHALL return Current_Stock entries only for that material
4. THE API SHALL include the following fields in each Current_Stock entry: Material name, SKU code, Warehouse name, and calculated quantity as a numeric value with up to 2 decimal places
5. WHEN a User requests a stock summary grouped by material, THE API SHALL return the total quantity across all warehouses for each material
6. IF a User specifies a warehouse ID or material ID that does not exist in the system, THEN THE API SHALL return an empty list with no error
7. THE API SHALL include materials and warehouses with a net quantity of zero in the response when they have at least one Stock_Transaction record
8. THE API SHALL return a maximum of 1000 Current_Stock entries per request, ordered by Material name ascending

### Requirement 5: 在庫不足アラート (CronJob)

**User Story:** As a User, I want the system to periodically check for low stock conditions, so that I can be alerted when materials need reordering.

#### Acceptance Criteria

1. THE Inventory_System SHALL execute a low-stock check using CronJob with a schedule of `rate(1 hour)`
2. WHEN the CronJob executes, THE Inventory_System SHALL compare each Material's total Current_Stock (summed across all warehouses) against its Low_Stock_Threshold, processing materials in batches of up to 500 per query to remain within DSQL transaction limits
3. WHEN a Material's total Current_Stock is at or below its Low_Stock_Threshold and no unacknowledged Stock_Alert already exists for that Material, THE Inventory_System SHALL record a Stock_Alert entry containing the material ID, current quantity, threshold, and timestamp
4. WHEN a User requests the alert list, THE API SHALL return Stock_Alert records ordered by timestamp descending, limited to a maximum of 100 records per response, with pagination support via a cursor parameter
5. WHEN a User marks an alert as acknowledged, THE API SHALL update the Stock_Alert record with an acknowledged flag and acknowledgement timestamp
6. IF a User attempts to acknowledge a Stock_Alert that does not exist, THEN THE API SHALL return an error indicating the alert was not found without modifying any data
7. IF a Material has no Low_Stock_Threshold defined (null or 0), THEN THE Inventory_System SHALL skip that Material during the low-stock check without generating an alert
8. WHEN the CronJob handler encounters a query failure during execution, THE Inventory_System SHALL rely on the CronJob's built-in retry mechanism (up to 2 retries with exponential backoff) and each execution SHALL be idempotent due to the duplicate alert suppression in criterion 3

### Requirement 6: CSV 一括インポート (AsyncJob)

**User Story:** As a User, I want to import stock transactions from CSV data in bulk, so that I can efficiently register large volumes of inventory movements.

#### Acceptance Criteria

1. WHEN a User submits CSV text data containing stock transactions, THE API SHALL validate that the CSV text does not exceed 200KB in size and contains no more than 1000 data rows, enqueue an import job via AsyncJob, and return the job ID immediately
2. IF the submitted CSV text exceeds 200KB or contains more than 1000 data rows, THEN THE API SHALL reject the request with an error indicating the size or row limit was exceeded without enqueuing a job
3. THE CSV_Import_Job handler SHALL parse each CSV row as comma-delimited values expecting columns in order: material_sku, warehouse_name, type (in/out), quantity, note — treating the first row as a header row to be skipped if it matches the column names exactly
4. IF the submitted CSV text contains zero data rows after header processing, THEN THE CSV_Import_Job handler SHALL record the job result as failed with an error indicating empty input
5. WHEN all rows are valid, THE CSV_Import_Job handler SHALL insert each Stock_Transaction applying the same validation rules as individual transaction creation (positive integer quantity, stock-out insufficient stock check)
6. IF a CSV row references a non-existent SKU or warehouse name, THEN THE CSV_Import_Job handler SHALL record the row number and error description in a job result entry and continue processing remaining rows
7. IF a CSV row would cause negative stock, THEN THE CSV_Import_Job handler SHALL record the row number and error description in a job result entry and continue processing remaining rows
8. IF a CSV row contains a malformed value (missing column, non-numeric quantity, or type value other than "in" or "out"), THEN THE CSV_Import_Job handler SHALL record the row number and error description in a job result entry and continue processing remaining rows
9. WHEN the CSV_Import_Job completes, THE Inventory_System SHALL store the job result containing total row count, successful count, failed count, and a list of per-failure entries (each with row number and error description) retrievable by job ID
10. WHEN a User requests the status of an import job by job ID, THE API SHALL return the job result including total row count, successful count, failed count, and the list of per-failure entries

### Requirement 7: SQL マイグレーション管理

**User Story:** As a developer, I want database schema changes managed through numbered SQL migration files, so that schema evolution is versioned and reproducible.

#### Acceptance Criteria

1. THE Inventory_System SHALL define the database schema using SQL migration files in the `aws-blocks/dsql-migrations/` directory, named with a zero-padded numeric prefix followed by a descriptive suffix (e.g., `0001_initial.sql`, `0002_add_indexes.sql`), and THE migration runner SHALL execute them in ascending numeric order
2. THE migration files SHALL create tables for materials, warehouses, stock_transactions, stock_alerts, and import_job_results
3. THE migration files SHALL define indexes for material SKU lookups, stock transaction aggregations by material_id and warehouse_id, and alert timestamp ordering
4. THE migration files SHALL use UUID primary keys generated by `gen_random_uuid()`
5. THE migration files SHALL define `created_at` and `updated_at` columns of type TIMESTAMP with DEFAULT CURRENT_TIMESTAMP on every table
6. THE migration files SHALL NOT use foreign key constraints, SERIAL types, SEQUENCE types, or other DSQL-unsupported features
7. WHEN all migration files are executed sequentially in numeric order against an empty database, THE migration runner SHALL complete without errors and produce the expected schema

### Requirement 8: フロントエンド UI

**User Story:** As a User, I want a web interface to interact with the inventory management system, so that I can manage inventory without using API calls directly.

#### Acceptance Criteria

1. THE Inventory_System SHALL provide a web UI in `src/index.ts` using lit-html that displays a navigation bar with selectable sections: material management, warehouse management, stock transactions, stock inquiry, and alerts, where selecting a section renders the corresponding view in the main content area
2. WHEN a User navigates to the material management section, THE UI SHALL display a list of all registered materials showing name and unit, and provide a form with fields for material name (max 100 characters) and unit to create a new material, and provide edit and delete controls for each listed material
3. WHEN a User navigates to the warehouse management section, THE UI SHALL display a list of all registered warehouses showing name and location, and provide a form with fields for warehouse name (max 100 characters) and location (max 200 characters) to create a new warehouse, and provide edit and delete controls for each listed warehouse
4. WHEN a User navigates to the stock transaction section, THE UI SHALL provide a form with a transaction type selector (stock-in or stock-out), a material dropdown populated from registered materials, a warehouse dropdown populated from registered warehouses, and a quantity input accepting integers from 1 to 999,999
5. WHEN a User navigates to the stock inquiry section, THE UI SHALL display a table of current stock levels showing material name, warehouse name, and quantity, with dropdown filters for material and warehouse that update the displayed results when changed
6. WHEN a User navigates to the alerts section, THE UI SHALL display a list of low-stock alerts showing material name, warehouse name, current quantity, and threshold, and provide an acknowledge button for each alert that removes the alert from the displayed list upon successful acknowledgment
7. IF an API call fails, THEN THE UI SHALL display a visible error message indicating the failure reason within the current section view, and the error message SHALL remain visible until the User performs another action or dismisses it
8. WHEN a User submits a create, edit, delete, or transaction form successfully, THE UI SHALL refresh the displayed list to reflect the updated data

### Requirement 9: E2E テスト

**User Story:** As a developer, I want end-to-end tests that verify the core inventory management flows, so that I can confirm the system works correctly through the Blocks local development server.

#### Acceptance Criteria

1. THE test suite SHALL be defined in `test/e2e.test.ts` and run with `npm run test:e2e`
2. THE test suite SHALL verify material CRUD operations by creating a material with name and unit, listing materials to confirm it appears, updating the material name, and deleting the material to confirm it no longer appears in the list
3. THE test suite SHALL verify warehouse CRUD operations by creating a warehouse with a name and location, listing warehouses to confirm it appears, updating the warehouse name, and deleting the warehouse to confirm it no longer appears in the list
4. WHEN a stock-in transaction is recorded for a given material and warehouse with a specified quantity, THE test suite SHALL verify that the current stock for that material-warehouse pair increases by exactly that quantity
5. IF a stock-out transaction is attempted with a quantity exceeding the available stock for that material-warehouse pair, THEN THE test suite SHALL verify that the API throws an error indicating insufficient stock and that the current stock remains unchanged
6. WHEN current stock is queried, THE test suite SHALL verify that the response includes the aggregated quantity along with the associated material name and warehouse name for each stock record
7. THE test suite SHALL verify CSV import by submitting a file containing at least 1 valid row and at least 1 invalid row (e.g., missing required field), then confirming that the valid row is persisted and the response includes an error entry identifying the failed row number and reason for failure
8. THE test suite SHALL authenticate via the typed `authApi` client and call all API methods via the typed `api` client imported from `'aws-blocks'`, without constructing HTTP requests or RPC payloads manually
9. WHEN each test case begins, THE test suite SHALL create its own test data (materials, warehouses) so that test results do not depend on execution order or prior test state
