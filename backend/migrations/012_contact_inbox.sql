-- Contact inquiries live in a separate manager-only intake; they are not sales orders.
-- Existing legacy contact rows remain valid; new submissions include idempotency metadata.
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS request_key UUID;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS payload_sha256 CHAR(64);
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS privacy_acknowledged_at TIMESTAMPTZ;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_request_key_idx
  ON contact_requests(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_requests_status_created_idx
  ON contact_requests(status,created_at DESC,id DESC)
  WHERE anonymized_at IS NULL;
CREATE TABLE IF NOT EXISTS contact_request_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES contact_requests(id) ON DELETE CASCADE,
  actor_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('received','staff_update','staff_activity','privacy.anonymized')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_request_events_idx
  ON contact_request_events(contact_id,id DESC);
