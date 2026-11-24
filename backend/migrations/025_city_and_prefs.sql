-- Banners can be shown only in one city (NULL = everywhere), and people can turn off email/push alerts by category (in-app alerts stay on).
ALTER TABLE banners ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}';
