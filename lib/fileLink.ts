import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { siteUrl } from '@/lib/roles';

// Brochure / floor-plan links handed to the website go through /api/site/file, which adds the company's
// contact details to every PDF page. The link is signed so nobody can use the route for other files.
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || '';
const sign = (s: string) => createHmac('sha256', secret()).update(s).digest('base64url').slice(0, 32);

export function fileLink(url: string | null, orgId: string, label = ''): string | null {
  if (!url) return null;
  if (!secret() || !/\.pdf(\?|#|$)/i.test(url)) return url;      // pictures and web pages open as they are
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400;          // link works for 7 days
  const payload = Buffer.from(JSON.stringify({ u: url, o: orgId, e: exp, n: label.slice(0, 80) })).toString('base64url');
  return `${siteUrl()}/api/site/file?d=${payload}&s=${sign(payload)}`;
}

export function readFileLink(d: string, s: string): { u: string; o: string; n: string } | null {
  if (!d || !s || !secret()) return null;
  const want = Buffer.from(sign(d)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(d, 'base64url').toString());
    if (typeof p.u !== 'string' || typeof p.o !== 'string' || !(p.e > Date.now() / 1000)) return null;
    return { u: p.u, o: p.o, n: String(p.n ?? '') };
  } catch { return null; }
}
