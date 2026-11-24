-- JusGo schema (from JusGo_Complete_Database_Schema PDF): standalone admin and venue-owner account tables
-- plus their session tables. They sit beside the existing users/owner_profiles tables; the app's current
-- login still uses `users`, so nothing here changes existing behaviour.

CREATE TABLE IF NOT EXISTS jusgo_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_code    varchar(30)  NOT NULL UNIQUE,
  first_name    varchar(100) NOT NULL,
  last_name     varchar(100),
  email         varchar(255) NOT NULL UNIQUE,
  mobile        varchar(20)  NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  mfa_enabled   boolean      NOT NULL DEFAULT true,
  status        varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS jusgo_admin_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jusgo_admin_id     uuid         NOT NULL REFERENCES jusgo_admins(id) ON DELETE CASCADE,
  session_token_hash varchar(255) NOT NULL UNIQUE,
  expires_at         timestamptz  NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);
CREATE INDEX IF NOT EXISTS jusgo_admin_sessions_admin_idx ON jusgo_admin_sessions (jusgo_admin_id);

CREATE TABLE IF NOT EXISTS venue_owners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_code      varchar(30)  NOT NULL UNIQUE,
  first_name      varchar(100) NOT NULL,
  last_name       varchar(100),
  email           varchar(255) NOT NULL UNIQUE,
  mobile          varchar(20)  NOT NULL UNIQUE,
  password_hash   varchar(255) NOT NULL,
  email_verified  boolean      NOT NULL DEFAULT false,
  mobile_verified boolean      NOT NULL DEFAULT false,
  status          varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE IF NOT EXISTS venue_owner_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_owner_id     uuid         NOT NULL REFERENCES venue_owners(id) ON DELETE CASCADE,
  session_token_hash varchar(255) NOT NULL UNIQUE,
  expires_at         timestamptz  NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);
CREATE INDEX IF NOT EXISTS venue_owner_sessions_owner_idx ON venue_owner_sessions (venue_owner_id);

-- Deny-by-default RLS, like every other table (the API connects with a privileged role).
ALTER TABLE jusgo_admins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jusgo_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_owners         ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_owner_sessions ENABLE ROW LEVEL SECURITY;
