import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, del, get, post, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { FileLink } from '../../components/FileLink';
import { StateCityFields } from '../../components/StateCity';
import { coordsFromMapUrl, GOOGLE_MAPS_LINK } from '../../lib/mapLink';
import { GeoVideoCapture, type GeoVideo } from '../../components/GeoVideoCapture';
import { categoryOptions } from '../../lib/venueCategories';
import { cx } from '../../lib/utils';
import { isIndianMobile, MOBILE_MESSAGE } from '../../lib/phone';

type Step = { key: string; label: string; state: 'todo' | 'doing' | 'done' | 'failed'; error?: string };
const STAR = "after:ml-1 after:font-bold after:text-danger after:content-['*']";
const IMAGE = ['image/jpeg', 'image/png', 'image/webp'], VIDEO = ['video/mp4', 'video/webm'], DOC = ['image/jpeg', 'image/png', 'application/pdf'];
const GOOGLE_MAPS = GOOGLE_MAPS_LINK;
const hhmm = (t?: string) => (t ?? '').slice(0, 5);

/** Same limits the server enforces, so a bad file is refused here with the reason instead of failing at the end. */
export function fileProblem(file: File, allowed: string[]): string | null {
  if (!allowed.includes(file.type)) return `${file.name}: unsupported type. Use ${allowed.map((t) => t.split('/')[1].toUpperCase()).join(', ')}.`;
  const max = file.type.startsWith('image/') ? 8 : file.type === 'application/pdf' ? 10 : 50;
  return file.size > max * 1024 * 1024 ? `${file.name}: too large (max ${max} MB for this type).` : null;
}

function Section({ n, title, hint, required, children }: { n: number; title: string; hint?: string; required?: boolean; children: ReactNode }) {
  return <Card className="space-y-4 p-5"><div><h2 className="text-2xl font-bold"><span className="mr-2 text-[rgb(var(--brand-text))]" aria-hidden="true">{n}.</span>{title}{required && <span className="ml-1 font-bold text-danger" aria-hidden="true">*</span>}</h2>{hint && <p className="text-sm text-muted">{hint}</p>}</div>{children}</Card>;
}
const Chips = <T extends number>({ items, value, onChange }: { items: { id: T; name: string }[]; value: T[]; onChange(v: T[]): void }) => (
  <div className="flex flex-wrap gap-2">{items.map((x) => { const on = value.includes(x.id); return <button type="button" key={x.id} aria-pressed={on} onClick={() => onChange(on ? value.filter((i) => i !== x.id) : [...value, x.id])} className={cx('chip !px-3 !py-1.5 text-sm', on && '!border-brand bg-brand/15 text-ink')}>{on ? '✓ ' : ''}{x.name}</button>; })}</div>
);

export const CreateVenuePage = () => <VenueForm />;

/**
 * One page with everything a venue needs. Used to create a venue (no `venue`) and to edit one (`venue` = the saved record), so the
 * information is always in the same place. New files are held until Save; then everything is saved in order and can be retried from a failed step.
 */
