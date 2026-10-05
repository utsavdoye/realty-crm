import { AuthShell } from '@/components/AuthShell';
import { safeNext } from '@/lib/roles';
import { ForgotForm } from './ForgotForm';

export const metadata = { title: 'Forgot password' };

export default function Forgot({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Forgot password</h1>
        <p className="muted">We will send a link to your registered email. Open it and set a new password.</p>
        <ForgotForm next={safeNext(searchParams.next)} />
      </div>
    </AuthShell>
  );
}
