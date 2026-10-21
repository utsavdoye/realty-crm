import 'server-only';
import readXlsxFile, { readSheetNames } from 'read-excel-file/node';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseInventory, type RateBand, type Sheet } from '@/lib/units';

/** A share link → a link that downloads the file. Google Sheets works best ("Anyone with the link can view"). */
export function downloadUrl(link: string): string | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'docs.google.com') {
    const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)/);
    if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=xlsx`;
    const id = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
    return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` : null;
  }
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get('id');
    return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
  }
  if (host.endsWith('dropbox.com')) { u.searchParams.set('dl', '1'); return u.toString(); }
  if (host.endsWith('sharepoint.com') || host === 'onedrive.live.com' || host === '1drv.ms') { u.searchParams.set('download', '1'); return u.toString(); }
  return u.toString(); // a direct .xlsx / .csv link
}

const NOT_SHARED = 'Could not open the sheet. In Google Sheets press Share → General access → "Anyone with the link" → Viewer, then sync again.';

/** Downloads the sheet and reads every tab. */
export async function readSheetLink(link: string): Promise<Sheet[] | { error: string }> {
  const url = downloadUrl(link);
  if (!url) return { error: 'This is not a sheet link. Paste the Google Sheets link (it starts with https://docs.google.com/spreadsheets/).' };
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 EstateDesk inventory sync' } });
  } catch { return { error: 'The sheet did not answer. Try again in a minute.' }; }
  if (!res.ok) return { error: res.status === 401 || res.status === 403 || res.status === 404 ? NOT_SHARED : `The sheet could not be read (error ${res.status}).` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) return { error: 'The sheet is bigger than 15 MB.' };
  if (buf[0] === 0x50 && buf[1] === 0x4b) { // .xlsx (zip)
    try {
      const out: Sheet[] = [];
      for (const name of await readSheetNames(buf)) out.push({ name, rows: (await readXlsxFile(buf, { sheet: name })) as Sheet['rows'] });
      return out;
    } catch { return { error: 'The sheet was downloaded but could not be read. Is it an Excel / Google sheet?' }; }
  }
  const text = buf.toString('utf8').replace(/^﻿/, '');
  if (/^\s*</.test(text)) return { error: NOT_SHARED }; // a sign-in / web page instead of the file
  const first = text.split('\n')[0];
  const sep = (first.match(/\t/g)?.length ?? 0) > 1 ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  return [{ name: 'Sheet', rows: text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())) }];
}

/** The rate card saved on the project ([{floors: "1–3", rate: 4700}]) → bands for the parser. */
function bandsOf(card: unknown): RateBand[] {
  if (!Array.isArray(card)) return [];
  return card.flatMap((b: { floors?: string; rate?: number }) => {
    const rate = Number(b?.rate); const f = String(b?.floors ?? '').trim();
    if (!(rate > 0)) return [];
    const m = f.match(/^(-?\d+)\s*[–-]\s*(-?\d+)$/); const one = f.match(/^(-?\d+)$/);
    if (m) return [{ from: Number(m[1]), to: Number(m[2]), rate }];
    if (one) return [{ from: Number(one[1]), to: Number(one[1]), rate }];
    return [];
  });
}

export type SyncResult = { ok: boolean; changed: boolean; flats?: number; error?: string; skipped?: boolean };

/**
 * Reads the project's sheet and makes the CRM match it (the sheet is the master list).
 * Safe: if the sheet cannot be read, or suddenly has far fewer flats, nothing is removed.
 * minAgeMs: skip if the last sync was more recent than this (automatic syncs); 0 = always.
 */
