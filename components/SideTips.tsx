'use client';

import { useEffect, useState } from 'react';

/** Names next to the icons when the side menu is folded. Drawn on top of the page so nothing can hide them, even when the menu scrolls. */
export function SideTips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.app.mini .side [data-label]') as HTMLElement | null;
      if (!el) { setTip(null); return; }
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.label ?? '', x: r.right + 12, y: r.top + r.height / 2 });
    };
    const hide = () => setTip(null);
    const side = document.querySelector('.side');
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    side?.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('scroll', hide, { passive: true });
    return () => {
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      side?.removeEventListener('scroll', hide);
      window.removeEventListener('scroll', hide);
    };
  }, []);
  if (!tip?.text) return null;
  return <div className="side-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
