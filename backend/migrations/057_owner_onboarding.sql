-- JusGo venue-owner tables, phase 3: owner_profiles becomes JusGo's owner_onboarding (same table, JusGo's field names).
--   user_id -> owner_id          dob -> date_of_birth            address -> address_line1       business_city -> city
--   business_state -> state      business_pincode -> postal_code  country -> country_code        business_type -> account_type
--   pan -> pan_number            application_status -> status     application_ref -> application_reference_number
--   business_phone -> turf_phone representative_name -> legal_full_name   verification_note -> review_note
--   new: account_details (kept in step with the business fields), aadhaar_masked, reviewed_at, reviewed_by, created_at, updated_at
-- Fields JusGo keeps elsewhere (business_name, gstin, bank_*, upi_id, partners ...) stay on this table as they were.
-- `owner_profiles` stays as a view over owner_onboarding with the old field names, so code and reports written against the
-- old names keep working (reads, inserts and updates go straight through to owner_onboarding).

ALTER TABLE owner_profiles RENAME TO owner_onboarding;
ALTER TABLE owner_onboarding RENAME COLUMN user_id TO owner_id;
ALTER TABLE owner_onboarding RENAME COLUMN dob TO date_of_birth;
ALTER TABLE owner_onboarding RENAME COLUMN address TO address_line1;
ALTER TABLE owner_onboarding RENAME COLUMN business_city TO city;
ALTER TABLE owner_onboarding RENAME COLUMN business_state TO state;
ALTER TABLE owner_onboarding RENAME COLUMN business_pincode TO postal_code;
ALTER TABLE owner_onboarding RENAME COLUMN country TO country_code;
ALTER TABLE owner_onboarding RENAME COLUMN business_type TO account_type;
ALTER TABLE owner_onboarding RENAME COLUMN pan TO pan_number;
ALTER TABLE owner_onboarding RENAME COLUMN application_status TO status;
ALTER TABLE owner_onboarding RENAME COLUMN application_ref TO application_reference_number;
ALTER TABLE owner_onboarding RENAME COLUMN business_phone TO turf_phone;
ALTER TABLE owner_onboarding RENAME COLUMN representative_name TO legal_full_name;
ALTER TABLE owner_onboarding RENAME COLUMN verification_note TO review_note;

ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS account_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS aadhaar_masked text;
ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE owner_onboarding ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE owner_onboarding o SET created_at = u.created_at FROM users u WHERE u.id = o.owner_id;

-- account_details: the details that belong to the chosen account type, as one document (kept in step automatically)
CREATE OR REPLACE FUNCTION owner_onboarding_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.account_details := jsonb_strip_nulls(jsonb_build_object(
    'businessName', NEW.business_name, 'gstin', NEW.gstin, 'registrationNumber', NEW.registration_number, 'designation', NEW.designation,
    'udyamNumber', NEW.udyam_number, 'otherInfo', NEW.other_info, 'partners', NEW.partners, 'identityType', NEW.identity_type));
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN NEW.reviewed_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS owner_onboarding_sync_trg ON owner_onboarding;
CREATE TRIGGER owner_onboarding_sync_trg BEFORE INSERT OR UPDATE ON owner_onboarding FOR EACH ROW EXECUTE FUNCTION owner_onboarding_sync();
UPDATE owner_onboarding SET business_name = business_name;

CREATE VIEW owner_profiles AS
  SELECT owner_id AS user_id, business_name, gstin, pan_number AS pan, address_line1 AS address, verification_status, review_note AS verification_note,
         bank_account_name, bank_account_number, bank_ifsc, upi_id, commission_override, bank_verified, account_type AS business_type, registration_number,
         legal_full_name AS representative_name, designation, identity_type, identity_consent_at, terms_accepted_at, terms_version,
         application_reference_number AS application_ref, status AS application_status, submitted_at, business_verified_at, identity_verified_at,
         state AS business_state, city AS business_city, postal_code AS business_pincode, alternate_phone, gateway_fund_account_id,
         date_of_birth AS dob, turf_phone AS business_phone, udyam_number, other_info, partners, address_line2, country_code AS country
    FROM owner_onboarding;
ALTER VIEW owner_profiles SET (security_invoker = true);
