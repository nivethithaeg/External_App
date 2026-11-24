import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/maps', async (orig) => ({ ...(await orig() as any), LocationPicker: () => null }));

import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { AuthProvider } from '../src/lib/auth';
import { AreasTab } from '../src/pages/owner/VenueEditor';
import { BookingWidget } from '../src/components/BookingWidget';

const calls: { method: string; url: string; body?: any }[] = [];
const liveChecks: Record<string, any>[] = []; let liveReply: any;
let position: { latitude: number; longitude: number; accuracy: number } | null; let geoError: { code: number } | null; let stopped: number; let cameraError: Error | null;
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
const venue = (over: any = {}) => ({ id: 'v1', name: 'Turf 1', status: 'draft', images: [], areas: [], ...over });
const refusal = (code: string, message: string) => Object.assign(new Error(code), { response: { data: { error: { code, message } } } });

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; localStorage.clear(); liveChecks.length = 0; stopped = 0; cameraError = null; geoError = null;
  position = { latitude: 12.9717, longitude: 77.5947, accuracy: 10 };
  URL.createObjectURL = () => 'blob:preview'; URL.revokeObjectURL = () => {}; // jsdom has neither
  // the camera, the phone's location and the canvas that a real phone provides
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => { if (cameraError) throw cameraError; return { getTracks: () => [{ stop: () => { stopped++; } }] }; }) } });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition: vi.fn((ok: (p: any) => void, fail: (e: any) => void) => { if (geoError) fail(geoError); else if (position) ok({ coords: position }); return 7; }), clearWatch: vi.fn() } });
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as any;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['jpeg'], { type: 'image/jpeg' })); } as any;
  HTMLMediaElement.prototype.play = (() => Promise.resolve()) as any;
  vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/sports' ? { sports: [{ id: 1, name: 'Football' }, { id: 2, name: 'Cricket' }] } : {}));
  vi.mocked(api.post).mockImplementation((async (url: string, body: any) => { calls.push({ method: 'POST', url, body }); return url.endsWith('/areas') ? { area: { id: 'a9' } } : {}; }) as any);
  vi.mocked(api.put).mockImplementation((async (url: string, body: any) => { calls.push({ method: 'PUT', url, body }); return {}; }) as any);
  vi.mocked(api.del).mockImplementation((async (url: string) => { calls.push({ method: 'DELETE', url }); return {}; }) as any);
  liveReply = { data: { ok: true, proof: 'proof-1', lat: 12.9717, lng: 77.5947, address: '12, Park Road, Indiranagar, Bengaluru, Karnataka, 560038, India', distanceM: 40, accuracyM: 10, maxMeters: 500 } };
  vi.spyOn(api.api, 'post').mockImplementation((async (url: string, body: FormData) => {
    if (url.endsWith('/live-check')) { liveChecks.push(Object.fromEntries([...body.entries()].map(([k, v]) => [k, v instanceof File ? v.name : v]))); if (liveReply instanceof Error) throw liveReply; return liveReply; }
    calls.push({ method: 'UPLOAD', url, body: Object.fromEntries([...body.entries()].map(([k, v]) => [k, v instanceof File ? v.name : v])) }); return { data: {} };
  }) as any);
});
afterEach(() => { delete (navigator as any).mediaDevices; delete (navigator as any).geolocation; });

const openNew = async (v = venue()) => { wrap(<AreasTab venue={v} />); await userEvent.click(await screen.findByRole('button', { name: '+ Add area' })); return screen.findByRole('dialog', { name: 'Add playing area' }); };
const fillArea = async (dlg: HTMLElement) => { await userEvent.type(within(dlg).getByLabelText(/^Playing area name/), 'Turf A'); await userEvent.type(within(dlg).getByLabelText(/^Default price/), '1000'); await userEvent.click(within(dlg).getByRole('button', { name: 'Football' }));
  await userEvent.selectOptions(within(dlg).getByLabelText(/^Indoor or Outdoor/), 'outdoor'); await userEvent.selectOptions(within(dlg).getByLabelText(/^Ground Shape/), 'rectangle'); }; // JusGo's required choices
