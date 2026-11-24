-- JusGo admin portal: sports that can be switched off, and admin approval of new playing areas.
ALTER TABLE sports ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE playing_areas
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending','rejected')),
  ADD COLUMN IF NOT EXISTS approval_note   text;
