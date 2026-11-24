import { describe, expect, it, vi } from 'vitest';

const saved: { blob?: Blob; name?: string } = {};
vi.mock('../src/lib/utils', async (orig) => ({ ...(await orig() as any), downloadBlob: (b: Blob, n: string) => { saved.blob = b; saved.name = n; } }));
import { downloadReceiptPdf } from '../src/lib/receiptPdf';

const booking = { reference: 'KO-XP74YPV', status: 'confirmed', payment_status: 'captured', venue_name: 'Turf 1', address: '12 Park Road', city: 'Chennai', area_name: 'Turf A', sport: 'Cricket',
  starts_at: '2030-01-01T04:30:00.000Z', ends_at: '2030-01-01T05:30:00.000Z', timezone: 'Asia/Kolkata', subtotal: 800, discount: 100, total: 700, razorpay_payment_id: 'pay_123' };

describe('receipt download', () => {
  it('produces a real PDF file named after the booking reference', async () => {
    await downloadReceiptPdf(booking, [{ amount: 700, status: 'processed' }], 'Asha Rao');
    expect(saved.name).toBe('KickOff-receipt-KO-XP74YPV.pdf');
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as ArrayBuffer); fr.readAsArrayBuffer(saved.blob!); }));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(saved.blob!.type).toBe('application/pdf');
  });
});
