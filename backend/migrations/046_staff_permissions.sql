-- JusGo staff permissions: the owner ticks exactly what each staff login can see and do.
ALTER TABLE venue_staff ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT ARRAY['CHECK_IN','BOOKING_VIEW'];
