/**
 * Supabase sends at most 1,000 rows per request, so a big list is read page by page.
 * `make` must build a NEW query each time (with a fixed .order so pages do not overlap).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T = any>(make: () => any, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** A real calendar day like 2026-10-07 (not 2026-13-45). */
export function realDay(d: string | undefined | null): d is string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
