-- JusGo's booking form: the customer's city, and Opponent 1 and Opponent 2 (mobile, name, city); payment mode Online or Offline.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS walkin_city text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS opponent1_name text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS opponent1_phone text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS opponent1_city text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS opponent_city text;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check CHECK (payment_method IN ('cash','upi','card','unpaid','online','offline'));
