/**
 * Reads a builder's inventory Excel/CSV and turns it into flats.
 * Works with messy sheets: header row not on top, "A - 101" style numbers, "3BHK"/"PH", a separate sizes sheet
 * where one row covers a whole stack ("A-101: A-901"), statuses like Open / Booked / Sold / Hold / Mortgage.
 */

export type Cell = string | number | boolean | Date | null | undefined;
export type Sheet = { name: string; rows: Cell[][] };
export type UnitStatus = 'open' | 'hold' | 'booked' | 'mortgage';
export type UnitRow = { tower: string; floor: number | null; unit_no: string; bhk: string | null; sba: number | null; carpet: number | null; rate: number | null; status: UnitStatus };
export type RateBand = { from: number; to: number; rate: number };
export type ParseResult = { units: UnitRow[]; sheet: string; columns: Record<string, string>; sizeSheet: string | null; notes: string[] };

type Col = 'unit' | 'tower' | 'floor' | 'bhk' | 'sba' | 'carpet' | 'status' | 'rate' | 'price';
const LABEL: Record<Col, string> = { unit: 'Flat number', tower: 'Tower', floor: 'Floor', bhk: 'Type (BHK)', sba: 'Super area', carpet: 'Carpet area', status: 'Status', rate: 'Rate / sq ft', price: 'Price' };

