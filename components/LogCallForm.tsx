'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { logCall } from '@/app/crm-actions';
import { Submit } from '@/components/forms';
import { LOST_REASONS, OUTCOMES, toLocalInput } from '@/lib/crm';
import type { FormState } from '@/app/actions';

export function LogCallForm({ leadId }: { leadId: string }) {
  const [state, action] = useFormState<FormState, FormData>(logCall, null);
  const [out, setOut] = useState<string>('interested');
  const o = OUTCOMES.find((x) => x.k === out)!;
  const next = o.hours ? toLocalInput(new Date(Date.now() + o.hours * 3600000).toISOString()) : '';
  const closes = out === 'notint' || out === 'wrong';
  return (
    <form action={action} className="stack" key={state?.ok ?? 'f'}>
      <input type="hidden" name="id" value={leadId} />
      <div className="pick" role="radiogroup" aria-label="What happened">
        {OUTCOMES.map((x) => (
          <label key={x.k} className={`pickopt ${out === x.k ? 'on' : ''}`}>
            <input type="radio" name="outcome" value={x.k} checked={out === x.k} onChange={() => setOut(x.k)} />{x.l}
          </label>
        ))}
      </div>
      <textarea name="note" rows={2} placeholder="What did they say? Budget, family, loan, objections…" />
      {out === 'notint' && (
        <label className="field"><span className="label">Reason</span><select name="reason">{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
      )}
      {!closes && (
        <label className="field"><span className="label">Next call</span><input type="datetime-local" name="next" defaultValue={next} key={out} /></label>
      )}
      {closes && <p className="hint">This lead will be marked as lost.</p>}
      <div><Submit>Save call</Submit></div>
      {state?.error && <p className="msg err">{state.error}</p>}
      {state?.ok && <p className="msg ok">{state.ok}</p>}
    </form>
  );
}
