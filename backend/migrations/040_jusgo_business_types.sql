-- Business types as on jusgo.in: Individual, Sole Proprietorship, Partnership / Private Limited Company.
-- The older types stay valid so existing applications keep working.
ALTER TABLE owner_profiles DROP CONSTRAINT IF EXISTS owner_profiles_business_type_check;
ALTER TABLE owner_profiles ADD CONSTRAINT owner_profiles_business_type_check
  CHECK (business_type IN ('individual','sole_proprietorship','partnership_pvt_ltd','partnership','private_limited','opc','llp','trust_society'));
ALTER TABLE owner_profiles
  ADD COLUMN IF NOT EXISTS dob            date,
  ADD COLUMN IF NOT EXISTS business_phone text,
  ADD COLUMN IF NOT EXISTS udyam_number   text,
  ADD COLUMN IF NOT EXISTS other_info     text,
  ADD COLUMN IF NOT EXISTS partners       jsonb NOT NULL DEFAULT '[]'::jsonb;  -- partners / directors: [{name, pan, aadhaarLast4, phone}]
