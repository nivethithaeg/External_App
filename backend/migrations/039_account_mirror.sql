-- venue_owners / jusgo_admins mirror the owner and admin logins that live in `users`.
-- The app still signs in through `users`; these tables carry the JusGo-style account record (codes, first/last name,
-- verification flags, last login) and are kept in sync by the API.
ALTER TABLE venue_owners  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE jusgo_admins  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE venue_owners  ALTER COLUMN mobile DROP NOT NULL;
ALTER TABLE jusgo_admins  ALTER COLUMN mobile DROP NOT NULL;

CREATE SEQUENCE IF NOT EXISTS venue_owner_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS jusgo_admin_code_seq START 1;

-- Backfill the accounts that already exist.
INSERT INTO venue_owners (user_id, owner_code, first_name, last_name, email, mobile, password_hash, email_verified, mobile_verified, status, created_at)
SELECT u.id, 'VO' || lpad(nextval('venue_owner_code_seq')::text, 6, '0'),
       split_part(btrim(u.full_name), ' ', 1), NULLIF(btrim(substr(btrim(u.full_name), length(split_part(btrim(u.full_name), ' ', 1)) + 1)), ''),
       lower(u.email), u.phone, u.password_hash, u.email_verified, u.phone_verified,
       CASE WHEN u.is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END, u.created_at
FROM users u WHERE u.role = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO jusgo_admins (user_id, admin_code, first_name, last_name, email, mobile, password_hash, mfa_enabled, status, created_at)
SELECT u.id, 'AD' || lpad(nextval('jusgo_admin_code_seq')::text, 6, '0'),
       split_part(btrim(u.full_name), ' ', 1), NULLIF(btrim(substr(btrim(u.full_name), length(split_part(btrim(u.full_name), ' ', 1)) + 1)), ''),
       lower(u.email), u.phone, u.password_hash, false,
       CASE WHEN u.is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END, u.created_at
FROM users u WHERE u.role = 'admin'
ON CONFLICT DO NOTHING;
