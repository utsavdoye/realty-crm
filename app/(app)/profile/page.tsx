import { requireOrg } from '@/lib/context';
import { updateMyPhone } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { SignOutButtons } from '@/components/SignOutButtons';
import { PICK_HELP, PICK_LABEL, fmtPhone, memberRole, siteUrl } from '@/lib/roles';
import { SharePop } from '@/components/SharePop';
import { PhoneInput } from '@/components/PhoneInput';

export const metadata = { title: 'Profile' };

export default async function Profile() {
  const { supabase, user, me, org } = await requireOrg();
  const { data: o } = await supabase.from('organizations').select('*').eq('id', org.id).maybeSingle();
  const myPhone = (me as { phone?: string | null }).phone || (user.user_metadata?.phone as string | undefined) || (user.phone ? '+' + user.phone : '');
  const formLink = o?.form_token ? `${siteUrl()}/r/${o.form_token}?by=${user.id}` : '';
  return (
    <>
      <div className="top"><h1>Profile</h1></div>
      <div className="grid-main">
        <section className="panel">
          <div className="panel-h"><h2>Your details</h2></div>
          <div className="panel-b stack">
            <div className="field"><span className="label">Your name</span><div className="locked-name">{me.full_name}</div>
              <span className="hint">{memberRole(me) === 'owner' ? 'To fix a spelling, use Team → Edit name.' : 'Wrong spelling? Ask your admin to fix it.'}</span></div>
            <ActionForm action={updateMyPhone} className="stack" key={myPhone}>
              <label className="field"><span className="label">Your mobile number</span><PhoneInput required defaultValue={myPhone} />
                <span className="hint">Clients see it on project pages (Call and WhatsApp buttons). You can also log in with it.</span></label>
              <div><Submit>{myPhone ? 'Save number' : 'Add number'}</Submit></div>
            </ActionForm>
            <dl className="kv">
              <div><dt className="label">Mobile</dt><dd>{myPhone ? fmtPhone(myPhone) : '—'}</dd></div>
              <div><dt className="label">Email</dt><dd>{user.email || '—'}</dd></div>
              <div><dt className="label">Company</dt><dd>{org.name}</dd></div>
              <div><dt className="label">Role</dt><dd>{PICK_LABEL[memberRole(me)]}</dd></div>
            </dl>
            <p className="hint">{PICK_HELP[memberRole(me)]}</p>
          </div>
        </section>
        <section className="panel" id="form">
          <div className="panel-h"><h2>Your client form</h2></div>
          <div className="panel-b stack">
            <p className="hint">Send this link to a new client. They pick their budget, home type and area in 1 minute. It becomes a lead that comes straight to you, and they see how many of our projects fit their budget.</p>
            {formLink ? <div><SharePop url={formLink} title="Your client form" text="Tell me what home you are looking for. It takes 1 minute, and I will send you options that fit your budget:">Copy my form link</SharePop></div> : <p className="msg err">Run patch-011 in Supabase to switch this on.</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Security</h2></div>
          <div className="panel-b stack">
            <p className="hint">Lost your phone or used a shared computer? Log out everywhere ends your login on every device.</p>
            <SignOutButtons />
          </div>
        </section>
      </div>
    </>
  );
}
