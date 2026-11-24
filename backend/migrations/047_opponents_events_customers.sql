-- JusGo bookings: opponent details, event / academic bookings, and customers the owner adds by hand.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS opponent_name  text,
  ADD COLUMN IF NOT EXISTS opponent_phone text,
  ADD COLUMN IF NOT EXISTS event_kind     text CHECK (event_kind IN ('event','academic')),
  ADD COLUMN IF NOT EXISTS event_title    text;

CREATE TABLE IF NOT EXISTS owner_customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  mobile     text NOT NULL,
  email      text,
  city       text,
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','opponent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, mobile)
);
ALTER TABLE owner_customers ENABLE ROW LEVEL SECURITY;
