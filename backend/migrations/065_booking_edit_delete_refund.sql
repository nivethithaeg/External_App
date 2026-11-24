-- JusGo's booking actions for a booking the owner made: edit it, delete it (and restore it), and record the refund given on a cancelled one.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_by    uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delete_reason text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prev_status   text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_mode   text CHECK (refund_mode IN ('online', 'offline'));
