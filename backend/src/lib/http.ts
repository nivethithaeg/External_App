import type { ZodType } from 'zod';
export const parse = <T>(schema: ZodType<T>, data: unknown): T => schema.parse(data);
export function page(q: any, maxLimit = 50) {
  const limit = Math.min(Math.max(parseInt(q.limit ?? '20', 10) || 20, 1), maxLimit);
  const pageNo = Math.max(parseInt(q.page ?? '1', 10) || 1, 1);
  return { limit, offset: (pageNo - 1) * limit, page: pageNo };
}
export function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
