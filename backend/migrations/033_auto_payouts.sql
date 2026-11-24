-- Sending owner payouts through the bank (RazorpayX). A payout that has been handed to the bank is 'processing' until the bank confirms.
ALTER TABLE owner_payouts DROP CONSTRAINT IF EXISTS owner_payouts_status_check;
ALTER TABLE owner_payouts ADD CONSTRAINT owner_payouts_status_check CHECK (status IN ('pending','processing','paid','failed'));
ALTER TABLE owner_payouts ADD COLUMN IF NOT EXISTS gateway_payout_id text;
ALTER TABLE owner_payouts ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE owner_payouts ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS owner_payouts_gateway_uq ON owner_payouts (gateway_payout_id) WHERE gateway_payout_id IS NOT NULL;
-- the bank "fund account" created for an owner the first time they are paid, so it is reused afterwards
ALTER TABLE owner_profiles ADD COLUMN IF NOT EXISTS gateway_fund_account_id text;
