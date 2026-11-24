-- JusGo playing-area details: indoor / outdoor, roof type, and a per-area advance booking limit (days).
ALTER TABLE playing_areas
  ADD COLUMN IF NOT EXISTS environment          text CHECK (environment IN ('indoor','outdoor')),
  ADD COLUMN IF NOT EXISTS roof_type            text CHECK (roof_type IN ('open','covered','retractable')),
  ADD COLUMN IF NOT EXISTS advance_booking_days integer CHECK (advance_booking_days BETWEEN 1 AND 365);
