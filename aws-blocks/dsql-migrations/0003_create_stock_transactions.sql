CREATE TABLE stock_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
