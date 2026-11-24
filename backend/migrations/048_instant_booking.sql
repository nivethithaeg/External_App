-- JusGo slot settings: instant booking. When off, customers cannot pay online for this area; they contact the venue and the owner books for them.
ALTER TABLE playing_areas ADD COLUMN IF NOT EXISTS instant_booking boolean NOT NULL DEFAULT true;
