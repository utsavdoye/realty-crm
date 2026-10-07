import { requireOrg } from '@/lib/context';
import { changeRole, deactivateMember, decideJoin, reactivateMember, renameMember, revokeInvite, setJoinLink, updateCompany } from '@/app/actions';
import { SharePop } from '@/components/SharePop';
import { ActionForm, Submit } from '@/components/forms';
import { InviteForm } from '@/components/InviteForm';
import { CopyButton } from '@/components/CopyButton';
import { PICK_LABEL, fmtPhone, memberRole, siteUrl, type PickRole } from '@/lib/roles';

export const metadata = { title: 'Team' };

export default async function Team() {
  const { supabase, org, role, user } = await requireOrg(['owner', 'manager']);
  const [{ data: members }, { data: invites }, { data: reqs }, { data: o }] = await Promise.all([
    supabase.from('members').select('*').eq('org_id', org.id).order('joined_at'),
    supabase.from('invites').select('*').eq('org_id', org.id).is('accepted_at', null).order('created_at', { ascending: false }),
    supabase.from('join_requests').select('*').eq('org_id', org.id).eq('status', 'pending').order('created_at'),
    supabase.from('organizations').select('join_token, join_open').eq('id', org.id).maybeSingle(),
  ]);
  const joinLink = o?.join_token ? `${siteUrl()}/join/team/${o.join_token}` : '';
  const WANTS: Record<string, string> = { agent: 'Employee', intern: 'Intern', manager: 'Manager' };
  const list = members ?? [];
  const activeAssignable = list.filter((m) => m.active && m.role !== 'partner');
  const isOwner = role === 'owner';
  return (
    <>
      <div className="top"><h1>Team</h1></div>
      <div className="grid-main">
        <div className="stack">
          {reqs && reqs.length > 0 && (
            <section className="panel" id="requests">
              <div className="panel-h"><h2>Asking to join</h2><span className="chip tape">{reqs.length} waiting</span></div>
              <div className="people">
                {reqs.map((q) => {
                  const mine = isOwner || q.wants !== 'manager';
                  return (
                    <div key={q.id} className="person">
                      <div className="person-main"><span className="avatar faint-bg">{q.full_name.slice(0, 1).toUpperCase()}</span>
                        <div><div className="pname">{q.full_name} <span className="chip">wants: {WANTS[q.wants]}</span></div>
                          <div className="hint">{q.phone ? fmtPhone(q.phone) : ''}{q.email ? ' · ' + q.email : ''} · asked {new Date(q.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</div></div></div>
                      {mine ? (
                        <div className="req-acts">
                          <ActionForm action={decideJoin} className="inline">
                            <input type="hidden" name="id" value={q.id} /><input type="hidden" name="approve" value="1" />
                            <select name="role" defaultValue={q.wants} aria-label={`Role for ${q.full_name}`}>
                              <option value="agent">Employee</option><option value="intern">Intern</option>
                              {isOwner && <option value="manager">Manager</option>}
                            </select>
                            <Submit className="btn sm primary">Approve</Submit>
                          </ActionForm>
                          <ActionForm action={decideJoin} className="inline">
                            <input type="hidden" name="id" value={q.id} /><input type="hidden" name="approve" value="0" />
                            <Submit className="btn sm ghost danger">Say no</Submit>
                          </ActionForm>
                        </div>
                      ) : <span className="hint">Only the admin can approve a manager</span>}
                    </div>
                  );
                })}
              </div>
              <p className="hint" style={{ padding: '0 16px 14px' }}>Call or check the person before approving. Only approve people you know.</p>
            </section>
          )}
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
                        <div className="hint">{PICK_LABEL[memberRole(m)]}{m.phone ? ' · ' + fmtPhone(m.phone) : ''}{m.email ? ' · ' + m.email : ''}</div>
                      </div>
                    </div>
                    <div className="person-acts">
                      {isOwner && (
                        <details className="remove">
                          <summary className="btn sm ghost">Edit name</summary>
                          <ActionForm action={renameMember} className="stack remove-box">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <input name="full_name" defaultValue={m.full_name ?? ''} required minLength={2} maxLength={80} aria-label="Name" />
                            <Submit className="btn sm">Save name</Submit>
                          </ActionForm>
                        </details>
                      )}
                      {m.active && canEditRole && (
                        <ActionForm action={changeRole} className="inline">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <select name="role" defaultValue={memberRole(m)} aria-label={`Role for ${m.full_name}`}>
                            {(['owner', 'manager', 'agent', 'intern'] as PickRole[]).map((r) => <option key={r} value={r}>{PICK_LABEL[r]}</option>)}
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
                          <div className="hint">{PICK_LABEL[memberRole(i)]} · {i.phone ? fmtPhone(i.phone) : i.email}</div></div></div>
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
            <div className="panel-h"><h2>Team join link</h2><span className={`chip ${o?.join_open ? 'good' : 'bad'}`}>{o?.join_open ? 'On' : 'Off'}</span></div>
            <div className="panel-b join-link-box">
              {!joinLink ? <p className="msg err">Run patch-013 in Supabase to switch this on.</p> : (
                <>
                  <p className="hint">One link for your whole team. Post it in your office WhatsApp group. Anyone who opens it can only <b>ask</b> to join: you{isOwner ? '' : ' or the admin'} approve each person first. Managers need the admin&apos;s approval.</p>
                  {o?.join_open && <div><SharePop url={joinLink} title="Team join link" text={`Join ${org.name} on our CRM. Open this link, log in, and ask to join:`}>Copy team link</SharePop></div>}
                  {isOwner && (
                    <div className="row-btns">
                      <form action={setJoinLink}><input type="hidden" name="open" value={o?.join_open ? '0' : '1'} /><button className="btn sm ghost">{o?.join_open ? 'Turn link off' : 'Turn link on'}</button></form>
                      <form action={setJoinLink}><input type="hidden" name="open" value="1" /><input type="hidden" name="new" value="1" /><button className="btn sm ghost">Make a new link (old one stops)</button></form>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Invite one person</h2></div>
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
              <thead><tr><th></th><th>Admin</th><th>Manager</th><th>Employee</th><th>Intern</th></tr></thead>
              <tbody>
                {[
                  ['See all leads', 1, 1, 0, 0],
                  ['See own leads, call, add notes', 1, 1, 1, 1],
                  ['Send client links (shortlists)', 1, 1, 1, 1],
                  ['Delete their own client links', 1, 1, 1, 0],
                  ['Reports and team performance', 1, 1, 0, 0],
                  ['Reassign and delete leads', 1, 1, 0, 0],
                  ['Invite employees and interns', 1, 1, 0, 0],
                  ['Money: deals, payments, expenses', 1, 0, 0, 0],
                  ['Add admins or managers, change roles', 1, 0, 0, 0],
                  ['Export all data', 1, 0, 0, 0],
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
