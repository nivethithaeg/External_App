-- Two-step sign-in for admins with an authenticator app (Google Authenticator and the like).
-- The shared secret is stored encrypted; it only counts as set up once the admin has entered a first code.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret_enc  text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS totp_last_step   bigint,
  ADD COLUMN IF NOT EXISTS mfa_failed_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfa_locked_until timestamptz;
