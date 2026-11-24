import type { Queryable } from '../db.js';
import { distanceMeters } from './geo.js';

export interface ScorePart { key: string; label: string; points: number; max: number; detail: string }
export interface VenueScore { score: number; grade: 'Excellent' | 'Good' | 'Fair' | 'Needs work'; parts: ScorePart[]; tips: string[] }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const grade = (s: number): VenueScore['grade'] => (s >= 85 ? 'Excellent' : s >= 70 ? 'Good' : s >= 50 ? 'Fair' : 'Needs work');

/**
 * A venue's quality score out of 100, with the reasons. The rules are fixed and visible to the owner:
 *   Profile 30: description (6), up to 3 photos (8), contact number (4), up to 3 facilities (4), a live photo for each playing area (8).
 *   Reliability 30: how rarely the venue cancels games in the last 90 days. 0% cancelled is 30; 25% or more is 0. Under 5 games: 24 ("new venue").
 *   Reviews 25: average rating out of 5, scaled to 25. Under 3 reviews: 15.
 *   Complaints 15: lose 5 for each customer complaint about a booking there in the last 90 days.
 */
export async function venueScore(q: Queryable, venueId: string, now: Date): Promise<VenueScore> {
  const v = (await q.query(
    `SELECT v.description, v.contact_phone, v.rating_avg::float8 AS rating_avg, v.rating_count,
            (SELECT count(*)::int FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending) AS photos,
            (SELECT count(*)::int FROM venue_facilities f WHERE f.venue_id=v.id) AS facilities,
            (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=v.id AND a.is_active) AS areas,
            (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=v.id AND a.is_active AND EXISTS (SELECT 1 FROM venue_images i WHERE i.area_id=a.id AND i.geo_lat IS NOT NULL)) AS areas_with_photo,
            (SELECT count(*)::int FROM bookings b WHERE b.venue_id=v.id AND b.source='online' AND b.created_at >= $2::timestamptz - interval '90 days' AND (b.status IN ('confirmed','completed') OR (b.status='cancelled' AND b.cancelled_by='venue'))) AS games,
            (SELECT count(*)::int FROM bookings b WHERE b.venue_id=v.id AND b.source='online' AND b.created_at >= $2::timestamptz - interval '90 days' AND b.status='cancelled' AND b.cancelled_by='venue') AS venue_cancelled,
            (SELECT count(DISTINCT t.id)::int FROM support_tickets t JOIN bookings b ON b.id=t.booking_id WHERE b.venue_id=v.id AND t.user_id=b.customer_id AND t.created_at >= $2::timestamptz - interval '90 days') AS complaints
       FROM venues v WHERE v.id=$1`, [venueId, now.toISOString()])).rows[0];
  const parts: ScorePart[] = []; const tips: string[] = [];
  const desc = (v.description ?? '').trim().length >= 40; const phone = !!(v.contact_phone ?? '').trim();
  const photoPts = Math.round((Math.min(v.photos, 3) / 3) * 8); const facPts = Math.round((Math.min(v.facilities, 3) / 3) * 4);
  const areaPts = v.areas > 0 ? Math.round((v.areas_with_photo / v.areas) * 8) : 0;
  const profile = (desc ? 6 : 0) + photoPts + (phone ? 4 : 0) + facPts + areaPts;
  parts.push({ key: 'profile', label: 'Complete profile', points: profile, max: 30, detail: `${desc ? 'Description added' : 'No description'} · ${v.photos} photo${v.photos === 1 ? '' : 's'} · ${v.facilities} facilit${v.facilities === 1 ? 'y' : 'ies'} · ${v.areas_with_photo} of ${v.areas} areas with a live photo` });
  if (!desc) tips.push('Write a description of at least 40 characters (+6).');
  if (v.photos < 3) tips.push(`Add ${3 - v.photos} more venue photo${3 - v.photos === 1 ? '' : 's'} (+${8 - photoPts}).`);
  if (!phone) tips.push('Add a contact number (+4).');
  if (v.facilities < 3) tips.push('List at least 3 facilities, such as parking or floodlights (+' + (4 - facPts) + ').');
  if (v.areas > v.areas_with_photo) tips.push(`Take a live photo of ${v.areas - v.areas_with_photo} playing area${v.areas - v.areas_with_photo === 1 ? '' : 's'} (+${8 - areaPts}).`);
  const rate = v.games ? v.venue_cancelled / v.games : 0;
  const rel = v.games < 5 ? 24 : Math.round(30 * (1 - clamp(rate * 4, 0, 1)));
  parts.push({ key: 'reliability', label: 'Reliability', points: rel, max: 30, detail: v.games < 5 ? 'New venue: not enough bookings in the last 90 days yet' : `${v.venue_cancelled} of ${v.games} games cancelled by the venue in 90 days` });
  if (v.games >= 5 && rel < 30) tips.push('Avoid cancelling confirmed bookings. Block slots in advance instead (+' + (30 - rel) + ').');
  const rev = v.rating_count < 3 ? 15 : Math.round((25 * v.rating_avg) / 5);
  parts.push({ key: 'reviews', label: 'Player reviews', points: rev, max: 25, detail: v.rating_count < 3 ? 'Fewer than 3 reviews so far' : `${v.rating_avg.toFixed(1)} out of 5 from ${v.rating_count} reviews` });
  if (v.rating_count >= 3 && rev < 25) tips.push('Reply to reviews and fix what players mention to raise your rating.');
  const cmp = Math.max(0, 15 - 5 * v.complaints);
  parts.push({ key: 'complaints', label: 'Complaints', points: cmp, max: 15, detail: v.complaints ? `${v.complaints} customer complaint${v.complaints === 1 ? '' : 's'} in the last 90 days` : 'No complaints in the last 90 days' });
  if (v.complaints) tips.push('Resolve open complaints quickly; each one costs 5 points for 90 days.');
  const score = clamp(parts.reduce((n, p) => n + p.points, 0), 0, 100);
  return { score, grade: grade(score), parts, tips };
}

