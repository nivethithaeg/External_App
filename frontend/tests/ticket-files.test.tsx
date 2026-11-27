import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import * as api from '../src/lib/api';
import { TicketFilePicker, uploadTicketFiles } from '../src/components/TicketAttachments';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), api: { post: vi.fn(async () => ({ data: {} })), get: vi.fn() } }));

function Host() { const [f, setF] = useState<File[]>([]); return <TicketFilePicker files={f} onChange={setF} />; }

describe('ticket photos and videos', () => {
  it('takes photos and videos, refuses other files, and lets one be removed', async () => {
    render(<Host />);
    const input = screen.getByLabelText('Add photos or videos');
    await userEvent.upload(input, [new File(['a'], 'pitch.png', { type: 'image/png' }), new File(['b'], 'clip.mp4', { type: 'video/mp4' })]);
    const list = screen.getByRole('list', { name: 'Files to attach' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.upload(input, new File(['c'], 'bill.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent('only JPG, PNG or WebP photos and MP4 or WebM videos');
    await userEvent.click(screen.getByRole('button', { name: 'Remove pitch.png' }));
    expect(within(screen.getByRole('list', { name: 'Files to attach' })).getAllByRole('listitem')).toHaveLength(1);
  });
  it('sends each file to the ticket', async () => {
    const failed = await uploadTicketFiles('t1', [new File(['a'], 'p.png', { type: 'image/png' }), new File(['b'], 'v.mp4', { type: 'video/mp4' })]);
    expect(failed).toBe(0);
    await waitFor(() => expect(vi.mocked(api.api.post)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.api.post).mock.calls[0][0]).toBe('/me/tickets/t1/attachments');
  });
});
