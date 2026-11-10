-- Explicit opt-in by product before any approved corporate quote.
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS corporate_eligible BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN product_prices.corporate_eligible IS 'Set true only after independent academic and commercial approval of corporate eligibility';
