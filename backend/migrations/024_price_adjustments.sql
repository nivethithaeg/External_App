-- Holiday and special-date pricing: for a range of dates, every slot at the venue costs a percentage more (or less) than usual.
CREATE TABLE IF NOT EXISTS price_adjustments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  label      text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  percent    integer NOT NULL CHECK (percent BETWEEN -50 AND 200 AND percent <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_adjustment_dates CHECK (end_date >= start_date AND end_date - start_date <= 30)
);
CREATE INDEX IF NOT EXISTS price_adjustments_venue_idx ON price_adjustments (venue_id, start_date, end_date);
ALTER TABLE price_adjustments ENABLE ROW LEVEL SECURITY;
