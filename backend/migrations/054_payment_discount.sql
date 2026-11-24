-- Record payment: an owner can give a walk-in customer a discount. It lowers what is pending but is never money received.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_discount numeric(10,2) NOT NULL DEFAULT 0 CHECK (payment_discount >= 0);
ALTER TABLE booking_payments ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0);
ALTER TABLE booking_payments ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE booking_payments DROP CONSTRAINT IF EXISTS booking_payments_amount_check;
