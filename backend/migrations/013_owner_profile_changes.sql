-- Edits to an approved owner's sensitive profile details (business name, GST, PAN, address, bank/UPI) wait here until an admin approves them.
-- owner_profiles keeps the approved values; approval copies the proposed values onto it. History is kept.
CREATE TABLE IF NOT EXISTS owner_profile_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fields       jsonb NOT NULL,                 -- owner_profiles column -> proposed value
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  note         text,                           -- reason, when rejected
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz
);
-- At most one open request per owner: a new edit updates it instead of stacking requests.
CREATE UNIQUE INDEX IF NOT EXISTS owner_profile_changes_one_pending ON owner_profile_changes (owner_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS owner_profile_changes_status_idx ON owner_profile_changes (status, requested_at DESC);
ALTER TABLE owner_profile_changes ENABLE ROW LEVEL SECURITY;
