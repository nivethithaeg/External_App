-- JusGo owner portal extras: reference videos/guides managed by admins.
CREATE TABLE IF NOT EXISTS reference_guides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  kind        text NOT NULL DEFAULT 'guide' CHECK (kind IN ('video','guide')),
  url         text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reference_guides ENABLE ROW LEVEL SECURITY;
