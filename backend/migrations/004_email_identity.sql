-- Email identity is verified separately from company/representative approval.
-- Existing accounts remain unverified until they complete the new verification flow.
ALTER TABLE accounts
  ADD COLUMN email_verified_at TIMESTAMPTZ;
CREATE TABLE account_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX account_action_tokens_account_purpose_idx
  ON account_action_tokens(account_id, purpose, created_at DESC);
CREATE INDEX account_action_tokens_expiry_idx
  ON account_action_tokens(expires_at);
