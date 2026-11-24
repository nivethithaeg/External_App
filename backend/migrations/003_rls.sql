-- Row Level Security.
-- The Express API connects with a privileged role (service connection) that bypasses RLS and
-- enforces authorisation itself. RLS protects every table from direct access through Supabase's
-- public PostgREST/anon/authenticated keys: deny by default, with minimal read policies.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','customer_profiles','owner_profiles','device_tokens','otp_codes','sports','facilities',
    'venues','venue_facilities','venue_documents','venue_images','playing_areas','area_sports',
    'pricing_rules','availability_rules','coupons','banners','slot_locks','bookings',
    'coupon_redemptions','payments','webhook_events','refunds','reviews','favourites',
    'notifications','support_tickets','ticket_messages','owner_payouts','platform_settings','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Policies reference Supabase's auth.uid(); only create them where that schema exists
-- (plain Postgres / test databases simply stay deny-by-default).
DO $$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    RAISE NOTICE 'auth schema not found: skipping policy creation (deny-by-default RLS only)';
    RETURN;
  END IF;

  -- public catalogue
  CREATE POLICY sports_read ON sports FOR SELECT USING (true);
  CREATE POLICY facilities_read ON facilities FOR SELECT USING (true);
  CREATE POLICY venues_read ON venues FOR SELECT USING (status = 'approved' OR owner_id = auth.uid());
  CREATE POLICY venue_images_read ON venue_images FOR SELECT USING (
    EXISTS (SELECT 1 FROM venues v WHERE v.id = venue_id AND (v.status = 'approved' OR v.owner_id = auth.uid())));
  CREATE POLICY areas_read ON playing_areas FOR SELECT USING (
    EXISTS (SELECT 1 FROM venues v WHERE v.id = venue_id AND (v.status = 'approved' OR v.owner_id = auth.uid())));
  CREATE POLICY banners_read ON banners FOR SELECT USING (is_active);
  CREATE POLICY reviews_read ON reviews FOR SELECT USING (NOT is_hidden);

  -- own data
  CREATE POLICY users_self ON users FOR SELECT USING (id = auth.uid());
  CREATE POLICY cust_profile_self ON customer_profiles FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  CREATE POLICY owner_profile_self ON owner_profiles FOR SELECT USING (user_id = auth.uid());
  CREATE POLICY bookings_self ON bookings FOR SELECT USING (
    customer_id = auth.uid() OR EXISTS (SELECT 1 FROM venues v WHERE v.id = venue_id AND v.owner_id = auth.uid()));
  CREATE POLICY payments_self ON payments FOR SELECT USING (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));
  CREATE POLICY refunds_self ON refunds FOR SELECT USING (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));
  CREATE POLICY favourites_self ON favourites FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  CREATE POLICY notifications_self ON notifications FOR SELECT USING (user_id = auth.uid());
  CREATE POLICY tickets_self ON support_tickets FOR SELECT USING (user_id = auth.uid());
  CREATE POLICY payouts_self ON owner_payouts FOR SELECT USING (owner_id = auth.uid());
END $$;
