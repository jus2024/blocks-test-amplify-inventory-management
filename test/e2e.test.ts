/**
 * End-to-end tests — Inventory Management System
 *
 * Run:  npm run test:e2e
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { isServerRunning } from '@aws-blocks/blocks/utils';
import type { api as ApiType } from 'aws-blocks';

let server: ChildProcess | null = null;
let api: typeof ApiType;

/** Generate a unique SKU to avoid collision across test runs */
function uniqueSku(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

test.before(async () => {
  if (!await isServerRunning()) {
    server = spawn('npm', ['run', 'dev:server'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    server.unref();
    await setTimeout(2000);
  }

  const mod = await import('aws-blocks');
  api = mod.api;

  if (process.env.COGNITO_TEST_USER) {
    // Sandbox mode: authenticate with Cognito (to be implemented when running against sandbox)
    console.log('Sandbox mode: COGNITO_TEST_USER set, would authenticate via Cognito');
  }

  // Wait for server readiness
  for (let i = 0; i < 30; i++) {
    try {
      await api.listMaterials();
      return;
    } catch {
      await setTimeout(1000);
    }
  }
  throw new Error('Dev server did not become ready within 30s');
});

test.after(() => {
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  }
});

// ─── Materials CRUD ───────────────────────────────────────────────────────────

test('materials: create material with valid input', async () => {
  const sku = uniqueSku('BOLT-M8');
  const material = await api.createMaterial({
    name: 'Steel Bolt M8',
    sku,
    unit: 'pcs',
    category: 'Fasteners',
    lowStockThreshold: 100,
  });
  assert.ok(material.id);
  assert.strictEqual(material.name, 'Steel Bolt M8');
  assert.strictEqual(material.sku, sku);
  assert.strictEqual(material.unit, 'pcs');
  assert.strictEqual(material.category, 'Fasteners');
  assert.strictEqual(material.lowStockThreshold, 100);
  assert.ok(material.createdAt);
  assert.ok(material.updatedAt);
});

test('materials: list materials returns created material', async () => {
  const sku = uniqueSku('ALU-SHEET');
  const created = await api.createMaterial({
    name: 'Aluminum Sheet',
    sku,
    unit: 'm2',
    category: 'Sheets',
    lowStockThreshold: 50,
  });

  const list = await api.listMaterials();
  assert.ok(list.length >= 1);
  const found = list.find(m => m.id === created.id);
  assert.ok(found, 'Created material should appear in list');
  assert.strictEqual(found!.name, 'Aluminum Sheet');
  assert.strictEqual(found!.sku, sku);
});

test('materials: list is ordered by name ASC', async () => {
  // Create materials with names that sort differently
  await api.createMaterial({
    name: 'Zebra Tape',
    sku: uniqueSku('ZEBRA-TAPE'),
    unit: 'roll',
    category: 'Tapes',
    lowStockThreshold: 10,
  });
  await api.createMaterial({
    name: 'Alpha Wire',
    sku: uniqueSku('ALPHA-WIRE'),
    unit: 'm',
    category: 'Wires',
    lowStockThreshold: 200,
  });

  const list = await api.listMaterials();
  for (let i = 1; i < list.length; i++) {
    assert.ok(
      list[i].name.localeCompare(list[i - 1].name) >= 0,
      `Expected "${list[i].name}" >= "${list[i - 1].name}" (ordered by name ASC)`,
    );
  }
});

test('materials: duplicate SKU is rejected', async () => {
  const sku = uniqueSku('DUP-TEST');
  await api.createMaterial({
    name: 'First Material',
    sku,
    unit: 'kg',
    category: 'Raw',
    lowStockThreshold: 0,
  });

  await assert.rejects(
    () => api.createMaterial({
      name: 'Second Material',
      sku,
      unit: 'kg',
      category: 'Raw',
      lowStockThreshold: 0,
    }),
    (err: any) => err.message.includes('SKU already exists'),
  );
});

test('materials: validation rejects invalid name', async () => {
  await assert.rejects(
    () => api.createMaterial({
      name: '',
      sku: uniqueSku('VALID-SKU'),
      unit: 'pcs',
      category: 'Cat',
      lowStockThreshold: 10,
    }),
    (err: any) => err.message.includes('Validation error'),
  );
});

test('materials: validation rejects invalid SKU', async () => {
  await assert.rejects(
    () => api.createMaterial({
      name: 'Valid Name',
      sku: 'invalid sku!@#',
      unit: 'pcs',
      category: 'Cat',
      lowStockThreshold: 10,
    }),
    (err: any) => err.message.includes('Validation error'),
  );
});

test('materials: validation rejects threshold out of range', async () => {
  await assert.rejects(
    () => api.createMaterial({
      name: 'Valid Name',
      sku: uniqueSku('THR-NEG'),
      unit: 'pcs',
      category: 'Cat',
      lowStockThreshold: -1,
    }),
    (err: any) => err.message.includes('Validation error'),
  );

  await assert.rejects(
    () => api.createMaterial({
      name: 'Valid Name',
      sku: uniqueSku('THR-HIGH'),
      unit: 'pcs',
      category: 'Cat',
      lowStockThreshold: 1000000,
    }),
    (err: any) => err.message.includes('Validation error'),
  );
});


// ─── Materials Update & Delete ────────────────────────────────────────────────

test('materials: update material name', async () => {
  const sku = uniqueSku('UPD-NAME');
  const created = await api.createMaterial({
    name: 'Original Name',
    sku,
    unit: 'kg',
    category: 'Metals',
    lowStockThreshold: 50,
  });

  const updated = await api.updateMaterial(created.id, { name: 'Updated Name' });
  assert.strictEqual(updated.id, created.id);
  assert.strictEqual(updated.name, 'Updated Name');
  // Other fields unchanged
  assert.strictEqual(updated.sku, sku);
  assert.strictEqual(updated.unit, 'kg');
  assert.strictEqual(updated.category, 'Metals');
  assert.strictEqual(updated.lowStockThreshold, 50);
});

test('materials: update material not found', async () => {
  await assert.rejects(
    () => api.updateMaterial('00000000-0000-0000-0000-000000000000', { name: 'Nope' }),
    (err: any) => err.message.includes('Material not found'),
  );
});

test('materials: update validates fields', async () => {
  const sku = uniqueSku('UPD-VAL');
  const created = await api.createMaterial({
    name: 'Valid Material',
    sku,
    unit: 'pcs',
    category: 'Cat',
    lowStockThreshold: 10,
  });

  // Empty name
  await assert.rejects(
    () => api.updateMaterial(created.id, { name: '' }),
    (err: any) => err.message.includes('Validation error'),
  );

  // Threshold out of range
  await assert.rejects(
    () => api.updateMaterial(created.id, { lowStockThreshold: -1 }),
    (err: any) => err.message.includes('Validation error'),
  );
});

test('materials: delete material', async () => {
  const sku = uniqueSku('DEL-MAT');
  const created = await api.createMaterial({
    name: 'To Delete',
    sku,
    unit: 'L',
    category: 'Liquids',
    lowStockThreshold: 5,
  });

  const result = await api.deleteMaterial(created.id);
  assert.strictEqual(result.id, created.id);

  // Verify it's gone from the list
  const list = await api.listMaterials();
  const found = list.find(m => m.id === created.id);
  assert.strictEqual(found, undefined, 'Deleted material should not appear in list');
});

test('materials: delete non-existent material', async () => {
  await assert.rejects(
    () => api.deleteMaterial('00000000-0000-0000-0000-000000000000'),
    (err: any) => err.message.includes('Material not found'),
  );
});

// ─── Warehouses CRUD ──────────────────────────────────────────────────────────

test('warehouses: create warehouse with valid input', async () => {
  const wh = await api.createWarehouse({
    name: 'Main Warehouse',
    location: 'Building A, Floor 1',
  });
  assert.ok(wh.id);
  assert.strictEqual(wh.name, 'Main Warehouse');
  assert.strictEqual(wh.location, 'Building A, Floor 1');
  assert.ok(wh.createdAt);
  assert.ok(wh.updatedAt);
});

test('warehouses: list warehouses returns created warehouse', async () => {
  const created = await api.createWarehouse({
    name: 'Test List Warehouse',
    location: 'Dock 3',
  });
  const list = await api.listWarehouses();
  const found = list.find(w => w.id === created.id);
  assert.ok(found);
  assert.strictEqual(found!.name, 'Test List Warehouse');
});

test('warehouses: list is ordered by name ASC', async () => {
  await api.createWarehouse({ name: 'Zeta Storage', location: 'Zone Z' });
  await api.createWarehouse({ name: 'Alpha Depot', location: 'Zone A' });
  const list = await api.listWarehouses();
  const alphaIdx = list.findIndex(w => w.name === 'Alpha Depot');
  const zetaIdx = list.findIndex(w => w.name === 'Zeta Storage');
  assert.ok(alphaIdx !== -1, 'Alpha Depot should be in the list');
  assert.ok(zetaIdx !== -1, 'Zeta Storage should be in the list');
  assert.ok(alphaIdx < zetaIdx, 'Alpha Depot should come before Zeta Storage (ordered by name ASC)');
});

test('warehouses: update warehouse', async () => {
  const wh = await api.createWarehouse({ name: 'Old Name', location: 'Old Location' });
  const updated = await api.updateWarehouse(wh.id, { name: 'New Name' });
  assert.strictEqual(updated.name, 'New Name');
  assert.strictEqual(updated.location, 'Old Location'); // unchanged
});

test('warehouses: update non-existent warehouse', async () => {
  await assert.rejects(
    () => api.updateWarehouse('non-existent-id', { name: 'X' }),
    (err: any) => err.message.includes('not found'),
  );
});

test('warehouses: delete warehouse', async () => {
  const wh = await api.createWarehouse({ name: 'To Delete', location: 'Nowhere' });
  const result = await api.deleteWarehouse(wh.id);
  assert.strictEqual(result.id, wh.id);
  const list = await api.listWarehouses();
  assert.ok(!list.some(w => w.id === wh.id));
});

test('warehouses: delete non-existent warehouse', async () => {
  await assert.rejects(
    () => api.deleteWarehouse('non-existent-id'),
    (err: any) => err.message.includes('not found'),
  );
});

test('warehouses: validation rejects empty name', async () => {
  await assert.rejects(
    () => api.createWarehouse({ name: '', location: 'Valid Location' }),
    (err: any) => err.message.includes('Validation error'),
  );
});

test('warehouses: validation rejects empty location', async () => {
  await assert.rejects(
    () => api.createWarehouse({ name: 'Valid Name', location: '' }),
    (err: any) => err.message.includes('Validation error'),
  );
});


// ─── Stock Transactions ───────────────────────────────────────────────────────

test('transactions: stock-in records transaction', async () => {
  const mat = await api.createMaterial({
    name: 'TX Test Material',
    sku: uniqueSku('TX-IN'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const wh = await api.createWarehouse({ name: 'TX Test Warehouse', location: 'Zone TX' });
  
  const tx = await api.recordTransaction({
    materialId: mat.id,
    warehouseId: wh.id,
    type: 'in',
    quantity: 100,
  });
  
  assert.ok(tx.id);
  assert.strictEqual(tx.materialId, mat.id);
  assert.strictEqual(tx.warehouseId, wh.id);
  assert.strictEqual(tx.type, 'in');
  assert.strictEqual(tx.quantity, 100);
  assert.ok(tx.createdAt);
});

test('transactions: stock-out rejected when insufficient', async () => {
  const mat = await api.createMaterial({
    name: 'TX Reject Material',
    sku: uniqueSku('TX-REJECT'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const wh = await api.createWarehouse({ name: 'TX Reject Warehouse', location: 'Zone R' });
  
  // Stock in 50
  await api.recordTransaction({
    materialId: mat.id,
    warehouseId: wh.id,
    type: 'in',
    quantity: 50,
  });
  
  // Try to take out 100 — should fail
  await assert.rejects(
    () => api.recordTransaction({
      materialId: mat.id,
      warehouseId: wh.id,
      type: 'out',
      quantity: 100,
    }),
    (err: any) => err.message.includes('Insufficient stock'),
  );
});

test('transactions: successful stock-out reduces stock', async () => {
  const mat = await api.createMaterial({
    name: 'TX Out Material',
    sku: uniqueSku('TX-OUT'),
    unit: 'kg',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const wh = await api.createWarehouse({ name: 'TX Out Warehouse', location: 'Zone O' });
  
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: 200 });
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'out', quantity: 75 });
  
  // Verify via listTransactions
  const txList = await api.listTransactions(mat.id, wh.id);
  assert.strictEqual(txList.length, 2);
  // Ordered by timestamp DESC, most recent first
  assert.strictEqual(txList[0].type, 'out');
  assert.strictEqual(txList[0].quantity, 75);
  assert.strictEqual(txList[1].type, 'in');
  assert.strictEqual(txList[1].quantity, 200);
});

test('transactions: validation rejects invalid quantity', async () => {
  const mat = await api.createMaterial({
    name: 'TX Val Material',
    sku: uniqueSku('TX-VAL'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const wh = await api.createWarehouse({ name: 'TX Val Warehouse', location: 'Zone V' });
  
  await assert.rejects(
    () => api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: 0 }),
    (err: any) => err.message.includes('Validation error'),
  );
  
  await assert.rejects(
    () => api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: -5 }),
    (err: any) => err.message.includes('Validation error'),
  );
});

test('transactions: rejects non-existent material', async () => {
  const wh = await api.createWarehouse({ name: 'TX NoMat Warehouse', location: 'Zone N' });
  
  await assert.rejects(
    () => api.recordTransaction({ materialId: 'fake-id', warehouseId: wh.id, type: 'in', quantity: 10 }),
    (err: any) => err.message.includes('not found'),
  );
});

test('transactions: rejects non-existent warehouse', async () => {
  const mat = await api.createMaterial({
    name: 'TX NoWH Material',
    sku: uniqueSku('TX-NOWH'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  
  await assert.rejects(
    () => api.recordTransaction({ materialId: mat.id, warehouseId: 'fake-id', type: 'in', quantity: 10 }),
    (err: any) => err.message.includes('not found'),
  );
});


// ─── Stock Inquiry ────────────────────────────────────────────────────────────

test('stock inquiry: getCurrentStock returns aggregated quantities', async () => {
  const mat = await api.createMaterial({
    name: 'Stock Inquiry Material',
    sku: uniqueSku('STK-INQ'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const wh = await api.createWarehouse({ name: 'Stock Inquiry WH', location: 'Inquiry Zone' });

  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: 100 });
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'out', quantity: 30 });

  const stock = await api.getCurrentStock();
  const entry = stock.find(s => s.materialId === mat.id && s.warehouseId === wh.id);
  assert.ok(entry);
  assert.strictEqual(entry!.quantity, 70);
  assert.strictEqual(entry!.materialName, 'Stock Inquiry Material');
  assert.strictEqual(entry!.warehouseName, 'Stock Inquiry WH');
});

test('stock inquiry: filter by warehouseId', async () => {
  const mat = await api.createMaterial({
    name: 'Filter WH Material',
    sku: uniqueSku('FLT-WH'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const wh1 = await api.createWarehouse({ name: 'Filter WH 1', location: 'A' });
  const wh2 = await api.createWarehouse({ name: 'Filter WH 2', location: 'B' });

  await api.recordTransaction({ materialId: mat.id, warehouseId: wh1.id, type: 'in', quantity: 50 });
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh2.id, type: 'in', quantity: 80 });

  const filtered = await api.getCurrentStock({ warehouseId: wh1.id });
  assert.ok(filtered.every(s => s.warehouseId === wh1.id));
  const entry = filtered.find(s => s.materialId === mat.id);
  assert.ok(entry);
  assert.strictEqual(entry!.quantity, 50);
});

test('stock inquiry: filter by materialId', async () => {
  const mat1 = await api.createMaterial({ name: 'Filter Mat 1', sku: uniqueSku('FLT-M1'), unit: 'kg', category: 'Test', lowStockThreshold: 0 });
  const mat2 = await api.createMaterial({ name: 'Filter Mat 2', sku: uniqueSku('FLT-M2'), unit: 'kg', category: 'Test', lowStockThreshold: 0 });
  const wh = await api.createWarehouse({ name: 'Filter Mat WH', location: 'C' });

  await api.recordTransaction({ materialId: mat1.id, warehouseId: wh.id, type: 'in', quantity: 25 });
  await api.recordTransaction({ materialId: mat2.id, warehouseId: wh.id, type: 'in', quantity: 75 });

  const filtered = await api.getCurrentStock({ materialId: mat1.id });
  assert.ok(filtered.every(s => s.materialId === mat1.id));
});

test('stock inquiry: non-existent filter returns empty list', async () => {
  const stock = await api.getCurrentStock({ materialId: 'non-existent-id' });
  assert.deepStrictEqual(stock, []);
});

test('stock inquiry: getStockSummary groups by material', async () => {
  const mat = await api.createMaterial({ name: 'Summary Material', sku: uniqueSku('SUM-MAT'), unit: 'pcs', category: 'Test', lowStockThreshold: 0 });
  const wh1 = await api.createWarehouse({ name: 'Summary WH1', location: 'S1' });
  const wh2 = await api.createWarehouse({ name: 'Summary WH2', location: 'S2' });

  await api.recordTransaction({ materialId: mat.id, warehouseId: wh1.id, type: 'in', quantity: 40 });
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh2.id, type: 'in', quantity: 60 });

  const summary = await api.getStockSummary();
  const entry = summary.find(s => s.materialId === mat.id);
  assert.ok(entry);
  assert.strictEqual(entry!.totalQuantity, 100);
  assert.strictEqual(entry!.materialName, 'Summary Material');
});


// ─── Alerts (CronJob) ─────────────────────────────────────────────────────────

test('alerts: cron job creates alert for low-stock material', async () => {
  // Create a material with threshold = 100
  const mat = await api.createMaterial({
    name: 'Alert Test Material',
    sku: uniqueSku('ALERT-TEST'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 100,
  });
  const wh = await api.createWarehouse({ name: 'Alert Test WH', location: 'Alert Zone' });

  // Stock in only 50 (below threshold of 100)
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: 50 });

  // Call the CronJob handler directly
  await api.triggerLowStockCheck();

  // Check alerts
  const { alerts } = await api.listAlerts();
  const alert = alerts.find(a => a.materialId === mat.id);
  assert.ok(alert, 'Alert should be created for low-stock material');
  assert.strictEqual(alert!.currentQuantity, 50);
  assert.strictEqual(alert!.threshold, 100);
  assert.strictEqual(alert!.acknowledged, false);
});

test('alerts: acknowledge alert', async () => {
  // Get the alerts and acknowledge one
  const { alerts } = await api.listAlerts();
  assert.ok(alerts.length > 0, 'Should have at least one alert');

  const alertToAck = alerts[0];
  const result = await api.acknowledgeAlert(alertToAck.id);
  assert.strictEqual(result.id, alertToAck.id);

  // Verify it's acknowledged
  const { alerts: updatedAlerts } = await api.listAlerts();
  const acked = updatedAlerts.find(a => a.id === alertToAck.id);
  assert.ok(acked);
  assert.strictEqual(acked!.acknowledged, true);
  assert.ok(acked!.acknowledgedAt);
});

test('alerts: cron job is idempotent (no duplicate alerts)', async () => {
  // Create a material with threshold = 50
  const mat = await api.createMaterial({
    name: 'Idempotent Alert Material',
    sku: uniqueSku('IDEMP-ALERT'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 50,
  });
  const wh = await api.createWarehouse({ name: 'Idempotent WH', location: 'Zone I' });

  // Stock in only 10 (below threshold of 50)
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: 10 });

  // Run handler twice
  await api.triggerLowStockCheck();
  await api.triggerLowStockCheck();

  // Should only have ONE unacknowledged alert for this material
  const { alerts } = await api.listAlerts();
  const materialAlerts = alerts.filter(a => a.materialId === mat.id && !a.acknowledged);
  assert.strictEqual(materialAlerts.length, 1, 'Should have exactly one unacknowledged alert');
});

test('alerts: acknowledge non-existent alert', async () => {
  await assert.rejects(
    () => api.acknowledgeAlert('non-existent-id'),
    (err: any) => err.message.includes('not found'),
  );
});


// ─── CSV Import ───────────────────────────────────────────────────────────────

/** Poll for import job result (AsyncJob processes via setTimeout in local mode) */
async function waitForImportResult(jobId: string, maxAttempts = 20): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await api.getImportJobResult(jobId);
    } catch (err: any) {
      if (err.message.includes('not found') && i < maxAttempts - 1) {
        await setTimeout(200);
        continue;
      }
      throw err;
    }
  }
}

test('csv import: valid + invalid rows', async () => {
  // Create test material and warehouse with unique names
  const testId = Date.now().toString(36);
  const mat = await api.createMaterial({
    name: `CSV Import Material ${testId}`,
    sku: uniqueSku('CSV-MAT'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const whName = `CSV Import WH ${testId}`;
  const wh = await api.createWarehouse({ name: whName, location: 'CSV Zone' });

  // Create CSV with header, 1 valid row, and 1 invalid row (non-existent SKU)
  const csvText = [
    'material_sku,warehouse_name,type,quantity,note',
    `${mat.sku},${whName},in,100,Bulk delivery`,
    `NON-EXISTENT-SKU,${whName},in,50,Bad row`,
  ].join('\n');

  const { jobId } = await api.importCsv(csvText);
  assert.ok(jobId);

  // Get result (poll since AsyncJob processes asynchronously in local mode)
  const result = await waitForImportResult(jobId);
  assert.strictEqual(result.totalRows, 2);
  assert.strictEqual(result.successCount, 1);
  assert.strictEqual(result.failedCount, 1);
  assert.strictEqual(result.failures.length, 1);
  assert.strictEqual(result.failures[0].row, 3); // row 3 (1-based with header)
  assert.ok(result.failures[0].error.includes('not found'));

  // Verify the valid transaction was persisted
  const stock = await api.getCurrentStock({ materialId: mat.id });
  const entry = stock.find(s => s.materialId === mat.id && s.warehouseId === wh.id);
  assert.ok(entry);
  assert.strictEqual(entry!.quantity, 100);
});

test('csv import: rejects oversized CSV', async () => {
  // The RPC transport has payload limits, so we validate that the server 
  // rejects oversized CSVs by testing with a size just over 200KB.
  // We use a single long note field to push over the limit without excessive rows.
  const header = 'material_sku,warehouse_name,type,quantity,note';
  const longNote = 'x'.repeat(200 * 1024); // one row with 200KB note
  const bigCsv = `${header}\nSKU,WH,in,1,${longNote}`;
  await assert.rejects(
    () => api.importCsv(bigCsv),
    (err: any) => err.message.includes('200KB') || err.message.includes('size'),
  );
});

test('csv import: rejects more than 1000 rows', async () => {
  // Create CSV with > 1000 data rows
  const header = 'material_sku,warehouse_name,type,quantity,note';
  const dataRows = Array.from({ length: 1001 }, (_, i) => `SKU-${i},WH,in,1,note`);
  const csv = [header, ...dataRows].join('\n');

  await assert.rejects(
    () => api.importCsv(csv),
    (err: any) => err.message.includes('1000') || err.message.includes('row'),
  );
});

test('csv import: stock-out with insufficient stock', async () => {
  const testId = Date.now().toString(36);
  const mat = await api.createMaterial({
    name: `CSV Out Material ${testId}`,
    sku: uniqueSku('CSV-OUT'),
    unit: 'pcs',
    category: 'Test',
    lowStockThreshold: 0,
  });
  const whName = `CSV Out WH ${testId}`;
  const wh = await api.createWarehouse({ name: whName, location: 'CSV Out Zone' });

  // Stock in 20
  await api.recordTransaction({ materialId: mat.id, warehouseId: wh.id, type: 'in', quantity: 20 });

  // Try to take out 100 via CSV
  const csvText = [
    'material_sku,warehouse_name,type,quantity,note',
    `${mat.sku},${whName},out,100,Too much`,
  ].join('\n');

  const { jobId } = await api.importCsv(csvText);
  const result = await waitForImportResult(jobId);
  assert.strictEqual(result.failedCount, 1);
  assert.ok(result.failures[0].error.includes('Insufficient stock'));
});
