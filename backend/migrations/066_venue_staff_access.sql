-- JusGo's venue_staff: the venues a staff login may work in (used when the owner's staff is not given "All venues").
CREATE TABLE IF NOT EXISTS venue_staff (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  staff_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, staff_id)
);
CREATE INDEX IF NOT EXISTS venue_staff_staff_idx ON venue_staff (staff_id);
ALTER TABLE venue_staff ENABLE ROW LEVEL SECURITY;
