import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeoVideoCapture } from '../src/components/GeoVideoCapture';

describe('geo-tagged video camera', () => {
  afterEach(() => { cleanup(); delete (navigator as any).mediaDevices; delete (navigator as any).geolocation; delete (globalThis as any).MediaRecorder; });
  it('shows the camera picture in the recorder (it used to stay black)', async () => {
    const stream = { getTracks: () => [{ stop: () => {} }] } as unknown as MediaStream;
    let answer!: (s: MediaStream) => void;
    (navigator as any).mediaDevices = { getUserMedia: vi.fn(() => new Promise((r) => { answer = r; })) };
    (navigator as any).geolocation = { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() };
    (globalThis as any).MediaRecorder = class { static isTypeSupported() { return true; } };
    render(<GeoVideoCapture value={null} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /record/i }));
    const box = await screen.findByLabelText('Camera') as HTMLVideoElement; // the box is there while the camera starts
    expect(screen.getByText('Starting the camera…')).toBeInTheDocument();
    answer(stream);
    await waitFor(() => expect(box.srcObject).toBe(stream));
    expect(screen.queryByText('Starting the camera…')).toBeNull();
  });
});
