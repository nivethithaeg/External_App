import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/components/GeoVideoCapture', () => ({
  GeoVideoCapture: ({ value, onChange, error }: any) => (<div data-invalid={error ? 'true' : undefined}><p className="after:content-['*']">Geo-tagged video</p>
    <button type="button" onClick={() => onChange({ file: new File(['v'], 'venue-video.webm', { type: 'video/webm' }), previewUrl: 'blob:x', lat: 12.97, lng: 77.59, accuracy: 20, seconds: 5 })}>{value ? 'Record again' : 'Record video'}</button>{error && <p role="alert">{error}</p>}</div>),
}));
vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/razorpay', () => ({ openCheckout: vi.fn(), isPaymentNotCompleted: (e: any) => e?.name === 'PaymentNotCompleted' }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const OWNER = { id: 'o1', email: 'o@x.co', phone: null, fullName: 'Arjun Mehta', role: 'owner', adminRole: null, emailVerified: true, phoneVerified: false };
const ACTIVE = { accountStatus: 'active', application: { status: 'approved', editable: false }, contact: { emailVerified: true }, business: {}, identity: {}, documents: [], requiredDocs: [], venues: [], sections: {}, missing: [], correction: null, events: [] };
const VENUE = { id: 'v9', name: 'New Arena', city: 'Bengaluru', state: 'Karnataka', status: 'draft', images: [{ id: 'm9', kind: 'video', url: 'u', geo_lat: 12.97, geo_lng: 77.59, is_pending: false, delete_requested: false, area_id: null }], documents: [], areas: [], facilityIds: [], sportIds: [1], lat: 1, lng: 1, address: 'x', cancellation_hours: 24 };
let calls: { method: string; url: string; body?: any }[] = [];
let fail: Record<string, any> = {};

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.setItem('playnx_token', 't'); calls = []; fail = {};
  vi.mocked(api.get).mockImplementation(async (url: string) => ({
    '/auth/me': { user: OWNER }, '/owner/application': ACTIVE, '/me/notifications': { notifications: [], unread: 0 }, '/owner/venues/v9': { venue: VENUE }, '/owner/venues': { venues: [] }, '/owner/bank': { accountName: 'Mehta Sports', accountNumber: '••••••••9012', ifsc: 'HDFC0001234', upi: null, verified: false },
    '/sports': { sports: [{ id: 1, name: 'Football' }, { id: 2, name: 'Cricket' }] }, '/facilities': { facilities: [{ id: 1, name: 'Parking' }, { id: 2, name: 'Floodlights' }] },
  } as Record<string, any>)[url] ?? {});
  const respond = (method: string) => async (url: string, body?: any) => {
    calls.push({ method, url, body });
    if (fail[`${method} ${url}`]) { const f = fail[`${method} ${url}`]; delete fail[`${method} ${url}`]; throw f; }
    if (url === '/owner/venues') return { venue: { id: 'v9' } };
    if (url.endsWith('/areas')) return { area: { id: 'a9' } };
    return {};
  };
  vi.mocked(api.post).mockImplementation(respond('POST') as any); vi.mocked(api.put).mockImplementation(respond('PUT') as any);
  vi.spyOn(api.api, 'post').mockImplementation((async (url: string, body: FormData) => { calls.push({ method: 'UPLOAD', url, body: Object.fromEntries([...body.entries()].map(([k, v]) => [k, v instanceof File ? v.name : v])) }); return { data: {} }; }) as any);
});
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={['/owner/venues/new']}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
const png = (name = 'photo.png') => new File([new Uint8Array(200)], name, { type: 'image/png' });
const pdf = (name = 'bill.pdf') => new File(['%PDF-1.4 x'], name, { type: 'application/pdf' });
const names = () => calls.map((c) => `${c.method} ${c.url}`);

async function fillBasics() {
  await userEvent.type(await screen.findByLabelText('Venue name'), 'New Arena');
  await userEvent.type(screen.getByLabelText('Address line 1'), '12 Park Road, Indiranagar');
  await userEvent.selectOptions(screen.getByLabelText('State'), 'Karnataka'); await userEvent.selectOptions(screen.getByLabelText('City'), 'Bengaluru');
  await userEvent.type(screen.getByLabelText('PIN code'), '560038');
  await userEvent.click(await screen.findByRole('button', { name: 'Football' })); // the sports the venue offers
}

