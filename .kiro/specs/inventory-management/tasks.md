# Implementation Plan: Inventory Management (資材在庫管理)

## Overview

AWS Blocks の DistributedDatabase、CronJob、AsyncJob を活用した資材在庫管理システムの実装。既存の todo アプリ (`aws-blocks/index.ts`) を在庫管理システムに置き換え、Amplify Gen2 統合と Cognito 認証基盤を追加する。

実装は段階的に進め、各タスク完了時に `npm run test:e2e` がパスすることを保証する。

## Tasks

- [x] 1. Project scaffolding and database migrations
  - [x] 1.1 Create SQL migration files in `aws-blocks/dsql-migrations/`
    - Create all 8 migration files (0001–0008) as defined in the design document
    - Tables: materials, warehouses, stock_transactions, stock_alerts, import_job_results
    - Indexes: idx_materials_sku, idx_stock_transactions_material_warehouse, idx_stock_alerts_timestamp
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 1.2 Create CognitoVerifier helper at `aws-blocks/cognito-verifier.ts`
    - Implement CognitoVerifier class with local bypass mode (no env vars → skip auth)
    - Cloud mode: validate JWT via `aws-jwt-verify` library
    - Add `aws-jwt-verify` to dependencies
    - _Requirements: Design — Authentication Flow_

  - [x] 1.3 Replace `aws-blocks/index.ts` with inventory management backend skeleton
    - Remove todo app code entirely
    - Set up new Scope, DistributedDatabase, CognitoVerifier imports
    - Define empty ApiNamespace with type stubs for all API methods
    - Export `api` (typed API client)
    - Ensure project compiles and `npm run test:e2e` can start the server (tests will be rewritten later)
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.4, 6.1_

  - [x] 1.4 Rewrite `test/e2e.test.ts` with initial setup and material CRUD tests
    - Remove all todo-related tests
    - Keep server setup/teardown boilerplate
    - Add material CRUD tests: create → list → update → delete
    - Add validation tests: duplicate SKU, invalid fields, not-found
    - _Requirements: 9.1, 9.2, 9.8, 9.9_

- [x] 2. Materials CRUD implementation
  - [x] 2.1 Implement `createMaterial` and `listMaterials` API methods
    - Input validation: name (1-100), sku (1-50, alphanumeric+hyphens), unit (1-20), category (1-50), threshold (0-999999)
    - SKU uniqueness check (catch UNIQUE constraint violation)
    - List returns max 200 records ordered by name ASC
    - _Requirements: 1.1, 1.2, 1.5, 1.7_

  - [x] 2.2 Implement `updateMaterial` and `deleteMaterial` API methods
    - Update: partial update of specified fields only, not-found check
    - Delete: not-found check, return deleted ID
    - _Requirements: 1.3, 1.4, 1.6_

  - [ ]* 2.3 Write property tests for material operations
    - **Property 1: Material creation round-trip**
    - **Property 2: Material list ordering**
    - **Property 3: SKU uniqueness enforcement**
    - **Property 4: Input validation rejects invalid materials**
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.7**

- [x] 3. Warehouses CRUD implementation
  - [x] 3.1 Implement `createWarehouse`, `listWarehouses`, `updateWarehouse`, `deleteWarehouse`
    - Input validation: name (1-100), location (1-200)
    - List ordered by name ASC
    - Delete: check for referenced stock_transactions, reject if in use
    - Not-found checks on update/delete
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.2 Add warehouse E2E tests to `test/e2e.test.ts`
    - Warehouse CRUD: create → list → update → delete
    - Validation: empty name, exceeding max length
    - Delete rejection when warehouse is referenced by transactions
    - _Requirements: 9.3, 9.9_

  - [ ]* 3.3 Write property tests for warehouse operations
    - **Property 5: Warehouse list ordering**
    - **Property 6: Warehouse input validation**
    - **Validates: Requirements 2.2, 2.6**

- [x] 4. Checkpoint — Core CRUD operations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Stock transactions implementation
  - [x] 5.1 Implement `recordTransaction` API method
    - Validate: quantity (1-999999), type ('in'/'out'), note (max 500 chars)
    - Application-layer referential integrity: check materialId and warehouseId exist
    - Stock-out: calculate current stock via SUM aggregation, reject if insufficient
    - Use `db.transaction()` with `retryOnConflict: true, maxRetries: 3`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x] 5.2 Implement `listTransactions` API method
    - Return max 100 records for given material+warehouse, ordered by timestamp DESC
    - _Requirements: 3.6_

  - [x] 5.3 Add stock transaction E2E tests
    - Stock-in: record transaction → verify current stock increases
    - Stock-out rejection: attempt out > available → error + stock unchanged
    - Transaction history listing
    - _Requirements: 9.4, 9.5_

  - [ ]* 5.4 Write property tests for stock transactions
    - **Property 7: Stock aggregation correctness**
    - **Property 8: Stock never goes negative**
    - **Property 9: Quantity validation**
    - **Validates: Requirements 3.2, 3.3, 3.4, 4.1**

- [x] 6. Stock inquiry implementation
  - [x] 6.1 Implement `getCurrentStock` and `getStockSummary` API methods
    - getCurrentStock: JOIN materials + warehouses + SUM transactions, filter by materialId/warehouseId
    - Return max 1000 entries, ordered by material name ASC
    - Include entries with quantity 0 (if transactions exist)
    - getStockSummary: total quantity per material across all warehouses
    - Non-existent filter IDs return empty list (no error)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 6.2 Add stock inquiry E2E tests
    - Verify aggregated quantity with material name and warehouse name
    - Verify filter by warehouseId and materialId
    - _Requirements: 9.6_

  - [ ]* 6.3 Write property tests for stock inquiry
    - **Property 10: Stock inquiry filter correctness**
    - **Property 11: Stock summary cross-warehouse aggregation**
    - **Validates: Requirements 4.2, 4.3, 4.5**

