'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { askHelper, type AskAnswer } from '@/app/ask-actions';
import { telHref } from '@/lib/roles';

type Msg = { q: string; a?: AskAnswer };
const TRY = ['My overdue calls', 'Hot leads under 60 lakh', 'Site visits today', 'How many bookings this month?', 'How do I import leads?'];

/** Floating "Ask" box. Press Ctrl/⌘ + K to open it from anywhere. */
export function AskHelper() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);

  async function ask(q: string) {
    const question = q.trim(); if (!question || busy) return;
    setText(''); setBusy(true);
    setMsgs((m) => [...m, { q: question }]);
    let a: AskAnswer;
    try { a = await askHelper(question); } catch { a = { text: 'Something went wrong. Please try again.', via: 'quick' }; }
    setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, a } : x)));
    setBusy(false);
  }

  return (
    <>
      <button type="button" className={`ask-fab ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ask a question">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>}
        </svg>
        {!open && <span>Ask</span>}
      </button>

      {open && (
        <section className="ask-panel" role="dialog" aria-label="Ask the CRM">
          <header className="ask-head">
            <div><b>Ask the CRM</b><span>Find leads, visits or how to do something. English, Hindi or Hinglish.</span></div>
          </header>
          <div className="ask-body" ref={list}>
            {!msgs.length && (
              <div className="ask-try">
                <span className="hint">Try:</span>
                {TRY.map((t) => <button key={t} type="button" onClick={() => ask(t)}>{t}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className="ask-turn">
                <div className="ask-q">{m.q}</div>
                {m.a ? (
                  <div className="ask-a">
                    <p>{m.a.text}</p>
                    {m.a.items?.map((it, j) => (
                      <div key={j} className="ask-item">
                        {it.href ? <Link href={it.href} onClick={() => setOpen(false)} className="ask-item-main"><b>{it.title}</b>{it.sub && <span>{it.sub}</span>}</Link>
                          : <span className="ask-item-main"><b>{it.title}</b>{it.sub && <span>{it.sub}</span>}</span>}
                        {it.tel && <a className="btn sm" href={telHref(it.tel)}>Call</a>}
                      </div>
                    ))}
                    {m.a.link && <Link className="btn sm primary" href={m.a.link.href} onClick={() => setOpen(false)}>{m.a.link.label} →</Link>}
                  </div>
                ) : <div className="ask-a ask-wait"><span /><span /><span /></div>}
              </div>
            ))}
          </div>
          <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. VIP Road ke hot leads 50 lakh" maxLength={300} aria-label="Your question" />
            <button className="btn primary" disabled={busy || !text.trim()} aria-label="Ask">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </section>
      )}
    </>
  );
}