const txt = (c: Cell) => (c == null ? '' : String(c).replace(/\s+/g, ' ').trim());
const num = (c: Cell) => {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = txt(c).replace(/[,₹\s]/g, '').replace(/sq\.?ft\.?|sqft/i, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Which column is what, from the header words. */
function columnsOf(header: Cell[]): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  header.forEach((h, i) => {
    const s = txt(h).toLowerCase();
    if (!s) return;
    const set = (k: Col) => { if (out[k] === undefined) out[k] = i; };
    if (/carpet/.test(s)) return set('carpet');
    if (/super|\bsba\b|saleable|salable|total super|s\.?b\.?a/.test(s)) return set('sba');
    if (/(rate|psf|per ?sq)/.test(s)) return set('rate');
    if (/(price|amount|value|cost|consideration)/.test(s)) return set('price');
    if (/(status|availab|booking|sold)/.test(s)) return set('status');
    if (/(flat|unit|apartment|apt|shop|villa|plot)/.test(s) && !/type/.test(s)) return set('unit');
    if (/(tower|block|wing|building)/.test(s)) return set('tower');
    if (/floor/.test(s) && !/area/.test(s)) return set('floor');
    if (/(bhk|type|config|category)/.test(s)) return set('bhk');
  });
  return out;
}

function headerRow(rows: Cell[][]) {
  let best = { at: -1, cols: {} as Partial<Record<Col, number>>, score: 0 };
  rows.slice(0, 20).forEach((r, i) => {
    const cols = columnsOf(r);
    const score = Object.keys(cols).length + (cols.unit !== undefined ? 2 : 0);
    if (score > best.score) best = { at: i, cols, score };
  });
  return best.cols.unit !== undefined && best.score >= 3 ? best : null;
}

/** "A - 101" → { tower: "A", num: 101 }; "101" with tower "B" → B-101; "C-101: C-901" → range (stack). */
function unitParts(raw: string, towerCell: string): { tower: string; n: number; label?: string } | null {
  const s = raw.toUpperCase().replace(/\s+/g, '').replace(/\.$/, '');
  const t0 = towerCell.toUpperCase().replace(/TOWER|BLOCK|WING|\s/g, '').slice(0, 3);
  // "G01" next to a tower column = ground floor unit of that tower (not tower "G")
  const g = s.match(/^G[-/]?(\d{1,3})$/);
  if (g && t0 && t0 !== 'G') return { tower: t0, n: Number(g[1]), label: `G${g[1].padStart(2, '0')}` };
  const m = s.match(/^([A-Z]{1,3})[-/]?(\d{2,5})$/);
  if (m) return { tower: m[1], n: Number(m[2]) };
  const d = s.match(/^(\d{2,5})$/);
  if (d) return { tower: t0 || 'A', n: Number(d[1]) };
  return null;
}
const stackOf = (n: number) => String(n % 100).padStart(2, '0');

export function fixBhk(v: string): string | null {
  const s = v.toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^(ph|penthouse)/.test(s)) return 'Penthouse';
  const m = s.match(/^(\d(?:\.5)?)(bhk|bk|rk)?$/);
  if (m) return m[2] === 'rk' ? `${m[1]} RK` : `${m[1]} BHK`;
  const m2 = s.match(/(\d(?:\.5)?)\s*bhk/);
  if (m2) return `${m2[1]} BHK`;
  const t = v.trim().slice(0, 30);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fixStatus(v: string): UnitStatus | null {
  const s = v.toLowerCase().trim();
  if (!s || /^(open|available|avail|unsold|vacant|free|yes|for sale)/.test(s)) return 'open';
  if (/(mortg|bank|loan)/.test(s)) return 'mortgage';
  if (/(hold|block|reserv|blocked|not for sale|nfs|landowner|owner)/.test(s)) return 'hold';
  if (/(book|sold|allot|registered|token|^no$)/.test(s)) return 'booked';
  return null;
}

/** "1-3: 4700, 4-6: 4800, 7-9: 4900" → bands. A single number = same rate for all floors. */
export function parseRateCard(s: string): RateBand[] {
  const t = s.trim();
  if (/^\d{3,6}$/.test(t.replace(/[,₹\s]/g, ''))) return [{ from: -5, to: 500, rate: Number(t.replace(/[,₹\s]/g, '')) }];
  const out: RateBand[] = [];
  for (const m of t.matchAll(/(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*[:=→\s]\s*₹?\s*([\d,]{3,7})/g)) {
    out.push({ from: Number(m[1]), to: Number(m[2]), rate: Number(m[3].replace(/,/g, '')) });
  }
  for (const m of t.matchAll(/(?:^|[,;\n])\s*(\d{1,3})\s*[:=→]\s*₹?\s*([\d,]{3,7})/g)) {
    out.push({ from: Number(m[1]), to: Number(m[1]), rate: Number(m[2].replace(/,/g, '')) });
  }
  return out.filter((b) => b.rate >= 100 && b.rate <= 200000 && b.from <= b.to);
}
export const rateFor = (bands: RateBand[], floor: number | null) =>
  bands.find((b) => floor != null && floor >= b.from && floor <= b.to)?.rate ?? (bands.length === 1 && bands[0].from < 0 ? bands[0].rate : null);
export const showRateCard = (bands: { floors?: string; from?: number; to?: number; rate: number }[]) =>
  bands.map((b) => `${b.floors ?? (b.from === b.to ? b.from : `${b.from}-${b.to}`)}: ${b.rate}`).join(', ');

export function parseInventory(sheets: Sheet[], bands: RateBand[]): ParseResult | { error: string } {
  const notes: string[] = [];
  // sizes by stack from any sheet whose flat column holds ranges like "A-101: A-901"
  const stack = new Map<string, { sba: number | null; carpet: number | null }>();
  let sizeSheet: string | null = null;
  let best: { sheet: Sheet; at: number; cols: Partial<Record<Col, number>>; units: number } | null = null;

  for (const sh of sheets) {
    const h = headerRow(sh.rows);
    if (!h) continue;
    const body = sh.rows.slice(h.at + 1);
    let ranges = 0, singles = 0, lastTower = '';
    for (const r of body) {
      const u = txt(r[h.cols.unit!]);
      if (!u) continue;
      if (h.cols.tower !== undefined && txt(r[h.cols.tower])) lastTower = txt(r[h.cols.tower]);
      const range = u.toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,3})-?(\d{2,5})[:\-–TO]+([A-Z]{1,3})?-?(\d{2,5})/);
      if (range && /[:–]|TO/.test(u.toUpperCase())) {
        ranges++;
        const key = `${range[1]}|${stackOf(Number(range[2]))}`;
        stack.set(key, { sba: h.cols.sba !== undefined ? num(r[h.cols.sba]) : null, carpet: h.cols.carpet !== undefined ? num(r[h.cols.carpet]) : null });
      } else if (unitParts(u, lastTower)) singles++;
    }
    if (ranges > 0 && ranges >= singles) { sizeSheet = sh.name; continue; }
    if (!best || singles > best.units) best = { sheet: sh, at: h.at, cols: h.cols, units: singles };
  }
  if (!best || !best.units) return { error: 'Could not find the flats in this file. It needs a column with flat numbers (like A-101) under a heading such as "Flat no" or "Unit".' };

  const c = best.cols;
  const seen = new Set<string>();
  const units: UnitRow[] = [];
  let lastTower = '', unknownStatus = 0, dupes = 0, noSize = 0;
  for (const r of best.sheet.rows.slice(best.at + 1)) {
    const raw = txt(r[c.unit!]);
    if (c.tower !== undefined && txt(r[c.tower])) lastTower = txt(r[c.tower]);
    if (!raw) continue;
    const p = unitParts(raw, lastTower);
    if (!p) continue;
    const unit_no = `${p.tower}-${p.label ?? p.n}`;
    if (seen.has(unit_no)) { dupes++; continue; }
    seen.add(unit_no);
    const fl = c.floor !== undefined && num(r[c.floor]) != null ? Math.round(num(r[c.floor])!) : p.label ? 0 : Math.floor(p.n / 100);
    const st = c.status !== undefined ? fixStatus(txt(r[c.status])) : 'open';
    if (!st) unknownStatus++;
    const bhk = c.bhk !== undefined ? fixBhk(txt(r[c.bhk])) : null;
    // a penthouse is not the same size as the flats below it, so it never takes the stack's size
    const fromStack = bhk === 'Penthouse' ? undefined : stack.get(`${p.tower}|${stackOf(p.n)}`);
    let sba = c.sba !== undefined ? num(r[c.sba]) : null;
    if (sba == null || sba <= 0) sba = fromStack?.sba ?? null;
    let carpet = c.carpet !== undefined ? num(r[c.carpet]) : null;
    if (carpet == null || carpet <= 0) carpet = fromStack?.carpet ?? null;
    let rate = c.rate !== undefined ? num(r[c.rate]) : null;
    if ((rate == null || rate <= 0) && c.price !== undefined && sba) { const pr = num(r[c.price]); if (pr && pr > 0) rate = Math.round((pr < 100000 ? pr * 100000 : pr) / sba); }
    if (rate == null || rate <= 0) rate = rateFor(bands, fl);
    if (!sba) noSize++;
    units.push({
      tower: p.tower, floor: Number.isFinite(fl) ? fl : null, unit_no, bhk,
      sba: sba ? Math.round(sba * 100) / 100 : null, carpet: carpet ? Math.round(carpet * 10) / 10 : null,
      rate: rate ? Math.round(rate) : null, status: st ?? 'open',
    });
  }
  if (dupes) notes.push(`${dupes} repeated flat number${dupes === 1 ? '' : 's'} skipped.`);
  if (unknownStatus) notes.push(`${unknownStatus} flat${unknownStatus === 1 ? ' has' : 's have'} a status we did not understand — saved as Open. Check them after import.`);
  if (noSize) notes.push(`${noSize} flat${noSize === 1 ? ' has' : 's have'} no size, so no price (shown as "on request").`);
  const noRate = units.filter((u) => u.sba && !u.rate).length;
  if (noRate) notes.push(`${noRate} flat${noRate === 1 ? ' has' : 's have'} no rate. Add a rate card above to price them.`);
  if (sizeSheet) notes.push(`Sizes for flats were also taken from the "${sizeSheet}" sheet.`);
  const columns = Object.fromEntries((Object.entries(c) as [Col, number][]).map(([k, i]) => [LABEL[k], txt(best!.sheet.rows[best!.at][i]) || `column ${i + 1}`]));
  return { units, sheet: best.sheet.name, columns, sizeSheet, notes };
}
