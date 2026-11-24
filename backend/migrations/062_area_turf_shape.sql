-- JusGo's playing area form: Turf Shape / Ground Shape (round or rectangle), and a roof that is open or closed.
ALTER TABLE playing_areas ADD COLUMN IF NOT EXISTS turf_shape text CHECK (turf_shape IN ('round', 'rectangle'));
ALTER TABLE playing_areas DROP CONSTRAINT IF EXISTS playing_areas_roof_type_check;
ALTER TABLE playing_areas ADD CONSTRAINT playing_areas_roof_type_check CHECK (roof_type IN ('open', 'closed', 'covered', 'retractable'));
