-- Rest of the JusGo schema (PDF), fitted to OUR database:
--  * tables whose names already exist here are NOT recreated and keep their current shape:
--    venues, playing_areas, sports, pricing_rules, notifications, audit_logs, webhook_events
--    (the PDF's playing_area_sports is our existing area_sports)
--  * the PDF's webhook_events (integration events) is created as integration_webhook_events
--  * references to venue_owners / jusgo_admins point at users(id), because owners and admins log in via `users` here
--  * sports.id is an integer here, so venue_sports.sport_id is integer

-- ---------- sports / media ----------
CREATE TABLE IF NOT EXISTS venue_sports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid    NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  sport_id   integer NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, sport_id)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name  varchar(255) NOT NULL,
  file_type  varchar(100) NOT NULL,
  media_type varchar(30)  NOT NULL DEFAULT 'IMAGE',
  s3_bucket  varchar(255) NOT NULL,
  s3_key     varchar(500) NOT NULL UNIQUE,
  file_size  bigint,
  checksum   varchar(128),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  display_order  integer NOT NULL DEFAULT 0,
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playing_area_media (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  media_asset_id  uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  display_order   integer NOT NULL DEFAULT 0,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- hours / slots / blocks ----------
CREATE TABLE IF NOT EXISTS operating_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   time NOT NULL,
  close_time  time NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operating_hour_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  open_time      time,
  close_time     time,
  is_closed      boolean NOT NULL DEFAULT false,
  reason         varchar(255),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slot_configurations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id             uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  slot_duration_minutes       integer NOT NULL,
  advance_booking_limit_hours integer NOT NULL,
  min_duration_minutes        integer NOT NULL,
  max_duration_minutes        integer NOT NULL,
  buffer_minutes              integer NOT NULL DEFAULT 0,
  instant_booking_enabled     boolean NOT NULL DEFAULT true,
  status                      varchar(30) NOT NULL DEFAULT 'ACTIVE',
  effective_from              timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slot_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_configuration_id uuid NOT NULL REFERENCES slot_configurations(id) ON DELETE CASCADE,
  day_of_week           smallint CHECK (day_of_week BETWEEN 0 AND 6),
  start_time            time NOT NULL,
  end_time              time NOT NULL,
  duration_minutes      integer NOT NULL,
  status                varchar(30) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS availability_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  block_type      varchar(30) NOT NULL DEFAULT 'MAINTENANCE',
  reason          varchar(255),
  status          varchar(30) NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- companies / developer accounts ----------
CREATE TABLE IF NOT EXISTS companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code varchar(30)  NOT NULL UNIQUE,
  company_name varchar(150) NOT NULL UNIQUE,
  email        varchar(255) NOT NULL UNIQUE,
  mobile       varchar(20),
  status       varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  developer_code varchar(30)  NOT NULL UNIQUE,
  first_name     varchar(100) NOT NULL,
  last_name      varchar(100),
  email          varchar(255) NOT NULL UNIQUE,
  mobile         varchar(20),
  password_hash  varchar(255) NOT NULL,
  role           varchar(30)  NOT NULL DEFAULT 'DEVELOPER_USER',  -- DEVELOPER_ADMIN / DEVELOPER_USER
  status         varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS company_user_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_user_id    uuid NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
  session_token_hash varchar(255) NOT NULL UNIQUE,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);

-- ---------- integrations ----------
CREATE TABLE IF NOT EXISTS integration_projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code        varchar(50)  NOT NULL UNIQUE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_name        varchar(150) NOT NULL,
  environment         varchar(20)  NOT NULL DEFAULT 'SANDBOX',
  status              varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  production_approved boolean      NOT NULL DEFAULT false,
  approved_at         timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  client_id        varchar(100) NOT NULL UNIQUE,
  secret_reference varchar(500) NOT NULL,           -- AWS Secrets Manager reference, never the secret itself
  environment      varchar(20)  NOT NULL DEFAULT 'SANDBOX',
  status           varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  expires_at       timestamptz,
  last_used_at     timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  revoked_at       timestamptz
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  venue_owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- owner (users.role = 'owner')
  status               varchar(30) NOT NULL DEFAULT 'PENDING',                 -- PENDING / APPROVED / REVOKED
  requested_at         timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  approved_by_admin_id uuid REFERENCES users(id),                              -- admin (users.role = 'admin')
  revoked_at           timestamptz
);

