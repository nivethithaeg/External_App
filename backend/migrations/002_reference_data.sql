-- Reference data required for the platform to function (not demo data)
INSERT INTO sports (name, slug) VALUES
  ('Football','football'),('Cricket','cricket'),('Badminton','badminton'),
  ('Tennis','tennis'),('Basketball','basketball'),('Volleyball','volleyball'),
  ('Pickleball','pickleball'),('Hockey','hockey')
ON CONFLICT DO NOTHING;

INSERT INTO facilities (name) VALUES
  ('Floodlights'),('Parking'),('Washroom'),('Changing Room'),('Drinking Water'),
  ('Cafeteria'),('First Aid'),('Equipment Rental'),('Seating Area'),('CCTV'),('Wi-Fi')
ON CONFLICT DO NOTHING;

INSERT INTO platform_settings (key, value) VALUES
  ('commission_percent', '10'),
  ('slot_lock_minutes', '10'),
  ('max_advance_booking_days', '60')
ON CONFLICT DO NOTHING;
