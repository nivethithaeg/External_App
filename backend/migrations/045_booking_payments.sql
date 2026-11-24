-- Offline (walk-in) bookings can be paid in parts. amount_paid is what the venue has collected so far.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2);
UPDATE bookings SET amount_paid = CASE WHEN payment_method = 'unpaid' THEN 0 ELSE total END WHERE source = 'offline' AND amount_paid IS NULL;

CREATE TABLE IF NOT EXISTS booking_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  mode        text NOT NULL CHECK (mode IN ('cash','upi','card','online','offline')),
  note        text,
  recorded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_payments_booking_idx ON booking_payments (booking_id);
ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
INSERT INTO booking_payments (booking_id, amount, mode, note)
SELECT id, amount_paid, CASE WHEN payment_method IN ('cash','upi','card') THEN payment_method ELSE 'offline' END, 'Recorded when the booking was made'
FROM bookings WHERE source = 'offline' AND amount_paid > 0;
