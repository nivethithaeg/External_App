-- Business and identity sections of an owner application are verified separately by the reviewer.
ALTER TABLE owner_profiles ADD COLUMN business_verified_at timestamptz, ADD COLUMN identity_verified_at timestamptz;
