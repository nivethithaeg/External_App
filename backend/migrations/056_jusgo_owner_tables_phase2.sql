-- JusGo venue-owner tables, phase 2: our existing owner tables take JusGo's names and field names.
--   area_sports               -> playing_area_sports            (area_id -> playing_area_id)
--   availability_rules        -> playing_area_hours             (area_id -> playing_area_id)
--   operating_hour_exceptions -> playing_area_hour_exceptions   (is_closed -> closed, playing_area_id)
--   venue_staff               -> owner_staff                    (user_id -> staff_id; permissions now live in staff_permissions)
--   owner_profile_changes     -> owner_profile_change_requests  (fields -> changes, note -> review_note, requested_at -> created_at)
--   venue_changes             -> listing_change_requests
--   owner_customers           + created_by, hidden_at

ALTER TABLE area_sports RENAME TO playing_area_sports;
ALTER TABLE playing_area_sports RENAME COLUMN area_id TO playing_area_id;
ALTER TABLE playing_area_sports ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE availability_rules RENAME TO playing_area_hours;
ALTER TABLE playing_area_hours RENAME COLUMN area_id TO playing_area_id;
ALTER TABLE playing_area_hours ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE operating_hour_exceptions RENAME TO playing_area_hour_exceptions;
ALTER TABLE playing_area_hour_exceptions RENAME COLUMN is_closed TO closed;
ALTER TABLE playing_area_hour_exceptions ADD COLUMN IF NOT EXISTS playing_area_id uuid REFERENCES playing_areas(id) ON DELETE CASCADE;
ALTER TABLE playing_area_hour_exceptions ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE venue_staff RENAME TO owner_staff;
ALTER TABLE owner_staff RENAME COLUMN user_id TO staff_id;
ALTER TABLE owner_staff ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE owner_staff ADD COLUMN IF NOT EXISTS all_venues boolean NOT NULL DEFAULT true;
ALTER TABLE owner_staff ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE owner_staff ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE owner_staff ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
UPDATE owner_staff SET created_by = owner_id WHERE created_by IS NULL;
ALTER TABLE owner_staff DROP COLUMN IF EXISTS permissions; -- copied into staff_permissions by 055

ALTER TABLE owner_profile_changes RENAME TO owner_profile_change_requests;
ALTER TABLE owner_profile_change_requests RENAME COLUMN fields TO changes;
ALTER TABLE owner_profile_change_requests RENAME COLUMN note TO review_note;
ALTER TABLE owner_profile_change_requests RENAME COLUMN requested_at TO created_at;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS previous jsonb;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS document_bucket text;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS document_path text;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS document_name text;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS document_mime text;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS document_size integer;
ALTER TABLE owner_profile_change_requests ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE venue_changes RENAME TO listing_change_requests;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'VENUE';
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES playing_areas(id) ON DELETE CASCADE;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS changes jsonb;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE listing_change_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
UPDATE listing_change_requests l SET owner_id = v.owner_id, requested_by = v.owner_id FROM venues v WHERE v.id = l.venue_id AND l.owner_id IS NULL;

ALTER TABLE owner_customers ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE owner_customers ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
UPDATE owner_customers SET created_by = owner_id WHERE created_by IS NULL;
