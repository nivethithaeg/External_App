-- Features KickOff does not use, removed with their tables:
--   add-ons (extras sold with a booking): venue_addons, booking_addons
--   Find a Game: open_games, open_game_players
--   split payments (already removed from the app): booking_shares, and payments.share_id that pointed at it
--   phone push notifications: device_tokens (in-app notifications and email stay)
--   unused: company_users, company_user_sessions, reference_guides
DROP TABLE IF EXISTS open_game_players;
DROP TABLE IF EXISTS open_games;
DROP TABLE IF EXISTS booking_addons;
DROP TABLE IF EXISTS venue_addons;
ALTER TABLE payments DROP COLUMN IF EXISTS share_id;
DROP TABLE IF EXISTS booking_shares;
DROP TABLE IF EXISTS device_tokens;
DROP TABLE IF EXISTS company_user_sessions;
DROP TABLE IF EXISTS company_users;
DROP TABLE IF EXISTS reference_guides;