/** Opens the camera, waits for camera and location, takes the photo, and (by default) keeps it after reviewing where it was taken. Returns the camera window. */
const takePhoto = async (dlg: HTMLElement, keep = true) => {
  await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
  const cam = await screen.findByRole('dialog', { name: 'Take a live photo' });
  await within(cam).findByText(/Camera ready/); await within(cam).findByText(/Location found/);
  await userEvent.click(within(cam).getByRole('button', { name: '📷 Take photo' }));
  if (keep) await userEvent.click(await within(cam).findByRole('button', { name: 'Use this photo' }));
  return cam;
};

describe('live photos in the playing area form', () => {
  it('offers both an upload from the device and a live camera, and says a photo is required', async () => {
    const dlg = await openNew();
    expect(within(dlg).getByLabelText('Upload area photos')).toBeInTheDocument(); // photos can be picked from files
    expect(within(dlg).getByRole('button', { name: '📷 Take live photo' })).toBeInTheDocument(); // or taken live
    expect(dlg).toHaveTextContent(/Take a live photo at the turf with the camera in this app/); expect(dlg).toHaveTextContent(/required for a new playing area/);
    expect(within(dlg).getByText('Photos')).toHaveClass("after:content-['*']"); // required
  });

  it('opens a live camera, reads the live location, takes the photo and has the server check it', async () => {
    const dlg = await openNew();
    const cam = await takePhoto(dlg);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Take a live photo' })).toBeNull()); // closes once the photo is kept
    expect(liveChecks).toEqual([{ file: expect.stringMatching(/^live-\d+\.jpg$/), lat: '12.9717', lng: '77.5947', accuracy: '10' }]); // the live location goes with the photo
    expect(within(dlg).getByAltText('New live photo 1')).toBeInTheDocument(); expect(within(dlg).getByText('📍 40 m')).toBeInTheDocument();
    expect(within(dlg).getByText(/1 live photo with a verified location/)).toBeInTheDocument();
    void cam;
  });

  it('straight after the photo is taken it shows the latitude, longitude and address of where it was taken', async () => {
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    const cam = await screen.findByRole('dialog', { name: 'Take a live photo' });
    await within(cam).findByText(/Location found/); await userEvent.click(within(cam).getByRole('button', { name: '📷 Take photo' }));
    const review = await within(cam).findByRole('region', { name: 'Where the photo was taken' });
    expect(within(review).getByText('Latitude').nextElementSibling).toHaveTextContent('12.971700');
    expect(within(review).getByText('Longitude').nextElementSibling).toHaveTextContent('77.594700');
    expect(within(review).getByText('Address').nextElementSibling).toHaveTextContent('12, Park Road, Indiranagar, Bengaluru, Karnataka, 560038, India');
    expect(within(review).getByText('From venue').nextElementSibling).toHaveTextContent('40 m away'); expect(within(review).getByAltText('The photo you just took')).toBeInTheDocument();
    expect(within(dlg).queryByAltText('New live photo 1')).toBeNull(); // not kept yet
  });

  it('Retake throws the photo away and goes back to the camera; Use this photo keeps it with its details in the form', async () => {
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    const cam = await screen.findByRole('dialog', { name: 'Take a live photo' });
    await within(cam).findByText(/Location found/); await userEvent.click(within(cam).getByRole('button', { name: '📷 Take photo' }));
    await userEvent.click(await within(cam).findByRole('button', { name: 'Retake' }));
    expect(within(cam).queryByRole('region', { name: 'Where the photo was taken' })).toBeNull(); expect(within(cam).getByRole('button', { name: '📷 Take photo' })).toBeEnabled();
    expect(within(dlg).queryByAltText('New live photo 1')).toBeNull();
    await userEvent.click(within(cam).getByRole('button', { name: '📷 Take photo' })); await userEvent.click(await within(cam).findByRole('button', { name: 'Use this photo' }));
    const item = (await within(dlg).findByAltText('New live photo 1')).closest('li')!;
    expect(item).toHaveTextContent('12.971700, 77.594700'); expect(item).toHaveTextContent('12, Park Road, Indiranagar, Bengaluru, Karnataka, 560038, India'); expect(item).toHaveTextContent('📍 40 m from your venue');
  });

  it('says so when no address could be found for the spot, and still lets the photo be used', async () => {
    liveReply = { data: { ok: true, proof: 'p', lat: 12.9717, lng: 77.5947, address: null, distanceM: 12, accuracyM: 5, maxMeters: 500 } };
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    const cam = await screen.findByRole('dialog', { name: 'Take a live photo' });
    await within(cam).findByText(/Location found/); await userEvent.click(within(cam).getByRole('button', { name: '📷 Take photo' }));
    expect(await within(cam).findByText('Address not available for this spot')).toBeInTheDocument();
    await userEvent.click(within(cam).getByRole('button', { name: 'Use this photo' }));
    expect((await within(dlg).findByAltText('New live photo 1')).closest('li')).toHaveTextContent('Address not available');
  });

  it('cannot take the photo until the camera is ready and the location is found', async () => {
    position = null; // no fix yet
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    const cam = await screen.findByRole('dialog', { name: 'Take a live photo' });
    await within(cam).findByText(/Camera ready/);
    expect(within(cam).getByText('Finding your location…')).toBeInTheDocument(); expect(within(cam).getByRole('button', { name: '📷 Take photo' })).toBeDisabled();
  });

  it('says what to do when the camera or the location is blocked', async () => {
    cameraError = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    expect(await screen.findByText(/Camera access was blocked/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Take a live photo' })).getByRole('button', { name: 'Cancel' }));
    cameraError = null; geoError = { code: 1 };
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    expect(await screen.findByText(/Location access was blocked/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Take a live photo' })).getByRole('button', { name: '📷 Take photo' })).toBeDisabled();
  });

  it('warns when the location is too rough, and shows the server\'s refusal without adding the photo', async () => {
    position = { latitude: 12.97, longitude: 77.59, accuracy: 900 };
    liveReply = refusal('location_inaccurate', 'Your location is only accurate to about 900 m. Step outside onto the turf, turn on precise location (GPS), wait a few seconds and take the photo again.');
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    const cam = await screen.findByRole('dialog', { name: 'Take a live photo' });
    expect(await within(cam).findByText(/Too rough: step outside/)).toBeInTheDocument();
    await userEvent.click(within(cam).getByRole('button', { name: '📷 Take photo' }));
    expect(await within(cam).findByText(/only accurate to about 900 m/)).toBeInTheDocument();
    await userEvent.click(within(cam).getByRole('button', { name: 'Cancel' }));
    expect(within(dlg).queryByAltText('New live photo 1')).toBeNull();
  });

  it('a photo taken away from the venue is refused with how far away it was, and not added', async () => {
    liveReply = refusal('geotag_far', 'You are about 3.2 km from the location pinned for this venue. Take the photo at the turf (within 500 m), or correct the venue\'s pinned location.');
    const dlg = await openNew();
    const cam = await takePhoto(dlg, false);
    expect(await within(cam).findByText(/about 3.2 km from the location pinned/)).toBeInTheDocument();
    await userEvent.click(within(cam).getByRole('button', { name: 'Cancel' }));
    expect(within(dlg).queryByAltText('New live photo 1')).toBeNull();
  });

  it('turns the camera off when the window closes', async () => {
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole('button', { name: '📷 Take live photo' }));
    const cam = await screen.findByRole('dialog', { name: 'Take a live photo' }); await within(cam).findByText(/Camera ready/);
    await userEvent.click(within(cam).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(stopped).toBe(1));
    expect((navigator.geolocation.clearWatch as any)).toHaveBeenCalledWith(7); // and stops following the location
  });

  it('a new playing area needs a live geo-tagged photo: without one nothing is created and the form says why', async () => {
    const dlg = await openNew(); await fillArea(dlg);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText(/Take a live photo of the playing area at the turf/)).toBeInTheDocument();
    expect(calls).toEqual([]);
    await userEvent.upload(within(dlg).getByLabelText('Upload area photos'), new File([new Uint8Array(50)], 'pitch.png', { type: 'image/png' })); // a photo from the files alone is not enough
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText(/Take a live photo of the playing area at the turf/)).toBeInTheDocument(); expect(calls).toEqual([]);
  });

  it('an extra photo from the files is sent with just the file (no live proof), after the live photo', async () => {
    const dlg = await openNew(); await fillArea(dlg); await takePhoto(dlg);
    await userEvent.upload(within(dlg).getByLabelText('Upload area photos'), new File([new Uint8Array(50)], 'pitch.png', { type: 'image/png' }));
    expect(await within(dlg).findByText('pitch.png')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'UPLOAD')).toHaveLength(2));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /owner/venues/v1/areas', 'UPLOAD /owner/venues/v1/media', 'UPLOAD /owner/venues/v1/media']);
    expect(liveChecks).toHaveLength(1); // only the live photo was checked; the file was not
  });

  it('a new playing area asks for a default price: required, and sent with the area', async () => {
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Playing area name/), 'Turf A'); await userEvent.click(within(dlg).getByRole('button', { name: 'Football' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText(/Enter the default price/)).toBeInTheDocument(); expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await userEvent.type(within(dlg).getByLabelText(/^Default price/), '1200');
    await userEvent.selectOptions(within(dlg).getByLabelText(/^Indoor or Outdoor/), 'outdoor'); await userEvent.selectOptions(within(dlg).getByLabelText(/^Ground Shape/), 'rectangle');
    await takePhoto(dlg);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/owner/venues/v1/areas')?.body).toMatchObject({ name: 'Turf A', defaultPrice: 1200 }));
  });

  it('rejects a file that is not an image', async () => {
    const dlg = await openNew();
    await userEvent.upload(within(dlg).getByLabelText('Upload area photos'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect(await within(dlg).findByText(/notes.pdf: use a JPG, PNG or WebP up to 8 MB/)).toBeInTheDocument();
  });

  it('after the area is created, uploads each live photo with the server\'s proof, and nothing else', async () => {
    const dlg = await openNew(); await fillArea(dlg);
    await takePhoto(dlg); await waitFor(() => expect(within(dlg).queryByAltText('New live photo 1')).not.toBeNull());
    liveReply = { data: { ok: true, proof: 'proof-2', distanceM: 15, accuracyM: 6, maxMeters: 500 } };
    await takePhoto(dlg); await waitFor(() => expect(within(dlg).queryByAltText('New live photo 2')).not.toBeNull());
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'UPLOAD')).toHaveLength(2));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /owner/venues/v1/areas', 'UPLOAD /owner/venues/v1/media', 'UPLOAD /owner/venues/v1/media']);
    expect(calls[1].body).toEqual({ areaId: 'a9', proof: 'proof-1', file: expect.stringMatching(/^live-\d+\.jpg$/) });
    expect(calls[2].body).toEqual({ areaId: 'a9', proof: 'proof-2', file: expect.stringMatching(/^live-\d+\.jpg$/) });
  });

  it('a photo can be taken out again before saving', async () => {
    const dlg = await openNew();
    await takePhoto(dlg); await waitFor(() => expect(within(dlg).queryByAltText('New live photo 1')).not.toBeNull());
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove new live photo 1' }));
    expect(within(dlg).queryByAltText('New live photo 1')).toBeNull();
  });

  it('when editing, an area that already has a live photo with a location needs no new one, and shows where it was taken', async () => {
    const v = venue({ areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, environment: 'outdoor', turf_shape: 'rectangle', is_active: true, pricing: [], availability: [] }],
      images: [{ id: 'g1', url: 'https://x/geo.jpg', kind: 'image', area_id: 'a1', geo_lat: 12.97, geo_lng: 77.59, geo_distance_m: 25, geo_address: '5 Test Street, Bengaluru' }, { id: 'o1', url: 'https://x/other.jpg', kind: 'image', area_id: 'a2', geo_lat: 1, geo_distance_m: 5 }] });
    wrap(<AreasTab venue={v} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    const list = within(dlg).getByLabelText('Area photos'); expect(within(list).getAllByRole('img')).toHaveLength(1); expect(within(list).getByText('📍 25 m')).toBeInTheDocument(); // not the other area's photo
    expect(list).toHaveTextContent('12.970000, 77.590000'); expect(list).toHaveTextContent('5 Test Street, Bengaluru'); // where each saved photo was taken
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toEqual([{ method: 'PUT', url: '/owner/areas/a1', body: expect.any(Object) }]));
  });

  it('an old area whose photos have no location can still be saved, and saved photos can be removed', async () => {
    const v = venue({ areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, environment: 'outdoor', turf_shape: 'rectangle', is_active: true, pricing: [], availability: [] }],
      images: [{ id: 'm1', url: 'https://x/a1.jpg', kind: 'image', area_id: 'a1', geo_lat: null, is_pending: false }] });
    wrap(<AreasTab venue={v} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove saved photo' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', url: '/owner/media/m1' }));
  });
  it('an area with a saved photo (even one without a location) saves without taking another', async () => {
    const v = venue({ areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, environment: 'outdoor', turf_shape: 'rectangle', is_active: true, pricing: [], availability: [] }],
      images: [{ id: 'm1', url: 'https://x/a1.jpg', kind: 'image', area_id: 'a1', geo_lat: null, is_pending: false }] });
    wrap(<AreasTab venue={v} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/owner/areas/a1')).toBe(true));
  });

  it('stops at 10 photos per area', async () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, url: `https://x/${i}.jpg`, kind: 'image', area_id: 'a1', geo_lat: 12.97, geo_distance_m: 10 }));
    wrap(<AreasTab venue={venue({ areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, environment: 'outdoor', turf_shape: 'rectangle', is_active: true, pricing: [], availability: [] }], images })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: '📷 Take live photo' })).toBeDisabled();
  });

  it('says new photos on a live venue wait for approval', async () => {
    const dlg = await openNew(venue({ status: 'approved' }));
    await takePhoto(dlg); await waitFor(() => expect(within(dlg).queryByAltText('New live photo 1')).not.toBeNull());
    expect(within(dlg).getByText(/after KickOff approves them/)).toBeInTheDocument();
  });
});

describe('customers see the selected area\'s photos', () => {
  const areas = [
    { id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], images: [{ id: 'i1', url: 'https://x/a1.jpg' }, { id: 'i2', url: 'https://x/a2.jpg' }] },
    { id: 'a2', name: 'Court B', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], images: [] }];
  it('shows a photo strip for an area that has photos and nothing for one that has none', async () => {
    vi.mocked(api.get).mockResolvedValue({ slots: [], timezone: 'Asia/Kolkata' });
    wrap(<BookingWidget venueId="v1" venueName="Turf 1" areas={areas} />);
    const strip = await screen.findByLabelText('Photos of Turf A');
    expect(within(strip).getAllByRole('img')).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('Playing area'), 'a2');
    expect(screen.queryByLabelText('Photos of Court B')).toBeNull(); expect(screen.queryByLabelText('Photos of Turf A')).toBeNull();
  });
});
