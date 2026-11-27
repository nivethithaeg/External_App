import { downloadBlob, fmtDateTime, fmtRange, titleCase } from './utils';

/** Standard PDF fonts only cover basic Latin, so ₹, dashes and the narrow spaces in formatted times are replaced with plain text. */
const ascii = (s: string) => s.replace(/[  ]/g, ' ').replace(/[·•]/g, '-').replace(/[–—−]/g, '-').replace(/₹/g, 'Rs. ').replace(/[^\x20-\x7e]/g, '');
const rs = (n: number | string | null | undefined) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(Number(n ?? 0))}`;

export interface ReceiptBooking { advance_amount?: number | string | null; reference: string; status: string; payment_status?: string | null; venue_name: string; address: string; city: string; area_name: string; sport?: string | null; starts_at: string; ends_at: string; timezone?: string; subtotal: number | string; discount: number | string; total: number | string; razorpay_payment_id?: string | null }

/** Builds the receipt as a PDF file and downloads it (jsPDF is loaded only when a receipt is requested). */
export async function downloadReceiptPdf(b: ReceiptBooking, refunds: { amount: number | string; status: string }[], customerName: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 48, right = 547; let y = 64;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text('PlaynX', left, y);
  doc.setFontSize(18); doc.text('Payment receipt', right, y, { align: 'right' }); y += 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110); doc.text(ascii(`Booking ${b.reference}`), right, y, { align: 'right' }); doc.setTextColor(0);
  y += 14; doc.setDrawColor(200); doc.line(left, y, right, y); y += 26;

  const row = (k: string, v: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text(k.toUpperCase(), left, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
    const lines = doc.splitTextToSize(ascii(v || '-'), 330) as string[]; doc.text(lines, 200, y); y += 18 * Math.max(1, lines.length);
  };
  row('Customer', customerName); row('Venue', b.venue_name); row('Address', `${b.address}, ${b.city}`);
  row('Playing area', `${b.area_name}${b.sport ? ` - ${b.sport}` : ''}`); row('Date and time', fmtRange(b.starts_at, b.ends_at, b.timezone));
  row('Booking status', titleCase(b.status)); row('Payment', titleCase(b.payment_status ?? b.status)); row('Transaction ID', b.razorpay_payment_id ?? '-'); row('Issued', fmtDateTime(new Date().toISOString()));

  y += 6; doc.line(left, y, right, y); y += 24;
  const money = (k: string, v: string, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 14 : 11); doc.text(k, left, y); doc.text(ascii(v), right, y, { align: 'right' }); y += bold ? 22 : 18; };
  money('Booking amount', rs(b.subtotal));
  if (Number(b.discount) > 0) money('Discount', `- ${rs(b.discount)}`);
  if (b.advance_amount != null) { // an advance booking: only the advance was paid online
    const pct = Number(b.total) > 0 ? Math.round((Number(b.advance_amount) / Number(b.total)) * 100) : 0;
    money('Booking total', rs(b.total));
    money(`Amount paid (advance ${pct}%)`, rs(b.advance_amount), true);
    money('Balance, paid at the venue', rs(Math.max(0, Number(b.total) - Number(b.advance_amount))));
  } else money('Amount paid', rs(b.total), true);
  for (const r of refunds) money(`Refund (${r.status})`, `- ${rs(r.amount)}`);
  y += 18; doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text('This is a computer-generated receipt for your records.', left, y);
  downloadBlob(doc.output('blob'), `PlaynX-receipt-${b.reference}.pdf`);
}
