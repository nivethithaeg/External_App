-- Tables PlaynX never uses (empty, not read or written anywhere in the app).
--   venue_owner_leads points at companies, so it goes first.
DROP TABLE IF EXISTS venue_owner_leads;
DROP TABLE IF EXISTS venue_discovery_preferences;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS application_errors;
