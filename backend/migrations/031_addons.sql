-- Extras a venue rents out with a booking (ball, bibs, floodlights...). Chosen by the customer while booking; the price is added to the total.
CREATE TABLE IF NOT EXISTS venue_addons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  price      numeric(10,2) NOT NULL CHECK (price >= 0),
  max_qty    int NOT NULL DEFAULT 1 CHECK (max_qty BETWEEN 1 AND 50),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_addons_venue_idx ON venue_addons (venue_id) WHERE is_active;
ALTER TABLE venue_addons ENABLE ROW LEVEL SECURITY;

-- what was bought, with the name and price as they were at booking time
CREATE TABLE IF NOT EXISTS booking_addons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id   uuid REFERENCES venue_addons(id) ON DELETE SET NULL,
  name       text NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  qty        int NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS booking_addons_booking_idx ON booking_addons (booking_id);
ALTER TABLE booking_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS addons_total numeric(10,2) NOT NULL DEFAULT 0;
