import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), uploadAvatar: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/razorpay', () => ({ openCheckout: vi.fn(), isPaymentNotCompleted: () => false }));
vi.mock('../src/components/GoogleSignIn', () => ({ GoogleSignIn: () => null }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import { CompleteProfilePage, ForgotPasswordPage, LoginPage, RegisterPage, VerifyAccountPage } from '../src/pages/auth/AuthPages';
import { BookingWidget } from '../src/components/BookingWidget';
import { RequireRole } from '../src/components/Layouts';

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const wrap = (ui: React.ReactNode, route: any = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={[route]}><AuthProvider>{ui}<Where /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
};
const sports = { sports: [{ id: 1, name: 'Football', slug: 'football' }, { id: 2, name: 'Cricket', slug: 'cricket' }] };
const customer = { id: 'u1', email: 'asha@x.co', phone: '+919876543210', fullName: 'Asha Rao', role: 'customer', adminRole: null, emailVerified: false, phoneVerified: false };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/sports' ? sports : url === '/auth/verification-options' ? { email: true, sms: true } : {})); });

const fill = async (over: Partial<Record<string, string>> = {}) => {
  const v = { 'Full name': 'Asha Rao', 'Mobile number': '9876543210', 'Email address': 'asha@x.co', Password: 'Secret123x', 'Confirm password': 'Secret123x', ...over };
  for (const [label, val] of Object.entries(v)) if (val) await userEvent.type(screen.getByLabelText(label), val);
};

describe('customer signup', () => {
  it('shows a field-level message for every missing or invalid mandatory field and does not call the API', async () => {
    wrap(<RegisterPage portal="customer" />, "/register?as=customer");
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    for (const m of ['Enter your full name', 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210', 'Enter a valid email address', 'At least 8 characters with a letter and a digit', 'Confirm your password']) expect((await screen.findAllByText(m)).length).toBeGreaterThan(0);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('requires the two passwords to match and marks mandatory fields', async () => {
    wrap(<RegisterPage portal="customer" />, "/register?as=customer");
    await fill({ 'Confirm password': 'Secret123y' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-required', 'true');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('offers optional picture, sport and location, and show/hide on both password fields', async () => {
    wrap(<RegisterPage portal="customer" />, "/register?as=customer");
    expect(await screen.findByLabelText('Profile picture')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Football' })).toBeInTheDocument();
    expect(screen.getByLabelText('Preferred location')).toBeInTheDocument();
    const pw = screen.getByLabelText('Password'); expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getAllByRole('button', { name: /password/i })).toHaveLength(2);
  });
  it('asks whether you are a customer or a venue owner before showing any form', async () => {
    wrap(<Routes><Route path="/register" element={<RegisterPage portal="customer" />} /></Routes>, '/register');
    const group = await screen.findByRole('group', { name: 'Choose account type' });
    expect(screen.queryByLabelText(/Full name/)).toBeNull();
    expect(within(group).getByRole('link', { name: /Customer/ })).toHaveAttribute('href', '/register?as=customer');
    expect(within(group).getByRole('link', { name: /Venue owner/ })).toHaveAttribute('href', '/owner/register');
  });
  it('the venue owner card has a View more button that opens the full description in a pop-up', async () => {
    wrap(<Routes><Route path="/register" element={<RegisterPage portal="customer" />} /></Routes>, '/register');
    const group = await screen.findByRole('group', { name: 'Choose account type' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(group).getAllByRole('button', { name: 'View more' })[1]); // the venue owner card
    const dlg = await screen.findByRole('dialog');
    for (const x of ['Main responsibilities', 'Available functionality', 'Staff management']) expect(within(dlg).getByText(x)).toBeInTheDocument();
    expect(within(dlg).getByText(/starting point of the venue hierarchy/)).toBeInTheDocument();
    expect(within(dlg).getByRole('link', { name: 'Register as a venue owner' })).toHaveAttribute('href', '/owner/register');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('the customer card also has a View more pop-up with what a customer can do', async () => {
    wrap(<Routes><Route path="/register" element={<RegisterPage portal="customer" />} /></Routes>, '/register');
    const group = await screen.findByRole('group', { name: 'Choose account type' });
    await userEvent.click(within(group).getAllByRole('button', { name: 'View more' })[0]);
    const dlg = await screen.findByRole('dialog');
    for (const x of ['Find the right turf', 'Book and pay', 'Manage your games', 'After the game']) expect(within(dlg).getByText(x)).toBeInTheDocument();
    expect(within(dlg).getByRole('link', { name: 'Sign up as a customer' })).toHaveAttribute('href', '/register?as=customer');
  });
  it('registers with mobile, confirm password and preferences, then goes to verification, carrying the return path', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 't', user: customer });
    wrap(<Routes><Route path="/register" element={<RegisterPage portal="customer" />} /><Route path="/verify-account" element={<p>verify page</p>} /></Routes>, { pathname: '/register', search: '?as=customer', state: { from: '/venues/v1' } });
    await fill();
    await userEvent.selectOptions(await screen.findByLabelText('Preferred sport'), 'football');
    await userEvent.type(screen.getByLabelText('Preferred location'), 'Chennai');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ role: 'customer', phone: '9876543210', email: 'asha@x.co', confirmPassword: 'Secret123x', preferredSports: ['football'], city: 'Chennai' })));
    expect(await screen.findByText('verify page')).toBeInTheDocument();
  });
  it('shows the server\'s "already registered" reason next to the field', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { error: { code: 'phone_taken', message: 'An account with this mobile number already exists.', details: { field: 'phone' } } } } });
    wrap(<RegisterPage portal="customer" />, "/register?as=customer");
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const msgs = await screen.findAllByText(/mobile number already exists/);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true');
  });
  it('rejects a non-image profile picture before submitting', async () => {
    wrap(<RegisterPage portal="customer" />, "/register?as=customer");
    await userEvent.upload(screen.getByLabelText('Profile picture'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect(await screen.findByText('Use a JPG, PNG or WebP image')).toBeInTheDocument();
  });
});

