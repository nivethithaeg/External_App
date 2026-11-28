-- A playing area created on JusGo is created on PlaynX too; this remembers which JusGo court each such PlaynX playing area is, so bookings
-- and changes for it land there even before JusGo pairs the court with our id.
CREATE TABLE IF NOT EXISTS jusgo_area_links (
  jusgo_court_id text PRIMARY KEY,
  area_id        uuid NOT NULL UNIQUE REFERENCES playing_areas(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE jusgo_area_links ENABLE ROW LEVEL SECURITY;
