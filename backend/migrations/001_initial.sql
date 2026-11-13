-- Vivaion Empresas: isolated database schema. No inserts into production academic databases.
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj VARCHAR(14) UNIQUE NOT NULL CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  legal_name VARCHAR(180) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','suspended')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) UNIQUE NOT NULL,
  full_name VARCHAR(140) NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS memberships (
  company_id UUID NOT NULL REFERENCES companies(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL CHECK (role IN ('administrator','manager','finance','collaborator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, account_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, account_id) REFERENCES memberships(company_id,account_id)
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catalog_products_active_idx ON catalog_products(active);
CREATE TABLE IF NOT EXISTS catalog_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  etag TEXT,
  content_hash CHAR(64),
  synced_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name VARCHAR(140) NOT NULL,
  email VARCHAR(254) NOT NULL,
  company_name VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','responded','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  requested_by UUID NOT NULL REFERENCES accounts(id),
  items JSONB NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_review','approved','declined','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS proposals_company_idx ON proposals(company_id,created_at DESC);
-- Commercial data is empty until explicitly approved by operators.
CREATE TABLE IF NOT EXISTS product_prices (
  product_id TEXT PRIMARY KEY REFERENCES catalog_products(id),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS discount_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  base_discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (base_discount_bps BETWEEN 0 AND 10000),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS discount_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES discount_policies(id) ON DELETE CASCADE,
  minimum_seats INTEGER NOT NULL CHECK (minimum_seats >= 1),
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  UNIQUE(policy_id,minimum_seats)
);
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  external_invoice_id TEXT UNIQUE,
  total_cents BIGINT,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_payment','paid','canceled','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_company_idx ON orders(company_id,created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000)
);
CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  assigned_account_id UUID REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','enrollment_pending','enrolled','canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seats_company_idx ON seats(company_id);
CREATE TABLE IF NOT EXISTS integration_events (
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','processed','failed')),
  payload_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider,external_event_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  actor_account_id UUID REFERENCES accounts(id),
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_company_idx ON audit_events(company_id,created_at DESC);
