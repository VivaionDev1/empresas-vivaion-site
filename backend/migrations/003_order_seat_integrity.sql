-- Prove each seat belongs to the same company as the containing order.
-- Additive migration. In a database with legacy records, the constraints deliberately fail
-- if cross-company references already exist; stop and investigate, do not silently rewrite.
ALTER TABLE orders
  ADD CONSTRAINT orders_id_company_id_unique UNIQUE(id, company_id);
ALTER TABLE order_items
  ADD COLUMN company_id UUID;
UPDATE order_items AS item
  SET company_id = o.company_id FROM orders AS o WHERE o.id = item.order_id;
ALTER TABLE order_items
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_company_fk
  FOREIGN KEY(order_id, company_id) REFERENCES orders(id, company_id);
ALTER TABLE order_items
  ADD CONSTRAINT order_items_id_company_unique UNIQUE(id, company_id);
ALTER TABLE seats
  ADD CONSTRAINT seats_order_item_company_fk
  FOREIGN KEY(order_item_id, company_id) REFERENCES order_items(id, company_id);
-- When a seat is assigned, it must refer to a member of the SAME company.
ALTER TABLE seats
  ADD CONSTRAINT seats_assignment_member_fk
  FOREIGN KEY(company_id, assigned_account_id) REFERENCES memberships(company_id, account_id);
-- A seat cannot be assigned without a designated account.
ALTER TABLE seats
  ADD CONSTRAINT seats_assigned_state_ck
  CHECK ((status IN ('assigned','enrollment_pending','enrolled') AND assigned_account_id IS NOT NULL)
      OR (status IN ('available','canceled')));
CREATE INDEX IF NOT EXISTS seats_company_account_idx
  ON seats(company_id, assigned_account_id)
  WHERE assigned_account_id IS NOT NULL;
