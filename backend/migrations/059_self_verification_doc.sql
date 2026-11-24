-- The self-verification photo is stored as an owner document, but the table's list of allowed document types never included it,
-- so every photo was refused by the database. Add it.
ALTER TABLE owner_documents DROP CONSTRAINT IF EXISTS owner_documents_doc_type_check;
ALTER TABLE owner_documents ADD CONSTRAINT owner_documents_doc_type_check CHECK (doc_type IN
  ('pan_card','identity_proof','address_proof','business_registration','partnership_deed','incorporation_certificate','authorization_letter','profile_photo','self_verification'));