describe('login page', () => {
  it('has show/hide, forgot password, no remember me, and a create-account link that keeps the return path', async () => {
    wrap(<LoginPage portal="customer" />, { pathname: '/login', state: { from: '/venues/v1' } });
    const pw = screen.getByLabelText('Password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.queryByLabelText(/Remember me/)).toBeNull(); // closing the browser always signs out
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
  });
  it('sends the customer back to the turf they were booking after logging in', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 't', user: { ...customer, emailVerified: true } });
    wrap(<Routes><Route path="/login" element={<LoginPage portal="customer" />} /><Route path="/venues/:id" element={<p>turf page</p>} /></Routes>, { pathname: '/login', state: { from: '/venues/v1?x=1' } });
    await userEvent.type(screen.getByLabelText('Email or mobile number'), '9876543210');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('turf page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/venues/v1?x=1');
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: '9876543210', password: 'Secret123x', remember: true });
  });
  it('ignores a second click while a login is in flight', async () => {
    let release!: (v: any) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((r) => { release = r; }));
    wrap(<LoginPage portal="customer" />);
    await userEvent.type(screen.getByLabelText('Email or mobile number'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123x');
    const btn = screen.getByRole('button', { name: 'Log in' });
    await userEvent.click(btn); await userEvent.click(btn);
    expect(api.post).toHaveBeenCalledTimes(1);
    release({ token: 't', user: customer });
  });
});

