-- Retention controls are opt-in, gated by an approved institutional policy.
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS commercial_leads_retention_idx
  ON commercial_leads(status,created_at) WHERE anonymized_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_requests_retention_idx
  ON contact_requests(status,created_at) WHERE anonymized_at IS NULL;
