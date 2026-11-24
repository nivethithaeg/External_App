-- Approval checklist (the checks only a person can do) and reusable rejection reasons.
CREATE TABLE IF NOT EXISTS venue_review_checks (
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  key        text NOT NULL,
  checked_by uuid REFERENCES users(id),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, key)
);
CREATE TABLE IF NOT EXISTS rejection_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  body       text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE venue_review_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejection_templates ENABLE ROW LEVEL SECURITY;
INSERT INTO rejection_templates (label, body) VALUES
  ('Photos unclear', 'The photos are unclear or do not show the playing area. Please upload bright, recent photos of the turf and the entrance.'),
  ('Electricity bill', 'The electricity bill is missing, unreadable or does not match the venue address. Please upload a clear, recent bill.'),
  ('Location mismatch', 'The map location or the live area photo does not match the venue address. Please correct the location and retake the area photo at the venue.'),
  ('Prices or hours missing', 'Please set prices and opening hours for every playing area before sending the venue for approval.');