describe('verify account page', () => {
  const login = async () => { vi.mocked(api.post).mockResolvedValueOnce({ token: 't', user: customer }); };
  it('only asks for the email code when the server has no SMS provider, and does not show a mobile box', async () => {
    sessionStorage.setItem('playnx_token', 't');
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: customer } : url === '/auth/verification-options' ? { email: true, sms: false } : {}));
    wrap(<VerifyAccountPage />, { pathname: '/verify-account', state: { fresh: true } });
    expect(await screen.findByLabelText('Email verification code')).toBeInTheDocument();
    expect(screen.getByText(/We sent a 6-digit code to asha@x.co/)).toBeInTheDocument(); // the code goes to the address that signed up
    expect(screen.queryByTestId('verify-phone')).toBeNull();
  });
  it('cannot be skipped: Continue stays disabled until the email is verified, and there is no "verify later"', async () => {
    sessionStorage.setItem('playnx_token', 't');
    let verified = false;
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: { ...customer, emailVerified: verified } } : url === '/auth/verification-options' ? { email: true, sms: false } : {}));
    vi.mocked(api.post).mockImplementation(async (url: string) => { if (url === '/auth/otp/verify') verified = true; return {}; });
    wrap(<Routes><Route path="/verify-account" element={<VerifyAccountPage />} /><Route path="/home" element={<p>home page</p>} /></Routes>, { pathname: '/verify-account', state: { fresh: true } });
    const cont = await screen.findByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled(); expect(screen.queryByRole('button', { name: /later/i })).toBeNull();
    await userEvent.type(await screen.findByLabelText('Email verification code'), '123456'); await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('home page')).toBeInTheDocument();
  });
  it('someone who logs in unverified gets a "Send code" button instead of a code that was never sent', async () => {
    sessionStorage.setItem('playnx_token', 't');
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: customer } : url === '/auth/verification-options' ? { email: true, sms: false } : {}));
    wrap(<VerifyAccountPage />);
    expect(await screen.findByRole('button', { name: 'Send code' })).toBeInTheDocument(); expect(screen.getByText(/We will send a 6-digit code/)).toBeInTheDocument();
  });
  it('lets people through when the server has no email provider at all, since no code could ever arrive', async () => {
    sessionStorage.setItem('playnx_token', 't');
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: customer } : url === '/auth/verification-options' ? { email: false, sms: false } : {}));
    wrap(<VerifyAccountPage />);
    expect(await screen.findByText(/cannot send email yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
  it('verifies the email only after the server accepts the code', async () => {
    sessionStorage.setItem('playnx_token', 't');
    let verified = false;
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: { ...customer, emailVerified: verified } } : url === '/auth/verification-options' ? { email: true, sms: true } : {}));
    vi.mocked(api.post).mockImplementation(async (url: string, body: any) => { if (url === '/auth/otp/verify') { if (body.code !== '123456') throw { response: { data: { error: { message: 'Incorrect code' } } } }; verified = true; } return {}; });
    wrap(<VerifyAccountPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: /Send code|Resend/ }))[0]);
    const box = await screen.findByLabelText('Email verification code');
    await userEvent.type(box, '000000'); await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText('Incorrect code')).toBeInTheDocument();
    await userEvent.clear(box); await userEvent.type(box, '123456'); await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0));
    void login;
  });
});

describe('forgot password', () => {
  it('requests a code, then needs matching strong passwords before resetting and returns to login', async () => {
    vi.mocked(api.post).mockResolvedValue({});
    wrap(<><ForgotPasswordPage /><Routes><Route path="/login" element={<p>login page</p>} /></Routes></>);
    await userEvent.type(screen.getByLabelText('Email or mobile number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: '9876543210' });
    await userEvent.type(await screen.findByLabelText('6-digit code'), '123456');
    await userEvent.type(screen.getByLabelText('New password'), 'weak');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('At least 8 characters with a letter and a digit', { selector: '[role=alert]' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('New password')); await userEvent.type(screen.getByLabelText('New password'), 'Brandnew123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Different123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Confirm new password')); await userEvent.type(screen.getByLabelText('Confirm new password'), 'Brandnew123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { email: '9876543210', code: '123456', newPassword: 'Brandnew123', confirmPassword: 'Brandnew123' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});

describe('returning to the booking after login', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }] }];
  const slots = [{ startsAt: '2030-01-01T04:30:00.000Z', endsAt: '2030-01-01T05:30:00.000Z', price: 800, available: true }];
  it('saves the chosen slot when an anonymous customer clicks book, and restores it for the same venue', async () => {
    vi.mocked(api.get).mockResolvedValue({ slots, timezone: 'Asia/Kolkata' });
    const first = wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />, '/venues/v1');
    await userEvent.click((await screen.findAllByRole('option', { name: /AM|PM/i }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /Log in to book/ }));
    const saved = JSON.parse(sessionStorage.getItem('playnx_booking_draft')!);
    expect(saved).toMatchObject({ venueId: 'v1', areaId: 'a1', sportId: 1, startsAt: slots[0].startsAt });
    expect(screen.getByTestId('where')).toHaveTextContent('/login');
    first.unmount();
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />, '/venues/v1');
    expect(await screen.findByText('Total')).toBeInTheDocument(); // slot is selected again without the customer doing anything
    expect(sessionStorage.getItem('playnx_booking_draft')).toBeNull();
  });
  it('does not restore a draft that belongs to a different venue', async () => {
    sessionStorage.setItem('playnx_booking_draft', JSON.stringify({ venueId: 'other', areaId: 'a1', sportId: 1, date: '2030-01-01', duration: 60, startsAt: slots[0].startsAt, savedAt: Date.now() }));
    vi.mocked(api.get).mockResolvedValue({ slots, timezone: 'Asia/Kolkata' });
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />);
    await screen.findAllByRole('option', { name: /AM|PM/i });
    expect(screen.queryByText('Total')).toBeNull();
  });
});

