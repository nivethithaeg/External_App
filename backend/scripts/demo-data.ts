import bcrypt from 'bcryptjs';
import type { Db } from '../src/db.js';

/**
 * OPTIONAL development data so the UI has something to show: one verified owner, two approved venues with
 * areas, pricing and opening hours, and one admin. Never run automatically in production.
 * Logins: admin@playnx.local / owner@playnx.local (password from DEMO_PASSWORD, default shown in the console).
 */
export async function seedDemo(db: Db, password = 'PlaynX@12345') {
  const exists = await db.query(`SELECT 1 FROM users WHERE email='owner@playnx.local'`);
  if (exists.rows[0]) return false;
  const hash = await bcrypt.hash(password, 10);
  await db.query(`INSERT INTO users (email, password_hash, full_name, role, admin_role, email_verified) VALUES ('admin@playnx.local',$1,'Platform Admin','admin','super_admin',true)`, [hash]);
  const owner = (await db.query(`INSERT INTO users (email, password_hash, full_name, role, email_verified, phone) VALUES ('owner@playnx.local',$1,'Arjun Mehta','owner',true,'+919800000001') RETURNING id`, [hash])).rows[0];
  await db.query(`INSERT INTO owner_profiles (user_id, business_name, verification_status) VALUES ($1,'Mehta Sports Ventures','verified')`, [owner.id]);
  const sports = Object.fromEntries((await db.query('SELECT id, slug FROM sports')).rows.map((s: any) => [s.slug, s.id]));
  const facilities = (await db.query('SELECT id FROM facilities')).rows.map((f: any) => f.id);

  const venues = [
    { name: 'Green Arena', city: 'Bengaluru', address: '12 Park Road, Indiranagar', lat: 12.9784, lng: 77.6408, areas: [['Turf A (7-a-side)', ['football', 'cricket'], 900, 1400], ['Turf B (5-a-side)', ['football'], 700, 1100]] },
    { name: 'Smash Point Badminton Club', city: 'Bengaluru', address: '44 Lake View Layout, HSR', lat: 12.9116, lng: 77.6474, areas: [['Court 1', ['badminton'], 350, 500], ['Court 2', ['badminton'], 350, 500]] },
  ] as const;
  for (const v of venues) {
    const vid = (await db.query(
      `INSERT INTO venues (owner_id, name, description, address, city, state, lat, lng, status, contact_phone, cancellation_hours)
       VALUES ($1,$2,$3,$4,$5,'Karnataka',$6,$7,'approved','+919800000001',12) RETURNING id`,
      [owner.id, v.name, `${v.name}: well-maintained surface, floodlit evenings and friendly staff.`, v.address, v.city, v.lat, v.lng])).rows[0].id;
    for (const f of facilities.slice(0, 6)) await db.query('INSERT INTO venue_facilities VALUES ($1,$2)', [vid, f]);
    for (const [name, sp, day, eve] of v.areas) {
      const aid = (await db.query(`INSERT INTO playing_areas (venue_id, name, slot_minutes, min_duration_minutes, max_duration_minutes, capacity) VALUES ($1,$2,60,60,180,14) RETURNING id`, [vid, name])).rows[0].id;
      for (const s of sp) await db.query('INSERT INTO area_sports VALUES ($1,$2)', [aid, sports[s]]);
      await db.query(`INSERT INTO pricing_rules (area_id, day_type, start_time, end_time, price_per_hour) VALUES ($1,'all','06:00','18:00',$2),($1,'all','18:00','23:00',$3)`, [aid, day, eve]);
      for (let d = 0; d < 7; d++) await db.query(`INSERT INTO availability_rules (area_id, day_of_week, open_time, close_time) VALUES ($1,$2,'06:00','23:00')`, [aid, d]);
    }
  }
  return true;
}
