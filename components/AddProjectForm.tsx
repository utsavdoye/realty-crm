'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { addFloorPlans, addProjectPhotos, addProjectVideo, importUnits, saveProject, setBrochure } from '@/app/crm-actions';
import { readInventoryFile } from '@/lib/inventoryFile';
import { parseInventory, type UnitRow } from '@/lib/units';
import { ProjectFields } from '@/components/ProjectFields';
import { uploadProjectFile } from '@/lib/upload';
import type { FormState } from '@/app/actions';

type Plan = { file: File; label: string; url: string };
type Inv = { name: string; units: UnitRow[]; summary: string } | { name: string; error: string };
const VIDEO_LIMIT = 10 * 1024 * 1024;
const mb = (b: number) => `${(Math.max(0, b) / 1024 / 1024).toFixed(1)} MB`;
const STATUS: Record<string, string> = { open: 'open', hold: 'on hold', booked: 'booked', mortgage: 'mortgage' };
/** Works on old phones too (crypto.randomUUID is missing on older iPhones). */
function newUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const nameToLabel = (n: string) => n.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);

function Save({ busy }: { busy: string }) {
  const { pending } = useFormStatus();
  return <button className="btn primary" disabled={pending || !!busy}>{busy || (pending ? 'Saving…' : 'Add project')}</button>;
}

