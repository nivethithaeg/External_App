-- Structured business address (state → city dropdowns in the application form).
ALTER TABLE owner_profiles ADD COLUMN business_state text, ADD COLUMN business_city text, ADD COLUMN business_pincode text;
