-- Photos of one playing area. They live in venue_images, so the existing upload checks, admin approval of new photos
-- and removal rules apply to them too. area_id IS NULL means a photo of the venue itself (gallery and cover).
ALTER TABLE venue_images ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES playing_areas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS venue_images_area_idx ON venue_images (area_id) WHERE area_id IS NOT NULL;
