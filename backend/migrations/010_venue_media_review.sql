-- Photos and videos added to (or removed from) an approved venue wait for admin approval.
-- is_pending: uploaded, not shown to customers yet. delete_requested: still shown until the removal is approved.
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS is_pending boolean NOT NULL DEFAULT false;
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS delete_requested boolean NOT NULL DEFAULT false;
