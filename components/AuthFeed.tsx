'use client';

import { useEffect, useState } from 'react';

type Ev = { icon: keyof typeof ICONS; tag: string; title: string; text: string };

const ICONS = {
  lead: <path d="M12 5v14M5 12h14" />,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  visit: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
  web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3M16 7l3 3" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
};

// Sample activity, to show how the CRM feels. Not real clients.
const EVENTS: Ev[] = [
  { icon: 'lead', tag: '99acres', title: 'New lead · 3 BHK, ₹1.2 Cr', text: 'Given to the next free agent in 4 seconds' },
  { icon: 'doc', tag: 'Brochure', title: 'Client opened the price list', text: 'Good time to call. Tap to dial.' },
  { icon: 'visit', tag: 'Site visit', title: 'Visit confirmed for Saturday', text: 'Reminder sent to the agent and the client' },
  { icon: 'web', tag: 'Website', title: 'Saved a home on your website', text: 'Added to their lead with name and mobile' },
  { icon: 'bell', tag: 'Follow-up', title: '3 calls due before noon', text: 'Nobody slips through the cracks' },
  { icon: 'key', tag: 'Booked', title: 'Flat B-704 booked', text: 'Payment plan and documents in one place' },
];

const AGO = ['just now', '1 min ago', '4 min ago'];

/** Three live-looking alerts; a new one slides in every few seconds. */
export function AuthFeed() {
  const [start, setStart] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setStart((s) => (s + 1) % EVENTS.length), 3200);
    return () => clearInterval(t);
  }, []);
  const shown = [0, 1, 2].map((k) => ({ i: (start - k + EVENTS.length) % EVENTS.length, k }));

  return (
    <div className="auth-feed" aria-hidden="true">
      <div className="auth-feed-h"><span className="auth-live" />Live in your CRM</div>
      {shown.map(({ i, k }) => {
        const e = EVENTS[i];
        return (
          <div key={`${i}-${start}`} className={`auth-toast t${k}`}>
            <i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[e.icon]}</svg></i>
            <div><span className="auth-tag">{e.tag} · {AGO[k]}</span><b>{e.title}</b><span>{e.text}</span></div>
          </div>
        );
      })}
    </div>
  );
}
