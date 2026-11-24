-- The Documents step asks for the Aadhaar card number (kept masked, XXXXXXXX1234); the owner_profiles view now carries it too.
CREATE OR REPLACE VIEW owner_profiles AS
  SELECT owner_id AS user_id, business_name, gstin, pan_number AS pan, address_line1 AS address, verification_status, review_note AS verification_note,
         bank_account_name, bank_account_number, bank_ifsc, upi_id, commission_override, bank_verified, account_type AS business_type, registration_number,
         legal_full_name AS representative_name, designation, identity_type, identity_consent_at, terms_accepted_at, terms_version,
         application_reference_number AS application_ref, status AS application_status, submitted_at, business_verified_at, identity_verified_at,
         state AS business_state, city AS business_city, postal_code AS business_pincode, alternate_phone, gateway_fund_account_id,
         date_of_birth AS dob, turf_phone AS business_phone, udyam_number, other_info, partners, address_line2, country_code AS country,
         aadhaar_masked
    FROM owner_onboarding;
