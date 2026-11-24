-- Two more kinds of owner: a One Person Company, and a Trust / Society / Club (common for sports clubs and schools).
ALTER TABLE owner_profiles DROP CONSTRAINT IF EXISTS owner_profiles_business_type_check;
ALTER TABLE owner_profiles ADD CONSTRAINT owner_profiles_business_type_check CHECK (business_type IN ('sole_proprietorship','partnership','private_limited','opc','llp','trust_society'));
