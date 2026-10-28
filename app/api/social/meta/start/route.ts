import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { makeState, metaConnectUrl, metaReady } from '@/lib/social';

export const dynamic = 'force-dynamic';

/** "Connect Facebook & Instagram" → Facebook's login page. */
export async function GET() {
  const { org, user } = await requireOrg(['owner', 'manager']);
  if (!metaReady()) redirect('/posts?error=' + encodeURIComponent('Add META_APP_ID and META_APP_SECRET in Vercel first (see the steps on this page).'));
  redirect(metaConnectUrl(makeState(org.id, user.id)));
}
