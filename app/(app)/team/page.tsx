import { requireOrg } from '@/lib/context';
import { changeRole, deactivateMember, reactivateMember, revokeInvite, updateCompany } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { InviteForm } from '@/components/InviteForm';
import { CopyButton } from '@/components/CopyButton';
import { ROLE_LABEL, fmtPhone, siteUrl, type Role } from '@/lib/roles';

export const metadata = { title: 'Team' };

export default async function Team() {
  const { supabase, org, role, user } = await requireOrg(['owner', 'manager']);
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from('members').select('user_id, full_name, role, phone, email, active, joined_at').eq('org_id', org.id).order('joined_at'),
    supabase.from('invites').select('id, token, full_name, phone, email, role, expires_at, accepted_at').eq('org_id', org.id).is('accepted_at', null).order('created_at', { ascending: false }),
  ]);
  const list = members ?? [];
  const activeAssignable = list.filter((m) => m.active && m.role !== 'partner');
  const isOwner = role === 'owner';
  return (
    <>
      <div className="top"><h1>Team</h1></div>
      <div className="grid-main">
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>People</h2><span className="hint">{list.filter((m) => m.active).length} active</span></div>
            <div className="people">
              {list.map((m) => {
                const self = m.user_id === user.id;
                const canEditRole = isOwner && !self;
                const canRemove = !self && (isOwner || (m.role !== 'manager' && m.role !== 'owner'));
                return (
                  <div key={m.user_id} className={`person ${m.active ? '' : 'off'}`}>
                    <div className="person-main">
                      <span className="avatar">{(m.full_name || '?').slice(0, 1).toUpperCase()}</span>
                      <div>
                        <div className="pname">{m.full_name || 'No name'} {self && <span className="chip">You</span>} {!m.active && <span className="chip bad">Access removed</span>}</div>
                        <div className="hint">{ROLE_LABEL[m.role as Role]}{m.phone ? ' · ' + fmtPhone(m.phone) : ''}{m.email ? ' · ' + m.email : ''}</div>
                      </div>
                    </div>
                    <div className="person-acts">
                      {m.active && canEditRole && (
                        <ActionForm action={changeRole} className="inline">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <select name="role" defaultValue={m.role} aria-label={`Role for ${m.full_name}`}>
                            {(['owner', 'manager', 'agent'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                          <Submit className="btn sm">Save</Submit>
                        </ActionForm>
                      )}
                      {m.active && canRemove && (
                        <details className="remove">
                          <summary className="btn sm danger">Remove access</summary>
                          <ActionForm action={deactivateMember} className="stack remove-box">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <p className="hint">{m.full_name} is logged out of this company at once. Their open leads move to:</p>
                            <select name="reassign_to" required defaultValue="">
                              <option value="" disabled>Choose who takes over</option>
                              {activeAssignable.filter((a) => a.user_id !== m.user_id).map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}
                            </select>
                            <Submit className="btn sm danger">Remove and move leads</Submit>
                          </ActionForm>
                        </details>
                      )}
                      {!m.active && (
                        <form action={reactivateMember}><input type="hidden" name="user_id" value={m.user_id} /><button className="btn sm">Give access back</button></form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          {invites && invites.length > 0 && (
            <section className="panel">
              <div className="panel-h"><h2>Waiting to join</h2></div>
              <div className="people">
                {invites.map((i) => {
                  const expired = new Date(i.expires_at).getTime() < Date.now();
                  return (
                    <div key={i.id} className="person">
                      <div className="person-main"><span className="avatar faint-bg">?</span>
                        <div><div className="pname">{i.full_name || 'Invited person'} {expired && <span className="chip bad">Expired</span>}</div>
                          <div className="hint">{ROLE_LABEL[i.role as Role]} · {i.phone ? fmtPhone(i.phone) : i.email}</div></div></div>
                      <div className="person-acts">
                        {!expired && <CopyButton text={`${siteUrl()}/join/${i.token}`} />}
                        <form action={revokeInvite}><input type="hidden" name="id" value={i.id} /><button className="btn sm ghost">Cancel</button></form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Invite someone</h2></div>
            <div className="panel-b"><InviteForm canInviteManager={isOwner} companyName={org.name} /></div>
          </section>
          {isOwner && (
            <section className="panel">
              <div className="panel-h"><h2>Company details</h2></div>
              <div className="panel-b">
                <ActionForm action={updateCompany} className="stack">
                  <label className="field"><span className="label">Company name</span><input name="company" defaultValue={org.name} required /></label>
                  <label className="field"><span className="label">City</span><input name="city" defaultValue={org.city ?? ''} /></label>
                  <label className="field"><span className="label">RERA number</span><input name="rera" defaultValue={org.rera_no ?? ''} /></label>
                  <Submit>Save</Submit>
                </ActionForm>
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-h"><h2>Who can do what</h2></div>
            <div className="table-wrap"><table className="tbl small">
              <thead><tr><th></th><th>Admin</th><th>Manager</th><th>Employee</th></tr></thead>
              <tbody>
                {[
                  ['See all leads', 1, 1, 0],
                  ['See own leads, call, add notes', 1, 1, 1],
                  ['Send client links (shortlists)', 1, 1, 1],
                  ['Reports and team performance', 1, 1, 0],
                  ['Reassign and delete leads', 1, 1, 0],
                  ['Invite employees', 1, 1, 0],
                  ['Money: deals, payments, expenses', 1, 0, 0],
                  ['Add admins or managers, change roles', 1, 0, 0],
                  ['Export all data', 1, 0, 0],
                ].map(([label, ...v]) => (
                  <tr key={label as string}><td>{label}</td>{v.map((x, i) => <td key={i} className="c">{x ? '✓' : '—'}</td>)}</tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </div>
      </div>
    </>
  );
}
