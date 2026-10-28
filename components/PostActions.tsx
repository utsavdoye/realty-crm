'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePost, disconnectAccount, publishDraft, retryPost, setAccountActive, setMetaLeadSource } from '@/app/social-actions';

type R = { ok?: string; error?: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<R | null>(null);
  const run = (fn: () => Promise<R>) => start(async () => { const r = await fn().catch(() => ({ error: 'Could not reach the server.' })); setMsg(r); router.refresh(); });
  return { pending, msg, run };
}

export function PostButtons({ id, status }: { id: string; status: string }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="row-btns">
      {status === 'draft' && <button className="btn sm primary" disabled={pending} onClick={() => run(() => publishDraft(id))}>{pending ? 'Posting…' : 'Publish'}</button>}
      {(status === 'partial' || status === 'failed') && <button className="btn sm" disabled={pending} onClick={() => run(() => retryPost(id))}>{pending ? 'Trying…' : 'Retry failed'}</button>}
      <button className="btn sm ghost danger" disabled={pending} onClick={() => run(() => deletePost(id))}>Delete</button>
      {msg?.error && <span className="hint" style={{ color: 'var(--hot)' }}>{msg.error}</span>}
    </span>
  );
}

export function AccountButtons({ id, active, owner }: { id: string; active: boolean; owner: boolean }) {
  const { pending, run } = useAct();
  const [sure, setSure] = useState(false);
  return (
    <span className="row-btns">
      <button className="btn sm" disabled={pending} onClick={() => run(() => setAccountActive(id, !active))}>{active ? 'Turn off' : 'Turn on'}</button>
      {owner && (sure
        ? <button className="btn sm danger" disabled={pending} onClick={() => run(() => disconnectAccount(id))}>Yes, disconnect</button>
        : <button className="btn sm ghost danger" onClick={() => setSure(true)}>Disconnect</button>)}
    </span>
  );
}

export function MetaLeadSource({ value, sources }: { value: string; sources: { key: string; name: string }[] }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="row-btns" style={{ alignItems: 'center' }}>
      <select defaultValue={value} disabled={pending} onChange={(e) => { const v = e.target.value; run(() => setMetaLeadSource(v)); }} aria-label="Lead source for Facebook and Instagram lead forms">
        <option value="">Pick automatically</option>
        {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
      </select>
      {msg?.ok && <span className="hint">Saved</span>}
      {msg?.error && <span className="hint" style={{ color: 'var(--hot)' }}>{msg.error}</span>}
    </span>
  );
}
