-- A second contact number for a venue. Contact numbers can be changed by the owner at any time without approval.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS contact_phone2 text;
