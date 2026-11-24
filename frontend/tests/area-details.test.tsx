import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { AreaDetailsPage } from '../src/pages/owner/AreaDetails';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../src/components/Layouts', () => ({}));

const AREA = { id: 'a1', venue_id: 'v1', venue_name: 'Green Arena', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, is_active: true, environment: 'outdoor', capacity: 14 };
describe('Playing area details page', () => {
  it('shows Details first and has the four JusGo tabs', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => url === '/owner/areas' ? { areas: [AREA] } : url === '/owner/venues/v1' ? { venue: { id: 'v1', name: 'Green Arena', status: 'approved', images: [], areas: [AREA] } } : url === '/sports' ? { sports: [{ id: 1, name: 'Football' }] } : {}) as any);
    render(<QueryClientProvider client={new QueryClient()}><ToastProvider><MemoryRouter initialEntries={['/owner/areas/a1']}><Routes><Route path="/owner/areas/:id" element={<AreaDetailsPage />} /></Routes></MemoryRouter></ToastProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Turf A' })).toBeInTheDocument();
    for (const t of ['Details', 'Edit playing area', 'Opening hours', 'Slot settings']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    expect(await screen.findByText('Football')).toBeInTheDocument(); expect(screen.getByText('14 players')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Edit playing area' }));
    expect(await screen.findByRole('region', { name: 'Edit Turf A' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull(); // in the page, not a pop-up
  });
});
