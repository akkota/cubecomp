'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type CurrentProfile = {
  id: string;
  username: string;
  display_name: string | null;
};

/**
 * Loads the signed-in user's public profile (username).
 * Never exposes email — use supabase.auth only for auth checks.
 */
export function useCurrentProfile() {
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const loadProfile = async (uid: string | null) => {
      if (!uid) {
        if (!cancelled) {
          setUserId(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name')
        .eq('id', uid)
        .maybeSingle();

      if (cancelled) return;
      setUserId(uid);
      if (data?.username) {
        setProfile({
          id: data.id,
          username: data.username,
          display_name: data.display_name,
        });
      } else {
        setProfile(null);
      }
      setLoading(false);
    };

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await loadProfile(user?.id ?? null);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { profile, userId, loading, isSignedIn: !!userId };
}
