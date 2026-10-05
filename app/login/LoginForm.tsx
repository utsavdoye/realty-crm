'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import { signInAction } from '@/app/auth-actions';
import { PhoneInput } from '@/components/PhoneInput';

type Mode = 'signin' | 'signup' | 'demo';

// Practice logins made by supabase/demo-seed.sql. Shown only when NEXT_PUBLIC_DEMO_LOGIN=true (never on the real website).
const DEMO_ON = process.env.NEXT_PUBLIC_DEMO_LOGIN === 'true';
// Sign-up by mobile needs WhatsApp/SMS codes. Set NEXT_PUBLIC_WHATSAPP_LOGIN=true once that is set up.
const WA_ON = process.env.NEXT_PUBLIC_WHATSAPP_LOGIN === 'true';
const DEMO_PASSWORD = 'Demo@12345';
const DEMO_USERS = [
  { email: 'owner', name: 'Rajesh Doye', role: 'Admin · sees everything incl. money' },
  { email: 'sunita', name: 'Sunita Doye', role: 'Admin · sees everything incl. money' },
  { email: 'manager', name: 'Priya Nair', role: 'Manager · everything except money' },
  { email: 'amit', name: 'Amit Kumar', role: 'Employee' },
  { email: 'sneha', name: 'Sneha Reddy', role: 'Employee' },
  { email: 'rahul', name: 'Rahul Verma', role: 'Employee' },
  { email: 'kavya', name: 'Kavya Iyer', role: 'Employee' },
  { email: 'arjun', name: 'Arjun Mehta', role: 'Employee' },
  { email: 'fatima', name: 'Fatima Shaikh', role: 'Employee' },
  { email: 'vikram', name: 'Vikram Singh', role: 'Employee · joined 3 days ago' },
  { email: 'deepak', name: 'Deepak Rao', role: 'Removed employee (should be blocked)' },
];

function Btn({ children, busyText }: { children: string; busyText: string }) {
  const { pending } = useFormStatus();
  return <button className="btn primary block" disabled={pending}>{pending ? busyText : children}</button>;
}

