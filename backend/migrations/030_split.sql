-- Split payment: one booking, several people each paying their own share. The booking is confirmed only when every share is paid.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_split boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS booking_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  amount     numeric(10,2) NOT NULL CHECK (amount > 0),
  payer_id   uuid REFERENCES users(id),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  paid_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_shares_booking_idx ON booking_shares (booking_id);
ALTER TABLE booking_shares ENABLE ROW LEVEL SECURITY;
-- which share a payment is for, who is paying it, and whether it covers every share that is still open ("pay the rest myself")
ALTER TABLE payments ADD COLUMN IF NOT EXISTS share_id uuid REFERENCES booking_shares(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_id uuid REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS covers_all boolean NOT NULL DEFAULT false;
