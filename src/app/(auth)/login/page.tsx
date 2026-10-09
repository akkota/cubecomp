import { safeRedirectPath } from '@/lib/safe-redirect';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; redirect?: string }>;
}) {
  const params = await searchParams;
  const raw = params.next || params.redirect || '/dashboard';
  // Only allow same-origin relative paths
  const redirectTo = safeRedirectPath(raw);

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <LoginForm redirectTo={redirectTo} />
    </div>
  );
}
