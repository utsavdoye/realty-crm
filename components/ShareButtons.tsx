'use client';

import { useState } from 'react';

/** Copy a link or send it on WhatsApp (opens WhatsApp with the message ready; you pick the chat). */
export function ShareButtons({ url, text, phone }: { url: string; text: string; phone?: string | null }) {
  const [done, setDone] = useState(false);
  const msg = `${text}\n${url}`;
  const wa = phone ? `https://wa.me/91${phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  return (
    <span className="row-btns">
      <a className="btn sm wa" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1800); } catch { window.prompt('Copy this link', url); } }}>{done ? 'Copied ✓' : 'Copy link'}</button>
      <a className="btn sm ghost" href={url} target="_blank" rel="noopener noreferrer">Preview</a>
    </span>
  );
}
