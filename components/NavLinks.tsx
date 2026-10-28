'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/roles';

const I = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  leads: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2"/>',
  team: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10h8M8 14h5"/>',
  visits: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  projects: '<path d="M4 21V8l6-4v17M10 21V10l10 3v8M2 21h20"/>',
  messages: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  sources: '<path d="M4 4h16v4H4zM6 8v4h12V8M9 12v4h6v-4M11 16v4h2v-4"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>',
  add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9s1.2-6.4 3.7-9z"/>',
  posts: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m21 15-5-5L5 21"/>',
  wa: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 9.5c.3 2.3 2.2 4.4 4.6 5"/>',
  fu: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  broker: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M2.5 19c.7-3 2.9-4.7 5.5-4.7s4.8 1.7 5.5 4.7M14 19c.4-2 1.6-3.3 3.3-3.3 1.6 0 2.8 1.2 3.2 3.3"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/>',
  cold: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  lost: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
};

export function NavLinks({ role, mobile = false }: { role: Role; mobile?: boolean }) {
  const path = usePathname();
  const m = role === 'owner' || role === 'manager';
  // Employees and interns: only what they need every day.
  const simple = role === 'agent';
  type Item = { href: string; label: string; icon: string; show: boolean; sec?: string };
  const all: Item[] = simple ? [
    { href: '/dashboard', label: 'Do now', icon: ICONS.today, show: true },
    { href: '/leads', label: 'My clients', icon: ICONS.leads, show: true },
    { href: '/leads/new', label: 'Add lead', icon: ICONS.add, show: true },
    { href: '/followups', label: 'Follow-ups', icon: ICONS.fu, show: true },
    { href: '/whatsapp', label: 'WhatsApp', icon: ICONS.wa, show: true },
    { href: '/cold', label: 'Cold data', icon: ICONS.cold, show: true },
    { href: '/attendance', label: 'Attendance', icon: ICONS.clock, show: true },
    { href: '/profile', label: 'Profile', icon: ICONS.me, show: true },
  ] : [
    { href: '/dashboard', label: 'Today', icon: ICONS.today, show: true },
    { href: '/leads', label: 'Leads', icon: ICONS.leads, show: true, sec: 'Clients' },
    { href: '/followups', label: 'Follow-ups', icon: ICONS.fu, show: role !== 'partner', sec: 'Clients' },
    { href: '/pipeline', label: 'Journey board', icon: ICONS.board, show: m, sec: 'Clients' },
    { href: '/whatsapp', label: 'WhatsApp', icon: ICONS.wa, show: role !== 'partner', sec: 'Clients' },
    { href: '/visits', label: 'Visits', icon: ICONS.visits, show: role !== 'partner', sec: 'Clients' },
    { href: '/cold', label: 'Cold data', icon: ICONS.cold, show: role !== 'partner', sec: 'Clients' },
    { href: '/lost', label: 'Lost leads', icon: ICONS.lost, show: m, sec: 'Clients' },
    { href: '/projects', label: 'Projects', icon: ICONS.projects, show: true, sec: 'Properties' },
    { href: '/website-clients', label: 'Website clients', icon: ICONS.web, show: m, sec: 'Properties' },
    { href: '/map', label: 'Map', icon: ICONS.map, show: role !== 'partner', sec: 'Properties' },
    { href: '/brokers', label: 'Brokers', icon: ICONS.broker, show: m, sec: 'Business' },
    { href: '/money', label: 'Money', icon: ICONS.money, show: role === 'owner', sec: 'Business' },
    { href: '/messages', label: 'Messages', icon: ICONS.messages, show: role !== 'partner', sec: 'Business' },
    { href: '/posts', label: 'Posts', icon: ICONS.posts, show: m, sec: 'Business' },
    { href: '/reports', label: 'Reports', icon: ICONS.reports, show: m, sec: 'Business' },
    { href: '/sources', label: 'Lead sources', icon: ICONS.sources, show: role === 'owner', sec: 'Business' },
    { href: '/integrations', label: 'Integrations', icon: ICONS.plug, show: role === 'owner', sec: 'Business' },
    { href: '/attendance', label: 'Attendance', icon: ICONS.clock, show: role !== 'partner', sec: 'Settings' },
    { href: '/team', label: 'Team', icon: ICONS.team, show: m, sec: 'Settings' },
    { href: '/profile', label: 'Profile', icon: ICONS.me, show: true, sec: 'Settings' },
  ].filter((i) => i.show) as { href: string; label: string; icon: string; show: boolean; sec?: string }[];
  const items = mobile ? [...all.slice(0, 4), { href: '/more', label: 'More', icon: ICONS.more, show: true }] : all;
  const on = (href: string) => (href === '/leads' ? path.startsWith('/leads') && !path.startsWith('/leads/new') : path.startsWith(href));
  // Side menu in folding groups. The group of the page you are on is always open; the rest remember open/closed.
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setClosed(JSON.parse(localStorage.getItem('ed_nav_closed') || '{}')); } catch { /* fresh */ } }, []);
  const flip = (sec: string) => setClosed((c) => { const n = { ...c, [sec]: !c[sec] }; try { localStorage.setItem('ed_nav_closed', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const link = (i: { href: string; label: string; icon: string }) => (
    <Link key={i.href} href={i.href} data-label={i.label} className={on(i.href) || (i.href === '/more' && all.slice(4).some((x) => path.startsWith(x.href))) ? 'on' : ''}>
      {I(i.icon)}<span>{i.label}</span>
    </Link>
  );
  if (!mobile && !simple) {
    const top = items.filter((i) => !i.sec);
    const groups: { sec: string; list: typeof items }[] = [];
    items.filter((i) => i.sec).forEach((i) => { const g = groups.find((x) => x.sec === i.sec); if (g) g.list.push(i); else groups.push({ sec: i.sec!, list: [i] }); });
    return (
      <nav className="nav" aria-label="Main">
        {top.map(link)}
        {groups.map((g) => {
          const here = g.list.some((i) => on(i.href));
          const open = here || !closed[g.sec];
          return (
            <div key={g.sec} className={`nav-group ${open ? 'open' : ''} ${here ? 'here' : ''}`}>
              <button type="button" className="nav-sec nav-sec-btn" aria-expanded={open} onClick={() => !here && flip(g.sec)} title={here ? undefined : open ? `Close ${g.sec}` : `Open ${g.sec}`}>
                <span>{g.sec}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div className="nav-items"><div>{g.list.map(link)}</div></div>
            </div>
          );
        })}
      </nav>
    );
  }
  return (
    <nav className={mobile ? 'bottomnav' : 'nav'} aria-label="Main">
      {items.map((i) => [
        !mobile && i.sec ? <div key={'s-' + i.sec} className="nav-sec">{i.sec}</div> : null,
        <Link key={i.href} href={i.href} data-label={i.label} className={on(i.href) || (i.href === '/more' && all.slice(4).some((x) => path.startsWith(x.href))) ? 'on' : ''}>
          {I(i.icon)}<span>{i.label}</span>
        </Link>,
      ])}
    </nav>
  );
}
