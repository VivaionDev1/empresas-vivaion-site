-- Opt-in transactional outbox. No client PII or email addresses are persisted here.
CREATE TABLE IF NOT EXISTS commercial_notification_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES commercial_leads(id) ON DELETE CASCADE,
  recipient_staff_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('received','assigned','overdue')),
  dedupe_key VARCHAR(190) NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','dead')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commercial_outbox_pending_idx
  ON commercial_notification_outbox(state,next_attempt_at,id);
