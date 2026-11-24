-- A second contact number for a turf owner's business. Contact numbers change straight away, without admin approval.
ALTER TABLE owner_profiles ADD COLUMN IF NOT EXISTS alternate_phone text;
