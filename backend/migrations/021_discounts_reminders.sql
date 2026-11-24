-- A venue-wide discount the owner sets (applied to every booking at that venue, before any coupon),
-- the discount a booking actually got from it, and flags so each game reminder is sent only once.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS venue_discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_24h_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_2h_at timestamptz;
