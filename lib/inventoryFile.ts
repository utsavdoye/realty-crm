'use client';

import type { Sheet } from '@/lib/units';

/** Reads the builder's inventory file (Excel, CSV or PDF) into sheets of rows. */
export async function readInventoryFile(f: File): Promise<Sheet[]> {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
    const { pdfToSheets } = await import('@/lib/pdfTable');
    return pdfToSheets(f);
  }
  if (/\.csv$/i.test(f.name)) {
    const text = await f.text();
    const first = text.split('\n')[0];
    const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
    return [{ name: f.name, rows: text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())) }];
  }
  const mod = await import('read-excel-file');
  const out: Sheet[] = [];
  for (const name of await mod.readSheetNames(f)) out.push({ name, rows: (await mod.default(f, { sheet: name })) as Sheet['rows'] });
  return out;
}
