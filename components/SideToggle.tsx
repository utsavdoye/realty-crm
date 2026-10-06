'use client';

import { useCallback, useEffect, useState } from 'react';

/** Folds the left menu into a slim icon bar and back. Remembered on this device (cookie), so pages load in the same state. */
export function SideToggle({ initial }: { initial: boolean }) {
  const [mini, setMini] = useState(initial);

  const flip = useCallback(() => {
    setMini((m) => {
      const next = !m;
      document.querySelector('.app')?.classList.toggle('mini', next);
      document.cookie = `ed_side=${next ? 'mini' : 'open'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  // Keyboard: press [ to fold or open the menu (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault(); flip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flip]);

  return (
    <button type="button" className="side-toggle" onClick={flip} aria-pressed={mini}
      aria-label={mini ? 'Open the menu' : 'Fold the menu'} title={mini ? 'Open menu  [' : 'Fold menu  ['}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /><path d={mini ? 'M13 10l2 2-2 2' : 'M15 10l-2 2 2 2'} />
      </svg>
    </button>
  );
}
