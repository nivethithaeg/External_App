-- Venue staff: a login that can check players in with their QR pass, and nothing else (no money, no settings).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer','owner','admin','staff'));
CREATE TABLE IF NOT EXISTS venue_staff (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_staff_owner_idx ON venue_staff (owner_id);
ALTER TABLE venue_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES users(id);
