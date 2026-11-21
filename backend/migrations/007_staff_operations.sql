-- Independent staff identities. No connection to company-account tenants.
CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) NOT NULL UNIQUE,
  full_name VARCHAR(140) NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','sales')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS staff_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_login_tokens_staff_idx ON staff_login_tokens(staff_id,created_at DESC);
CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_sessions_expiration_idx ON staff_sessions(expires_at);
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS assigned_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS commercial_leads_assigned_idx ON commercial_leads(assigned_staff_id,status,created_at DESC);
ALTER TABLE commercial_lead_events ADD COLUMN IF NOT EXISTS actor_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL;
