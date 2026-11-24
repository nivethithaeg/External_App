-- JusGo "360° venue photo": one panorama per venue, stored beside the other venue images.
ALTER TABLE venue_images DROP CONSTRAINT IF EXISTS venue_images_kind_check;
ALTER TABLE venue_images ADD CONSTRAINT venue_images_kind_check CHECK (kind IN ('image','video','panorama'));