describe('complete profile (Google sign-up)', () => {
  it('asks a phone-less customer for a valid mobile, saves it, then offers verification', async () => {
    sessionStorage.setItem('playnx_token', 't');
    const g = { ...customer, phone: null, emailVerified: true };
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: g } : url === '/sports' ? sports : url === '/auth/verification-options' ? { email: true, sms: true } : {}));
    vi.mocked(api.put).mockResolvedValue({ user: { ...g, phone: '+919876543210' } });
    wrap(<CompleteProfilePage />);
    await userEvent.type(await screen.findByLabelText('Mobile number'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect((await screen.findAllByText('Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210')).length).toBeGreaterThan(0);
    expect(api.put).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Mobile number')); await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/me/profile', { phone: '9876543210' }));
    expect(await screen.findByTestId('verify-phone')).toBeInTheDocument();
  });
});

describe('unverified customers are held at the email step', () => {
  const pages = (email: boolean) => {
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: customer } : url === '/auth/verification-options' ? { email, sms: false } : {}));
    return <Routes><Route path="/login" element={<LoginPage portal="customer" />} /><Route path="/verify-account" element={<p>verify page</p>} />
      <Route path="/bookings" element={<RequireRole role="customer"><p>my bookings</p></RequireRole>} /></Routes>;
  };
  it('sends an unverified customer to verification after login, whatever page they were heading to', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 't', user: customer });
    wrap(pages(true), { pathname: '/login', state: { from: '/venues/v1' } });
    await userEvent.type(screen.getByLabelText('Email or mobile number'), 'asha@x.co'); await userEvent.type(screen.getByLabelText('Password'), 'Secret123x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('verify page')).toBeInTheDocument();
  });
  it('keeps an unverified customer out of customer pages and sends them to verify', async () => {
    sessionStorage.setItem('playnx_token', 't');
    wrap(pages(true), '/bookings');
    expect(await screen.findByText('verify page')).toBeInTheDocument(); expect(screen.queryByText('my bookings')).toBeNull();
  });
  it('does not lock customers out when the server cannot send email', async () => {
    sessionStorage.setItem('playnx_token', 't');
    wrap(pages(false), '/bookings');
    expect(await screen.findByText('my bookings')).toBeInTheDocument();
  });
  it('lets a verified customer straight in', async () => {
    sessionStorage.setItem('playnx_token', 't');
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: { ...customer, emailVerified: true } } : url === '/auth/verification-options' ? { email: true, sms: false } : {}));
    wrap(<Routes><Route path="/bookings" element={<RequireRole role="customer"><p>my bookings</p></RequireRole>} /></Routes>, '/bookings');
    expect(await screen.findByText('my bookings')).toBeInTheDocument();
  });
});
