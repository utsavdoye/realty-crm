'use client';

import { useMemo, useState } from 'react';
import { useFormState } from 'react-dom';
import { addMemberDirect, type FormState } from '@/app/actions';
import { Submit } from '@/components/forms';
import { CopyButton } from '@/components/CopyButton';
import { PICK_LABEL, type PickRole } from '@/lib/roles';
import { waLink } from '@/lib/crm';

const tempPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = new Uint32Array(8); crypto.getRandomValues(b);
  return Array.from(b, (n) => a[n % a.length]).join('');
};

/** Add a person straight away with a temporary password (no email code needed). */
export function AddMemberForm({ canAddManager, companyName }: { canAddManager: boolean; companyName: string }) {
  const [state, action] = useFormState<FormState, FormData>(addMemberDirect, null);
  const roles: PickRole[] = canAddManager ? ['agent', 'intern', 'manager', 'owner'] : ['agent', 'intern'];
  const first = useMemo(() => tempPassword(), []);
  const [pw, setPw] = useState(first);
  const [email, setEmail] = useState('');
  const msg = state?.ok
    ? `Hi ${state.name ?? ''}, your ${companyName} CRM login is ready.\nOpen: ${state.link}\nSign in with your mobile number ${state.phone ?? ''} (or email ${email})\nTemporary password: ${pw}\nYou will choose your own password after you sign in.`
    : '';
  return (
    <form action={action} className="stack">
      <p className="hint">Use this when someone cannot create an account (for example &quot;Too many tries&quot;). They get in at once with a temporary password and choose their own after signing in.</p>
      <div className="grid2f">
        <label className="field"><span className="label">Full name</span><input name="full_name" required minLength={2} maxLength={80} placeholder="As on their ID" /></label>
        <label className="field"><span className="label">Mobile number</span><input name="phone" required inputMode="tel" placeholder="98765 43210" /></label>
        <label className="field"><span className="label">Email</span><input name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" /></label>
        <label className="field"><span className="label">Role</span>
          <select name="role" defaultValue="agent">{roles.map((r) => <option key={r} value={r}>{PICK_LABEL[r]}</option>)}</select></label>
        <label className="field"><span className="label">Temporary password</span>
          <div className="pw-wrap"><input name="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required className="mono" />
            <button type="button" className="linkbtn" onClick={() => setPw(tempPassword())}>New</button></div></label>
      </div>
      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      {state?.ok && (
        <div className="msg ok stack">
          <span>{state.ok}</span>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{msg}</pre>
          <div className="row-btns">
            <CopyButton text={msg} label="Copy message" />
            {state.phone && <a className="btn sm wa" href={waLink(state.phone, msg)} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
          </div>
        </div>
      )}
      <div><Submit className="btn primary">Add to team</Submit></div>
    </form>
  );
}