export function VenueForm({ venue }: { venue?: any }) {
  const editing = !!venue; const area0 = venue?.areas?.[0];
  const nav = useNavigate(); const qc = useQueryClient(); const { toast } = useToast();
  const sportsQ = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  const facQ = useQuery({ queryKey: ['facilities'], queryFn: () => get<{ facilities: { id: number; name: string }[] }>('/facilities'), staleTime: Infinity });
  const [f, setF] = useState({ name: venue?.name ?? '', category: venue?.category ?? '', description: venue?.description ?? '', contactPhone: venue?.contact_phone ?? '', contactPhone2: venue?.contact_phone2 ?? '', contactEmail: venue?.contact_email ?? '', address: venue?.address ?? '', locality: venue?.locality ?? '', state: venue?.state ?? '', city: venue?.city ?? '', pincode: venue?.pincode ?? '', country: venue?.country ?? 'India', cancellationHours: String(venue?.cancellation_hours ?? 24), addressLine2: venue?.address_line2 ?? '', mapUrl: venue?.map_url ?? '' });
  const [showPhone2, setShowPhone2] = useState(!!venue?.contact_phone2); // the second number's box only appears once it is asked for
  const [pos, setPos] = useState<{ lat?: number; lng?: number }>(venue ? { lat: venue.lat, lng: venue.lng } : {});
  const [facilityIds, setFacilityIds] = useState<number[]>(venue?.facilityIds ?? []);
  const [sportIds, setSportIds] = useState<number[]>(venue?.sportIds ?? []);
  const [media, setMedia] = useState<File[]>([]); const [bill, setBill] = useState<File | null>(null); const [land, setLand] = useState<File | null>(null); const [geoVideo, setGeoVideo] = useState<GeoVideo | null>(null); const [mapNote, setMapNote] = useState(''); const [pano, setPano] = useState<File | null>(null);
  const [extra, setExtra] = useState<{ type: string; file: File | null }>({ type: 'Ownership / lease deed', file: null });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [steps, setSteps] = useState<Step[] | null>(null); const [busy, setBusy] = useState(false); const [mode, setMode] = useState<'draft' | 'submit'>('draft');
  const made = useRef<{ venueId?: string; areaId?: string; done: Set<string>; published?: boolean; pending?: boolean; contactOnly?: boolean }>({ venueId: venue?.id, areaId: area0?.id, done: new Set() });
  const previews = useMemo(() => media.map((file) => ({ file, url: file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null })), [media]); // a missing preview must never break the page
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL?.(p.url)), [previews]);
  useEffect(() => { // the link's coordinates become the venue's location
    const link = f.mapUrl.trim(); setMapNote('');
    if (!link || !GOOGLE_MAPS.test(link)) return;
    const direct = coordsFromMapUrl(link);
    if (direct) { setPos(direct); setMapNote('Location read from the link.'); return; }
    let live = true; const t = setTimeout(() => { // a short link (maps.app.goo.gl/…) is followed by the server
      get<{ found: boolean; lat: number | null; lng: number | null }>('/owner/maps/resolve', { url: link }).then((r) => { if (!live) return; if (r.found && r.lat != null && r.lng != null) { setPos({ lat: r.lat, lng: r.lng }); setMapNote('Location read from the link.'); } else setMapNote('The location could not be read from this link. The geo-tagged video places the venue instead.'); }).catch(() => { if (live) setMapNote('The location could not be read from this link.'); });
    }, 600);
    return () => { live = false; clearTimeout(t); };
  }, [f.mapUrl]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  // what is already saved on the server
  const savedImages: any[] = ((venue?.images ?? []) as any[]).filter((i) => !i.area_id); /* playing area photos are managed in the area form */ const savedDocs: any[] = venue?.documents ?? [];
  const savedPano = savedImages.find((i) => i.kind === 'panorama'); const savedGeoVideo = savedImages.find((i) => i.kind === 'video' && i.geo_lat != null && !i.delete_requested);
  const savedBill = savedDocs.find((d) => d.doc_type === 'Electricity bill' && d.status !== 'rejected');
  const savedLand = savedDocs.find((d) => d.doc_type === 'Land proof' && d.status !== 'rejected'); const rejectedLand = savedDocs.find((d) => d.doc_type === 'Land proof' && d.status === 'rejected');
  const rejectedBill = savedDocs.find((d) => d.doc_type === 'Electricity bill' && d.status === 'rejected');
  const locked = editing && venue.status === 'pending'; // under approval: nothing can be changed
  const canSubmit = !editing || ['draft', 'rejected'].includes(venue.status); // i.e. not yet published
  const hasPricing = !!area0?.pricing?.length; const hasHours = !!area0?.availability?.some((d: any) => !d.isClosed); // set under Pricing & rates / Operating hours
  const refreshVenue = () => { qc.invalidateQueries({ queryKey: ['owner-venue', venue?.id] }); qc.invalidateQueries({ queryKey: ['owner-venues'] }); };
  const removeSaved = async (id: string) => { try { await del(`/owner/media/${id}`); refreshVenue(); } catch (e) { toast(apiError(e), 'error'); } };
  const makeCover = async (id: string) => { try { await put(`/owner/media/${id}/cover`); refreshVenue(); } catch (e) { toast(apiError(e), 'error'); } };

  function validate(submit: boolean) {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Enter the venue name';
    if (f.address.trim().length < 5) e.address = 'Enter the address';
    if (!f.state) e.state = 'Select the state';
    if (f.state && f.city.trim().length < 2) e.city = 'Select the city';
    if (!f.pincode) e.pincode = 'Enter the PIN code'; else if (!/^[1-9][0-9]{5}$/.test(f.pincode)) e.pincode = 'Enter a valid 6-digit PIN code';
    if (editing && !f.category) e.category = 'Select the venue category';
    if (!sportIds.length) e.sports = 'Select at least one sport';
    if (editing) { if (!f.contactPhone.trim()) e.contactPhone = 'Enter the contact number'; else if (!isIndianMobile(f.contactPhone.replace(/[\s-]/g, ''))) e.contactPhone = MOBILE_MESSAGE; }
    if (showPhone2 && f.contactPhone2 && !isIndianMobile(f.contactPhone2.replace(/[\s-]/g, ''))) e.contactPhone2 = MOBILE_MESSAGE;
    if (showPhone2 && f.contactPhone2 && f.contactPhone && f.contactPhone2.replace(/[\s-]/g, '') === f.contactPhone.replace(/[\s-]/g, '')) e.contactPhone2 = 'Use a different number from the first one';
    if (editing) { if (!f.contactEmail.trim()) e.contactEmail = 'Enter the contact email'; else if (!/^\S+@\S+\.\S+$/.test(f.contactEmail)) e.contactEmail = 'Enter a valid email address'; }
    if (editing && String(f.cancellationHours).trim() === '' || !(+f.cancellationHours >= 0 && +f.cancellationHours <= 168)) e.cancellationHours = 'Enter 0 to 168 hours';
    for (const file of media) { const p = fileProblem(file, [...IMAGE, ...VIDEO]); if (p) e.photos = p; }
    if (bill) { const p = fileProblem(bill, DOC); if (p) e.bill = p; }
    if (land) { const p = fileProblem(land, DOC); if (p) e.land = p; }
    if (f.mapUrl.trim() && !GOOGLE_MAPS.test(f.mapUrl.trim())) e.mapUrl = 'Paste a Google Maps link, e.g. https://maps.app.goo.gl/…';
    if (pano) { if (!['image/jpeg', 'image/png'].includes(pano.type)) e.pano = 'The 360° photo must be a JPG or PNG'; else if (pano.size > 20 * 1024 * 1024) e.pano = 'The 360° photo can be at most 20 MB'; }
    if (extra.file) { const p = fileProblem(extra.file, DOC); if (p) e.extra = p; }
    if (!savedImages.some((i) => i.kind === 'image') && !media.some((x) => x.type.startsWith('image/'))) e.photos ??= 'Add at least one photo'; // a photo is needed even to save the venue
    if (submit || !editing) { // JusGo's Add venue form asks for both documents up front
      if (!savedBill && !bill) e.bill ??= 'Upload the electricity bill';
      if (!savedLand && !land) e.land ??= 'Upload the land proof of the venue';
      if (!savedGeoVideo && !geoVideo) e.geoVideo = 'Record a geo-tagged video at the venue.';
    }
    return e;
  }

  async function run(submit: boolean) {
    setMode(submit ? 'submit' : 'draft'); setErrs({});
    const e = validate(submit);
    if (Object.keys(e).length) { setErrs(e); setTimeout(() => { if (typeof document === 'undefined') return; const el = document.querySelector<HTMLElement>('[aria-invalid="true"],[data-invalid="true"]'); el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); (el?.matches('input,select,textarea') ? el : el?.querySelector<HTMLElement>('input,select,textarea,button'))?.focus({ preventScroll: true }); }, 60); return; }
    const m = made.current;
    const images = media.filter((x) => x.type.startsWith('image/')), videos = media.filter((x) => !x.type.startsWith('image/')); // photos first so the first one becomes the cover
    const upload = async (url: string, file: File, extraFields: Record<string, string> = {}) => { const fd = new FormData(); Object.entries(extraFields).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file); await api.post(url, fd, { timeout: 180000 }); };
    const body = { name: f.name.trim(), description: f.description.trim() || undefined, category: f.category || undefined, contactPhone: f.contactPhone.replace(/[\s-]/g, '') || (editing ? '' : undefined), contactPhone2: (showPhone2 ? f.contactPhone2.replace(/[\s-]/g, '') : '') || (editing ? '' : undefined), contactEmail: f.contactEmail.trim() || undefined, address: f.address.trim(), addressLine2: f.addressLine2.trim() || (editing ? '' : undefined), mapUrl: f.mapUrl.trim() || (editing ? '' : undefined), locality: f.locality.trim() || undefined, city: f.city.trim(), state: f.state, pincode: f.pincode || undefined, country: f.country.trim() || 'India', lat: pos.lat, lng: pos.lng, cancellationHours: +f.cancellationHours };
    // Playing areas (name, sports, slot size, booking lengths, prices, hours) are added by the owner under Playing areas. This page never creates or changes them.
    const plan: { key: string; label: string; fn(): Promise<void> }[] = [
      { key: 'venue', label: editing ? 'Saving venue details' : 'Creating the venue', fn: async () => { if (m.venueId) { const r: any = await put(`/owner/venues/${m.venueId}`, body); m.pending = r?.pendingChange; m.contactOnly = !!r?.contactUpdated && r?.pendingChange === false; } else { const r = await post('/owner/venues', body); m.venueId = r.venue.id; } } },
      { key: 'sports', label: 'Saving the sports', fn: async () => { await put(`/owner/venues/${m.venueId}/sports`, { sportIds }); } },
      ...(facilityIds.length || editing ? [{ key: 'facilities', label: 'Saving facilities', fn: async () => { await put(`/owner/venues/${m.venueId}/facilities`, { facilityIds }); } }] : []),
      ...[...images, ...videos].map((file, i) => ({ key: `media${i}`, label: `Uploading ${file.name}`, fn: () => upload(`/owner/venues/${m.venueId}/media`, file) })),
      ...(pano ? [{ key: 'pano', label: 'Uploading the 360° photo', fn: () => upload(`/owner/venues/${m.venueId}/media`, pano, { kind: 'panorama' }) }] : []),
      ...(bill ? [{ key: 'bill', label: 'Uploading the electricity bill', fn: () => upload(`/owner/venues/${m.venueId}/documents`, bill, { docType: 'Electricity bill' }) }] : []),
      ...(geoVideo ? [{ key: 'geovideo', label: 'Uploading the geo-tagged video', fn: () => upload(`/owner/venues/${m.venueId}/media/geo-video`, geoVideo.file, { lat: String(geoVideo.lat), lng: String(geoVideo.lng), accuracy: String(Math.round(geoVideo.accuracy)) }) }] : []),
      ...(land ? [{ key: 'land', label: 'Uploading the land proof', fn: () => upload(`/owner/venues/${m.venueId}/documents`, land, { docType: 'Land proof' }) }] : []),
      ...(extra.file ? [{ key: 'extra', label: `Uploading ${extra.type.toLowerCase()}`, fn: () => upload(`/owner/venues/${m.venueId}/documents`, extra.file!, { docType: extra.type }) }] : []),
      ...(submit && canSubmit ? [{ key: 'submit', label: 'Sending the venue for approval', fn: async () => { try { await post(`/owner/venues/${m.venueId}/send-for-approval`); m.published = true; } catch (err: any) { if (!editing && err?.response?.data?.error?.code === 'incomplete_venue') return; throw err; } } }] : []),
    ];
    setBusy(true); setSteps(plan.map((p) => ({ key: p.key, label: p.label, state: m.done.has(p.key) ? 'done' : 'todo' })));
    const mark = (key: string, state: Step['state'], error?: string) => setSteps((s) => s && s.map((x) => (x.key === key ? { ...x, state, error } : x)));
    for (const p of plan) {
      if (m.done.has(p.key)) continue;
      mark(p.key, 'doing');
      try { await p.fn(); m.done.add(p.key); mark(p.key, 'done'); } catch (err) { mark(p.key, 'failed', apiError(err)); setBusy(false); return; }
    }
    qc.invalidateQueries({ queryKey: ['owner-venues'] }); qc.invalidateQueries({ queryKey: ['owner-overview'] }); qc.invalidateQueries({ queryKey: ['owner-areas'] }); qc.invalidateQueries({ queryKey: ['owner-venue', m.venueId] });
    toast(m.published ? 'Sent for approval. Now set its prices and opening hours while PlaynX reviews it' : editing && ['approved', 'ready'].includes(venue.status) ? (m.contactOnly ? 'Contact numbers updated. They are live now' : m.pending === false ? 'Changes saved' : 'Changes sent for approval. Customers keep seeing the current version until PlaynX approves them. Contact numbers are not held back: they are live now') : 'Changes saved');
    if (editing) { made.current = { venueId: m.venueId, areaId: m.areaId, done: new Set() }; setMedia([]); setBill(null); setLand(null); setGeoVideo(null); setPano(null); setExtra({ ...extra, file: null }); setSteps(null); setBusy(false); }
    else { toast('Venue created. Send it for approval when it is ready. You can add playing areas, prices and hours meanwhile.'); nav('/owner/venues'); }
  }

  const [pub, setPub] = useState(false);
  async function setLive(live: boolean) {
    setPub(true);
    try { await post(`/owner/venues/${venue.id}/${live ? 'publish' : 'unpublish'}`); qc.invalidateQueries({ queryKey: ['owner-venue', venue.id] }); qc.invalidateQueries({ queryKey: ['owner-venues'] }); toast(live ? 'Published. Customers can now find and book this venue' : 'Unpublished. Customers can no longer see this venue'); }
    catch (err) { toast(apiError(err), 'error'); } finally { setPub(false); }
  }
  const failed = steps?.find((s) => s.state === 'failed');
  const problems = Object.keys(errs).length;

  return (
    <div className="space-y-6">
      {!editing && <><PageHeader title="Add venue" subtitle="The details needed to create your venue, on one page. Fields marked * are required." />
        <p className="rounded-xl border border-line bg-surface p-3 text-sm">Fill in the details, then press <b>Create venue</b>. PlaynX checks the photos and documents before your venue goes live; the venue stays inactive until it is approved. Playing areas, prices and opening hours can be added at any time (they are needed before you publish).</p></>}
      {editing && venue.pendingChange && <p role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm"><b>Changes waiting for approval.</b> Customers still see the approved version of this venue. They will see your changes once PlaynX approves them.</p>}
      {locked && <p role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm"><b>Sent for approval.</b> Your details were sent to PlaynX and can't be changed while they are reviewed. Set the venue's <Link className="font-semibold underline" to={`/owner/pricing?venue=${venue.id}`}>prices</Link> and <Link className="font-semibold underline" to={`/owner/hours?venue=${venue.id}`}>opening hours</Link> now; the admin needs them to approve. You'll be told the decision. If changes are needed, the venue opens for editing again.</p>}
      {editing && <p className="text-sm text-muted">Everything about this venue is on this page. Change what you need and press save. Fields marked <span className="font-bold text-danger">*</span> are required.</p>}

      <fieldset disabled={locked} aria-label="Venue details form" className={`m-0 min-w-0 space-y-6 border-0 p-0 ${locked ? 'opacity-70' : ''}`}>
      <Section n={1} title="Venue details">
        <Input mandatory label="Venue name" placeholder="Enter venue or turf name" hint="Letters, numbers and & . , - ( ) / are allowed." value={f.name} onChange={set('name')} error={errs.name} />
        <div data-invalid={errs.sports ? 'true' : undefined}><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted after:ml-1 after:font-bold after:text-danger after:content-['*']">Sports available</p>
          <p className="mb-2 text-xs text-muted">The sports this venue offers. When you add a playing area you choose from these.</p>
          <Chips items={sportsQ.data?.sports ?? []} value={sportIds} onChange={setSportIds} />
          {errs.sports && <p role="alert" className="mt-1 text-xs text-danger">{errs.sports}</p>}</div>
        <Textarea label="Description (optional)" value={f.description} onChange={set('description')} rows={3} maxLength={editing ? 3000 : 500} placeholder="Facilities, parking, changing rooms ..." />
        {editing && <>
        <div className="grid gap-3 sm:grid-cols-2"><Select mandatory label="Venue category" value={f.category} onChange={set('category')} error={errs.category}><option value="">Select category</option>{categoryOptions(f.category).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          <Input mandatory label="Free-cancellation window (hours before start)" type="number" min={0} max={168} value={f.cancellationHours} onChange={set('cancellationHours')} error={errs.cancellationHours} hint="Customers cancelling earlier than this get a full refund" /></div>
        <div className="grid gap-3 sm:grid-cols-2"><Input mandatory label="Contact number" type="tel" value={f.contactPhone} onChange={set('contactPhone')} error={errs.contactPhone} placeholder="+919876543210" hint="Contact numbers change straight away, without approval." /><Input mandatory label="Contact email" type="email" value={f.contactEmail} onChange={set('contactEmail')} error={errs.contactEmail} /></div>
        {showPhone2 ? (
          <div className="flex items-start gap-2"><div className="max-w-sm flex-1"><Input label="Second contact number" type="tel" value={f.contactPhone2} onChange={set('contactPhone2')} error={errs.contactPhone2} placeholder="+919876543211" /></div>
            <button type="button" onClick={() => { setShowPhone2(false); setF((x) => ({ ...x, contactPhone2: '' })); }} className="mt-6 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-muted hover:text-danger">Remove</button></div>
        ) : <button type="button" onClick={() => setShowPhone2(true)} className="btn-ghost !py-1.5 text-sm">+ Add another phone number</button>}
        </>}
      </Section>

      <Section n={2} title="Address" hint="Where customers will find you.">
        <Input mandatory label="Address line 1" value={f.address} onChange={set('address')} error={errs.address} placeholder="Building, street and area" />
        <Input label="Address line 2 (optional)" value={f.addressLine2} onChange={set('addressLine2')} placeholder="Apartment, landmark, area (optional)" hint="Landmark or area. Leave blank if not needed." />
        <StateCityFields state={f.state} city={f.city} errors={{ state: errs.state, city: errs.city }} onChange={(v) => setF({ ...f, ...v })} />
        <div className={editing ? 'grid gap-3 sm:grid-cols-3' : 'max-w-[12rem]'}>{editing && <Input label="Area / locality" value={f.locality} onChange={set('locality')} />}<Input mandatory label="PIN code" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, '') })} error={errs.pincode} />{editing && <Input label="Country" value={f.country} onChange={set('country')} />}</div>
        <div><Input label="Google Maps location (optional)" value={f.mapUrl} onChange={set('mapUrl')} error={errs.mapUrl} placeholder="Paste the Google Maps link, e.g. https://maps.app.goo.gl/…" hint="In Google Maps, find your venue, tap Share, then Copy link and paste it here. Players use it to find you." />
          {f.mapUrl && GOOGLE_MAPS.test(f.mapUrl.trim()) && <a href={f.mapUrl.trim()} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline">📍 Check this location on Google Maps ↗</a>}{mapNote && <p className="mt-1 text-xs text-muted" role="status">{mapNote}</p>}</div>
      </Section>

      {editing && <Section n={3} title="Facilities">
        <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Facilities</p><Chips items={facQ.data?.facilities ?? []} value={facilityIds} onChange={setFacilityIds} /></div>
      </Section>}

      <Section n={editing ? 4 : 3} title={editing ? 'Photos & video' : 'Photos and documents'} required hint={editing ? 'At least one photo is required. The first photo becomes the cover. JPG, PNG or WebP up to 8 MB; MP4 or WebM video up to 50 MB.' : "PlaynX checks these before your venue goes live. The venue stays inactive until it is approved. Venue photos: at least 1 (the first is the cover), JPG, PNG or WebP up to 8 MB."}>
        <div data-invalid={errs.photos ? 'true' : undefined}>
          {savedImages.length > 0 && <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Saved photos">{savedImages.map((m) => (
            <div key={m.id} className="group relative aspect-video overflow-hidden rounded-lg border border-line">{m.kind === 'video' ? <video src={m.url} className="h-full w-full object-cover" muted /> : <img src={m.url} alt="Saved venue" className="h-full w-full object-cover" />}
              {m.is_cover && <span className="absolute left-1 top-1 rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-ink">Cover</span>}{m.is_pending && <span className="absolute right-1 top-1 rounded-full bg-warn px-1.5 text-[10px] font-bold text-brand-ink">Awaiting approval</span>}{m.delete_requested && <span className="absolute right-1 top-1 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">Removal awaiting approval</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/70 p-1 text-[10px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100">{m.kind === 'image' && !m.is_cover ? <button type="button" className="text-white underline" onClick={() => makeCover(m.id)}>Set cover</button> : <span />}{m.delete_requested ? <span /> : <button type="button" className="text-red-300 underline" onClick={() => window.confirm('Remove this file?') && removeSaved(m.id)}>Delete</button>}</div></div>))}</div>}
          <label className="btn-ghost cursor-pointer"><input type="file" hidden multiple accept={[...IMAGE, ...VIDEO].join(',')} aria-label="Add photos and video" onChange={(e) => { setMedia([...media, ...Array.from(e.target.files ?? [])].slice(0, 30)); e.target.value = ''; }} />+ Add photos or video</label>
          {errs.photos && <p role="alert" className="mt-1 text-xs text-danger">{errs.photos}</p>}
          {previews.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{previews.map((p, i) => (
            <div key={i} className="relative aspect-video overflow-hidden rounded-lg border border-line">{p.url ? <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center bg-surface2 text-2xl" aria-hidden="true">🎬</span>}
              <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => setMedia(media.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-xs text-white">✕</button></div>))}</div>}
        </div>
      </Section>

      <Section n={editing ? 5 : 4} title="Documents" hint="Reviewed by PlaynX. PDF, JPG or PNG up to 10 MB. Stored privately.">
        <div className="space-y-3">
          <GeoVideoCapture value={geoVideo} onChange={setGeoVideo} error={errs.geoVideo} disabled={busy} />
          {savedGeoVideo && !geoVideo && <p className="text-xs text-ok">✓ A geo-tagged video is already saved for this venue.</p>}
          <div data-invalid={errs.land ? 'true' : undefined} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"><div><p className={cx('text-sm font-semibold', STAR)}>Land proof</p><p className="text-xs text-muted">A document showing you own or lease the land (sale deed, lease or rental agreement). PDF, JPG or PNG, up to 10 MB.</p>
            {savedLand && <p className="text-xs text-ok">Uploaded <Badge status={savedLand.status === 'approved' ? 'approved' : 'pending'}>{savedLand.status === 'approved' ? 'Verified' : 'Pending review'}</Badge> <FileLink path={`/owner/venue-documents/${savedLand.id}/file`} url={savedLand.url}>View</FileLink></p>}
            {rejectedLand && !savedLand && <p role="alert" className="text-xs text-danger">Rejected{rejectedLand.note ? `: ${rejectedLand.note}` : ''}. Upload a corrected copy.</p>}
            {land && <p className="text-xs text-ok">Selected: {land.name}</p>}{errs.land && <p role="alert" className="text-xs text-danger">{errs.land}</p>}</div>
            <label className="btn-ghost cursor-pointer !py-1.5"><input type="file" hidden accept={DOC.join(',')} aria-label="Upload land proof" onChange={(e) => { setLand(e.target.files?.[0] ?? null); e.target.value = ''; }} />{land || savedLand ? 'Replace' : 'Choose file'}</label></div>
          <div data-invalid={errs.bill ? 'true' : undefined} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"><div><p className={cx('text-sm font-semibold', STAR)}>Electricity bill</p><p className="text-xs text-muted">Recent bill showing the venue's address.</p>
            {savedBill && <p className="text-xs text-ok">Uploaded <Badge status={savedBill.status === 'approved' ? 'approved' : 'pending'}>{savedBill.status === 'approved' ? 'Verified' : 'Pending review'}</Badge> <FileLink path={`/owner/venue-documents/${savedBill.id}/file`} url={savedBill.url}>View</FileLink></p>}
            {rejectedBill && !savedBill && <p role="alert" className="text-xs text-danger">Rejected{rejectedBill.note ? `: ${rejectedBill.note}` : ''}. Upload a corrected copy.</p>}
            {bill && <p className="text-xs text-ok">Selected: {bill.name}</p>}{errs.bill && <p role="alert" className="text-xs text-danger">{errs.bill}</p>}</div>
            <label className="btn-ghost cursor-pointer !py-1.5"><input type="file" hidden accept={DOC.join(',')} aria-label="Upload electricity bill" onChange={(e) => { setBill(e.target.files?.[0] ?? null); e.target.value = ''; }} />{bill || savedBill ? 'Replace' : 'Choose file'}</label></div>
          <div data-invalid={errs.pano ? 'true' : undefined} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"><div><p className="text-sm font-semibold">360° Venue Photo (optional)</p><p className="text-xs text-muted">Upload a 360° panoramic photo to give customers an immersive view. JPG or PNG, up to 20 MB, best with a 2:1 image, e.g. 4000 × 2000.</p>
            {savedPano && !pano && <p className="text-xs text-ok">Uploaded <a className="underline" href={savedPano.url} target="_blank" rel="noreferrer">View 360°</a> · <button type="button" className="underline" onClick={() => removeSaved(savedPano.id)}>Remove</button></p>}
            {pano && <p className="text-xs text-ok">Selected: {pano.name}</p>}{errs.pano && <p role="alert" className="text-xs text-danger">{errs.pano}</p>}</div>
            <label className="btn-ghost cursor-pointer !py-1.5"><input type="file" hidden accept="image/jpeg,image/png" aria-label="Upload 360 degree photo" onChange={(e) => { setPano(e.target.files?.[0] ?? null); e.target.value = ''; }} />{pano || savedPano ? 'Replace' : 'Upload 360° Photo'}</label></div>
          {savedDocs.filter((d) => !['Electricity bill', 'Land proof'].includes(d.doc_type)).length > 0 && <ul className="space-y-1 text-sm" aria-label="Other saved documents">{savedDocs.filter((d) => !['Electricity bill', 'Land proof'].includes(d.doc_type)).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface2 px-3 py-2"><FileLink path={`/owner/venue-documents/${d.id}/file`} url={d.url}>{d.doc_type}</FileLink><span className="flex items-center gap-2">{d.note && <span className="text-xs text-danger">{d.note}</span>}<Badge status={d.status === 'approved' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending'}>{d.status === 'approved' ? 'Verified' : d.status === 'rejected' ? 'Rejected' : 'Pending review'}</Badge></span></li>))}</ul>}
          {editing && (<div className="flex flex-wrap items-end justify-between gap-2 rounded-xl border border-line p-3"><div className="min-w-56 flex-1"><Select label="Another document (optional)" value={extra.type} onChange={(e) => setExtra({ ...extra, type: e.target.value })}>{['Ownership / lease deed', 'Trade licence', 'GST certificate', 'Government ID', 'Other'].map((t) => <option key={t}>{t}</option>)}</Select>{extra.file && <p className="mt-1 text-xs text-ok">Selected: {extra.file.name}</p>}{errs.extra && <p role="alert" className="text-xs text-danger">{errs.extra}</p>}</div>
            <label className="btn-ghost cursor-pointer !py-1.5"><input type="file" hidden accept={DOC.join(',')} aria-label="Upload another document" onChange={(e) => { setExtra({ ...extra, file: e.target.files?.[0] ?? null }); e.target.value = ''; }} />{extra.file ? 'Replace' : 'Choose file'}</label></div>)}
        </div>
      </Section>


      </fieldset>
      {steps && (
        <Card className="space-y-2 p-5" aria-live="polite"><h2 className="text-2xl font-bold">{failed ? 'Stopped. Nothing is lost' : busy ? (editing ? 'Saving…' : 'Creating your venue…') : 'Done'}</h2>
          <ul className="space-y-1 text-sm">{steps.map((s) => <li key={s.key} className="flex flex-wrap items-center gap-2"><span aria-hidden="true" className={s.state === 'done' ? 'text-ok' : s.state === 'failed' ? 'text-danger' : s.state === 'doing' ? 'text-warn' : 'text-muted'}>{s.state === 'done' ? '✓' : s.state === 'failed' ? '✗' : s.state === 'doing' ? '…' : '○'}</span>{s.label}{s.error && <span role="alert" className="text-danger">: {s.error}</span>}</li>)}</ul>
          {failed && <p className="text-sm text-muted">What was already saved is kept. Fix the problem above if you can, then press the button again to continue from here.</p>}</Card>)}

      {problems > 0 && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{problems} thing{problems === 1 ? '' : 's'} need{problems === 1 ? 's' : ''} attention. They're marked in red above.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><Link to="/owner/venues" className="btn-ghost">{editing ? 'Back to venues' : 'Cancel'}</Link>
        <div className="flex flex-wrap gap-2">{editing && !locked && <Button type="button" variant={canSubmit ? 'ghost' : 'primary'} disabled={busy} loading={busy && mode === 'draft'} onClick={() => run(false)}>{failed && mode === 'draft' ? 'Try again' : 'Save changes'}</Button>}
          {editing && venue.status === 'ready' && <Button type="button" loading={pub} onClick={() => setLive(true)}>Publish venue</Button>}
          {editing && venue.status === 'approved' && <Button type="button" variant="ghost" loading={pub} onClick={() => setLive(false)}>Unpublish</Button>}
          {!editing && <Button type="button" disabled={busy} loading={busy && mode === 'draft'} onClick={() => run(false)}>{failed ? 'Try again' : 'Create venue'}</Button>}
          {editing && canSubmit && <Button type="button" disabled={busy} loading={busy && mode === 'submit'} onClick={() => run(true)}>{failed && mode === 'submit' ? 'Try again' : 'Send for approval'}</Button>}</div></div>
    </div>
  );
}
