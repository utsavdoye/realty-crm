'use client';

import type { Cell, Sheet } from '@/lib/units';

type Item = { s: string; x0: number; x1: number; y: number; h: number };

const HEAD = /(flat|unit|apartment|apt|shop|villa|plot|tower|block|wing|floor|bhk|type|config|super|sba|saleable|carpet|area|status|availab|rate|price|amount)/i;

/** Joins pieces of text on one line that sit right next to each other (one table cell). */
function cellsOf(line: Item[]): Item[] {
  const out: Item[] = [];
  for (const it of [...line].sort((a, b) => a.x0 - b.x0)) {
    const last = out[out.length - 1];
    if (last && it.x0 - last.x1 < Math.max(2.5, 0.45 * Math.max(it.h, last.h))) {
      last.s = `${last.s} ${it.s}`.replace(/\s+/g, ' ').trim(); last.x1 = Math.max(last.x1, it.x1);
    } else out.push({ ...it });
  }
  return out;
}

/**
 * Reads a table out of a PDF made from Excel / a builder's system (not a scanned photo).
 * Columns are lined up under the heading row, so empty cells stay in the right column.
 */
export async function pdfToSheets(file: File): Promise<Sheet[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; // copy of pdfjs-dist 4.10.38 (keep the same version)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

  const lines: Item[][] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      const s = (raw.str ?? '').replace(/\s+/g, ' ').trim();
      if (!s || !raw.transform) continue;
      const h = Math.abs(raw.height || raw.transform[3] || 8);
      items.push({ s, x0: raw.transform[4], x1: raw.transform[4] + (raw.width ?? s.length * h * 0.5), y: raw.transform[5], h });
    }
    // same line = almost the same height on the page (top to bottom)
    items.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    let cur: Item[] = [];
    for (const it of items) {
      if (cur.length && Math.abs(cur[0].y - it.y) > Math.max(2, cur[0].h * 0.45)) { lines.push(cur); cur = []; }
      cur.push(it);
    }
    if (cur.length) lines.push(cur);
  }
  await doc.destroy();

  const rows = lines.map(cellsOf);
  // The heading row: the line with the most heading words (flat, floor, type, area, status…).
  let headAt = -1, best = 0;
  rows.slice(0, 80).forEach((r, i) => {
    const score = r.filter((c) => HEAD.test(c.s) && c.s.length < 40).length;
    if (score > best) { best = score; headAt = i; }
  });
  if (headAt < 0 || best < 2) return [{ name: file.name, rows: rows.map((r) => r.map((c) => c.s)) }];

  const head = rows[headAt];
  const mid = (c: Item) => (c.x0 + c.x1) / 2;
  const centres = head.map(mid);
  const headKey = head.map((c) => c.s.toLowerCase()).join('|');
  const out: Cell[][] = [head.map((c) => c.s)];
  for (const r of rows.slice(headAt + 1)) {
    if (r.map((c) => c.s.toLowerCase()).join('|') === headKey) continue; // heading repeated on the next page
    const row: Cell[] = new Array(head.length).fill(null);
    for (const c of r) {
      // the column whose heading overlaps this text, else the nearest heading
      let k = -1, most = 0;
      head.forEach((h, i) => { const o = Math.min(c.x1, h.x1 + 2) - Math.max(c.x0, h.x0 - 2); if (o > most) { most = o; k = i; } });
      if (k < 0) { let d = Infinity; centres.forEach((m, i) => { const dd = Math.abs(m - mid(c)); if (dd < d) { d = dd; k = i; } }); }
      row[k] = row[k] == null ? c.s : `${row[k]} ${c.s}`;
    }
    if (row.some((v) => v != null)) out.push(row);
  }
  return [{ name: file.name, rows: out }];
}
