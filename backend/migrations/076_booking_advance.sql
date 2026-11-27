-- Advance bookings: when the venue owner takes only an advance, the customer pays that part online when booking and the
-- rest at the venue. advance_amount is what was due online; amount_paid grows when the owner records the rest.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS advance_amount numeric(10,2);
