-- Where a playing area photo was taken, read from the GPS data inside the photo itself, and how far that was from the venue's pinned location.
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS geo_lat double precision;
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS geo_lng double precision;
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS geo_distance_m integer;
