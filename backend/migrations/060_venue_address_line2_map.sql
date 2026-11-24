-- JusGo's Add venue form: Address line 2 and the Google Maps link of the venue (both optional).
ALTER TABLE venues ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS map_url text;
