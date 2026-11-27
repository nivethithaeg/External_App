import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') } }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const ADMIN = { id: 'a1', email: 'boss@playnx.test', phone: null, fullName: 'Boss', role: 'admin', adminRole: 'super_admin', emailVerified: true, phoneVerified: false };
const renderAt = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
};
let posts: [string, any][] = [];
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); posts = [];
  vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/auth/me' ? { user: ADMIN } : url === '/me/notifications' ? { notifications: [], unread: 0 } : {}) as any);
});
const fillLogin = async () => {
  await userEvent.type(await screen.findByLabelText(/email or mobile number/i), ADMIN.email);
  await userEvent.type(screen.getByLabelText(/^password/i), 'AdminPass12345');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
};

describe('admin sign-in with Google Authenticator', () => {
  it('first time: shows the QR code and setup key, then the code signs in', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string, body: any) => {
      posts.push([url, body]);
      if (url === '/auth/login') return { mfaSetupRequired: true, mfaToken: 'ticket', secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', otpauthUrl: 'otpauth://totp/PlaynX:boss?secret=ABC' } as any;
      if (url === '/auth/mfa/verify') return { token: 'session', user: ADMIN } as any;
      return {} as any;
    });
    renderAt('/admin/login');
    await fillLogin();
    expect(await screen.findByRole('heading', { name: 'Set up two-step sign-in' })).toBeInTheDocument();
    expect(await screen.findByAltText(/QR code to add PlaynX/)).toHaveAttribute('src', 'data:image/png;base64,QR');
    expect(screen.getByText('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the 6-digit code');
    await userEvent.type(screen.getByLabelText('6-digit code'), '12a3456');
    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456'); // digits only
    await userEvent.click(screen.getByRole('button', { name: 'Turn on and sign in' }));
    expect(posts.find(([u]) => u === '/auth/mfa/verify')![1]).toEqual({ mfaToken: 'ticket', code: '123456' });
    await waitFor(() => expect(sessionStorage.getItem('playnx_token') ?? localStorage.getItem('playnx_token')).toBe('session')); // signed in only after the code
  });

  it('after setup: only the code is asked, a wrong code shows the error, and Back returns to the password form', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === '/auth/login') return { mfaRequired: true, mfaToken: 'ticket' } as any;
      if (url === '/auth/mfa/verify') { const e: any = new Error('x'); e.response = { status: 401, data: { error: { code: 'mfa_invalid', message: 'Incorrect code. Check the time on your phone and try the newest code.' } } }; e.isAxiosError = true; throw e; }
      return {} as any;
    });
    renderAt('/admin/login');
    await fillLogin();
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code/)).toBeNull();
    await userEvent.type(screen.getByLabelText('6-digit code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect code');
    await userEvent.click(screen.getByRole('button', { name: 'Back to log in' }));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});
