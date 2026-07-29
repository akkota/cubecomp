/**
 * Public identity helpers.
 * Email is auth-only (Supabase Auth). Everywhere else uses username.
 */

export type PublicProfile = {
  username?: string | null;
  display_name?: string | null;
};

/** Canonical public handle — never email. */
export function publicUsername(
  profile: PublicProfile | null | undefined,
  fallback = 'unknown',
): string {
  const username = profile?.username?.trim();
  return username || fallback;
}

/** Label for lists / greetings: @username. */
export function publicHandle(
  profile: PublicProfile | null | undefined,
  fallback = 'unknown',
): string {
  return `@${publicUsername(profile, fallback)}`;
}

/**
 * Optional friendly line for admin pickers: "Display Name (@username)"
 * or just "@username" when no display name is set.
 */
export function publicDisplayWithHandle(
  profile: PublicProfile | null | undefined,
  fallback = 'unknown',
): string {
  const username = publicUsername(profile, fallback);
  const display = profile?.display_name?.trim();
  if (display && display.toLowerCase() !== username.toLowerCase()) {
    return `${display} (@${username})`;
  }
  return `@${username}`;
}
