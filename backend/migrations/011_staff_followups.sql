-- Operational follow-up scheduling for assisted commercial enquiries.
-- Deliberately no automatic marketing communication or customer notifications.
ALTER TABLE commercial_leads
  ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS commercial_leads_followup_due_idx
  ON commercial_leads(next_followup_at,id)
  WHERE next_followup_at IS NOT NULL AND anonymized_at IS NULL;
-- Closed outcomes cannot retain actionable future follow-ups.
ALTER TABLE commercial_leads
  ADD CONSTRAINT commercial_leads_terminal_followup_ck
  CHECK (next_followup_at IS NULL OR status NOT IN ('won','lost','closed'));
