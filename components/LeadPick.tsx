'use client';

import { useState } from 'react';
import { BHKS, CATEGORIES, PTYPES, PTYPES_FOR } from '@/lib/crm';

const opts = (list: string[], cur?: string | null) =>
  [<option key="" value="">—</option>, ...list.map((x) => <option key={x} value={x}>{x}</option>)]
    .concat(cur && !list.includes(cur) ? [<option key={cur} value={cur}>{cur}</option>] : []);

/** Category → Configuration → Property type. Commercial has no BHK, so Configuration is greyed out. */
export function PropertyPick({ category, bhk, ptype }: { category?: string | null; bhk?: string | null; ptype?: string | null }) {
  const [cat, setCat] = useState(category ?? '');
  const [pt, setPt] = useState(ptype ?? '');
  const commercial = cat === 'Commercial';
  const types = PTYPES_FOR[cat] ?? PTYPES;
  return (
    <>
      <label className="field"><span className="label">Category</span>
        <select name="category" value={cat} onChange={(e) => { setCat(e.target.value); if (pt && !(PTYPES_FOR[e.target.value] ?? PTYPES).includes(pt)) setPt(''); }}>
          {opts(CATEGORIES, category)}
        </select>
      </label>
      <label className="field"><span className="label">Configuration</span>
        <select name="bhk" defaultValue={commercial ? '' : bhk ?? ''} disabled={commercial} title={commercial ? 'Not needed for shops and offices' : undefined}>
          {opts(BHKS, bhk)}
        </select>
        {commercial && <span className="hint">Not needed for commercial</span>}
      </label>
      <label className="field"><span className="label">Property type</span>
        <select name="property_type" value={pt} onChange={(e) => setPt(e.target.value)}>{opts(types, ptype)}</select>
      </label>
    </>
  );
}

/** Project list with "Other (not in the list)", which opens a box to type the name. */
export function ProjectPick({ projects, projectId, other, name = 'project_id', label = 'Project', required = false, placeholder = '—' }: {
  projects: { id: string; name: string }[]; projectId?: string | null; other?: string | null; name?: string; label?: string | null; required?: boolean; placeholder?: string;
}) {
  const [v, setV] = useState(projectId ?? (other ? '__other' : ''));
  const sel = (
    <select name={name} value={v} required={required} onChange={(e) => setV(e.target.value)} aria-label={label ?? placeholder}>
      <option value="">{placeholder}</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value="__other">Other (not in the list)</option>
    </select>
  );
  const box = v === '__other' && <input name="project_other" defaultValue={other ?? ''} placeholder="Project name" maxLength={120} required={required} />;
  if (!label) return <>{sel}{box}</>;
  return <label className="field"><span className="label">{label}</span>{sel}{box}</label>;
}