CREATE TABLE IF NOT EXISTS integration_venue_access (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  venue_id      uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  access_status varchar(30) NOT NULL DEFAULT 'ACTIVE',
  shared_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE TABLE IF NOT EXISTS integration_venue_mappings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  venue_id          uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  external_venue_id varchar(100) NOT NULL,
  mapping_status    varchar(30)  NOT NULL DEFAULT 'MAPPING_REQUIRED',
  mapped_at         timestamptz
);

CREATE TABLE IF NOT EXISTS integration_playing_area_mappings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  playing_area_id          uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  external_playing_area_id varchar(100) NOT NULL,
  mapping_status           varchar(30)  NOT NULL DEFAULT 'MAPPING_REQUIRED',
  mapped_at                timestamptz
);

CREATE TABLE IF NOT EXISTS channel_pricing_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  playing_area_id uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  override_price  numeric(12,2) NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'INR',
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz,
  status          varchar(30) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS integration_price_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  playing_area_id uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  base_price      numeric(12,2) NOT NULL,
  override_price  numeric(12,2) NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'INR',
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz,
  status          varchar(30) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  endpoint_url     varchar(500) NOT NULL,
  secret_reference varchar(500) NOT NULL,
  status           varchar(30)  NOT NULL DEFAULT 'ACTIVE',
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- PDF name: webhook_events (taken here by the payment-gateway events table)
CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES integration_projects(id) ON DELETE CASCADE,
  event_type  varchar(100) NOT NULL,
  entity_type varchar(50)  NOT NULL,
  entity_id   uuid NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id uuid NOT NULL REFERENCES integration_webhook_events(id) ON DELETE CASCADE,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  delivery_status  varchar(30) NOT NULL DEFAULT 'PENDING',
  attempt_count    integer NOT NULL DEFAULT 0,
  http_status_code integer,
  error_message    text,
  delivered_at     timestamptz,
  last_attempt_at  timestamptz
);

-- ---------- logs / notifications ----------
CREATE TABLE IF NOT EXISTS api_request_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid REFERENCES integration_projects(id) ON DELETE SET NULL,
  endpoint         varchar(255) NOT NULL,
  http_method      varchar(10)  NOT NULL,
  request_id       varchar(100) NOT NULL UNIQUE,
  status_code      integer NOT NULL,
  response_time_ms integer,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  varchar(100),
  project_id  uuid REFERENCES integration_projects(id) ON DELETE SET NULL,
  error_code  varchar(100) NOT NULL,
  message     text NOT NULL,
  stack_trace text,
  severity    varchar(20) NOT NULL DEFAULT 'ERROR',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id      uuid NOT NULL,
  recipient_type    varchar(30) NOT NULL,
  notification_type varchar(50) NOT NULL,
  email_enabled     boolean NOT NULL DEFAULT true,
  sms_enabled       boolean NOT NULL DEFAULT true,
  push_enabled      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- plans / owner discovery ----------
CREATE TABLE IF NOT EXISTS subscription_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code     varchar(30)  NOT NULL UNIQUE,
  name          varchar(100) NOT NULL,
  description   text,
  price         numeric(12,2) NOT NULL DEFAULT 0,
  currency      char(3) NOT NULL DEFAULT 'INR',
  billing_cycle varchar(30) NOT NULL DEFAULT 'MONTHLY',
  status        varchar(30) NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id    uuid NOT NULL REFERENCES subscription_plans(id),
  start_at   timestamptz NOT NULL,
  end_at     timestamptz,
  status     varchar(30) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_discovery_preferences (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_owner_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discovery_enabled       boolean NOT NULL DEFAULT false,
  contact_sharing_enabled boolean NOT NULL DEFAULT false,
  approved_at             timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_owner_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES companies(id) ON DELETE SET NULL,
  status            varchar(30) NOT NULL DEFAULT 'NEW',
  contact_shared_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Deny-by-default RLS on every table created here.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venue_sports','media_assets','venue_media','playing_area_media','operating_hours',
    'operating_hour_exceptions','slot_configurations','slot_rules','availability_blocks','companies',
    'company_users','company_user_sessions','integration_projects','api_credentials',
    'integration_connections','integration_venue_access','integration_venue_mappings',
    'integration_playing_area_mappings','channel_pricing_rules','integration_price_rules',
    'webhook_endpoints','integration_webhook_events','webhook_deliveries','api_request_logs',
    'application_errors','notification_preferences','subscription_plans','company_subscriptions',
    'venue_discovery_preferences','venue_owner_leads'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
