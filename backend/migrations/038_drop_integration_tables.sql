-- Integration tables are not needed: remove them (all were created empty in 037).
ALTER TABLE api_request_logs   DROP COLUMN IF EXISTS project_id;
ALTER TABLE application_errors DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS integration_webhook_events;
DROP TABLE IF EXISTS webhook_endpoints;
DROP TABLE IF EXISTS channel_pricing_rules;
DROP TABLE IF EXISTS integration_price_rules;
DROP TABLE IF EXISTS integration_playing_area_mappings;
DROP TABLE IF EXISTS integration_venue_mappings;
DROP TABLE IF EXISTS integration_venue_access;
DROP TABLE IF EXISTS integration_connections;
DROP TABLE IF EXISTS api_credentials;
DROP TABLE IF EXISTS integration_projects;
