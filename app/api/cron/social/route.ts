import { runDuePosts } from '@/lib/social';

// Publishes scheduled posts. Call every 5 minutes (Supabase pg_cron, or any free cron service) with
//   Authorization: Bearer <CRON_SECRET>
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runDuePosts(undefined, 45_000));
}
