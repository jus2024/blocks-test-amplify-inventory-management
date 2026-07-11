/**
 * Backend — aws-blocks/index.ts
 *
 * 資材在庫管理システム (Inventory Management System)
 *
 * DistributedDatabase (Aurora DSQL) を使用したリレーショナルデータモデル。
 * 資材マスタ、倉庫マスタ、入出庫トランザクション、在庫アラート、CSV インポートを管理する。
 */
import { ApiNamespace, Scope, DistributedDatabase, sql, type BlocksContext } from '@aws-blocks/blocks';
import { CronJob } from '@aws-blocks/bb-cron-job';
import { AsyncJob } from '@aws-blocks/bb-async-job';
import { CognitoVerifier } from './cognito-verifier.js';
import crypto from 'crypto';

const scope = new Scope('inventory');

// ─── Auth ────────────────────────────────────────────────────────────────────
// Cognito — cloud deployment uses Cognito, local dev bypasses
const cognitoAuth = new CognitoVerifier({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
  region: process.env.COGNITO_REGION,
});

// ─── Database ────────────────────────────────────────────────────────────────
const db = new DistributedDatabase(scope, 'main', {
  migrationsPath: './aws-blocks/dsql-migrations',
});

// ─── Type Definitions ────────────────────────────────────────────────────────
interface Material {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
}

interface Warehouse {
  id: string;
  name: string;
  location: string;
  createdAt: string;
  updatedAt: string;
}

interface StockTransaction {
  id: string;
  materialId: string;
  warehouseId: string;
  type: 'in' | 'out';
  quantity: number;
  note: string | null;
  createdAt: string;
}

