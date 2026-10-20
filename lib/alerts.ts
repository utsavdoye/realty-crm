// Alert groups on the Alerts page. Every alert type the CRM sends belongs to exactly one group.

export type AlertGroup = 'hot' | 'leads' | 'activity' | 'team' | 'daily';

export const GROUPS: { key: AlertGroup; label: string; icon: string; hint: string }[] = [
  { key: 'hot', label: 'Call now', icon: '🔥', hint: 'Clients asking for a visit, checking prices or sending their requirement. Call these first.' },
  { key: 'leads', label: 'New & moved leads', icon: '🆕', hint: 'Leads given to you, taken from you, or moved by a manager.' },
  { key: 'activity', label: 'Client activity', icon: '👀', hint: 'Clients opening your shortlist, and projects that fit your leads.' },
  { key: 'team', label: 'Team', icon: '👥', hint: 'People asking to join, and hand-overs between team members.' },
  { key: 'daily', label: 'Daily summary', icon: '☀️', hint: 'The morning summary.' },
];

export function groupOf(type: string): AlertGroup {
  if (type === 'enquiry' || type === 'shortlist_visit' || type === 'shortlist_like' || type === 'shortlist_details') return 'hot';
  if (type === 'lead_assigned' || type === 'lead_taken' || type === 'reassign') return 'leads';
  if (type.startsWith('shortlist_') || type === 'project_match') return 'activity';
  if (type === 'join_request' || type === 'joined' || type === 'handoff') return 'team';
  if (type === 'morning') return 'daily';
  return 'activity';
}

/** All alert types in a group (for "mark these as read"). shortlist_* types not listed fall in 'activity'. */
export const TYPES: Record<AlertGroup, string[]> = {
  hot: ['enquiry', 'shortlist_visit', 'shortlist_like', 'shortlist_details'],
  leads: ['lead_assigned', 'lead_taken', 'reassign'],
  activity: ['shortlist_opened', 'shortlist_maybe', 'shortlist_no', 'project_match'],
  team: ['join_request', 'joined', 'handoff'],
  daily: ['morning'],
};

/** Today / Yesterday / This week / Earlier, in India time. */
export function dayBucket(iso: string, now = new Date()): string {
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(ist(now)) - Date.parse(ist(new Date(iso)))) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}
