'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { logCall } from '@/app/crm-actions';
import { Submit } from '@/components/forms';
import { VoiceFill } from '@/components/VoiceFill';
import { BHKS, BUDGETS, LOST_REASONS, OUTCOMES, RAIPUR_AREAS, toLocalInput } from '@/lib/crm';
import type { FormState } from '@/app/actions';

const defaultNext = (k: string) => {
  const o = OUTCOMES.find((x) => x.k === k);
  return o?.hours ? toLocalInput(new Date(Date.now() + o.hours * 3600000).toISOString()) : '';
};

export function LogCallForm({ leadId, voice = false, step, onSaved }: {
  leadId: string; voice?: boolean;
  /** The client's current step, if this person can finish it with this call (first call, presentation, follow-up). */
  step?: { k: string; label: string; next?: string | null } | null;
  onSaved?: (msg: string) => void;
}) {
  const [state, action] = useFormState<FormState, FormData>(async (prev: FormState, fd: FormData) => {
    const r = await logCall(prev, fd);
    if (r?.ok) onSaved?.(r.ok);
    return r;
  }, null);
  const [out, setOut] = useState<string>('interested');
  const [next, setNext] = useState(() => defaultNext('interested'));
  const [more, setMore] = useState(false);
  const closes = out === 'notint' || out === 'wrong';

  // After-call voice note: the form takes outcome and next time itself (the rest is typed into the boxes).
  function onFields(f: Record<string, string>) {
    const done: string[] = [];
    if (f.outcome) { setOut(f.outcome); setNext(f.next || defaultNext(f.outcome)); done.push('outcome'); if (f.next) done.push('next'); }
    else if (f.next) { setNext(f.next); done.push('next'); }
    if (f.visit_at || f.upd_bhk || f.upd_budget || f.upd_location) setMore(true);
    return done;
  }

  return (
    <form action={action} className="stack" key={state?.ok ?? 'f'}>
      <input type="hidden" name="id" value={leadId} />
      <VoiceFill enabled={voice} endpoint="/api/voice/call" extra={{ lead_id: leadId }} onFields={onFields}
        label="Fill call by voice" tip="Say what happened on the call: what they want, budget, visit, when to call back" doneHint="check it, then Save call" />
      <div className="pick" role="radiogroup" aria-label="What happened">
        {OUTCOMES.map((x) => (
          <label key={x.k} className={`pickopt ${out === x.k ? 'on' : ''}`}>
            <input type="radio" name="outcome" value={x.k} checked={out === x.k} onChange={() => { setOut(x.k); setNext(defaultNext(x.k)); }} />{x.l}
          </label>
        ))}
      </div>
      <textarea name="note" rows={2} placeholder="What did they say? Budget, family, loan, objections…" />
      {out === 'notint' && (
        <label className="field"><span className="label">Reason</span><select name="reason">{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
      )}
      {!closes && (
        <label className="field"><span className="label">Next call</span><input type="datetime-local" name="next" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      )}
      {closes && <p className="hint">This lead will be marked as lost.</p>}
      <details className="call-more" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
        <summary className="linkbtn">{more ? 'Hide' : '+ Site visit fixed, or new budget / configuration / area?'}</summary>
        <div className="grid2f" style={{ marginTop: 10 }}>
          <label className="field"><span className="label">Site visit on</span><input type="datetime-local" name="visit_at" /></label>
          <label className="field"><span className="label">Configuration</span><select name="upd_bhk" defaultValue=""><option value="">No change</option>{BHKS.map((b) => <option key={b}>{b}</option>)}</select></label>
          <label className="field"><span className="label">Budget</span><select name="upd_budget" defaultValue=""><option value="">No change</option>{BUDGETS.map((b) => <option key={b.k} value={b.k}>{b.l}</option>)}</select></label>
          <label className="field"><span className="label">Area</span><input name="upd_location" list="raipur-areas-call" placeholder="e.g. VIP Road, Amlidih" /></label>
          <datalist id="raipur-areas-call">{RAIPUR_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
      </details>
      {step && (out === 'interested' || out === 'callback') && (
        <label className="check finish-step"><input type="checkbox" name="finish_step" value={step.k} defaultChecked={step.k === 'call' && out === 'interested'} />
          <span>This call finishes the <b>{step.label.toLowerCase()}</b>{step.next ? <> — hand the client to {step.next}</> : ''}</span></label>
      )}
      <div><Submit>Save call</Submit></div>
      {state?.error && <p className="msg err">{state.error}</p>}
      {state?.ok && <p className="msg ok">{state.ok}</p>}
    </form>
  );
}