interface CurrentStockEntry {
  materialId: string;
  materialName: string;
  materialSku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

interface StockSummaryEntry {
  materialId: string;
  materialName: string;
  materialSku: string;
  totalQuantity: number;
}

interface StockAlert {
  id: string;
  materialId: string;
  materialName: string;
  currentQuantity: number;
  threshold: number;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
}

interface ImportJobResult {
  jobId: string;
  totalRows: number;
  successCount: number;
  failedCount: number;
  failures: Array<{ row: number; error: string }>;
  createdAt: string;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Extract headers from BlocksContext and call CognitoVerifier */
async function requireCognitoAuth(context: BlocksContext): Promise<void> {
  const h: Record<string, string> = {};
  context.request.headers.forEach((value, key) => { h[key] = value; });
  await cognitoAuth.requireAuth({ headers: h });
}

export const api = new ApiNamespace(scope, 'api', ((context: BlocksContext) => ({
  // ─── Materials CRUD ───────────────────────────────────────────
  async createMaterial(input: {
    name: string;
    sku: string;
    unit: string;
    category: string;
    lowStockThreshold: number;
  }): Promise<Material> {
    await requireCognitoAuth(context);
    // Validation
    if (!input.name || input.name.length > 100)
      throw new Error('Validation error: name must be 1-100 characters');
    if (!input.sku || input.sku.length > 50 || !/^[a-zA-Z0-9-]+$/.test(input.sku))
      throw new Error('Validation error: sku must be 1-50 alphanumeric characters or hyphens');
    if (!input.unit || input.unit.length > 20)
      throw new Error('Validation error: unit must be 1-20 characters');
    if (!input.category || input.category.length > 50)
      throw new Error('Validation error: category must be 1-50 characters');
    if (input.lowStockThreshold === undefined || input.lowStockThreshold < 0 || input.lowStockThreshold > 999999)
      throw new Error('Validation error: lowStockThreshold must be 0-999999');

    try {
      const rows = await db.query(sql`
        INSERT INTO materials (name, sku, unit, category, low_stock_threshold)
        VALUES (${input.name}, ${input.sku}, ${input.unit}, ${input.category}, ${input.lowStockThreshold})
        RETURNING id, name, sku, unit, category, low_stock_threshold, created_at, updated_at
      `);
      const row = rows[0] as any;
      return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        category: row.category,
        lowStockThreshold: row.low_stock_threshold,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      };
    } catch (err: any) {
      if (err.message?.includes('unique') || err.message?.includes('duplicate') || err.code === '23505') {
        throw new Error(`SKU already exists: ${input.sku}`);
      }
      throw err;
    }
  },

  async listMaterials(): Promise<Material[]> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      SELECT id, name, sku, unit, category, low_stock_threshold, created_at, updated_at
      FROM materials
      ORDER BY name ASC
      LIMIT 200
    `);
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      unit: row.unit,
      category: row.category,
      lowStockThreshold: row.low_stock_threshold,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  },

  async updateMaterial(id: string, input: {
    name?: string;
    unit?: string;
    category?: string;
    lowStockThreshold?: number;
  }): Promise<Material> {
    await requireCognitoAuth(context);
    // Validate provided fields
    if (input.name !== undefined && (input.name.length === 0 || input.name.length > 100))
      throw new Error('Validation error: name must be 1-100 characters');
    if (input.unit !== undefined && (input.unit.length === 0 || input.unit.length > 20))
      throw new Error('Validation error: unit must be 1-20 characters');
    if (input.category !== undefined && (input.category.length === 0 || input.category.length > 50))
      throw new Error('Validation error: category must be 1-50 characters');
    if (input.lowStockThreshold !== undefined && (input.lowStockThreshold < 0 || input.lowStockThreshold > 999999))
      throw new Error('Validation error: lowStockThreshold must be 0-999999');

    // Fetch current material
    const current = await db.query(sql`SELECT * FROM materials WHERE id = ${id}`);
    if (current.length === 0) throw new Error('Material not found');
    const row = current[0] as any;

    // Merge: use input values if provided, otherwise keep existing values
    const newName = input.name ?? row.name;
    const newUnit = input.unit ?? row.unit;
    const newCategory = input.category ?? row.category;
    const newThreshold = input.lowStockThreshold ?? row.low_stock_threshold;

    const updated = await db.query(sql`
      UPDATE materials
      SET name = ${newName}, unit = ${newUnit}, category = ${newCategory},
          low_stock_threshold = ${newThreshold}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING id, name, sku, unit, category, low_stock_threshold, created_at, updated_at
    `);

    const r = updated[0] as any;
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      unit: r.unit,
      category: r.category,
      lowStockThreshold: r.low_stock_threshold,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  },

  async deleteMaterial(id: string): Promise<{ id: string }> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      DELETE FROM materials WHERE id = ${id} RETURNING id
    `);
    if (rows.length === 0) throw new Error('Material not found');
    return { id: (rows[0] as any).id };
  },

  // ─── Warehouses CRUD ──────────────────────────────────────────
  async createWarehouse(input: {
    name: string;
    location: string;
  }): Promise<Warehouse> {
    await requireCognitoAuth(context);
    if (!input.name || input.name.length > 100)
      throw new Error('Validation error: name must be 1-100 characters');
    if (!input.location || input.location.length > 200)
      throw new Error('Validation error: location must be 1-200 characters');

    const rows = await db.query(sql`
      INSERT INTO warehouses (name, location)
      VALUES (${input.name}, ${input.location})
      RETURNING id, name, location, created_at, updated_at
    `);
    const row = rows[0] as any;
    return {
      id: row.id,
      name: row.name,
      location: row.location,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  },

  async listWarehouses(): Promise<Warehouse[]> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      SELECT id, name, location, created_at, updated_at
      FROM warehouses
      ORDER BY name ASC
    `);
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  },

  async updateWarehouse(id: string, input: {
    name?: string;
    location?: string;
  }): Promise<Warehouse> {
    await requireCognitoAuth(context);
    if (input.name !== undefined && (input.name.length === 0 || input.name.length > 100))
      throw new Error('Validation error: name must be 1-100 characters');
    if (input.location !== undefined && (input.location.length === 0 || input.location.length > 200))
      throw new Error('Validation error: location must be 1-200 characters');

    const current = await db.query(sql`SELECT * FROM warehouses WHERE id = ${id}`);
    if (current.length === 0) throw new Error('Warehouse not found');
    const row = current[0] as any;

    const newName = input.name ?? row.name;
    const newLocation = input.location ?? row.location;

    const updated = await db.query(sql`
      UPDATE warehouses
      SET name = ${newName}, location = ${newLocation}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING id, name, location, created_at, updated_at
    `);
    const r = updated[0] as any;
    return {
      id: r.id,
      name: r.name,
      location: r.location,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  },

  async deleteWarehouse(id: string): Promise<{ id: string }> {
    await requireCognitoAuth(context);
    // Check for referenced stock_transactions
    const refs = await db.query(sql`
      SELECT COUNT(*)::int AS count FROM stock_transactions WHERE warehouse_id = ${id}
    `);
    if ((refs[0] as any).count > 0) {
      throw new Error('Warehouse is in use: referenced by stock transactions');
    }

    const rows = await db.query(sql`
      DELETE FROM warehouses WHERE id = ${id} RETURNING id
    `);
    if (rows.length === 0) throw new Error('Warehouse not found');
    return { id: (rows[0] as any).id };
  },

  // ─── Stock Transactions ───────────────────────────────────────
  async recordTransaction(input: {
    materialId: string;
    warehouseId: string;
    type: 'in' | 'out';
    quantity: number;
    note?: string;
  }): Promise<StockTransaction> {
    await requireCognitoAuth(context);
    // Validation
    if (!input.type || (input.type !== 'in' && input.type !== 'out'))
      throw new Error('Validation error: type must be "in" or "out"');
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999999)
      throw new Error('Validation error: quantity must be an integer between 1 and 999999');
    if (input.note !== undefined && input.note.length > 500)
      throw new Error('Validation error: note must be at most 500 characters');

    // Use transaction with OCC retry
    return await db.transaction(async (tx) => {
      // Check materialId exists
      const materials = await tx.query(sql`SELECT id FROM materials WHERE id = ${input.materialId}`);
      if (materials.length === 0) throw new Error('Material not found');

      // Check warehouseId exists
      const warehouses = await tx.query(sql`SELECT id FROM warehouses WHERE id = ${input.warehouseId}`);
      if (warehouses.length === 0) throw new Error('Warehouse not found');

      // Stock-out: check sufficient stock
      if (input.type === 'out') {
        const stockRows = await tx.query(sql`
          SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0)::int AS current_stock
          FROM stock_transactions
          WHERE material_id = ${input.materialId} AND warehouse_id = ${input.warehouseId}
        `);
        const currentStock = (stockRows[0] as any).current_stock;
        if (currentStock < input.quantity) {
          throw new Error(`Insufficient stock: available ${currentStock}`);
        }
      }

      // Insert transaction
      const rows = await tx.query(sql`
        INSERT INTO stock_transactions (material_id, warehouse_id, type, quantity, note)
        VALUES (${input.materialId}, ${input.warehouseId}, ${input.type}, ${input.quantity}, ${input.note ?? null})
        RETURNING id, material_id, warehouse_id, type, quantity, note, created_at
      `);
      const row = rows[0] as any;
      return {
        id: row.id,
        materialId: row.material_id,
        warehouseId: row.warehouse_id,
        type: row.type as 'in' | 'out',
        quantity: row.quantity,
        note: row.note,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      };
    }, { retryOnConflict: true, maxRetries: 3 });
  },

  async listTransactions(materialId: string, warehouseId: string): Promise<StockTransaction[]> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      SELECT id, material_id, warehouse_id, type, quantity, note, created_at
      FROM stock_transactions
      WHERE material_id = ${materialId} AND warehouse_id = ${warehouseId}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return rows.map((row: any) => ({
      id: row.id,
      materialId: row.material_id,
      warehouseId: row.warehouse_id,
      type: row.type as 'in' | 'out',
      quantity: row.quantity,
      note: row.note,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  },

  // ─── Stock Inquiry ────────────────────────────────────────────
  async getCurrentStock(filter?: {
    materialId?: string;
    warehouseId?: string;
  }): Promise<CurrentStockEntry[]> {
    await requireCognitoAuth(context);
    const materialId = filter?.materialId ?? null;
    const warehouseId = filter?.warehouseId ?? null;

    const rows = await db.query(sql`
      SELECT
        m.id AS material_id,
        m.name AS material_name,
        m.sku AS material_sku,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        SUM(CASE WHEN st.type = 'in' THEN st.quantity ELSE -st.quantity END)::int AS quantity
      FROM stock_transactions st
      JOIN materials m ON m.id = st.material_id
      JOIN warehouses w ON w.id = st.warehouse_id
      WHERE (${materialId}::TEXT IS NULL OR st.material_id = ${materialId})
        AND (${warehouseId}::TEXT IS NULL OR st.warehouse_id = ${warehouseId})
      GROUP BY m.id, m.name, m.sku, w.id, w.name
      ORDER BY m.name ASC
      LIMIT 1000
    `);
    return rows.map((row: any) => ({
      materialId: row.material_id,
      materialName: row.material_name,
      materialSku: row.material_sku,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      quantity: row.quantity,
    }));
  },

  async getStockSummary(): Promise<StockSummaryEntry[]> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      SELECT
        m.id AS material_id,
        m.name AS material_name,
        m.sku AS material_sku,
        SUM(CASE WHEN st.type = 'in' THEN st.quantity ELSE -st.quantity END)::int AS total_quantity
      FROM stock_transactions st
      JOIN materials m ON m.id = st.material_id
      GROUP BY m.id, m.name, m.sku
      ORDER BY m.name ASC
    `);
    return rows.map((row: any) => ({
      materialId: row.material_id,
      materialName: row.material_name,
      materialSku: row.material_sku,
      totalQuantity: row.total_quantity,
    }));
  },

