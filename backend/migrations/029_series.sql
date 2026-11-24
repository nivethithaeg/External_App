-- Weekly series: the same slot booked for 2 to 8 weeks in a single payment. Each week is its own booking (so it can be cancelled,
-- reviewed and settled on its own); one of them (the "payer") carries the payment row for the whole series.
CREATE TABLE IF NOT EXISTS booking_series (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weeks       integer NOT NULL CHECK (weeks BETWEEN 2 AND 8),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE booking_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES booking_series(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS series_index integer;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_series_idx ON bookings (series_id, series_index);
