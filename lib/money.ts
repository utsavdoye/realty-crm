/** Rupee formatting, Indian style. */
export const inr = (n: number | null | undefined) => (n == null ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN'));
/** Short: ₹1.25 Cr, ₹45.3 L, ₹8,500 */
export function inrShort(n: number | null | undefined) {
  if (n == null) return '—';
  const v = Number(n); const a = Math.abs(v); const s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} L`;
  return `${s}₹${Math.round(a).toLocaleString('en-IN')}`;
}
/** Reads "45,000", "1.2 L", "2 cr", "₹ 75000" → rupees. */
export function parseRupees(input: string): number | null {
  const s = String(input ?? '').toLowerCase().replace(/[,₹\s]|rs\.?|inr/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(cr|crore|l|lac|lakh|k)?$/);
  if (!m) return null;
  const n = Number(m[1]); const u = m[2] ?? '';
  const v = u.startsWith('c') ? n * 1e7 : u.startsWith('l') ? n * 1e5 : u === 'k' ? n * 1e3 : n;
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}
export const OUT_CATEGORIES = ['Ads', 'Salary', 'Incentive', 'Rent', 'Site visit', 'Office', 'Travel', 'Tax', 'Other'] as const;
export const IN_CATEGORIES = ['Commission', 'Other income'] as const;
export const MODES = ['Bank transfer', 'UPI', 'Cash', 'Cheque', 'Card'];
export const PERIODS = [['month', 'This month'], ['3m', '3 months'], ['6m', '6 months'], ['year', 'This year (Apr–Mar)'], ['all', 'All time']] as const;

/** Start date (YYYY-MM-DD, India time) for a period. Financial year starts 1 April. */
export function periodStart(p: string): string | null {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = now.getFullYear(), m = now.getMonth();
  const d = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  if (p === 'month') return d(y, m);
  if (p === '3m') return d(y, m - 2);
  if (p === '6m') return d(y, m - 5);
  if (p === 'year') return d(m >= 3 ? y : y - 1, 3);
  return null;
}
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
