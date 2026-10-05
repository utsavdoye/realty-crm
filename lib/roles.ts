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

export function normPhone(p: string | null | undefined) {
  const d = String(p ?? '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) return d.slice(-10);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

export function fmtPhone(p: string | null | undefined) {
  const n = normPhone(p);
  return n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : p ?? '';
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}
