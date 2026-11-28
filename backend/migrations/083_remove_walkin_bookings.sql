-- Offline (walk-in) bookings were removed from PlaynX. Delete the ones already made, with what hangs off them.
-- Venue events are also stored with source 'offline' but always have a block_kind, so they are kept.
-- Rows in booking_payments, check-ins and the other child tables go with their booking (ON DELETE CASCADE / SET NULL).
DELETE FROM bookings WHERE source = 'offline' AND block_kind IS NULL;

-- Opponents were only ever added to an owner's customer list by an offline booking.
DELETE FROM owner_customers WHERE source = 'opponent';
