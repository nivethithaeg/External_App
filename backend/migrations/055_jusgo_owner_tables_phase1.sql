-- JusGo venue-owner tables, phase 1: tables that did not exist here, with JusGo's names and fields.
--   staff_permission_catalog / staff_permissions   (what each staff login may do; was a text[] on venue_staff)
--   pricing_date_slots                             (slot-wise price for one chosen date)
--   weekly_blocks                                  (a recurring weekly block / a block over a date range)
--   booking_events                                 (history of a booking: created, confirmed, cancelled, notes)

CREATE TABLE IF NOT EXISTS staff_permission_catalog (
  code           text    PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]*$'),
  requires       text[]  NOT NULL DEFAULT '{}',
  is_staff_admin boolean NOT NULL DEFAULT false
);
INSERT INTO staff_permission_catalog (code, requires, is_staff_admin) VALUES
  ('CHECK_IN', '{}', false), ('BOOKING_VIEW', '{}', false), ('BOOKING_CREATE', ARRAY['BOOKING_VIEW'], false), ('DASHBOARD_VIEW', '{}', false),
  ('VENUE_VIEW', '{}', false), ('PLAYING_AREA_VIEW', '{}', false), ('PRICING_VIEW', '{}', false), ('CALENDAR_VIEW', '{}', false), ('REPORTS_VIEW', '{}', false)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE staff_permission_catalog ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS staff_permissions (
  staff_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES staff_permission_catalog(code),
  created_at      timestamptz NOT NULL DEFAULT now(),
  granted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, permission_code)
);
ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;
INSERT INTO staff_permissions (staff_id, permission_code, granted_by)
SELECT s.user_id, p, s.owner_id FROM venue_staff s, unnest(s.permissions) AS p WHERE p IN (SELECT code FROM staff_permission_catalog)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_date_slots (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id uuid          NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  price_date      date          NOT NULL,
  start_time      time          NOT NULL,
  end_time        time          NOT NULL,
  price_per_hour  numeric(12,2) NOT NULL CHECK (price_per_hour > 0 AND price_per_hour <= 100000),
  currency        char(3)       NOT NULL DEFAULT 'INR',
  status          varchar(20)   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REMOVED')),
  created_by      uuid          REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  CONSTRAINT pricing_date_slots_time_order CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS pricing_date_slots_area_date_idx ON pricing_date_slots (playing_area_id, price_date) WHERE status = 'ACTIVE';
ALTER TABLE pricing_date_slots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS weekly_blocks (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id uuid         NOT NULL REFERENCES playing_areas(id) ON DELETE CASCADE,
  days_of_week    smallint[]   NOT NULL CHECK (cardinality(days_of_week) BETWEEN 1 AND 7 AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  start_time      time         NOT NULL,
  end_time        time         NOT NULL,
  reason          varchar(60)  NOT NULL CHECK (char_length(btrim(reason)) >= 2),
  note            varchar(200),
  status          varchar(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  created_by      uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  removed_by      uuid         REFERENCES users(id) ON DELETE SET NULL,
  removed_at      timestamptz,
  valid_from      date,
  valid_until     date,
  event_details   jsonb,
  CONSTRAINT weekly_blocks_order CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS weekly_blocks_area_idx ON weekly_blocks (playing_area_id) WHERE status = 'ACTIVE';
ALTER TABLE weekly_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS booking_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL CHECK (event_type IN ('CREATED', 'CANCELLED', 'CONFIRMED', 'NOTE')),
  actor_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  actor_type varchar(20) NOT NULL DEFAULT 'SYSTEM' CHECK (actor_type IN ('OWNER', 'STAFF', 'ADMIN', 'PARTNER', 'SYSTEM')),
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_events_booking_idx ON booking_events (booking_id, created_at);
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;

-- every booking records its own history, whichever code path creates or changes it
CREATE OR REPLACE FUNCTION booking_events_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO booking_events (booking_id, event_type, data) VALUES (NEW.id, 'CREATED', jsonb_build_object('status', NEW.status, 'source', NEW.source));
    IF NEW.status = 'confirmed' THEN INSERT INTO booking_events (booking_id, event_type, data) VALUES (NEW.id, 'CONFIRMED', '{}'::jsonb); END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' THEN INSERT INTO booking_events (booking_id, event_type, data) VALUES (NEW.id, 'CONFIRMED', jsonb_build_object('from', OLD.status));
    ELSIF NEW.status IN ('cancelled', 'no_show') THEN INSERT INTO booking_events (booking_id, event_type, data) VALUES (NEW.id, 'CANCELLED', jsonb_build_object('from', OLD.status, 'status', NEW.status));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_record_events ON bookings;
CREATE TRIGGER bookings_record_events AFTER INSERT OR UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION booking_events_record();
