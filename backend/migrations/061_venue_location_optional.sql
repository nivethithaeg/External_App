-- JusGo's Add venue form has no map pin: the location comes from the optional Google Maps link, or from the geo-tagged video recorded at the venue.
-- A venue can therefore exist for a while without coordinates.
ALTER TABLE venues ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE venues ALTER COLUMN lng DROP NOT NULL;
