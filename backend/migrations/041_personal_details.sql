-- JusGo "Personal details": second address line and country (date of birth, phone and photo already exist).
ALTER TABLE owner_profiles
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS country       text NOT NULL DEFAULT 'India';
