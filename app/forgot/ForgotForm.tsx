'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { forgotAction } from '@/app/auth-actions';
import { PhoneInput } from '@/components/PhoneInput';

function Send() {
  const { pending } = useFormStatus();
  return <button className="btn primary block" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>;
}

export function ForgotForm({ next }: { next: string }) {
  const [state, action] = useFormState(forgotAction, null);
  const [via, setVia] = useState<'email' | 'phone'>('email');
  if (state?.ok) return <div className="stack"><p className="msg ok">{state.ok}</p><Link className="btn block" href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></div>;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="via" value={via} />
      <div className="seg small-seg">
        <button type="button" className={via === 'email' ? 'on' : ''} onClick={() => setVia('email')}>Email</button>
        <button type="button" className={via === 'phone' ? 'on' : ''} onClick={() => setVia('phone')}>Mobile number</button>
      </div>
      {via === 'email'
        ? <label className="field"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" /></label>
        : <label className="field"><span className="label">Mobile number</span><PhoneInput name="phone" required /></label>}
      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      <Send />
      <p className="hint center"><Link href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></p>
    </form>
  );
}
