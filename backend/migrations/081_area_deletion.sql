-- Deleting a playing area needs admin approval. The area is never removed from the database: its bookings stay.
-- pending: the owner asked; it is greyed out and closed for booking. deleted: approved; it stays closed and greyed out.
ALTER TABLE playing_areas
  ADD COLUMN IF NOT EXISTS deletion_status       text CHECK (deletion_status IN ('pending','deleted')),
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason       text,
  ADD COLUMN IF NOT EXISTS deletion_note         text,   -- the admin's reason when a request is turned down
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS active_before_delete  boolean;