export interface CheckItem { id: string; label: string; ok: boolean; detail: string; required: boolean }
export const MANUAL_CHECKS = [
  { id: 'photos_match', label: 'The photos show the real venue (not stock images)' },
  { id: 'docs_legible', label: 'The documents are readable and match the owner and address' }] as const;

/** What an admin should look at before approving: facts we can check by machine, and the two judgements only a person can make. */
export async function reviewChecklist(q: Queryable, venueId: string, opts: { requireGeotag: boolean; maxPhotoMeters: number }) {
  const v = (await q.query(
    `SELECT v.lat, v.lng, v.address, v.city, v.state, v.description, v.contact_phone, v.cancellation_hours, op.verification_status, op.bank_account_number,
            (SELECT count(*)::int FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending) AS photos,
            (SELECT count(*)::int FROM venue_documents d WHERE d.venue_id=v.id AND d.doc_type='Electricity bill' AND d.status <> 'rejected') AS bill,
            (SELECT count(*)::int FROM venue_documents d WHERE d.venue_id=v.id AND d.status='pending') AS pending_docs,
            (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=v.id AND a.is_active) AS areas,
            (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=v.id AND a.is_active AND EXISTS (SELECT 1 FROM playing_area_sports s WHERE s.playing_area_id=a.id) AND EXISTS (SELECT 1 FROM pricing_rules p WHERE p.area_id=a.id) AND EXISTS (SELECT 1 FROM playing_area_hours r WHERE r.playing_area_id=a.id AND NOT r.is_closed)) AS areas_ready,
            (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=v.id AND a.is_active AND NOT EXISTS (SELECT 1 FROM venue_images i WHERE i.area_id=a.id AND i.geo_lat IS NOT NULL)) AS areas_no_photo
       FROM venues v JOIN owner_profiles op ON op.user_id=v.owner_id WHERE v.id=$1`, [venueId])).rows[0];
  const far = (await q.query(`SELECT i.geo_lat, i.geo_lng FROM venue_images i JOIN playing_areas a ON a.id=i.area_id WHERE a.venue_id=$1 AND i.geo_lat IS NOT NULL`, [venueId])).rows
    .filter((i: any) => distanceMeters({ lat: Number(v.lat), lng: Number(v.lng) }, { lat: Number(i.geo_lat), lng: Number(i.geo_lng) }) > Math.max(1000, opts.maxPhotoMeters * 2)).length;
  const it = (id: string, label: string, ok: boolean, detail: string, required = true): CheckItem => ({ id, label, ok, detail, required });
  const auto: CheckItem[] = [
    it('owner_verified', 'Owner identity verified', v.verification_status === 'verified', `Owner is ${v.verification_status}`),
    it('location', 'Address and map location set', !!(v.address && v.city && v.state && v.lat != null && v.lng != null), v.state ? `${v.address}, ${v.city}, ${v.state}` : 'State is missing'),
    it('photos', 'At least one venue photo', v.photos >= 1, `${v.photos} photo${v.photos === 1 ? '' : 's'} (3 or more is best)`),
    it('bill', 'Electricity bill uploaded', v.bill >= 1, v.bill ? 'Uploaded' : 'Missing'),
    it('areas', 'Every playing area has sports, prices and hours', v.areas > 0 && v.areas_ready === v.areas, `${v.areas_ready} of ${v.areas} areas ready`),
    it('area_photos', 'Live photo of each playing area', v.areas > 0 && v.areas_no_photo === 0, v.areas_no_photo ? `${v.areas_no_photo} area${v.areas_no_photo === 1 ? '' : 's'} without a located photo` : 'All areas have one', opts.requireGeotag),
    it('photos_near', 'Area photos were taken at the venue', far === 0, far ? `${far} photo${far === 1 ? '' : 's'} taken far from the venue pin` : 'All near the venue'),
    it('bank', 'Bank account added', !!v.bank_account_number, v.bank_account_number ? 'Added' : 'Missing', false),
    it('description', 'Description of 40+ characters', (v.description ?? '').trim().length >= 40, 'Helps players choose', false),
    it('contact', 'Contact number', !!(v.contact_phone ?? '').trim(), v.contact_phone ? 'Added' : 'Missing', false),
    it('docs_reviewed', 'No documents left unreviewed', v.pending_docs === 0, v.pending_docs ? `${v.pending_docs} waiting for review` : 'All reviewed', false)];
  const checked = (await q.query('SELECT c.key, c.checked_at, u.full_name FROM venue_review_checks c LEFT JOIN users u ON u.id=c.checked_by WHERE c.venue_id=$1', [venueId])).rows;
  const manual = MANUAL_CHECKS.map((m) => { const c = checked.find((x: any) => x.key === m.id); return { id: m.id, label: m.label, checked: !!c, by: c?.full_name ?? null, at: c?.checked_at ?? null }; });
  const blocking = auto.filter((a) => a.required && !a.ok).length + manual.filter((m) => !m.checked).length;
  return { auto, manual, ready: blocking === 0, blocking };
}
