import { APP_NAME } from '@/lib/brand';
import type { ReactNode } from 'react';

export function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
      </div>
      <span className="brand-name">{APP_NAME}</span>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-side">
        <Logo />
        <div className="auth-pitch">
          <h2>Every lead called. Every visit followed up.</h2>
          <ul>
            <li>Leads from 99acres, MagicBricks and walk-ins in one list</li>
            <li>Each agent sees only their own leads</li>
            <li>Follow-ups, site visits and WhatsApp in one place</li>
          </ul>
        </div>
        <p className="faint">Your company data stays private to your team.</p>
      </div>
      <div className="auth-main">
        <div className="auth-mobile-logo"><Logo /></div>
        {children}
      </div>
    </main>
  );
}
