-- A price rule can now be for one specific day of the week (day_of_week 0 = Sunday ... 6 = Saturday), so every slot of every
-- day can have its own price. NULL keeps the old meaning (any day, narrowed by day_type), so all existing rules work unchanged.
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6);
