'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const ran = useRef(false);

  useEffect(() => {
    // Prevent double-invocation in React Strict Mode
    if (ran.current) return;
    ran.current = true;

    const supabase = createClient();

    // The callback URL receives auth tokens in the URL hash or query params
    // (e.g. from email verification, magic link, or OAuth).
    // getSession() automatically exchanges any pending tokens into a session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Use window.location for a full page load so the middleware
        // picks up the freshly-set session cookies.
        window.location.replace(new URL('/dashboard', window.location.origin).href);
      } else {
        // No session — redirect to login with a message
        window.location.replace(new URL('/login?error=verification_failed', window.location.origin).href);
      }
    });
  }, []);

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <p className="text-muted-foreground">Completing sign in...</p>
    </div>
  );
}
