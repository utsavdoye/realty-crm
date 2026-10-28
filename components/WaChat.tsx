'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markChatRead, sendWaBrochure, sendWaText, sendWaWelcome } from '@/app/wa-actions';

/** Keeps the inbox fresh while it is open (new messages and ticks). */
export function WaRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}

export function WaScroll({ dep }: { dep: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'end' }); }, [dep]);
  return <span ref={ref} />;
}

export function WaComposer({ chatId, windowOpen, unread, projects, defaultProject }: { chatId: string; windowOpen: boolean; unread: number; projects: { id: string; name: string }[]; defaultProject?: string | null }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [project, setProject] = useState(defaultProject || projects[0]?.id || '');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => { if (unread) markChatRead(chatId).then(() => router.refresh()); }, [chatId, unread, router]);

  const run = (fn: () => Promise<{ ok?: string; error?: string }>, clear = false) => start(async () => {
    const r = await fn().catch(() => ({ error: 'Could not reach the server.' }));
    setMsg(r.error ? r : null);
    if (!r.error && clear) setText('');
    router.refresh();
  });

  return (
    <div className="wa-compose">
      {!windowOpen && <p className="hint wa-closed">The client has not written in 24 hours. WhatsApp only allows the approved welcome message until they reply.</p>}
      <div className="wa-tools">
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn sm" disabled={pending} onClick={() => run(() => sendWaWelcome(chatId, project))}>Send welcome + brochure</button>
        {windowOpen && <button className="btn sm" disabled={pending || !project} onClick={() => run(() => sendWaBrochure(chatId, project))}>Send brochure PDF</button>}
      </div>
      {windowOpen && (
        <form className="wa-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(() => sendWaText(chatId, text), true); }}>
          <textarea rows={2} value={text} placeholder="Type a message" maxLength={4096}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) run(() => sendWaText(chatId, text), true); } }} />
          <button className="btn wa" disabled={pending || !text.trim()}>{pending ? 'Sending…' : 'Send'}</button>
        </form>
      )}
      {msg?.error && <p className="msg err">{msg.error}</p>}
    </div>
  );
}
