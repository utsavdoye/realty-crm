'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { setPasswordAction } from '@/app/auth-actions';
import { PhoneInput } from '@/components/PhoneInput';

function Save() {
  const { pending } = useFormStatus();
  return <button className="btn primary block" disabled={pending}>{pending ? 'Saving…' : 'Save and continue'}</button>;
}

export function SetPasswordForm({ next, askPhone, askName }: { next: string; askPhone: boolean; askName: boolean }) {
  const [state, action] = useFormState(setPasswordAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      {askName && <label className="field"><span className="label">Your name</span><input name="full_name" autoComplete="name" /></label>}
      <label className="field"><span className="label">Password</span>
        <div className="pw-wrap"><input name="password" type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} /><button type="button" className="linkbtn" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button></div>
        <span className="hint">At least 8 characters, with letters and numbers.</span>
      </label>
      <label className="field"><span className="label">Confirm password</span><input name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required /></label>
      {askPhone && (
        <label className="field"><span className="label">Mobile number</span><PhoneInput name="phone" required />
          <input type="hidden" name="require_phone" value="1" />
          <span className="hint">So you can also sign in with your mobile number.</span></label>
      )}
      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      <Save />
    </form>
  );
}
