import { requireOrg } from '@/lib/context';
import { updateMyName } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { SignOutButtons } from '@/components/SignOutButtons';
import { ROLE_HELP, ROLE_LABEL } from '@/lib/roles';

export const metadata = { title: 'Profile' };

export default async function Profile() {
  const { user, me, role, org } = await requireOrg();
  return (
    <>
      <div className="top"><h1>Profile</h1></div>
      <div className="grid-main">
        <section className="panel">
          <div className="panel-h"><h2>Your details</h2></div>
          <div className="panel-b">
            <ActionForm action={updateMyName} className="stack">
              <label className="field"><span className="label">Name shown to your team</span><input name="full_name" defaultValue={me.full_name} required /></label>
              <Submit>Save</Submit>
            </ActionForm>
            <dl className="kv">
              <div><dt className="label">Mobile</dt><dd>{user.phone ? '+' + user.phone : '—'}</dd></div>
              <div><dt className="label">Email</dt><dd>{user.email || '—'}</dd></div>
              <div><dt className="label">Company</dt><dd>{org.name}</dd></div>
              <div><dt className="label">Role</dt><dd>{ROLE_LABEL[role]}</dd></div>
            </dl>
            <p className="hint">{ROLE_HELP[role]}</p>
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
