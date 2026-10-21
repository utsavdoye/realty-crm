import { APP_NAME } from '@/lib/brand';
import type { ReactNode } from 'react';
import { LangSwitch } from '@/components/Translator';
import { AuthFeed } from '@/components/AuthFeed';

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
          <span className="auth-eyebrow">The CRM built for real estate teams</span>
          <h2>Every lead called.<br />Every visit <em>followed up.</em></h2>
          <p className="auth-sub">From the first enquiry to the keys, your whole sales team works from one screen. Fast, simple and private to you.</p>
          <ul>
            <li><i><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg></i>99acres, MagicBricks, your website and walk-ins in one list</li>
            <li><i><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></i>Each agent sees only their own clients</li>
            <li><i><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg></i>Follow-ups, site visits and WhatsApp, never missed</li>
          </ul>
        </div>
        <AuthFeed />
        <p className="faint"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>Your company data stays private to your team.</p>
      </div>
      <div className="auth-main">
        <LangSwitch className="langsw-fixed" />
        <div className="auth-mobile-logo"><Logo /></div>
        {children}
      </div>
    </main>
  );
}
