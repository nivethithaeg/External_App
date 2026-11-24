-- How the venue owner collects a booking's amount: the full amount when booking, or only an advance (a percentage) when booking
-- and the rest at the venue after the game.
ALTER TABLE owner_onboarding
  ADD COLUMN IF NOT EXISTS payment_collection text NOT NULL DEFAULT 'full' CHECK (payment_collection IN ('full', 'advance')),
  ADD COLUMN IF NOT EXISTS advance_percent smallint CHECK (advance_percent BETWEEN 1 AND 99),
  ADD COLUMN IF NOT EXISTS payment_collection_updated_at timestamptz;
ALTER TABLE owner_onboarding DROP CONSTRAINT IF EXISTS owner_payment_collection_advance;
ALTER TABLE owner_onboarding ADD CONSTRAINT owner_payment_collection_advance CHECK (payment_collection = 'full' OR advance_percent IS NOT NULL);
