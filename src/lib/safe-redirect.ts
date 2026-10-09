/** Validate using the same URL normalization used by browser navigation. */
export function safeRedirectPath(raw: string, fallback = '/dashboard'): string {
  if (!raw.startsWith('/') || /[\\\x00-\x20\x7f]/.test(raw)) return fallback;
  const origin = 'https://cubecomp.invalid';
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}
