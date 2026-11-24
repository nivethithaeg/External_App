-- Who ended a booking: the customer, or the venue / KickOff. Lets us spot customers who cancel again and again.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by text CHECK (cancelled_by IN ('customer','venue'));
