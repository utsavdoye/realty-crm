'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { addFloorPlans, addProjectPhotos, saveProject, setBrochure } from '@/app/crm-actions';
import { ProjectFields } from '@/components/ProjectFields';
import { uploadProjectFile } from '@/lib/upload';
import type { FormState } from '@/app/actions';

type Plan = { file: File; label: string; url: string };
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

/** "Add a project" with photos, floor plans and a brochure PDF in one go. */
export function AddProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [newId, setNewId] = useState('');
  const [round, setRound] = useState(0);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [warn, setWarn] = useState('');

  useEffect(() => { setNewId(newUuid()); }, [round]);
  // The save step runs later, so it reads the picked files from here (always the latest).
  const picked = useRef({ photos, plans, pdf });
  picked.current = { photos, plans, pdf };

  const [state, action] = useFormState(async (prev: FormState, fd: FormData): Promise<FormState> => {
    setWarn('');
    const r = await saveProject(prev, fd);
    if (!r?.ok) return r;
    const id = String(fd.get('new_id'));
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      router.refresh();
      return { ok: 'Project added. Add its photos and floor plans from the project card.' };
    }
    const { photos, plans, pdf } = picked.current;
    const failed: string[] = [];
    const up = async (kind: 'photo' | 'plan' | 'brochure', f: File, n: string) => {
      setBusy(n);
      try { return await uploadProjectFile(orgId, id, kind, f); } catch (e) { failed.push(`${f.name} (${e instanceof Error ? e.message : 'failed'})`); return null; }
    };
    const pUrls: string[] = [];
    for (let i = 0; i < photos.length; i++) { const u = await up('photo', photos[i].file, `Uploading photo ${i + 1} of ${photos.length}…`); if (u) pUrls.push(u); }
    const plUrls: { url: string; label: string }[] = [];
    for (let i = 0; i < plans.length; i++) { const u = await up('plan', plans[i].file, `Uploading floor plan ${i + 1} of ${plans.length}…`); if (u) plUrls.push({ url: u, label: plans[i].label }); }
    const pdfUrl = pdf ? await up('brochure', pdf, 'Uploading brochure…') : null;
    setBusy('Saving…');
    if (pUrls.length) await addProjectPhotos(id, pUrls);
    if (plUrls.length) await addFloorPlans(id, plUrls);
    if (pdfUrl) await setBrochure(id, pdfUrl);
    setBusy('');
    if (failed.length) setWarn(`Project added, but these did not upload: ${failed.join(', ')}. Add them again from the project card.`);
    form.current?.reset();
    setPhotos([]); setPlans([]); setPdf(null); setRound((x) => x + 1);
    router.refresh();
    return { ok: `Project added${pUrls.length ? ` with ${pUrls.length} photo${pUrls.length === 1 ? '' : 's'}` : ''}${plUrls.length ? ` and ${plUrls.length} floor plan${plUrls.length === 1 ? '' : 's'}` : ''}.` };
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
      </div>

      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      {state?.ok && !busy && <p className="msg ok" role="status">{state.ok}</p>}
      {warn && <p className="msg err">{warn}</p>}
      <div><Save busy={busy} /></div>
    </form>
  );
}
