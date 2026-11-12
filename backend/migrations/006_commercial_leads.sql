-- Commercial leads for assisted sales: no checkout, no academic enrollment.
CREATE TABLE IF NOT EXISTS commercial_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key UUID NOT NULL UNIQUE,
  payload_sha256 CHAR(64) NOT NULL,
  contact_name VARCHAR(140) NOT NULL,
  company_name VARCHAR(180) NOT NULL,
  contact_email VARCHAR(254) NOT NULL,
  contact_phone VARCHAR(30),
  message TEXT,
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  privacy_acknowledged_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','assigned','contacted','proposal_sent','negotiating','won','lost','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commercial_leads_status_idx ON commercial_leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_leads_email_idx ON commercial_leads(contact_email, created_at DESC);
CREATE TABLE IF NOT EXISTS commercial_lead_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES commercial_leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_label VARCHAR(120),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commercial_lead_events_idx ON commercial_lead_events(lead_id, created_at);
