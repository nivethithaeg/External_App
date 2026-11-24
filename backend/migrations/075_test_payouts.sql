-- A payout recorded in test mode (no RazorpayX account): marked paid, but no money reached a bank.
ALTER TABLE owner_payouts ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
