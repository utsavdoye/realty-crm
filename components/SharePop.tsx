'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** One tap: the link is copied at once and a small window shows it, with WhatsApp and Share. */
export function SharePop({ url, text, title = 'Your link', label = 'Share my form', className = 'btn primary', children }: {
  url: string; text: string; title?: string; label?: string; className?: string; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const msg = `${text}\n${url}`;

  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && !!navigator.share); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <>
      <button type="button" className={className} onClick={(e) => { e.preventDefault(); setOpen(true); copy(); }}>
        {children ?? label}
      </button>
      {open && createPortal(
        <div className="pop-back" role="dialog" aria-modal="true" aria-label={title} onClick={() => setOpen(false)}>
          <div className="pop" onClick={(e) => e.stopPropagation()}>
            <div className="pop-h"><b>{title}</b><button type="button" className="btn sm ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
            <p className={copied ? 'msg ok' : 'hint'}>{copied ? 'Link copied. Paste it anywhere.' : 'Press Copy, then paste it anywhere.'}</p>
            <input className="pop-link mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
            <div className="row-btns">
              <button type="button" className="btn sm" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <a className="btn sm wa" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              {canShare && <button type="button" className="btn sm" onClick={() => navigator.share({ text, url }).catch(() => {})}>More apps</button>}
              <a className="btn sm ghost" href={url} target="_blank" rel="noopener noreferrer">Open</a>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
