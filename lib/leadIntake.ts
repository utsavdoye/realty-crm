import 'server-only';
import { createAdminClient, createAnonClient } from '@/lib/supabase/admin';
import { notifyLeadAssigned } from '@/lib/whatsapp';
import { parseBudget } from '@/lib/crm';

export type IncomingLead = {
  name?: string; phone?: string; email?: string; city?: string; location?: string;
  budgetMin?: number | null; budgetMax?: number | null; bhk?: string; project?: string; message?: string;
};

const FIELDS: Record<keyof Omit<IncomingLead, 'budgetMin' | 'budgetMax'> | 'budget' | 'firstname' | 'lastname', string[]> = {
  name: ['name', 'fullname', 'customername', 'contactname', 'buyername', 'leadname', 'clientname', 'sendername', 'username', 'qryname'],
  firstname: ['firstname', 'fname'],
  lastname: ['lastname', 'lname', 'surname'],
  phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contact', 'contactno', 'contactnumber', 'number', 'whatsapp', 'whatsappnumber', 'cell', 'qrymobile', 'sendermobile', 'tel'],
  email: ['email', 'emailid', 'emailaddress', 'mail', 'senderemail', 'qryemail'],
  city: ['city', 'cityname'],
  location: ['location', 'locality', 'area', 'address', 'preferredlocation', 'localityname'],
  budget: ['budget', 'price', 'budgetrange', 'pricerange'],
  bhk: ['bhk', 'configuration', 'config', 'unittype', 'bedrooms'],
  project: ['project', 'projectname', 'property', 'propertyname', 'listing', 'listingname', 'propname', 'propertytitle', 'subject'],
  message: ['message', 'query', 'comments', 'comment', 'remarks', 'enquiry', 'inquiry', 'requirement', 'note', 'notes', 'msg'],
};

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Flattens nested objects one or two levels so { lead: { name } } also works. */
function flatten(obj: unknown, out: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (!obj || typeof obj !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length && typeof v[0] !== 'object') out[norm(k)] ??= String(v[0]); else v.forEach((x) => flatten(x, out, depth + 1)); }
    else if (typeof v === 'object') flatten(v, out, depth + 1);
    else out[norm(k)] ??= String(v).trim();
  }
  return out;
}

/** Reads any portal / form payload and picks out the lead fields. */
export function mapPayload(payload: unknown): IncomingLead {
  const flat = flatten(payload);
  const pick = (k: keyof typeof FIELDS) => { for (const n of FIELDS[k]) if (flat[n]) return flat[n]; return undefined; };
  let name = pick('name');
  if (!name) name = [pick('firstname'), pick('lastname')].filter(Boolean).join(' ') || undefined;
  const loose = (part: string) => Object.entries(flat).find(([k]) => k.includes(part))?.[1];
  const msg = pick('message') || '';
  const budgetText = pick('budget') || loose('budget') || (msg.match(/budget[^\d₹]*([₹\d.,\s\-–tolakhcr]+)/i)?.[1] ?? '');
  const b = parseBudget(budgetText);
  const bhkRaw = [pick('bhk'), loose('bhk'), loose('configuration'), pick('project'), msg].filter(Boolean).join(' ');
  const bhkM = bhkRaw.match(/(\d)\s*bhk/i);
  return {
    name, phone: pick('phone') || loose('phone') || loose('mobile'), email: pick('email') || loose('email'), city: pick('city'), location: pick('location') || loose('location'),
    budgetMin: b?.min ?? null, budgetMax: b?.max ?? null,
    bhk: bhkM ? (Number(bhkM[1]) >= 5 ? '5+' : bhkM[1]) + ' BHK' : undefined,
    project: pick('project'), message: pick('message'),
  };
}

export type IngestResult = { ok: boolean; error?: string; is_new?: boolean; lead_id?: string };

/** Saves the lead (or adds the enquiry to an existing one) and alerts the assigned agent on WhatsApp. */
export async function ingest(key: string, lead: IncomingLead, raw: unknown): Promise<IngestResult> {
  // With the server key we get the agent's details back (for the WhatsApp alert); without it the lead is still saved.
  const supabase = createAdminClient() ?? createAnonClient();
  const { data, error } = await supabase.rpc('ingest_lead', {
    p_key: key, p_name: lead.name ?? null, p_phone: lead.phone ?? null, p_email: lead.email ?? null,
    p_city: lead.city ?? null, p_location: lead.location ?? null, p_budget_min: lead.budgetMin ?? null, p_budget_max: lead.budgetMax ?? null,
    p_bhk: lead.bhk ?? null, p_project: lead.project ?? null, p_message: lead.message ?? null,
    p_raw: (raw && typeof raw === 'object' ? raw : {}) as object,
  });
  if (error) { console.error('ingest_lead failed:', error.message); return { ok: false, error: 'server_error' }; }
  const r = (data ?? { ok: false, error: 'server_error' }) as { ok: boolean; error?: string; is_new?: boolean; lead_id?: string; name?: string; phone?: string; source?: string; agent_name?: string | null; agent_phone?: string | null };
  if (r.ok && r.is_new && r.agent_phone) {
    await notifyLeadAssigned({ agentPhone: r.agent_phone, agentName: r.agent_name ?? '', leadName: r.name ?? '', leadPhone: r.phone ?? '', source: r.source });
  }
  return { ok: r.ok, error: r.error, is_new: r.is_new, lead_id: r.lead_id };
}

export const KEY_RE = /^[a-f0-9]{64}$/;
