-- Booking sync for partner apps (JusGo): the partner reads an owner's venues and bookings from /api/playnx/* with that owner's API key.

-- One key per owner. Only a SHA-256 hash is kept; the key itself is shown to the owner once, when it is made.
CREATE TABLE IF NOT EXISTS owner_sync_keys (
  owner_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
ALTER TABLE owner_sync_keys ENABLE ROW LEVEL SECURITY;

-- When a booking last changed, so a partner can ask for "what changed since".
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sync_updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS bookings_sync_updated_idx ON bookings (venue_id, sync_updated_at);
CREATE OR REPLACE FUNCTION bookings_touch_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sync_updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_touch_sync ON bookings;
CREATE TRIGGER bookings_touch_sync BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_touch_sync();

-- A booking or block that is deleted outright (a block opened again) must still reach the partner, as cancelled.
CREATE TABLE IF NOT EXISTS booking_sync_removed (
  booking_id uuid PRIMARY KEY,
  venue_id   uuid NOT NULL,
  area_id    uuid NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_sync_removed_idx ON booking_sync_removed (venue_id, removed_at);
ALTER TABLE booking_sync_removed ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION bookings_record_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO booking_sync_removed (booking_id, venue_id, area_id, starts_at, ends_at)
  VALUES (OLD.id, OLD.venue_id, OLD.area_id, lower(OLD.during), upper(OLD.during))
  ON CONFLICT (booking_id) DO UPDATE SET removed_at = now();
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS bookings_record_removed ON bookings;
CREATE TRIGGER bookings_record_removed AFTER DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_record_removed();
