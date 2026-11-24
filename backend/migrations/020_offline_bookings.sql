-- Offline (walk-in) bookings: an owner books a slot for someone who is not using the app. There is no customer account and no online
-- payment, so the customer's details are kept on the booking itself, and KickOff takes no commission and owes the owner nothing for it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'online' CHECK (source IN ('online','offline'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS walkin_name text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS walkin_phone text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS walkin_email text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('cash','upi','card','unpaid'));
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS customer_required;
ALTER TABLE bookings ADD CONSTRAINT customer_required CHECK (status = 'blocked' OR source = 'offline' OR customer_id IS NOT NULL);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS offline_has_name;
ALTER TABLE bookings ADD CONSTRAINT offline_has_name CHECK (source <> 'offline' OR (walkin_name IS NOT NULL AND walkin_phone IS NOT NULL));
CREATE INDEX IF NOT EXISTS bookings_offline_idx ON bookings (venue_id, created_at DESC) WHERE source = 'offline';
