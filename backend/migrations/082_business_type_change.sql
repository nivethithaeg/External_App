-- An approved venue owner asks to change their business type (and the business details that go with it).
-- The approved details stay live until an admin approves the request. Partners' Aadhaar numbers are kept as the last 4 digits only.
CREATE TABLE IF NOT EXISTS business_change_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  from_type    text,
  to_type      text NOT NULL,
  details      jsonb NOT NULL,
  reason       text,
  review_note  text,
  reviewed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_change_one_pending ON business_change_requests (owner_id) WHERE status = 'pending';
ALTER TABLE business_change_requests ENABLE ROW LEVEL SECURITY;
