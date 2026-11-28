-- Three more things an owner can let a staff login do: block slots, see the customer list, record payments for venue events.
INSERT INTO staff_permission_catalog (code, requires, is_staff_admin) VALUES
  ('BLOCK_SLOTS', '{}', false), ('CUSTOMER_VIEW', '{}', false), ('PAYMENT_RECORD', '{}', false)
ON CONFLICT (code) DO NOTHING;
