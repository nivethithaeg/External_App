import { describe, expect, it } from 'vitest';
import { priceFor, rateAt, type PriceRule } from '../src/lib/pricing.js';
import { refundableAmount } from '../src/lib/bookings.js';
import { csv } from '../src/lib/http.js';
import { sniff } from '../src/lib/upload.js';

const rules: PriceRule[] = [
  { sport_id: null, day_type: 'all', start_time: '06:00:00', end_time: '18:00:00', price_per_hour: 800 },
  { sport_id: null, day_type: 'all', start_time: '18:00:00', end_time: '23:00:00', price_per_hour: 1200 },
  { sport_id: null, day_type: 'weekend', start_time: '06:00:00', end_time: '23:00:00', price_per_hour: 1500 },
  { sport_id: 2, day_type: 'all', start_time: '06:00:00', end_time: '23:00:00', price_per_hour: 2000 },
];
describe('pricing', () => {
  it('weekday daytime uses base rate', () => expect(priceFor(rules, 3, 1, 10 * 60, 60, 60)).toBe(800));
  it('blends rates across a peak boundary', () => expect(priceFor(rules, 3, 1, 17 * 60, 120, 60)).toBe(800 + 1200));
  it('weekend rule beats generic rule', () => expect(rateAt(rules, 6, 1, 10 * 60)).toBe(1500));
  it('sport-specific rule beats generic/weekend', () => expect(rateAt(rules, 6, 2, 10 * 60)).toBe(2000));
  it('returns null when a step is unpriced', () => expect(priceFor(rules, 3, 1, 22 * 60, 120, 60)).toBeNull());
  it('prices 30-minute steps proportionally', () => expect(priceFor(rules, 3, 1, 10 * 60, 90, 30)).toBe(1200));
});
describe('refund policy', () => {
  it('full refund when cancelling early enough', () => expect(refundableAmount(1000, 30, 24, false)).toBe(1000));
  it('no refund inside the cancellation window', () => expect(refundableAmount(1000, 5, 24, false)).toBe(0));
  it('venue-initiated cancellations always refund in full', () => expect(refundableAmount(1000, 1, 24, true)).toBe(1000));
});
describe('helpers', () => {
  it('csv neutralises formula injection and quotes commas', () => {
    expect(csv([{ a: '=cmd()', b: 'x,y' }])).toBe(`a,b\n'=cmd(),"x,y"`);
  });
  it('sniff detects real file signatures and rejects others', () => {
    expect(sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]))).toBe('image/jpeg');
    expect(sniff(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });
});