- [x] 7. Checkpoint — Core business logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Low-stock alert CronJob
  - [x] 8.1 Implement CronJob handler for low-stock detection
    - Define `CronJob` block with schedule `rate(1 hour)`
    - Query materials with threshold > 0, batch of 500
    - Calculate total stock per material (SUM across all warehouses)
    - Create alert only if stock <= threshold AND no unacknowledged alert exists (idempotency)
    - _Requirements: 5.1, 5.2, 5.3, 5.7, 5.8_

  - [x] 8.2 Implement `listAlerts` and `acknowledgeAlert` API methods
    - listAlerts: max 100, ordered by timestamp DESC, pagination via cursor
    - acknowledgeAlert: set acknowledged=true, acknowledged_at=now, not-found check
    - _Requirements: 5.4, 5.5, 5.6_

  - [x] 8.3 Add alert E2E tests
    - Create material with low threshold, add stock below threshold
    - Trigger CronJob handler directly, verify alert created
    - Acknowledge alert, verify updated
    - _Requirements: 9.9_

  - [ ]* 8.4 Write property tests for alert generation
    - **Property 12: Low-stock alert generation correctness**
    - **Property 13: Low-stock alert idempotency**
    - **Validates: Requirements 5.2, 5.3**

- [x] 9. CSV import AsyncJob
  - [x] 9.1 Implement `importCsv` API method and AsyncJob handler
    - Validate CSV size <= 200KB, rows <= 1000
    - Define `AsyncJob` block for CSV processing
    - Parse CSV: skip header, expect columns (material_sku, warehouse_name, type, quantity, note)
    - Process each row: lookup SKU → materialId, lookup warehouse name → warehouseId
    - Apply same validation as individual transactions (positive quantity, stock-out check)
    - Record row-level errors (row number + reason), continue processing remaining rows
    - Store result in import_job_results table
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 9.2 Implement `getImportJobResult` API method
    - Retrieve job result by ID: totalRows, successCount, failedCount, failures list
    - _Requirements: 6.10_

  - [x] 9.3 Add CSV import E2E tests
    - Submit CSV with valid + invalid rows
    - Verify valid rows persisted, response includes failure entries (row number + reason)
    - _Requirements: 9.7_

  - [ ]* 9.4 Write property tests for CSV import
    - **Property 14: CSV size/row limit enforcement**
    - **Property 15: CSV import partial success**
    - **Property 16: CSV import result completeness**
    - **Validates: Requirements 6.2, 6.6, 6.7, 6.8, 6.9**

- [x] 10. Checkpoint — All backend features complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend UI implementation
  - [x] 11.1 Implement navigation and material management section in `src/index.ts`
    - Replace todo UI with inventory management UI using lit-html
    - Navigation bar with sections: materials, warehouses, transactions, stock inquiry, alerts
    - Material management: list, create form, edit/delete controls
    - Error message display on API failure
    - _Requirements: 8.1, 8.2, 8.7, 8.8_

  - [x] 11.2 Implement warehouse management and stock transaction sections
    - Warehouse management: list, create form, edit/delete controls
    - Stock transaction: form with type selector, material/warehouse dropdowns, quantity input
    - _Requirements: 8.3, 8.4_

  - [x] 11.3 Implement stock inquiry and alerts sections
    - Stock inquiry: table with material name, warehouse name, quantity; filters for material/warehouse
    - Alerts: list with acknowledge button; remove from display on acknowledgment
    - _Requirements: 8.5, 8.6_

- [x] 12. Amplify Gen2 integration
  - [x] 12.1 Create `amplify/` directory structure with Cognito and Blocks integration
    - Create `amplify/auth/resource.ts` — Cognito User Pool definition
    - Create `amplify/backend.ts` — defineBackend + Blocks integration
    - Create `amplify/blocks.ts` — BlocksBackend nested stack, Cognito env injection
    - Create `amplify/package.json` and `amplify/tsconfig.json`
    - _Requirements: Design — Amplify Gen2 Integration_

  - [x] 12.2 Add frontend authentication middleware in `src/index.ts`
    - Register Amplify middleware to attach Cognito ID token as Bearer header
    - Ensure local development still works without Cognito (graceful fallback)
    - _Requirements: Design — Frontend Authentication Middleware_

- [x] 13. Final checkpoint — Full system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit/E2E tests validate specific examples and edge cases
- All backend code lives in `aws-blocks/index.ts` (single-file backend pattern)
- SQL migrations in `aws-blocks/dsql-migrations/` are auto-executed by Blocks
- Local development uses PGlite (no AWS needed) with auth bypass
- `npm run test:e2e` must pass after each task completion

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1"] },
    { "id": 4, "tasks": ["2.3", "3.2"] },
    { "id": 5, "tasks": ["3.3", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["5.4", "6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3"] },
    { "id": 9, "tasks": ["8.1", "8.2"] },
    { "id": 10, "tasks": ["8.3", "8.4"] },
    { "id": 11, "tasks": ["9.1"] },
    { "id": 12, "tasks": ["9.2", "9.3"] },
    { "id": 13, "tasks": ["9.4", "11.1"] },
    { "id": 14, "tasks": ["11.2", "11.3"] },
    { "id": 15, "tasks": ["12.1", "12.2"] }
  ]
}
```
