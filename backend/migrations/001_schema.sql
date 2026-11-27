-- PlaynX Turf Booking Platform: core schema
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- identity ----------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  phone          text,
  password_hash  text NOT NULL,
  full_name      text NOT NULL,
  role           text NOT NULL CHECK (role IN ('customer','owner','admin')),
  admin_role     text CHECK (admin_role IN ('super_admin','operations','finance','support')),
  email_verified boolean NOT NULL DEFAULT false,
  phone_verified boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_has_admin_role CHECK ((role = 'admin') = (admin_role IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE customer_profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_url text,
  city       text,
  birth_date date,
  lat        double precision,
  lng        double precision
);

CREATE TABLE owner_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name       text NOT NULL,
  gstin               text,
  pan                 text,
  address             text,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  verification_note   text,
  bank_account_name   text,
  bank_account_number text,
  bank_ifsc           text,
  upi_id              text,
  commission_override numeric(5,2) CHECK (commission_override BETWEEN 0 AND 100)
);

CREATE TABLE device_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('email','phone')),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_user_idx ON otp_codes (user_id, channel, created_at DESC);

-- ---------- catalogue ----------
CREATE TABLE sports (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

CREATE TABLE facilities (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE venues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name               text NOT NULL,
  description        text,
  address            text NOT NULL,
  city               text NOT NULL,
  state              text,
  pincode            text,
  lat                double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  contact_phone      text,
  timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
  cancellation_hours int NOT NULL DEFAULT 24 CHECK (cancellation_hours >= 0),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','suspended')),
  rejection_reason   text,
  rating_avg         numeric(3,2) NOT NULL DEFAULT 0,
  rating_count       int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_owner_idx ON venues (owner_id);
CREATE INDEX venues_city_idx ON venues (lower(city)) WHERE status = 'approved';
CREATE INDEX venues_geo_idx ON venues (lat, lng) WHERE status = 'approved';

CREATE TABLE venue_facilities (
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  facility_id int  NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, facility_id)
);

CREATE TABLE venue_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,
  url         text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note        text,
  reviewed_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_documents_venue_idx ON venue_documents (venue_id);

CREATE TABLE venue_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  url        text NOT NULL,
  kind       text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video')),
  is_cover   boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX venue_images_venue_idx ON venue_images (venue_id, sort_order);

CREATE TABLE playing_areas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  surface               text,
  capacity              int,
  slot_minutes          int NOT NULL DEFAULT 60 CHECK (slot_minutes IN (30,60)),
  min_duration_minutes  int NOT NULL DEFAULT 60 CHECK (min_duration_minutes > 0),
  max_duration_minutes  int NOT NULL DEFAULT 180,
  is_active             boolean NOT NULL DEFAULT true,
  CONSTRAINT duration_range CHECK (max_duration_minutes >= min_duration_minutes)
);
CREATE INDEX playing_areas_venue_idx ON playing_areas (venue_id);

CREATE TABLE area_sports (
  area_id  uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  sport_id int  NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  PRIMARY KEY (area_id, sport_id)
);

CREATE TABLE pricing_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id        uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  sport_id       int REFERENCES sports(id) ON DELETE CASCADE,
  day_type       text NOT NULL DEFAULT 'all' CHECK (day_type IN ('all','weekday','weekend')),
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  price_per_hour numeric(10,2) NOT NULL CHECK (price_per_hour >= 0),
  CONSTRAINT pricing_window CHECK (end_time > start_time)
);
CREATE INDEX pricing_rules_area_idx ON pricing_rules (area_id);

CREATE TABLE availability_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id     uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  day_of_week int  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   time NOT NULL,
  close_time  time NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  UNIQUE (area_id, day_of_week),
  CONSTRAINT open_before_close CHECK (close_time > open_time)
);

