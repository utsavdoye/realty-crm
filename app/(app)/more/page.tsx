import Link from 'next/link';
import { requireOrg } from '@/lib/context';

export const metadata = { title: 'More' };

export default async function More() {
  const { role } = await requireOrg();
  const m = role === 'owner' || role === 'manager';
  const links = [
    { href: '/map', label: 'Map of projects', show: role !== 'partner' },
    { href: '/money', label: 'Money (admins only)', show: role === 'owner' },
    { href: '/notifications', label: 'Alerts', show: true },
    { href: '/messages', label: 'Message templates', show: role !== 'partner' },
    { href: '/reports', label: 'Reports', show: m },
    { href: '/sources', label: 'Lead sources', show: m },
    { href: '/team', label: 'Team', show: m },
    { href: '/profile', label: 'Profile and log out', show: true },
  ].filter((l) => l.show);
  return (
    <>
      <div className="top"><h1>More</h1></div>
      <section className="panel"><div className="rows">{links.map((l) => <Link key={l.href} href={l.href} className="callrow"><span className="cr-main"><b>{l.label}</b></span><span aria-hidden="true">›</span></Link>)}</div></section>
    </>
  );
}
