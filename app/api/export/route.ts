import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/context';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { supabase, org, role } = await requireOrg();
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Only an admin can export data.' }, { status: 403 });
  }
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('leads').select('*').eq('org_id', org.id).order('created_at').range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: people } = await supabase.from('members').select('user_id, full_name').eq('org_id', org.id);
  const names = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const cols = ['name', 'phone', 'email', 'stage', 'score', 'source', 'budget_min', 'budget_max', 'bhk', 'location', 'purpose', 'dob', 'assigned_to', 'next_follow_up', 'created_at'];
  // A name like =HYPERLINK(...) must not run as a formula when the file is opened in Excel.
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^\+\d[\d ]*$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(c === 'assigned_to' ? names.get(r[c] as string) ?? '' : r[c])).join(','))].join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
