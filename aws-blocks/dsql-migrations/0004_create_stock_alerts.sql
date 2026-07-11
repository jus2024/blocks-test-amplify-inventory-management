CREATE TABLE stock_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id TEXT NOT NULL,
  current_quantity INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
