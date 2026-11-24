-- A paid booking can be moved once, to another slot of the same area at the same price.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS previous_starts_at timestamptz;
