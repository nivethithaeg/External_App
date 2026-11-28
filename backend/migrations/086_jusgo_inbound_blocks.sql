-- Bookings made on JusGo (walk-ins, phone, other apps) close the same slot on PlaynX: each one is kept here as a PlaynX block.
CREATE TABLE IF NOT EXISTS jusgo_slot_blocks (
  jusgo_booking_id text PRIMARY KEY,
  booking_id       uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE jusgo_slot_blocks ENABLE ROW LEVEL SECURITY;
