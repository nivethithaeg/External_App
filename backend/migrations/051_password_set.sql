-- Accounts created with Google start with a random password nobody knows. password_set turns true once the person chooses their own.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set boolean NOT NULL DEFAULT true;
