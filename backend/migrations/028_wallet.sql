-- Wallet credit: refunds the customer chose to keep, goodwill credits from PlaynX, and money returned when a booking was not completed.
-- Each credit is a "lot" that expires after 12 months and is spent soonest-expiry first. Wallet money is never paid out as cash.
CREATE TABLE IF NOT EXISTS wallet_lots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     numeric(10,2) NOT NULL CHECK (amount > 0),
  remaining  numeric(10,2) NOT NULL CHECK (remaining >= 0),
  source     text NOT NULL CHECK (source IN ('refund','admin','release')),
  note       text,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_lots_user_idx ON wallet_lots (user_id, expires_at) WHERE remaining > 0;
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      numeric(10,2) NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('refund','admin_credit','admin_debit','booking_payment','booking_release')),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  note       text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON wallet_ledger (user_id, created_at DESC);
ALTER TABLE wallet_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
-- how much of a booking was paid from the wallet, and whether that was handed back because the booking never completed
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS wallet_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (wallet_amount >= 0);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS wallet_released boolean NOT NULL DEFAULT false;
