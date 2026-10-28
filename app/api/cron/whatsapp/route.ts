import { sendVisitReminders } from '@/lib/waInbox';

// Site-visit reminders on WhatsApp. Call every 5–15 minutes with  Authorization: Bearer <CRON_SECRET>
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 });
  return Response.json(await sendVisitReminders());
}