  // ─── Alerts ───────────────────────────────────────────────────
  async listAlerts(cursor?: string): Promise<{ alerts: StockAlert[]; nextCursor?: string }> {
    await requireCognitoAuth(context);
    let rows: any[];
    if (cursor) {
      // Get the timestamp of the cursor alert for keyset pagination
      const cursorRow = await db.query(sql`SELECT created_at FROM stock_alerts WHERE id = ${cursor}`);
      if (cursorRow.length > 0) {
        const cursorTime = (cursorRow[0] as any).created_at;
        rows = await db.query(sql`
          SELECT sa.id, sa.material_id, m.name AS material_name, sa.current_quantity, sa.threshold,
                 sa.acknowledged, sa.acknowledged_at, sa.created_at
          FROM stock_alerts sa
          JOIN materials m ON m.id = sa.material_id
          WHERE sa.created_at < ${cursorTime}
          ORDER BY sa.created_at DESC
          LIMIT 100
        `);
      } else {
        rows = [];
      }
    } else {
      rows = await db.query(sql`
        SELECT sa.id, sa.material_id, m.name AS material_name, sa.current_quantity, sa.threshold,
               sa.acknowledged, sa.acknowledged_at, sa.created_at
        FROM stock_alerts sa
        JOIN materials m ON m.id = sa.material_id
        ORDER BY sa.created_at DESC
        LIMIT 100
      `);
    }

    const alerts = (rows as any[]).map(row => ({
      id: row.id,
      materialId: row.material_id,
      materialName: row.material_name,
      currentQuantity: row.current_quantity,
      threshold: row.threshold,
      acknowledged: row.acknowledged,
      acknowledgedAt: row.acknowledged_at ? (row.acknowledged_at instanceof Date ? row.acknowledged_at.toISOString() : String(row.acknowledged_at)) : null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));

    const nextCursor = alerts.length === 100 ? alerts[alerts.length - 1].id : undefined;
    return { alerts, nextCursor };
  },

  async acknowledgeAlert(alertId: string): Promise<{ id: string }> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      UPDATE stock_alerts
      SET acknowledged = true, acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ${alertId}
      RETURNING id
    `);
    if (rows.length === 0) throw new Error('Alert not found');
    return { id: (rows[0] as any).id };
  },

  // ─── Low Stock Check (test trigger) ────────────────────────────
  async triggerLowStockCheck(): Promise<{ ok: boolean }> {
    await requireCognitoAuth(context);
    await lowStockCheckHandler();
    return { ok: true };
  },

  // ─── CSV Import ───────────────────────────────────────────────
  async importCsv(csvText: string): Promise<{ jobId: string }> {
    await requireCognitoAuth(context);
    // Validate size
    const sizeInBytes = new TextEncoder().encode(csvText).length;
    if (sizeInBytes > 200 * 1024) {
      throw new Error('Validation error: CSV exceeds 200KB size limit');
    }

    // Count data rows (exclude header)
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    let dataRowCount = lines.length;
    if (lines.length > 0) {
      const header = lines[0].toLowerCase().trim();
      if (header.includes('material_sku') || header.includes('warehouse_name')) {
        dataRowCount = lines.length - 1;
      }
    }
    if (dataRowCount > 1000) {
      throw new Error('Validation error: CSV exceeds 1000 row limit');
    }

    // Generate job ID and submit
    const jobId = crypto.randomUUID();
    await csvImportJob.submit({ csvText, jobId });
    return { jobId };
  },

  async getImportJobResult(jobId: string): Promise<ImportJobResult> {
    await requireCognitoAuth(context);
    const rows = await db.query(sql`
      SELECT id, total_rows, success_count, failed_count, failures_json, created_at
      FROM import_job_results
      WHERE id = ${jobId}
    `);
    if (rows.length === 0) {
      throw new Error('Import job not found');
    }
    const row = rows[0] as any;
    return {
      jobId: row.id,
      totalRows: row.total_rows,
      successCount: row.success_count,
      failedCount: row.failed_count,
      failures: JSON.parse(row.failures_json),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  },
})) as any);

// ─── AsyncJob: CSV Import ────────────────────────────────────────────────────

const csvImportJob = new AsyncJob(scope, 'csv-import', {
  handler: async (payload: { csvText: string; jobId: string }) => {
    const { csvText, jobId } = payload;
    const lines = csvText.split('\n').filter(line => line.trim() !== '');

    // Skip header if it matches expected column names
    let dataLines = lines;
    if (lines.length > 0) {
      const header = lines[0].toLowerCase().trim();
      if (header.includes('material_sku') || header.includes('warehouse_name')) {
        dataLines = lines.slice(1);
      }
    }

    const totalRows = dataLines.length;
    let successCount = 0;
    let failedCount = 0;
    const failures: Array<{ row: number; error: string }> = [];

    if (totalRows === 0) {
      // Empty CSV
      await db.query(sql`
        INSERT INTO import_job_results (id, total_rows, success_count, failed_count, failures_json)
        VALUES (${jobId}, 0, 0, 0, ${JSON.stringify([{ row: 0, error: 'Empty input: no data rows' }])})
      `);
      return;
    }

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = i + 2; // 1-based + header offset
      const cols = dataLines[i].split(',').map(c => c.trim());

      if (cols.length < 4) {
        failures.push({ row: rowNum, error: 'Missing required columns' });
        failedCount++;
        continue;
      }

      const [materialSku, warehouseName, type, quantityStr, note] = cols;

      // Validate type
      if (type !== 'in' && type !== 'out') {
        failures.push({ row: rowNum, error: `Invalid type: "${type}". Must be "in" or "out"` });
        failedCount++;
        continue;
      }

      // Validate quantity
      const quantity = parseInt(quantityStr, 10);
      if (isNaN(quantity) || quantity < 1 || quantity > 999999) {
        failures.push({ row: rowNum, error: `Invalid quantity: "${quantityStr}"` });
        failedCount++;
        continue;
      }

      // Lookup material by SKU
      const matRows = await db.query(sql`SELECT id FROM materials WHERE sku = ${materialSku}`);
      if (matRows.length === 0) {
        failures.push({ row: rowNum, error: `Material SKU not found: "${materialSku}"` });
        failedCount++;
        continue;
      }
      const materialId = (matRows[0] as any).id;

      // Lookup warehouse by name
      const whRows = await db.query(sql`SELECT id FROM warehouses WHERE name = ${warehouseName}`);
      if (whRows.length === 0) {
        failures.push({ row: rowNum, error: `Warehouse not found: "${warehouseName}"` });
        failedCount++;
        continue;
      }
      const warehouseId = (whRows[0] as any).id;

      // Stock-out check
      if (type === 'out') {
        const stockRows = await db.query(sql`
          SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0)::int AS current_stock
          FROM stock_transactions
          WHERE material_id = ${materialId} AND warehouse_id = ${warehouseId}
        `);
        const currentStock = (stockRows[0] as any).current_stock;
        if (currentStock < quantity) {
          failures.push({ row: rowNum, error: `Insufficient stock: available ${currentStock}` });
          failedCount++;
          continue;
        }
      }

      // Insert transaction
      await db.query(sql`
        INSERT INTO stock_transactions (material_id, warehouse_id, type, quantity, note)
        VALUES (${materialId}, ${warehouseId}, ${type}, ${quantity}, ${note || null})
      `);
      successCount++;
    }

    // Store result
    await db.query(sql`
      INSERT INTO import_job_results (id, total_rows, success_count, failed_count, failures_json)
      VALUES (${jobId}, ${totalRows}, ${successCount}, ${failedCount}, ${JSON.stringify(failures)})
    `);
  },
});

// ─── CronJob: Low-Stock Alert Detection ──────────────────────────────────────

/** Handler logic for low-stock detection — exported for testability */
export async function lowStockCheckHandler() {
  // Query materials where threshold > 0 and total stock <= threshold
  const rows = await db.query(sql`
    SELECT
      m.id,
      m.name,
      m.low_stock_threshold,
      COALESCE(SUM(CASE WHEN st.type = 'in' THEN st.quantity ELSE -st.quantity END), 0)::int AS total_stock
    FROM materials m
    LEFT JOIN stock_transactions st ON st.material_id = m.id
    WHERE m.low_stock_threshold > 0
    GROUP BY m.id, m.name, m.low_stock_threshold
    HAVING COALESCE(SUM(CASE WHEN st.type = 'in' THEN st.quantity ELSE -st.quantity END), 0) <= m.low_stock_threshold
    LIMIT 500
  `);

  for (const row of rows as any[]) {
    // Check if an unacknowledged alert already exists for this material (idempotency)
    const existing = await db.query(sql`
      SELECT id FROM stock_alerts
      WHERE material_id = ${row.id} AND acknowledged = false
    `);
    if (existing.length === 0) {
      await db.query(sql`
        INSERT INTO stock_alerts (material_id, current_quantity, threshold)
        VALUES (${row.id}, ${row.total_stock}, ${row.low_stock_threshold})
      `);
    }
  }
}

const lowStockCheck = new CronJob(scope, 'low-stock-check', {
  schedule: 'rate(1 hour)',
  handler: async () => {
    await lowStockCheckHandler();
  },
});
