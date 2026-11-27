-- Sports are listed everywhere in one order: Cricket, Football, Badminton first, then the others by name.
ALTER TABLE sports ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
UPDATE sports SET sort_order = CASE slug WHEN 'cricket' THEN 1 WHEN 'football' THEN 2 WHEN 'badminton' THEN 3 ELSE 100 END;
