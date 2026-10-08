'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { LogCallForm } from '@/components/LogCallForm';

type Step = { k: string; label: string; next?: string | null } | null;
type Pending = { id: string; name: string; step: Step; at: number };
const KEY = 'ed_call';

/** Big Call button. Remembers the call, so "How did it go?" opens by itself when the person comes back to the CRM. */
export function CallButton({ leadId, name, tel, step = null, className = 'btn primary', children }: {
  leadId: string; name: string; tel: string; step?: Step; className?: string; children?: React.ReactNode;
}) {
  return (
    <a className={className} href={tel} onClick={() => {
      try { localStorage.setItem(KEY, JSON.stringify({ id: leadId, name, step, at: Date.now() } satisfies Pending)); } catch { /* private mode: no pop-up, the form is still on the page */ }
    }}>{children ?? '📞 Call'}</a>
  );
}

/** Put once in the app layout. Opens the call form after a call made with CallButton. */
export function CallReturn({ voice = false }: { voice?: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<Pending | null>(null);
  const [done, setDone] = useState('');

  const check = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return;
      const v = JSON.parse(raw) as Pending;
      const age = Date.now() - v.at;
      if (age > 3 * 3600000) { localStorage.removeItem(KEY); return; }
      if (age > 3000) setP(v); // back from the phone app
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [check]);

  const close = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setP(null); setDone(''); };
  if (!p) return null;
  return createPortal(
    <div className="pop-back" role="dialog" aria-modal="true" aria-label="How did the call go?">
      <div className="pop callpop">
        <div className="pop-h"><b>How did the call with {p.name.split(' ')[0]} go?</b><button type="button" className="btn sm ghost" onClick={close} aria-label="Close">✕</button></div>
        {done ? (
          <>
            <p className="msg ok">{done}</p>
            <div className="row-btns"><button type="button" className="btn primary" onClick={close}>Done</button><a className="btn" href={`/leads/${p.id}`} onClick={close}>Open client</a></div>
          </>
        ) : (
          <>
            <LogCallForm leadId={p.id} voice={voice} step={p.step} onSaved={(m) => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setDone(m); router.refresh(); }} />
            <button type="button" className="linkbtn small" onClick={close}>Did not call — close</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
