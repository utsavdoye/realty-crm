'use client';

import { useEffect, useRef, useState } from 'react';

type State = 'idle' | 'asking' | 'recording' | 'working' | 'done' | 'error';
const MAX_SECONDS = 90;

/** Turns any recording the browser makes into a small 16 kHz mono WAV file (works the same on Chrome, Safari, Android). */
async function toWav(blob: Blob): Promise<Blob> {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}


/** 🎤 button that fills the lead form it sits in. Speak Hindi, English or Hinglish; check, then Save. */
export function VoiceFill({ enabled }: { enabled: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const [state, setState] = useState<State>('idle');
  const [secs, setSecs] = useState(0);
  const [msg, setMsg] = useState('');
  const [heard, setHeard] = useState('');
  const [filled, setFilled] = useState<string[]>([]);

  useEffect(() => () => { clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  function fill(fields: Record<string, string>) {
    const form = box.current?.closest('form');
    if (!form) return;
    const done: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!v) continue;
      if (k === 'project') {
        const sel = form.elements.namedItem('project_id') as HTMLSelectElement | null;
        const opt = sel && [...sel.options].find((o) => o.text.toLowerCase() === v.toLowerCase());
        if (sel && opt) { sel.value = opt.value; mark(sel); done.push(k); }
        continue;
      }
      const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!el) continue;
      if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === v)) continue;
      el.value = k === 'note' && el.value && !el.value.includes(v) ? `${el.value}\n${v}` : v;
      mark(el); done.push(k);
    }
    setFilled(done);
  }
  function mark(el: HTMLElement) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.classList.add('voice-filled');
    setTimeout(() => el.classList.remove('voice-filled'), 4000);
  }

  async function start() {
    setMsg(''); setHeard(''); setFilled([]);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setState('error'); setMsg('This browser cannot record. Use Chrome or Safari.'); return; }
    setState('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); send(new Blob(chunks.current, { type: r.mimeType })); };
      r.start(250);
      rec.current = r;
      setSecs(0); setState('recording');
      timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SECONDS) stop(); return s + 1; }), 1000);
    } catch {
      setState('error'); setMsg('Microphone is blocked. Allow the microphone for this site in the browser settings, then try again.');
    }
  }
  function stop() {
    clearInterval(timer.current);
    if (rec.current?.state === 'recording') rec.current.stop();
  }
  async function send(raw: Blob) {
    setState('working');
    try {
      const wav = await toWav(raw);
      const fd = new FormData(); fd.append('audio', wav, 'note.wav');
      const res = await fetch('/api/voice/lead', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setHeard(data.transcript || '');
      fill(data.fields || {});
      setState('done');
    } catch (e) {
      setState('error'); setMsg(e instanceof Error ? e.message : 'Something went wrong. Please type it.');
    }
  }

  if (!enabled) return <div ref={box} className="voice off"><span className="hint">Voice filling is off (admin: add GEMINI_API_KEY).</span></div>;

  const busy = state === 'asking' || state === 'working';
  return (
    <div ref={box} className="voice">
      <div className="voice-row">
        {state === 'recording' ? (
          <button type="button" className="vbtn rec" onClick={stop} aria-label="Stop recording"><span className="vdot" />{secs}s · Stop</button>
        ) : (
          <button type="button" className="vbtn" onClick={start} disabled={busy} aria-label="Fill the form by voice" title="Speak in Hindi, English or Hinglish">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            {state === 'working' ? 'Filling…' : 'Fill by voice'}
          </button>
        )}
        {state === 'recording' && <span className="hint">Speak in Hindi, English or both</span>}
        {state === 'done' && <span className="hint ok-text">{filled.length ? `Filled ${filled.length} fields — check the mobile number, then Save` : 'Could not catch that. Try again, a bit slower.'}</span>}
        {state === 'error' && <span className="hint err-text">{msg}</span>}
        {heard && <details className="vheard"><summary className="hint">Heard</summary><p className="hint">{heard}</p></details>}
      </div>
    </div>
  );
}