describe('Add venue: everything on one page', () => {
  it('shows JusGo\'s Add venue sections and nothing more, with required fields marked', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Add venue' })).toBeInTheDocument();
    for (const t of ['Venue details', 'Address', 'Photos and documents', 'Documents']) expect(screen.getByRole('heading', { level: 2, name: t })).toBeInTheDocument();
    for (const t of ['Facilities', 'Photos & video']) expect(screen.queryByRole('heading', { level: 2, name: t })).not.toBeInTheDocument();
    for (const l of [/^Venue category/, /^Free-cancellation window/, /^Contact number/, /^Contact email/, 'Area / locality', 'Another document (optional)']) expect(screen.queryByLabelText(l)).not.toBeInTheDocument(); // asked only when editing
    expect(screen.queryByRole('heading', { name: /Pricing/ })).not.toBeInTheDocument(); expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    for (const l of ['Area name', 'Surface', 'Slot size', 'Shortest booking (minutes)', 'Longest booking (minutes)']) expect(screen.queryByLabelText(l)).not.toBeInTheDocument();
    for (const l of ['Venue name', 'Address line 1', 'State', 'City', 'PIN code', 'Land proof', 'Electricity bill', 'Geo-tagged video']) expect(screen.getByText(l), l).toHaveClass("after:content-['*']");
    expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument(); // JusGo's form has no map pin: the location comes from the Google Maps link
    expect(screen.getByLabelText(/Venue name/)).toHaveAttribute('placeholder', 'Enter venue or turf name');
    expect(screen.getByLabelText('Address line 2 (optional)')).toBeInTheDocument(); expect(screen.getByLabelText('Google Maps location (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toHaveAttribute('maxlength', '500');
    expect(await screen.findByRole('button', { name: 'Football' })).toBeInTheDocument(); // the sports are chosen here, with the venue details
    expect(screen.getByRole('button', { name: 'Create venue' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Send for approval' })).not.toBeInTheDocument();
  });

  it('refuses to submit an empty form, names every problem, and sends nothing', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Create venue' }));
    for (const m of ['Enter the venue name', 'Enter the address', 'Select the state', 'Enter the PIN code']) expect(await screen.findByText(m)).toBeInTheDocument();
    expect(screen.getByText(/things need attention/)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('creates the venue as a draft with its photos and bill, and never creates a playing area by itself', async () => {
    renderPage(); await fillBasics();
    await userEvent.upload(screen.getByLabelText('Add photos and video'), [png('a.png'), png('b.png')]);
    await userEvent.upload(screen.getByLabelText('Upload electricity bill'), pdf()); await userEvent.upload(screen.getByLabelText('Upload land proof'), pdf('land.pdf')); await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    await waitFor(() => expect(names().filter((n) => n === 'UPLOAD /owner/venues/v9/documents')).toHaveLength(2));
    expect(names()).toEqual(['POST /owner/venues', 'PUT /owner/venues/v9/sports', 'UPLOAD /owner/venues/v9/media', 'UPLOAD /owner/venues/v9/media', 'UPLOAD /owner/venues/v9/documents', 'UPLOAD /owner/venues/v9/media/geo-video', 'UPLOAD /owner/venues/v9/documents']);
    expect(names().some((n) => n.includes('/areas') || n.includes('send-for-approval'))).toBe(false);
    expect(calls[0].body).toMatchObject({ name: 'New Arena', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', cancellationHours: 24, country: 'India' }); expect(calls[0].body.lat).toBeUndefined(); // no map pin: the location comes from the Maps link or the video
    expect(calls[1].body).toEqual({ sportIds: [1] }); expect(calls[2].body.file).toBe('a.png'); expect(calls[4].body).toEqual({ docType: 'Electricity bill', file: 'bill.pdf' }); expect(calls[5].body).toEqual({ file: 'venue-video.webm', lat: '12.97', lng: '77.59', accuracy: '20' }); expect(calls[6].body).toEqual({ docType: 'Land proof', file: 'land.pdf' });
    expect(calls[0].body.category).toBeUndefined(); expect(calls[0].body.contactPhone).toBeUndefined(); // JusGo's Add venue form does not ask for them
    expect(await screen.findByRole('heading', { level: 1, name: 'Your venues' })).toBeInTheDocument(); // sent to the venues list, where Send for approval is
  });

  it('the venue form has no bank fields: the bank account is added under Account first, and the form sends none', async () => {
    renderPage(); await fillBasics();
    expect(screen.queryByLabelText(/Account holder name/)).toBeNull(); expect(screen.queryByLabelText(/Account number/)).toBeNull(); expect(screen.queryByLabelText(/IFSC code/)).toBeNull();
    expect(screen.queryByText(/Payout bank account/)).toBeNull();
    await userEvent.upload(screen.getByLabelText('Add photos and video'), png('a.png'));
    await userEvent.upload(screen.getByLabelText('Upload electricity bill'), pdf()); await userEvent.upload(screen.getByLabelText('Upload land proof'), pdf('land.pdf')); await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/owner/venues')).toBe(true));
    expect(calls.find((c) => c.url === '/owner/venues')!.body.bank).toBeUndefined();
  });

  it('on a failure it says which step and why, keeps what was created, and continues from there', async () => {
    fail['PUT /owner/venues/v9/sports'] = { response: { data: { error: { message: 'Could not save sports' } } } };
    renderPage(); await fillBasics();
    await userEvent.upload(screen.getByLabelText('Add photos and video'), png('a.png'));
    await userEvent.upload(screen.getByLabelText('Upload electricity bill'), pdf()); await userEvent.upload(screen.getByLabelText('Upload land proof'), pdf('land.pdf')); await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByText(/Saving the sports/)).toBeInTheDocument();
    expect(screen.getByText(/Could not save sports/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopped. Nothing is lost' })).toBeInTheDocument();
    expect(names()).toEqual(['POST /owner/venues', 'PUT /owner/venues/v9/sports']);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(names().filter((n) => n === 'PUT /owner/venues/v9/sports')).toHaveLength(2));
    expect(names().filter((n) => n === 'POST /owner/venues')).toHaveLength(1); // the venue is not created twice
  });

  it('checks files before anything is sent, with the reason', async () => {
    renderPage(); await fillBasics();
    await userEvent.upload(screen.getByLabelText('Upload electricity bill'), new File(['hello'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByText(/notes.txt: unsupported type/)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('the PIN code is required and must be 6 digits', async () => {
    renderPage(); await fillBasics();
    const pin = screen.getByLabelText('PIN code'); await userEvent.clear(pin);
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByText('Enter the PIN code')).toBeInTheDocument(); expect(calls).toEqual([]);
    await userEvent.type(pin, '12345'); await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByText('Enter a valid 6-digit PIN code')).toBeInTheDocument(); expect(calls).toEqual([]);
  });
});

describe('the same single page edits a saved venue', () => {
  const saved = (over: any = {}) => ({
    id: 'v9', name: 'Green Arena', description: 'Floodlit turf', category: 'Football turf', contact_phone: '+919800000001', contact_email: 'a@x.co', address: '12 Park Road', locality: 'Indiranagar', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India',
    lat: 12.97, lng: 77.59, cancellation_hours: 12, status: 'draft', facilityIds: [1], sportIds: [1],
    images: [{ id: 'm1', url: 'http://x/a.jpg', kind: 'image', is_cover: true }, { id: 'm2', url: 'http://x/b.jpg', kind: 'image', is_cover: false }, { id: 'm3', url: 'http://x/v.webm', kind: 'video', geo_lat: 12.97, geo_lng: 77.59, is_cover: false }],
    documents: [{ id: 'd1', doc_type: 'Electricity bill', status: 'pending', url: null, note: null }, { id: 'd2', doc_type: 'Ownership / lease deed', status: 'approved', url: null, note: null }, { id: 'd3', doc_type: 'Land proof', status: 'approved', url: null, note: null }],
    areas: [{ id: 'a1', name: 'Turf A', surface: 'Grass', capacity: 14, slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sport_ids: [1],
      pricing: [{ id: 'p1', sportId: null, dayType: 'all', startTime: '06:00', endTime: '18:00', pricePerHour: 800 }, { id: 'p2', sportId: null, dayType: 'weekend', startTime: '06:00', endTime: '23:00', pricePerHour: 1500 }],
      availability: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '22:00', isClosed: false }))  }], ...over });
  const open = async (over: any = {}) => {
    const v = saved(over);
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      '/auth/me': { user: OWNER }, '/owner/application': ACTIVE, '/me/notifications': { notifications: [], unread: 0 }, '/owner/venues/v9': { venue: v },
      '/sports': { sports: [{ id: 1, name: 'Football' }, { id: 2, name: 'Cricket' }] }, '/facilities': { facilities: [{ id: 1, name: 'Parking' }, { id: 2, name: 'Floodlights' }] },
    } as Record<string, any>)[url] ?? {});
    vi.mocked(api.del).mockImplementation((async (url: string) => { calls.push({ method: 'DELETE', url }); return {}; }) as any);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={['/owner/venues/v9?tab=edit']}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    await screen.findByRole('heading', { level: 1, name: 'Green Arena' });
  };

  it('shows every saved detail in place, and has no separate submit checklist', async () => {
    await open();
    expect(screen.getByLabelText('Venue name')).toHaveValue('Green Arena'); expect(screen.getByLabelText('State')).toHaveValue('Karnataka'); expect(screen.getByLabelText('City')).toHaveValue('Bengaluru');
    expect(screen.getByLabelText('Venue category')).toHaveValue('Football turf');
    expect(screen.queryByText('Sports offered')).not.toBeInTheDocument(); expect(await screen.findByRole('button', { name: /Parking/ })).toHaveAttribute('aria-pressed', 'true'); expect(screen.getByRole('button', { name: 'Floodlights' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByLabelText('₹ per hour')).not.toBeInTheDocument(); expect(screen.getByLabelText('PIN code')).toHaveValue('560038');
    expect(within(screen.getByLabelText('Saved photos')).getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('Pending review')).toBeInTheDocument(); expect(screen.getByLabelText('Other saved documents')).toHaveTextContent('Ownership / lease deed');
    expect(screen.queryByRole('heading', { name: 'Submit for approval' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Send for approval' })).toBeInTheDocument();
  });

  it('saving updates the existing venue and leaves its playing areas alone', async () => {
    await open();
    await userEvent.clear(screen.getByLabelText('Venue name')); await userEvent.type(screen.getByLabelText('Venue name'), 'Green Arena Pro');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(names()).toContain('PUT /owner/venues/v9/facilities'));
    expect(names()).toEqual(['PUT /owner/venues/v9', 'PUT /owner/venues/v9/sports', 'PUT /owner/venues/v9/facilities']);
    expect(calls[0].body.name).toBe('Green Arena Pro');
  });

  it('new files are uploaded on save, and saved photos can be removed or made the cover right away', async () => {
    await open();
    await userEvent.upload(screen.getByLabelText('Add photos and video'), png('new.png'));
    await userEvent.upload(screen.getByLabelText('Upload another document'), pdf('lease.pdf'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(names()).toContain('UPLOAD /owner/venues/v9/documents'));
    expect(names()).toContain('UPLOAD /owner/venues/v9/media'); expect(calls.at(-1)?.body).toEqual({ docType: 'Ownership / lease deed', file: 'lease.pdf' });
    window.confirm = () => true;
    await userEvent.click(within(screen.getByLabelText('Saved photos')).getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(names()).toContain('DELETE /owner/media/m1'));
    await userEvent.click(within(screen.getByLabelText('Saved photos')).getByRole('button', { name: 'Set cover' }));
    await waitFor(() => expect(names()).toContain('PUT /owner/media/m2/cover'));
  });

  it('submitting from the same page saves everything first, then submits', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(names().at(-1)).toBe('POST /owner/venues/v9/send-for-approval'));
    expect(names()[0]).toBe('PUT /owner/venues/v9');
  });

  it('can be sent for approval without prices; they are set while it is under approval', async () => {
    await open({ areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], pricing: [], availability: [] }] });
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(names().at(-1)).toBe('POST /owner/venues/v9/send-for-approval'));
  });

  it('is locked while under approval: fields are disabled and there is nothing to save or publish', async () => {
    await open({ status: 'pending' });
    expect(screen.getByText(/can't be changed while they are reviewed/)).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'prices' })).toBeInTheDocument();
    expect(screen.getByLabelText('Venue name')).toBeDisabled(); expect(screen.getByLabelText('Address line 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Send for approval' })).not.toBeInTheDocument();
  });

  it('once PlaynX approves it, the owner (not the admin) publishes it, and can unpublish it', async () => {
    await open({ status: 'ready' });
    expect(screen.queryByRole('button', { name: 'Send for approval' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish venue' }));
    await waitFor(() => expect(names()).toContain('POST /owner/venues/v9/publish'));
  });

  it('editing an approved venue sends the changes for approval and says customers keep the current version', async () => {
    await open({ status: 'approved', pendingChange: { fields: { name: 'Green Arena Pro' } } });
    expect(screen.getByText(/Customers still see the approved version/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Changes sent for approval/)).toBeInTheDocument();
  });

  it('the second phone number is added with a button, saved, and can be removed again', async () => {
    await open({ contact_phone: '+919800000001' });
    expect(screen.queryByLabelText('Second contact number')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Add another phone number' }));
    await userEvent.type(screen.getByLabelText('Second contact number'), '+919800000002');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/owner/venues/v9')?.body).toMatchObject({ contactPhone: '+919800000001', contactPhone2: '+919800000002' }));
  });
  it('shows a saved second number, and Remove clears it (sent as empty so the server removes it)', async () => {
    await open({ contact_phone: '+919800000001', contact_phone2: '+919800000002' });
    expect(screen.getByLabelText('Second contact number')).toHaveValue('+919800000002');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Second contact number')).toBeNull(); expect(screen.getByRole('button', { name: '+ Add another phone number' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/owner/venues/v9')?.body).toMatchObject({ contactPhone2: '' }));
  });
  it('checks both numbers, and refuses the same number twice', async () => {
    await open({ contact_phone: '+919800000001' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add another phone number' }));
    await userEvent.type(screen.getByLabelText('Second contact number'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Second contact number')); await userEvent.type(screen.getByLabelText('Second contact number'), '+919800000001');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use a different number from the first one')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/owner/venues/v9')).toBe(false);
  });
  it('says contact numbers change straight away, and that they are live when only they were changed', async () => {
    await open({ status: 'approved', contact_phone: '+919800000001' });
    expect(screen.getByText('Contact numbers change straight away, without approval.')).toBeInTheDocument();
    vi.mocked(api.put).mockImplementation((async (url: string, body: any) => { calls.push({ method: 'PUT', url, body }); return url === '/owner/venues/v9' ? { contactUpdated: true, pendingChange: false } : {}; }) as any);
    await userEvent.clear(screen.getByLabelText('Contact number')); await userEvent.type(screen.getByLabelText('Contact number'), '+919800000077');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Contact numbers updated. They are live now/)).toBeInTheDocument();
  });

  it('photos waiting for approval are marked, and a photo already marked for removal cannot be deleted again', async () => {
    await open({ status: 'approved', images: [{ id: 'm1', url: 'http://x/a.jpg', kind: 'image', is_cover: true }, { id: 'm2', url: 'http://x/b.jpg', kind: 'image', is_pending: true }, { id: 'm3', url: 'http://x/c.jpg', kind: 'image', delete_requested: true }] });
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument(); expect(screen.getByText('Removal awaiting approval')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Saved photos')).getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('a published venue offers Unpublish', async () => {
    await open({ status: 'approved' });
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(names()).toContain('POST /owner/venues/v9/unpublish'));
  });

  it('a venue that is already submitted or live can only be saved, not submitted again', async () => {
    await open({ status: 'approved' });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit for approval/i })).not.toBeInTheDocument();
  });

  it('a rejected electricity bill is explained and must be replaced', async () => {
    await open({ documents: [{ id: 'd1', doc_type: 'Electricity bill', status: 'rejected', url: null, note: 'Address not visible' }] });
    expect(screen.getByText(/Address not visible/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText('Upload the electricity bill')).toBeInTheDocument();
  });

  it('venue category, free-cancellation window, contact number and contact email are required when editing (the Add venue form does not ask for them)', async () => {
    await open({ category: null, contact_phone: null, contact_email: null, cancellation_hours: 24 });
    await userEvent.clear(screen.getByLabelText(/^Free-cancellation window/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Select the venue category')).toBeInTheDocument();
    expect(screen.getByText('Enter the contact number')).toBeInTheDocument(); expect(screen.getByText('Enter the contact email')).toBeInTheDocument();
    expect(screen.getByText('Enter 0 to 168 hours')).toBeInTheDocument();
    for (const l of [/^Venue category/, /^Free-cancellation window/, /^Contact number/, /^Contact email/]) expect(screen.getByLabelText(l)).toHaveAttribute('aria-required', 'true');
    expect(calls.some((c) => c.url === '/owner/venues/v9')).toBe(false); // nothing was sent
  });

  it('the Add venue form needs a photo, the electricity bill and the land proof', async () => {
    renderPage();
    await userEvent.type(await screen.findByLabelText('Venue name'), 'New Arena');
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByText('Add at least one photo')).toBeInTheDocument();
    expect(screen.getByText('Upload the electricity bill')).toBeInTheDocument(); expect(screen.getByText('Upload the land proof of the venue')).toBeInTheDocument(); expect(screen.getByText('Record a geo-tagged video at the venue.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Photos and documents/ })).toHaveTextContent('*');
    expect(calls.some((c) => c.url === '/owner/venues')).toBe(false);
  });

  it('sports available is required, and needs no playing area to send the venue for approval', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Create venue' }));
    expect(await screen.findByText('Select at least one sport')).toBeInTheDocument();
    expect(screen.getByText('Sports available').className).toContain('after:content');
    expect(screen.queryByText(/Add a playing area with its sports, prices and hours/)).not.toBeInTheDocument(); // an area is not part of approval
    expect(screen.queryByRole('link', { name: 'Go to Playing areas' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Football' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    await waitFor(() => expect(screen.queryByText('Select at least one sport')).not.toBeInTheDocument());
  });
});
