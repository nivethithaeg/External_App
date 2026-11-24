-- The street address of the place a live playing area photo was taken, looked up from its location when the photo was checked.
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS geo_address text;