-- ---------- promotions ----------
CREATE TABLE coupons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,
  description    text,
  discount_type  text NOT NULL CHECK (discount_type IN ('percent','flat')),
  value          numeric(10,2) NOT NULL CHECK (value > 0),
  max_discount   numeric(10,2),
  min_amount     numeric(10,2) NOT NULL DEFAULT 0,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz NOT NULL,
  usage_limit    int,
  used_count     int NOT NULL DEFAULT 0,
  per_user_limit int NOT NULL DEFAULT 1,
  venue_id       uuid REFERENCES venues(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES users(id),
  is_active      boolean NOT NULL DEFAULT true,
  CONSTRAINT percent_max CHECK (discount_type <> 'percent' OR value <= 100)
);
CREATE UNIQUE INDEX coupons_code_uq ON coupons (upper(code));

CREATE TABLE banners (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  image_url  text NOT NULL,
  link_url   text,
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- booking engine ----------
CREATE TABLE slot_locks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id    uuid NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport_id   int  NOT NULL REFERENCES sports(id),
  during     tstzrange NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- two live locks can never overlap on the same area; expired rows are purged before insert
  CONSTRAINT slot_locks_no_overlap EXCLUDE USING gist (area_id WITH =, during WITH &&)
);
CREATE INDEX slot_locks_expiry_idx ON slot_locks (expires_at);

CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL UNIQUE,
  customer_id       uuid REFERENCES users(id) ON DELETE RESTRICT,
  venue_id          uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  area_id           uuid NOT NULL REFERENCES playing_areas(id) ON DELETE RESTRICT,
  sport_id          int  REFERENCES sports(id),
  during            tstzrange NOT NULL,
  status            text NOT NULL CHECK (status IN ('pending','confirmed','completed','cancelled','expired','blocked','no_show')),
  subtotal          numeric(10,2) NOT NULL DEFAULT 0,
  discount          numeric(10,2) NOT NULL DEFAULT 0,
  total             numeric(10,2) NOT NULL DEFAULT 0,
  commission_rate   numeric(5,2) NOT NULL DEFAULT 0,
  commission_amount numeric(10,2) NOT NULL DEFAULT 0,
  owner_amount      numeric(10,2) NOT NULL DEFAULT 0,
  coupon_id         uuid REFERENCES coupons(id),
  notes             text,
  qr_token          text,
  expires_at        timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_required CHECK (status = 'blocked' OR customer_id IS NOT NULL),
  CONSTRAINT positive_range CHECK (NOT isempty(during) AND lower(during) < upper(during)),
  -- THE double-booking guard: no two active bookings/blocks may overlap on one area
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (area_id WITH =, during WITH &&)
    WHERE (status IN ('pending','confirmed','completed','blocked'))
);
CREATE INDEX bookings_customer_idx ON bookings (customer_id, created_at DESC);
CREATE INDEX bookings_venue_idx ON bookings (venue_id, created_at DESC);
CREATE INDEX bookings_pending_expiry_idx ON bookings (expires_at) WHERE status = 'pending';

CREATE TABLE coupon_redemptions (
  coupon_id  uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, booking_id)
);

CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  razorpay_order_id    text NOT NULL UNIQUE,
  razorpay_payment_id  text UNIQUE,
  razorpay_signature   text,
  amount               numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency             text NOT NULL DEFAULT 'INR',
  status               text NOT NULL DEFAULT 'created' CHECK (status IN ('created','captured','failed','refunded','partially_refunded')),
  method               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

CREATE TABLE webhook_events (
  event_id     text PRIMARY KEY,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  amount             numeric(10,2) NOT NULL CHECK (amount > 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  razorpay_refund_id text UNIQUE,
  reason             text,
  requested_by       uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);

-- ---------- engagement ----------
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  owner_reply text,
  is_hidden   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_venue_idx ON reviews (venue_id, created_at DESC);

CREATE TABLE favourites (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  type       text NOT NULL DEFAULT 'general',
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES bookings(id) ON DELETE SET NULL,
  subject     text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);

CREATE TABLE ticket_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);

CREATE TABLE owner_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  reference    text,
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_payouts_owner_idx ON owner_payouts (owner_id, created_at DESC);

CREATE TABLE platform_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
