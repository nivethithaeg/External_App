-- 'ready' = approved by PlaynX but not yet published by the owner. Only 'approved' venues are shown to customers.
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_status_check;
ALTER TABLE venues ADD CONSTRAINT venues_status_check CHECK (status IN ('draft','pending','ready','approved','rejected','suspended'));
