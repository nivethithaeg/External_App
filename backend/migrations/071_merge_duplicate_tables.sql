-- Duplicate tables merged into the ones the app uses. Each was empty and unused; its data lives in the table named beside it.
--   operating_hours            -> playing_area_hours (+ playing_area_hour_exceptions)
--   availability_blocks        -> bookings (status 'blocked') and weekly_blocks
--   slot_configurations, slot_rules -> playing_areas (slot_minutes, min/max duration, instant_booking)
--   media_assets, venue_media, playing_area_media -> venue_images (venue and playing area photos, videos, 360 photos)
--   notification_preferences   -> users.notification_prefs
DROP TABLE IF EXISTS slot_rules;
DROP TABLE IF EXISTS slot_configurations;
DROP TABLE IF EXISTS venue_media;
DROP TABLE IF EXISTS playing_area_media;
DROP TABLE IF EXISTS media_assets;
DROP TABLE IF EXISTS operating_hours;
DROP TABLE IF EXISTS availability_blocks;
DROP TABLE IF EXISTS notification_preferences;
