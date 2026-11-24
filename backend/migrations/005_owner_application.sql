-- Venue-owner application: business type, identity, private documents, review history, extra venue fields.
-- The owner *account* status is derived (suspended / rejected / active / contact pending / profile incomplete / verification pending);
-- application_status tracks the review workflow; venues keep their own status.
ALTER TABLE owner_profiles
  ADD COLUMN business_type text CHECK (business_type IN ('sole_proprietorship','partnership','private_limited','llp')),
  ADD COLUMN registration_number text,
  ADD COLUMN representative_name text,
  ADD COLUMN designation text,
  ADD COLUMN identity_type text CHECK (identity_type IN ('aadhaar_masked','passport','voter_id','driving_licence')),
  ADD COLUMN identity_consent_at timestamptz,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN terms_version text,
  ADD COLUMN application_ref text UNIQUE,
  ADD COLUMN application_status text NOT NULL DEFAULT 'incomplete'
    CHECK (application_status IN ('incomplete','submitted','under_review','info_required','resubmission_required','approved','rejected')),
  ADD COLUMN submitted_at timestamptz;

-- Owners created before this migration: keep their effective state.
UPDATE owner_profiles SET application_status = CASE verification_status WHEN 'verified' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'incomplete' END;

CREATE TABLE owner_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type     text NOT NULL CHECK (doc_type IN ('pan_card','identity_proof','address_proof','business_registration','partnership_deed','incorporation_certificate','authorization_letter','profile_photo')),
  storage_key  text NOT NULL,          -- key in the PRIVATE bucket; never exposed to clients
  content_type text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','replaced')),
  note         text,
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_documents_owner_idx ON owner_documents (owner_id, doc_type);

CREATE TABLE application_events (
  id          bigserial PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,           -- submitted, resubmitted, review_started, info_requested, resubmission_requested, approved, rejected, document_reviewed, document_replaced
  from_status text,
  to_status   text,
  note        text,
  items       jsonb NOT NULL DEFAULT '[]',   -- items that need correction: [{type:'document'|'field', key, reason}]
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_events_owner_idx ON application_events (owner_id, created_at DESC);

ALTER TABLE venues
  ADD COLUMN category text,
  ADD COLUMN locality text,
  ADD COLUMN country text NOT NULL DEFAULT 'India',
  ADD COLUMN contact_email text;

ALTER TABLE owner_documents ENABLE ROW LEVEL SECURITY;   -- deny-by-default: documents are served only by the API
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
