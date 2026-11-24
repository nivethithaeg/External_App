-- Owner portal: session invalidation, bank verification, maintenance vs. blocked slots
ALTER TABLE users ADD COLUMN token_version int NOT NULL DEFAULT 0;
ALTER TABLE owner_profiles ADD COLUMN bank_verified boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN block_kind text CHECK (block_kind IN ('blocked','maintenance'));
UPDATE bookings SET block_kind = 'blocked' WHERE status = 'blocked';
ALTER TABLE bookings ADD CONSTRAINT block_kind_only_for_blocks CHECK (status = 'blocked' OR block_kind IS NULL);