/** "Add a project" with photos, floor plans, brochure, inventory and videos in one go. */
export function AddProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [newId, setNewId] = useState('');
  const [round, setRound] = useState(0);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [inv, setInv] = useState<Inv | null>(null);
  const [videos, setVideos] = useState<File[]>([]);
  const [vErr, setVErr] = useState('');
  const [busy, setBusy] = useState('');
  const [warn, setWarn] = useState('');

  useEffect(() => { setNewId(newUuid()); }, [round]);
  // The save step runs later, so it reads the picked files from here (always the latest).
  const picked = useRef({ photos, plans, pdf, inv, videos });
  picked.current = { photos, plans, pdf, inv, videos };

  async function pickInventory(f: File) {
    setInv({ name: f.name, error: 'Reading…' });
    try {
      const r = parseInventory(await readInventoryFile(f), []);
      if ('error' in r) return setInv({ name: f.name, error: r.error });
      const c = r.units.reduce<Record<string, number>>((a, u) => { a[u.status] = (a[u.status] ?? 0) + 1; return a; }, {});
      setInv({ name: f.name, units: r.units, summary: `${r.units.length} flats found: ${Object.entries(c).map(([k, v]) => `${v} ${STATUS[k]}`).join(', ')}.` });
    } catch {
      setInv({ name: f.name, error: /\.pdf$/i.test(f.name) ? 'Could not read this PDF. If it is a scanned photo, ask the builder for the Excel or a PDF made from Excel.' : 'Could not read this file. Save it as .xlsx or .csv and try again.' });
    }
  }

  function pickVideos(files: FileList | null) {
    setVErr('');
    let used = videos.reduce((a, f) => a + f.size, 0);
    const add: File[] = [];
    for (const f of Array.from(files ?? [])) {
      if (!/^video\//.test(f.type) && !/\.(mp4|mov|webm)$/i.test(f.name)) { setVErr(`${f.name} is not a video.`); continue; }
      if (videos.length + add.length >= 5) { setVErr('Up to 5 videos.'); break; }
      if (used + f.size > VIDEO_LIMIT) { setVErr(`${f.name} is ${mb(f.size)}. Only ${mb(VIDEO_LIMIT - used)} is left (10 MB in total).`); continue; }
      used += f.size; add.push(f);
    }
    setVideos((v) => [...v, ...add]);
  }

  const [state, action] = useFormState(async (prev: FormState, fd: FormData): Promise<FormState> => {
    setWarn('');
    const r = await saveProject(prev, fd);
    if (!r?.ok) return r;
    const id = String(fd.get('new_id'));
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      router.refresh();
      return { ok: 'Project added. Add its photos and floor plans from the project card.' };
    }
    const { photos, plans, pdf, inv, videos } = picked.current;
    const failed: string[] = [];
    const up = async (kind: 'photo' | 'plan' | 'brochure' | 'video', f: File, n: string) => {
      setBusy(n);
      try { return await uploadProjectFile(orgId, id, kind, f); } catch (e) { failed.push(`${f.name} (${e instanceof Error ? e.message : 'failed'})`); return null; }
    };
    const pUrls: string[] = [];
    for (let i = 0; i < photos.length; i++) { const u = await up('photo', photos[i].file, `Uploading photo ${i + 1} of ${photos.length}…`); if (u) pUrls.push(u); }
    const plUrls: { url: string; label: string }[] = [];
    for (let i = 0; i < plans.length; i++) { const u = await up('plan', plans[i].file, `Uploading floor plan ${i + 1} of ${plans.length}…`); if (u) plUrls.push({ url: u, label: plans[i].label }); }
    const pdfUrl = pdf ? await up('brochure', pdf, 'Uploading brochure…') : null;
    let vCount = 0;
    for (let i = 0; i < videos.length; i++) {
      const u = await up('video', videos[i], `Uploading video ${i + 1} of ${videos.length}…`);
      if (u) { const r = await addProjectVideo(id, { url: u, size: videos[i].size, name: videos[i].name }); if (r.error) failed.push(`${videos[i].name} (${r.error})`); else vCount++; }
    }
    let flats = 0;
    if (inv && 'units' in inv) {
      setBusy('Saving inventory…');
      const r = await importUnits(id, inv.units, true, []);
      if (r.error) failed.push(`inventory (${r.error})`); else flats = inv.units.length;
    }
    setBusy('Saving…');
    if (pUrls.length) await addProjectPhotos(id, pUrls);
    if (plUrls.length) await addFloorPlans(id, plUrls);
    if (pdfUrl) await setBrochure(id, pdfUrl);
    setBusy('');
    if (failed.length) setWarn(`Project added, but these did not upload: ${failed.join(', ')}. Add them again from the project card.`);
    form.current?.reset();
    setPhotos([]); setPlans([]); setPdf(null); setInv(null); setVideos([]); setRound((x) => x + 1);
    router.refresh();
    return { ok: `Project added${pUrls.length ? ` with ${pUrls.length} photo${pUrls.length === 1 ? '' : 's'}` : ''}${plUrls.length ? ` and ${plUrls.length} floor plan${plUrls.length === 1 ? '' : 's'}` : ''}${vCount ? `, ${vCount} video${vCount === 1 ? '' : 's'}` : ''}${flats ? `, ${flats} flats in inventory` : ''}.` };
  }, null);

  const pickImgs = (files: FileList | null) => Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));

  return (
    <form ref={form} action={action} className="stack">
      <input type="hidden" name="new_id" value={newId} />
      <ProjectFields key={round} />

      <div className="media-pick">
        <div className="mp-row">
          <div><b>Photos</b><span className="hint">Outside, inside, view, clubhouse. Up to 20.</span></div>
          <label className="btn sm">+ Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
            onChange={(e) => { const add = pickImgs(e.target.files).slice(0, 20 - photos.length).map((file) => ({ file, url: URL.createObjectURL(file) })); setPhotos((p) => [...p, ...add]); e.target.value = ''; }} /></label>
        </div>
        {photos.length > 0 && (
          <div className="mp-thumbs">
            {photos.map((p, i) => (
              <span key={p.url} className="mp-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" />{i === 0 && <i>Cover</i>}
                <button type="button" aria-label="Remove" onClick={() => setPhotos((x) => x.filter((y) => y !== p))}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div className="mp-row">
          <div><b>Floor plans</b><span className="hint">A picture or a PDF per plan. Clients see them only after they leave their number.</span></div>
          <label className="btn sm">+ Add floor plans<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden
            onChange={(e) => { const add = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/') || (f.type === 'application/pdf' && f.size <= 20 * 1024 * 1024)).slice(0, 20 - plans.length).map((file) => ({ file, label: nameToLabel(file.name), url: URL.createObjectURL(file) })); setPlans((p) => [...p, ...add]); e.target.value = ''; }} /></label>
        </div>
        {plans.length > 0 && (
          <div className="mp-plans">
            {plans.map((p, i) => (
              <div key={p.url} className="mp-plan">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.file.type === 'application/pdf' ? <span className="plan-pdf" aria-hidden="true">PDF</span> : <img src={p.url} alt="" />}
                <input value={p.label} maxLength={60} placeholder="e.g. 2 BHK · 1,150 sq ft" aria-label={`Name of floor plan ${i + 1}`}
                  onChange={(e) => setPlans((x) => x.map((y) => (y === p ? { ...y, label: e.target.value } : y)))} />
                <button type="button" className="btn sm ghost" onClick={() => setPlans((x) => x.filter((y) => y !== p))}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div className="mp-row">
          <div><b>Brochure (PDF)</b><span className="hint">{pdf ? pdf.name : 'Optional. Up to 20 MB. Shown after the client unlocks.'}</span></div>
          {pdf ? <button type="button" className="btn sm ghost" onClick={() => setPdf(null)}>Remove</button>
            : <label className="btn sm">+ Add PDF<input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPdf(f); e.target.value = ''; }} /></label>}
        </div>

        <div className="mp-row">
          <div><b>Inventory</b><span className="hint">{inv ? ('units' in inv ? `${inv.name} · ${inv.summary}` : `${inv.name} · ${inv.error}`) : "Optional. The builder's flat list as Excel (.xlsx, .csv) or PDF. You can also add or update it later."}</span></div>
          {inv ? <button type="button" className="btn sm ghost" onClick={() => setInv(null)}>Remove</button>
            : <label className="btn sm">+ Add inventory<input type="file" accept=".xlsx,.csv,.pdf,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickInventory(f); e.target.value = ''; }} /></label>}
        </div>
        {inv && 'error' in inv && inv.error !== 'Reading…' && <p className="msg err">{inv.error}</p>}

        <div className="mp-row">
          <div><b>Videos</b><span className="hint">{videos.length ? `${videos.length} of 5 · ${mb(videos.reduce((a, f) => a + f.size, 0))} of 10 MB` : 'Optional. Up to 5 videos, 10 MB in total. Shown on the website.'}</span></div>
          {videos.length < 5 && <label className="btn sm">+ Add videos<input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm" multiple hidden onChange={(e) => { pickVideos(e.target.files); e.target.value = ''; }} /></label>}
        </div>
        {videos.length > 0 && (
          <div className="mp-plans">
            {videos.map((v) => (
              <div key={v.name + v.size} className="mp-plan"><span className="plan-pdf" aria-hidden="true">▶</span><span className="grow">{v.name} · {mb(v.size)}</span>
                <button type="button" className="btn sm ghost" onClick={() => setVideos((x) => x.filter((y) => y !== v))}>Remove</button></div>
            ))}
          </div>
        )}
        {vErr && <p className="msg err">{vErr}</p>}
      </div>

      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      {state?.ok && !busy && <p className="msg ok" role="status">{state.ok}</p>}
      {warn && <p className="msg err">{warn}</p>}
      <div><Save busy={busy} /></div>
    </form>
  );
}
