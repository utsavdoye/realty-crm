'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Method = 'phone' | 'email' | 'demo';

// Practice logins made by supabase/demo-seed.sql. Shown only when NEXT_PUBLIC_DEMO_LOGIN=true (never turn this on for real customers).
const DEMO_ON = process.env.NEXT_PUBLIC_DEMO_LOGIN === 'true';
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

export default function LoginForm({ next, inviteHint, linkError }: { next: string; inviteHint?: string; linkError?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [method, setMethod] = useState<Method>(DEMO_ON ? 'demo' : 'phone');
  const [step, setStep] = useState<'enter' | 'code'>('enter');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(linkError ? 'That sign-in link did not work or has expired. Send a new one.' : '');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');

  async function send() {
    setError('');
    if (method === 'phone' && !/^[6-9]\d{9}$/.test(digits)) return setError('Enter your 10-digit mobile number.');
    if (method === 'email' && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    const { error } = method === 'phone'
      ? await supabase.auth.signInWithOtp({ phone: '+91' + digits })
      : await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes('sms') || m.includes('provider') || m.includes('phone')) {
        setError('WhatsApp login is not switched on yet. Use the Email tab for now.');
      } else if (m.includes('rate') || m.includes('seconds')) {
        setError('Too many tries. Wait a minute and try again.');
      } else setError(error.message);
      return;
    }
    setStep('code');
    setCode('');
    setWait(30);
  }

  async function demoLogin(who: string) {
    setError('');
    setBusy(true);
    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({ email: `${who}@demo.estatedesk.test`, password: DEMO_PASSWORD });
    if (error) {
      setBusy(false);
      setError('Demo login failed. Run supabase/demo-seed.sql in Supabase first.');
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function verify(value = code) {
    setError('');
    if (!/^\d{6}$/.test(value)) return setError('Enter the 6-digit code.');
    setBusy(true);
    const { error } = method === 'phone'
      ? await supabase.auth.verifyOtp({ phone: '+91' + digits, token: value, type: 'sms' })
      : await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: value, type: 'email' });
    if (error) {
      setBusy(false);
      setError(error.message.toLowerCase().includes('expired') ? 'That code has expired. Send a new one.' : 'That code is not right. Check it and try again.');
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="auth-card">
      {step === 'enter' ? (
        <>
          <h1>Log in</h1>
          <p className="muted">{inviteHint || 'We will send a 6-digit code on WhatsApp. No password needed.'}</p>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={method === 'phone'} className={method === 'phone' ? 'on' : ''} onClick={() => { setMethod('phone'); setError(''); }}>WhatsApp</button>
            <button role="tab" aria-selected={method === 'email'} className={method === 'email' ? 'on' : ''} onClick={() => { setMethod('email'); setError(''); }}>Email</button>
            {DEMO_ON && <button role="tab" aria-selected={method === 'demo'} className={method === 'demo' ? 'on' : ''} onClick={() => { setMethod('demo'); setError(''); }}>Demo</button>}
          </div>
          {method === 'demo' ? (
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
          ) : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); send(); }}>
            {method === 'phone' ? (
              <label className="field">
                <span className="label">Your WhatsApp number</span>
                <div className="prefix-input">
                  <span>+91</span>
                  <input id="phone" autoFocus inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={14} />
                </div>
              </label>
            ) : (
              <label className="field">
                <span className="label">Email</span>
                <input id="email" autoFocus type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            )}
            {error && <p className="msg err" role="alert">{error}</p>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          </form>
          )}
        </>
      ) : (
        <>
          <h1>{method === 'email' ? 'Check your email' : 'Check WhatsApp'}</h1>
          <p className="muted">
            Sent to <b>{method === 'phone' ? '+91 ' + digits.slice(0, 5) + ' ' + digits.slice(5) : email}</b>.{' '}
            <button className="linkbtn" onClick={() => { setStep('enter'); setError(''); }}>Change</button>
          </p>
          {method === 'phone' && (
            <p className="msg ok">Open WhatsApp. You will get a message with your 6-digit code. Tap <b>Copy code</b> and paste it here.</p>
          )}
          {method === 'email' && (
            <p className="msg ok">Open the email and tap <b>Sign in</b> on this same device and browser. If your email shows a 6-digit code instead, type it below.</p>
          )}
          <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <input
              ref={codeRef}
              className="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-label="6-digit code"
              placeholder="••••••"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(v);
                if (v.length === 6) verify(v);
              }}
            />
            {error && <p className="msg err" role="alert">{error}</p>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Checking…' : 'Verify and continue'}</button>
            <p className="hint center">
              {wait > 0 ? `Resend code in ${wait}s` : <button type="button" className="linkbtn" onClick={send}>Resend code</button>}
            </p>
          </form>
        </>
      )}
    </div>
  );
}
