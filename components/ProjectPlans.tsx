'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addFloorPlans, removeFloorPlan, setBrochure } from '@/app/crm-actions';
import { uploadProjectFile } from '@/lib/upload';

type Plan = { url: string; label: string };
export const isPdf = (u: string) => /\.pdf(\?|#|$)/i.test(u);
const nameToLabel = (n: string) => n.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);

/** Floor plans on a project card, plus the brochure PDF upload. */
export function ProjectPlans({ projectId, orgId, plans, canEdit, hasPdf }: { projectId: string; orgId: string; plans: Plan[]; canEdit: boolean; hasPdf: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<{ file: File; label: string; url: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<Plan | null>(null);

  async function save() {
    setError('');
    const done: Plan[] = [];
    for (let i = 0; i < picked.length; i++) {
      setBusy(`Uploading ${i + 1} of ${picked.length}…`);
      try { done.push({ url: await uploadProjectFile(orgId, projectId, 'plan', picked[i].file), label: picked[i].label }); }
      catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    }
    if (done.length) { const r = await addFloorPlans(projectId, done); if (r.error) setError(r.error); }
    setBusy(''); setPicked([]); router.refresh();
  }
  async function pdf(f: File) {
    setError(''); setBusy('Uploading brochure…');
    try { const r = await setBrochure(projectId, await uploadProjectFile(orgId, projectId, 'brochure', f)); if (r.error) setError(r.error); }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    setBusy(''); router.refresh();
  }
  async function remove(p: Plan) {
    if (!confirm(`Remove the floor plan "${p.label || 'plan'}"?`)) return;
    setBusy('Removing…'); const r = await removeFloorPlan(projectId, p.url); setBusy('');
    if (r.error) setError(r.error); else { setView(null); router.refresh(); }
  }

  if (!plans.length && !canEdit) return null;
  return (
    <div className="plans">
      {plans.length > 0 && <b className="small-h">Floor plans ({plans.length})</b>}
      {/* PDF floor plans: plain links like "Brochure (PDF)", open in a new tab */}
      {plans.filter((p) => isPdf(p.url)).map((p, i, all) => (
        <span key={p.url} className="plan-link-row">
          <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.label || undefined}>
            {p.label && p.label.length <= 30 ? p.label : all.length > 1 ? `Floor plan ${i + 1}` : 'Floor plan'} (PDF)
          </a>
          {canEdit && <button type="button" className="linkbtn small plan-remove" disabled={!!busy} onClick={() => remove(p)} aria-label={`Remove ${p.label || 'floor plan'}`}>Remove</button>}
        </span>
      ))}
      {plans.some((p) => !isPdf(p.url)) && (
        <div className="plans-grid">
          {plans.filter((p) => !isPdf(p.url)).map((p) => (
            <button key={p.url} type="button" className="plan-tile" onClick={() => setView(p)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.label} loading="lazy" /><span className="plan-name">{p.label || 'Floor plan'}</span>
            </button>
          ))}
        </div>
      )}
      {canEdit && picked.length > 0 && (
        <div className="mp-plans">
          {picked.map((p, i) => (
            <div key={p.url} className="mp-plan">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.file.type === 'application/pdf' ? <span className="plan-pdf" aria-hidden="true">PDF</span> : <img src={p.url} alt="" />}
              <input value={p.label} maxLength={60} placeholder="e.g. 3 BHK · 1,450 sq ft" aria-label={`Name of floor plan ${i + 1}`}
                onChange={(e) => setPicked((x) => x.map((y) => (y === p ? { ...y, label: e.target.value } : y)))} />
              <button type="button" className="btn sm ghost" onClick={() => setPicked((x) => x.filter((y) => y !== p))}>✕</button>
            </div>
          ))}
          <div className="row-gap"><button type="button" className="btn sm primary" disabled={!!busy} onClick={save}>{busy || `Upload ${picked.length} floor plan${picked.length === 1 ? '' : 's'}`}</button></div>
        </div>
      )}
      {canEdit && (
        <div className="row-gap">
          <label className="btn sm ghost">+ Floor plans (photo or PDF)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden
            onChange={(e) => { const add = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/') || (f.type === 'application/pdf' && f.size <= 20 * 1024 * 1024)).slice(0, 20 - plans.length - picked.length).map((file) => ({ file, label: nameToLabel(file.name), url: URL.createObjectURL(file) })); setPicked((x) => [...x, ...add]); e.target.value = ''; }} /></label>
          <label className="btn sm ghost">{hasPdf ? 'Replace brochure PDF' : '+ Brochure PDF'}<input type="file" accept="application/pdf" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pdf(f); e.target.value = ''; }} /></label>
          {busy && !picked.length && <span className="hint">{busy}</span>}
        </div>
      )}
      {error && <p className="msg err">{error}</p>}
      {view && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={view.label || 'Floor plan'} onClick={() => setView(null)}>
          <div className="lb-top" onClick={(e) => e.stopPropagation()}>
            <b>{view.label || 'Floor plan'}</b>
            {canEdit && <button className="btn sm danger" disabled={!!busy} onClick={() => remove(view)}>Remove</button>}
            <button className="btn sm" onClick={() => setView(null)} aria-label="Close">✕</button>
          </div>
          {isPdf(view.url) ? (
            <div className="lb-pdf" onClick={(e) => e.stopPropagation()}>
              <iframe src={view.url} title={view.label || 'Floor plan'} />
              <a className="btn sm" href={view.url} target="_blank" rel="noopener noreferrer">Open the PDF</a>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={view.url} alt={view.label} onClick={(e) => e.stopPropagation()} style={{ background: '#fff' }} />
          )}
        </div>
      )}
    </div>
  );
}
