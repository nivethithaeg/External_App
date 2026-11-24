-- Venues now choose the sports they offer (venue_sports); areas pick from that list. Existing venues start with the sports their areas already use.
INSERT INTO venue_sports (venue_id, sport_id)
SELECT DISTINCT a.venue_id, s.sport_id FROM area_sports s JOIN playing_areas a ON a.id = s.area_id
ON CONFLICT (venue_id, sport_id) DO NOTHING;