export async function syncProjectInventory(orgId: string, projectId: string, minAgeMs = 0): Promise<SyncResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, changed: false, error: 'The server key is missing in Vercel (SUPABASE_SERVICE_ROLE_KEY).' };
  const { data: p, error: readErr } = await admin.from('projects')
    .select('id, org_id, inventory_url, inventory_synced_at, inventory_sync_started_at, rate_card').eq('id', projectId).eq('org_id', orgId).maybeSingle();
  if (readErr) return { ok: false, changed: false, error: /inventory_url/.test(readErr.message) ? 'Run supabase/patch-038-inventory-sheet-sync.sql in Supabase first.' : readErr.message };
  if (!p?.inventory_url) return { ok: false, changed: false, error: 'No sheet link saved for this project.' };
  const now = Date.now();
  if (minAgeMs && p.inventory_synced_at && now - new Date(p.inventory_synced_at).getTime() < minAgeMs) return { ok: true, changed: false, skipped: true };
  // One sync at a time per project (two people opening the CRM together).
  const busyBefore = new Date(now - 60_000).toISOString();
  const { data: claimed } = await admin.from('projects').update({ inventory_sync_started_at: new Date(now).toISOString() })
    .eq('id', projectId).or(`inventory_sync_started_at.is.null,inventory_sync_started_at.lt.${busyBefore}`).select('id');
  if (!claimed?.length) return { ok: true, changed: false, skipped: true };

  const done = async (fields: Record<string, unknown>) => { await admin.from('projects').update({ inventory_sync_started_at: null, ...fields }).eq('id', projectId); };
  const sheets = await readSheetLink(p.inventory_url);
  if ('error' in sheets) { await done({ inventory_sync_error: sheets.error }); return { ok: false, changed: false, error: sheets.error }; }
  const parsed = parseInventory(sheets, bandsOf(p.rate_card));
  if ('error' in parsed) { await done({ inventory_sync_error: parsed.error }); return { ok: false, changed: false, error: parsed.error }; }

  const { data: existing } = await admin.from('project_units').select('id, unit_no, tower, floor, bhk, sba, carpet, rate, status').eq('project_id', projectId);
  const old = existing ?? [];
  if (old.length >= 20 && parsed.units.length < old.length * 0.3) {
    const msg = `The sheet now has only ${parsed.units.length} flats (the CRM has ${old.length}). Nothing was changed, in case the sheet was cut by mistake. Fix the sheet, or upload it as a file to replace everything.`;
    await done({ inventory_sync_error: msg });
    return { ok: false, changed: false, error: msg };
  }
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < max ? v : null);
  const rows = parsed.units.slice(0, 5000).map((u) => ({
    org_id: orgId, project_id: projectId,
    tower: String(u.tower ?? '').slice(0, 20) || 'A', floor: typeof u.floor === 'number' && Number.isFinite(u.floor) ? Math.round(u.floor) : null,
    unit_no: String(u.unit_no).trim().slice(0, 30), bhk: u.bhk ? String(u.bhk).slice(0, 30) : null,
    sba: n(u.sba, 100000), carpet: n(u.carpet, 100000), rate: n(u.rate, 1000000), status: u.status,
  })).filter((r) => r.unit_no);
  const key = (r: { unit_no: string; tower: string; floor: number | null; bhk: string | null; sba: number | null; carpet: number | null; rate: number | null; status: string }) =>
    [r.unit_no, r.tower, r.floor, r.bhk, r.sba == null ? '' : Number(r.sba), r.carpet == null ? '' : Number(r.carpet), r.rate == null ? '' : Number(r.rate), r.status].join('|');
  const before = new Map(old.map((o) => [o.unit_no, key(o as Parameters<typeof key>[0])]));
  const changedRows = rows.filter((r) => before.get(r.unit_no) !== key(r));
  const keep = new Set(rows.map((r) => r.unit_no));
  const gone = old.filter((o) => !keep.has(o.unit_no)).map((o) => o.id);

  for (let i = 0; i < changedRows.length; i += 500) {
    const { error } = await admin.from('project_units').upsert(changedRows.slice(i, i + 500), { onConflict: 'project_id,unit_no' });
    if (error) { await done({ inventory_sync_error: error.message }); return { ok: false, changed: i > 0, error: error.message }; }
  }
  for (let i = 0; i < gone.length; i += 200) await admin.from('project_units').delete().in('id', gone.slice(i, i + 200));
  await done({ inventory_synced_at: new Date().toISOString(), inventory_sync_error: null });
  return { ok: true, changed: changedRows.length > 0 || gone.length > 0, flats: rows.length };
}
