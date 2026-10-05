export type Role = 'owner' | 'manager' | 'agent' | 'partner';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Admin',
  manager: 'Manager',
  agent: 'Employee',
  partner: 'Channel partner',
};

export const ROLE_HELP: Record<Role, string> = {
  owner: 'Sees and controls everything, including money, payments and export.',
  manager: 'Sees all leads, reports and the team. Cannot see money or payments.',
  agent: 'Sees only the leads given to them. No reports, money or export.',
  partner: 'Sees only the leads they brought in and their status.',
};

export const isManager = (r: Role | null | undefined) => r === 'owner' || r === 'manager';
export const isAdmin = (r: Role | null | undefined) => r === 'owner';

export function safeNext(next: string | undefined | null, fallback = '/dashboard') {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** Same rule as the database: India → 10 digits (9845012345); other countries → +countrycode… (+971501234567). */
export function normPhone(p: string | null | undefined) {
  const raw = String(p ?? '').trim();
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d.startsWith('91') && d.length === 12 ? d.slice(2) : '+' + d;
  if (d.startsWith('0091') && d.length === 14) return d.slice(-10);
  if (d.startsWith('00') && d.length >= 10 && d.length <= 17) return '+' + d.slice(2);
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

export const validPhone = (p: string) => /^[6-9]\d{9}$/.test(p) || /^\+[1-9]\d{7,14}$/.test(p);
export const PHONE_HELP = 'India: 10 digits. Other countries: + and country code, e.g. +971 50 123 4567';

export function fmtPhone(p: string | null | undefined) {
  const n = normPhone(p);
  if (/^\d{10}$/.test(n)) return `${n.slice(0, 5)} ${n.slice(5)}`;
  return n || (p ?? '');
}

/** Link that starts a phone call on mobile. */
export const telHref = (p: string | null | undefined) => {
  const n = normPhone(p);
  return `tel:${n.startsWith('+') ? n : '+91' + n}`;
};

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}
