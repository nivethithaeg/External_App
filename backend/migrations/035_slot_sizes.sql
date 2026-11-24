-- A playing area's slot size can now be 30 minutes, 1, 2, 3, 4 or 5 hours.
ALTER TABLE playing_areas DROP CONSTRAINT IF EXISTS playing_areas_slot_minutes_check;
ALTER TABLE playing_areas ADD CONSTRAINT playing_areas_slot_minutes_check CHECK (slot_minutes IN (30,60,120,180,240,300));
