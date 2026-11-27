-- "I'm already registered in JusGo": a venue owner brings their JusGo profile and onboarding details to PlaynX
-- through JusGo's customer-link API.

-- One sign-up attempt: PlaynX email code first, then the JusGo approval, then the fetched profile until the owner finishes.
CREATE TABLE IF NOT EXISTS jusgo_link_signups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  owner_code         text,                       -- the JusGo Owner ID the person typed (JGO-XXXXXX); checked against the profile
  access_hash        text NOT NULL,              -- sha256 of the browser's secret for this attempt
  otp_hash           text,
  otp_expires_at     timestamptz,
  otp_sent_at        timestamptz,
  otp_attempts       int NOT NULL DEFAULT 0,
  otp_verified_at    timestamptz,
  request_id         text UNIQUE,                -- JusGo customer-link request id
  request_expires_at timestamptz,
  request_sent_at    timestamptz,
  status             text NOT NULL DEFAULT 'otp_sent'
                     CHECK (status IN ('otp_sent','pending','fetching','fetched','denied','expired','failed','completed','unlinked')),
  failure            text,
  profile_enc        text,                       -- the fetched profile, encrypted; cleared once the account is made
  jusgo_user_id      text,
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jusgo_link_signups_email_idx ON jusgo_link_signups (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS jusgo_link_signups_jusgo_user_idx ON jusgo_link_signups (jusgo_user_id);

-- webhook deliveries already handled (JusGo retries reuse the delivery id)
CREATE TABLE IF NOT EXISTS jusgo_webhook_deliveries (
  delivery_id text PRIMARY KEY,
  event       text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- the PlaynX account linked to a JusGo account, and which onboarding fields came from JusGo (removed if the owner unlinks)
ALTER TABLE users ADD COLUMN IF NOT EXISTS jusgo_user_id text;
CREATE UNIQUE INDEX IF NOT EXISTS users_jusgo_user_id_key ON users (jusgo_user_id) WHERE jusgo_user_id IS NOT NULL;
ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS jusgo_imported text[] NOT NULL DEFAULT '{}';
ALTER TABLE owner_documents ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','jusgo'));

ALTER TABLE jusgo_link_signups ENABLE ROW LEVEL SECURITY;      -- served only through the API
ALTER TABLE jusgo_webhook_deliveries ENABLE ROW LEVEL SECURITY;
