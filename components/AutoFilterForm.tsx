'use client';

import { useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Filters apply by themselves: dropdowns and dates at once, typed numbers/text after a short pause. Empty fields are left out of the link. */
export function AutoFilterForm({ action, className, children }: { action: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function go() {
    const f = ref.current; if (!f) return;
    const p = new URLSearchParams();
    new FormData(f).forEach((v, k) => { if (typeof v === 'string' && v.trim() && k !== 'page') p.set(k, v.trim()); });
    router.push(`${action}${p.toString() ? '?' + p.toString() : ''}`, { scroll: false });
  }
  function onChange(e: React.ChangeEvent<HTMLFormElement>) {
    const t = e.target as unknown as HTMLInputElement;
    clearTimeout(timer.current);
    const typed = t.tagName === 'INPUT' && ['text', 'number', 'search'].includes(t.type);
    timer.current = setTimeout(go, typed ? 700 : 0);
  }
  return (
    <form ref={ref} action={action} className={className} onChange={onChange} onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); go(); }}>
      {children}
    </form>
  );
}
