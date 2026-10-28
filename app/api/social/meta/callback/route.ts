import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { finishMeta, readState } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const { org, user } = await requireOrg(['owner', 'manager']);
  const s = readState(q.get('state') ?? '');
  if (q.get('error')) redirect('/posts?error=' + encodeURIComponent('Facebook connection was cancelled.'));
  if (!s || s.o !== org.id || s.u !== user.id || !q.get('code')) redirect('/posts?error=' + encodeURIComponent('This link expired. Press Connect again.'));
  let msg = '';
  try {
    const r = await finishMeta(org.id, user.id, q.get('code')!);
    msg = r.pages ? `Connected ${r.pages} Facebook Page${r.pages === 1 ? '' : 's'}${r.instagram ? ` and ${r.instagram} Instagram account${r.instagram === 1 ? '' : 's'}` : ' (no Instagram business account is linked to it yet)'}.` : 'No Facebook Page found on this account. Create a Page first, then connect again.';
  } catch (e) {
    redirect('/posts?error=' + encodeURIComponent((e as Error).message || 'Could not connect Facebook.'));
  }
  redirect('/posts?ok=' + encodeURIComponent(msg));
}
