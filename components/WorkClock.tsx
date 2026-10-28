'use client';

import { useEffect, useRef, useState } from 'react';
import { workEvent } from '@/app/work-actions';

/** The small "working / on break / end day" bar. It marks you present only while you actually use the CRM. */
export function WorkClock({ since, onBreak: initialBreak, ended }: { since: string | null; onBreak: boolean; ended: boolean }) {
  const [onBreak, setBreak] = useState(initialBreak);
  const [done, setDone] = useState(ended);
  const [start, setStart] = useState(since);
  const touched = useRef(true);
  useEffect(() => {
    const mark = () => { touched.current = true; };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const tick = () => {
      if (!touched.current || document.visibilityState !== 'visible') return;
      touched.current = false;
      workEvent('ping').then(() => { setDone(false); setStart((s) => s ?? new Date().toISOString()); }).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5 * 60_000);
    return () => { clearInterval(t); evs.forEach((e) => window.removeEventListener(e, mark)); };
  }, []);
  const time = start ? new Date(start).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <span className="workclock">
      <span className={`wc-dot ${done ? 'off' : onBreak ? 'brk' : 'on'}`} aria-hidden="true" />
      <span className="hint">{done ? 'Day ended' : onBreak ? 'On break' : time ? `Working since ${time}` : 'Working'}</span>
      {!done && (onBreak
        ? <button type="button" className="btn sm" onClick={() => { setBreak(false); workEvent('back'); }}>I&apos;m back</button>
        : <button type="button" className="btn sm ghost" onClick={() => { setBreak(true); workEvent('break'); }}>Break</button>)}
      {!done && <button type="button" className="btn sm ghost" onClick={() => { if (confirm('End your work day?')) { setDone(true); setBreak(false); workEvent('logout'); } }}>End day</button>}
    </span>
  );
}
