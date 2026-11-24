import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FaceCamera } from '../src/components/FaceCamera';

afterEach(() => { vi.restoreAllMocks(); });

describe('FaceCamera', () => {
  it('says so when there is no camera', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    render(<FaceCamera open onClose={() => undefined} onCapture={() => undefined} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera is not available/i);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  });
  it('opens the front camera and captures a JPEG file', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 640, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 480, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    const onCapture = vi.fn(); const onClose = vi.fn();
    render(<FaceCamera open onClose={onClose} onCapture={onCapture} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled());
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    const file = onCapture.mock.calls[0][0] as File; expect(file.type).toBe('image/jpeg'); expect(file.name).toMatch(/^self-verification-/);
    expect(stop).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });
});
