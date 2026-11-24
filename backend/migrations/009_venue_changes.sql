-- Edits to a venue that KickOff has already approved wait here until an admin approves them.
-- Customers keep seeing the venues row (the approved version); approval copies these values onto it.
CREATE TABLE IF NOT EXISTS venue_changes (
  venue_id     uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  fields       jsonb NOT NULL DEFAULT '{}',   -- column name -> proposed value
  facility_ids integer[],                      -- proposed facilities, or NULL when unchanged
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE venue_changes ENABLE ROW LEVEL SECURITY;
