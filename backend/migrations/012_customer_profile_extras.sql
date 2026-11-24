-- Optional customer profile details: gender and preferred sports (preferred location is the existing customer_profiles.city).
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('female','male','other','prefer_not_to_say'));
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS preferred_sports text[] NOT NULL DEFAULT '{}';
-- Case-insensitive uniqueness for email, so two accounts can never differ only by letter case.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));
