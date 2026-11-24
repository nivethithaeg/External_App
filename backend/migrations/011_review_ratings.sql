-- Optional category ratings on a review (the overall rating stays in reviews.rating).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ground_rating      int CHECK (ground_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS cleanliness_rating int CHECK (cleanliness_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS facilities_rating  int CHECK (facilities_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS staff_rating       int CHECK (staff_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at         timestamptz;