export default function LoginForm({ next, inviteHint, linkError }: { next: string; inviteHint?: string; linkError?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>(DEMO_ON ? 'demo' : 'signin');
  const [via, setVia] = useState<'email' | 'phone'>('email');
  const [signState, signAction] = useFormState(signInAction, null);
  const [showPw, setShowPw] = useState(false);

  // sign-up
  const [upVia, setUpVia] = useState<'email' | 'phone'>('email');
  const [step, setStep] = useState<'enter' | 'code'>('enter');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(linkError ? 'That link did not work or has expired. Please try again.' : '');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const afterCode = `/auth/set-password?next=${encodeURIComponent(next)}`;

  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  function switchTo(m: Mode) { setMode(m); setError(''); setStep('enter'); }

  async function sendCode() {
    setError('');
    if (upVia === 'email' && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (upVia === 'phone' && !/^(\d{10}|\+\d{8,15})$/.test(phone)) return setError('Enter a valid mobile number.');
    setBusy(true);
    const { error } = upVia === 'email'
      ? await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(afterCode)}` } })
      : await supabase.auth.signInWithOtp({ phone: phone.startsWith('+') ? phone : '+91' + phone });
    setBusy(false);
    if (error) {
      setError(/rate|seconds/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : /sms|provider|phone/i.test(error.message) ? 'Mobile codes are not switched on yet. Use email.' : error.message);
      return;
    }
    setStep('code'); setCode(''); setWait(30);
  }

  async function verify(value = code) {
    setError('');
    if (!/^\d{6,8}$/.test(value)) return setError('Enter the code from the message.');
    setBusy(true);
    const { error } = upVia === 'email'
      ? await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: value, type: 'email' })
      : await supabase.auth.verifyOtp({ phone: phone.startsWith('+') ? phone : '+91' + phone, token: value, type: 'sms' });
    if (error) { setBusy(false); setError(/expired/i.test(error.message) ? 'That code has expired. Send a new one.' : 'That code is not right. Check it and try again.'); return; }
    router.replace(afterCode);
    router.refresh();
  }

  async function demoLogin(who: string) {
    setError(''); setBusy(true);
    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({ email: `${who}@demo.estatedesk.test`, password: DEMO_PASSWORD });
    if (error) { setBusy(false); setError('Demo login failed. Run supabase/demo-seed.sql in Supabase first.'); return; }
    router.replace(next); router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchTo('signin')}>Sign in</button>
        <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>Create account</button>
        {DEMO_ON && <button role="tab" aria-selected={mode === 'demo'} className={mode === 'demo' ? 'on' : ''} onClick={() => switchTo('demo')}>Demo</button>}
      </div>
      {inviteHint && <p className="hint">{inviteHint}</p>}

      {mode === 'signin' && (
        <form action={signAction} className="stack">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="via" value={via} />
          <div className="seg small-seg">
            <button type="button" className={via === 'email' ? 'on' : ''} onClick={() => setVia('email')}>Email</button>
            <button type="button" className={via === 'phone' ? 'on' : ''} onClick={() => setVia('phone')}>Mobile number</button>
          </div>
          {via === 'email' ? (
            <label className="field"><span className="label">Email</span><input name="email" type="email" autoComplete="username" required placeholder="you@company.com" /></label>
          ) : (
            <label className="field"><span className="label">Mobile number</span><PhoneInput name="phone" required /></label>
          )}
          <label className="field">
            <span className="label row-between">Password <Link href={`/forgot?next=${encodeURIComponent(next)}`} className="hint">Forgot password?</Link></span>
            <div className="pw-wrap">
              <input name="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required />
              <button type="button" className="linkbtn" onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          {(signState?.error || error) && <p className="msg err" role="alert">{signState?.error || error}</p>}
          <Btn busyText="Signing in…">Sign in</Btn>
          <p className="hint center">New here? <button type="button" className="linkbtn" onClick={() => switchTo('signup')}>Create an account</button></p>
        </form>
      )}

      {mode === 'signup' && step === 'enter' && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          <p className="muted">We will send you a code to check it is you. Then you choose a password.</p>
          {WA_ON && (
            <div className="seg small-seg">
              <button type="button" className={upVia === 'email' ? 'on' : ''} onClick={() => setUpVia('email')}>Email</button>
              <button type="button" className={upVia === 'phone' ? 'on' : ''} onClick={() => setUpVia('phone')}>Mobile number</button>
            </div>
          )}
          {upVia === 'email' ? (
            <label className="field"><span className="label">Email</span><input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
          ) : (
            <label className="field"><span className="label">Mobile number</span><PhoneInput name="signup_phone" onValue={setPhone} autoFocus /></label>
          )}
          {error && <p className="msg err" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          <p className="hint center">Already have an account? <button type="button" className="linkbtn" onClick={() => switchTo('signin')}>Sign in</button></p>
        </form>
      )}

      {mode === 'signup' && step === 'code' && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <h1>{upVia === 'email' ? 'Check your email' : 'Check your messages'}</h1>
          <p className="muted">Sent to <b>{upVia === 'email' ? email : phone}</b>. <button type="button" className="linkbtn" onClick={() => setStep('enter')}>Change</button></p>
          {upVia === 'email' && <p className="msg ok">Type the code from the email below. If the email has a button instead, tap it <b>on this same device</b>.</p>}
          <input ref={codeRef} className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={8} aria-label="Code" placeholder="••••••" value={code}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 8); setCode(v); if (v.length === 6) verify(v); }} />
          {error && <p className="msg err" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
          <p className="hint center">{wait > 0 ? `Send again in ${wait}s` : <button type="button" className="linkbtn" onClick={sendCode}>Send the code again</button>}</p>
        </form>
      )}

      {mode === 'demo' && (
        <div className="stack">
          <p className="hint">Practice accounts with fake data. Tap a person to log in as them.</p>
          <div className="demo-list">
            {DEMO_USERS.map((u) => (
              <button key={u.email} type="button" className="org-pick" disabled={busy} onClick={() => demoLogin(u.email)}>
                <span className="org-initial">{u.name[0]}</span>
                <span className="org-text"><b>{u.name}</b><span className="hint">{u.role}</span></span>
              </button>
            ))}
          </div>
          {error && <p className="msg err" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
