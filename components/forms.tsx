'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { FormState } from '@/app/actions';
import { useRef, type ReactNode } from 'react';

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

export function ActionForm({ action, children, className, resetOnOk }: { action: Action; children: ReactNode; className?: string; resetOnOk?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(async (prev: FormState, fd: FormData) => {
    const r = await action(prev, fd);
    if (resetOnOk && r?.ok) ref.current?.reset(); // empty the boxes so a second tap does not save it twice
    return r;
  }, null);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p className="msg err" role="alert">{state.error}{state.link?.startsWith('/') && <> <a href={state.link}>Open it</a></>}</p>}
      {state?.ok && <p className="msg ok" role="status">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, className = 'btn primary', pendingText = 'Please wait…' }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
