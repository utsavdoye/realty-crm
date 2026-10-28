/** A simple 0–100 score: how likely this client is to buy soon. Made from interest, how complete the requirement is, and what has happened. */
export function leadScore(l: Record<string, any>, extra: { visitsDone: number; visitsBooked: number; calls: number; lastTouch: string | null; website: boolean }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (l.stage === 'lost') return 0;
  if (l.stage === 'booked') return 100;
  let s = ({ hot: 30, warm: 18, cold: 6 } as Record<string, number>)[l.score] ?? 10;
  if (l.budget_max) s += 10;
  if (l.bhk || l.property_type || l.category === 'Commercial') s += 7;
  if (l.location) s += 7;
  if (l.possession_pref || l.purpose || l.want) s += 4;
  s += Math.min(8, extra.calls * 2);
  if (extra.visitsBooked) s += 8;
  if (extra.visitsDone) s += 14;
  s += ({ qualified: 4, visit: 6, visited: 8, negotiation: 12, token: 18 } as Record<string, number>)[l.stage] ?? 0;
  if (extra.website) s += 3;
  const days = extra.lastTouch ? (Date.now() - Date.parse(extra.lastTouch)) / 86400000 : 99;
  if (days > 30) s -= 12; else if (days > 14) s -= 6; else if (days < 3) s += 4;
  return Math.max(1, Math.min(99, Math.round(s)));
}
