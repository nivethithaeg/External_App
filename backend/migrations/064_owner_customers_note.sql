-- JusGo's Add customer form: a note about the customer ("plays every Sunday morning").
ALTER TABLE owner_customers ADD COLUMN IF NOT EXISTS note text;
