ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMPTZ;
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS price_label TEXT NOT NULL DEFAULT 'Preço à vista';
CREATE INDEX IF NOT EXISTS product_prices_validity_idx ON product_prices(approved,corporate_eligible,valid_until);
