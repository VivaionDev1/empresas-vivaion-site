-- Terminal cancellation state: revoked recipients must never receive stale mail.
-- This is a new migration, so existing migration checksums remain unchanged.
ALTER TABLE commercial_notification_outbox
  DROP CONSTRAINT IF EXISTS commercial_notification_outbox_state_check;
ALTER TABLE commercial_notification_outbox
  ADD CONSTRAINT commercial_notification_outbox_state_check
  CHECK (state IN ('pending','sent','dead','cancelled'));
ALTER TABLE commercial_notification_outbox
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Reconcile queued messages from any previous period of inactive accounts.
UPDATE commercial_notification_outbox o
SET state='cancelled', cancelled_at=NOW()
WHERE o.state='pending'
  AND NOT EXISTS (
    SELECT 1 FROM staff_users s
    WHERE s.id=o.recipient_staff_id AND s.active=TRUE
  );

-- A database-level guard ensures that even administrative SQL updates (not
-- only the provisioning CLI) cancel undelivered messages on revocation,
-- reactivation, and role changes, in the same transaction as the identity change.
CREATE OR REPLACE FUNCTION cancel_staff_pending_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE commercial_notification_outbox
  SET state='cancelled', cancelled_at=NOW()
  WHERE recipient_staff_id=NEW.id AND state='pending';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS staff_cancel_pending_notifications ON staff_users;
CREATE TRIGGER staff_cancel_pending_notifications
  AFTER UPDATE OF active,role ON staff_users
  FOR EACH ROW
  WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION cancel_staff_pending_notifications();
