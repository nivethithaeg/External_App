-- venue_owners / jusgo_admins (and their session tables) were copies of the `users` row that signs in.
-- They are merged into users: the one thing only they had, the owner / admin ID code (VO000123, AD000001), moves to
-- users.account_code. Sign-ins are already recorded in audit_logs, so the copied session tables are not needed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_code varchar(30) UNIQUE;
CREATE SEQUENCE IF NOT EXISTS venue_owner_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS jusgo_admin_code_seq START 1;

DO $$ BEGIN
  IF to_regclass('venue_owners') IS NOT NULL THEN
    UPDATE users u SET account_code = vo.owner_code FROM venue_owners vo WHERE vo.user_id = u.id AND u.account_code IS NULL;
  END IF;
  IF to_regclass('jusgo_admins') IS NOT NULL THEN
    UPDATE users u SET account_code = ja.admin_code FROM jusgo_admins ja WHERE ja.user_id = u.id AND u.account_code IS NULL;
  END IF;
END $$;
-- owners and admins that had no copy yet get their code now
UPDATE users SET account_code = 'VO' || lpad(nextval('venue_owner_code_seq')::text, 6, '0') WHERE role = 'owner' AND account_code IS NULL;
UPDATE users SET account_code = 'AD' || lpad(nextval('jusgo_admin_code_seq')::text, 6, '0') WHERE role = 'admin' AND account_code IS NULL;

DROP TABLE IF EXISTS venue_owner_sessions;
DROP TABLE IF EXISTS jusgo_admin_sessions;
DROP TABLE IF EXISTS venue_owners;
DROP TABLE IF EXISTS jusgo_admins;
