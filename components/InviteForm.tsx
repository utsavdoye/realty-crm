'use client';

import { useFormState } from 'react-dom';
import { createInvite, type FormState } from '@/app/actions';
import { Submit } from '@/components/forms';
import { CopyButton } from '@/components/CopyButton';
import { ROLE_HELP, ROLE_LABEL, type Role } from '@/lib/roles';
import { useState } from 'react';
import { APP_NAME } from '@/lib/brand';

export function InviteForm({ canInviteManager, companyName }: { canInviteManager: boolean; companyName: string }) {
  // canInviteManager is true only for admins: they can add employees, managers and other admins.
  const [state, action] = useFormState<FormState, FormData>(createInvite, null);
  const roles: Role[] = canInviteManager ? ['agent', 'manager', 'owner'] : ['agent'];
  const [role, setRole] = useState<Role>('agent');
  const waText = state?.link
    ? `Hi ${state.name || ''}, you are invited to join ${companyName} on ${APP_NAME} as ${ROLE_LABEL[role]}. Open this link and log in with your mobile number: ${state.link}`
    : '';
  return (
    <form action={action} className="stack">
      <div className="grid2f">
        <label className="field">
          <span className="label">Name</span>
          <input name="full_name" placeholder="Priya Nair" required />
        </label>
        <label className="field">
          <span className="label">Mobile number</span>
          <input name="phone" inputMode="numeric" placeholder="98765 43210" />
        </label>
        <label className="field">
          <span className="label">Email (optional)</span>
          <input name="email" type="email" placeholder="If they will log in with email" />
        </label>
        <label className="field">
          <span className="label">Role</span>
          <select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
      </div>
      <p className="hint">{ROLE_HELP[role]} The link works only for the mobile number or email you enter, and expires in 7 days.</p>
      <div><Submit>Create invite link</Submit></div>
      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      {state?.link && (
        <div className="invite-box">
          <p className="msg ok">{state.ok}</p>
          <code className="link">{state.link}</code>
          <div className="row-gap">
            {state.phone && (
              <a className="btn wa sm" target="_blank" rel="noopener noreferrer"
                 href={`https://wa.me/91${state.phone}?text=${encodeURIComponent(waText)}`}>Send on WhatsApp</a>
            )}
            <CopyButton text={state.link} />
          </div>
        </div>
      )}
    </form>
  );
}
