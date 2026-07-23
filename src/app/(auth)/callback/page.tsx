'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.onAuthStateChange((_, session) => {
      if (session) router.push('/dashboard');
    });
  }, [router]);

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <p className="text-muted-foreground">Completing sign in...</p>
    </div>
  );
}
