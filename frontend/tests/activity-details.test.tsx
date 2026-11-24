import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../src/lib/api';
import { OwnerActivityPage } from '../src/pages/owner/OwnerExtras';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'owner' } }) }));

describe('Activity Log', () => {
  it('opens the details of a row in a pop-up and hides secrets', async () => {
    vi.mocked(api.get).mockResolvedValue({ categories: ['booking'], resources: ['booking'], activity: [{ id: 1, action: 'booking.cancelled', entity: 'booking', entity_id: 'b-1', metadata: { reference: 'KO-1', password: 'x' }, ip: '1.2.3.4', created_at: '2030-01-01T10:00:00Z', actor_name: 'Asha', actor_role: 'owner' }] } as any);
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OwnerActivityPage /></MemoryRouter></QueryClientProvider>);
    await userEvent.click(await screen.findByText('Booking Cancelled'));
    const dlg = await screen.findByRole('dialog', { name: 'Activity details' });
    expect(dlg).toHaveTextContent('1.2.3.4'); expect(dlg).toHaveTextContent('KO-1'); expect(dlg).toHaveTextContent('b-1');
    expect(within(dlg).queryByText(/password/i)).toBeNull();
  });
});
