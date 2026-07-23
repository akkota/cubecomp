export const THEME_STORAGE_KEY = 'cubecomp-theme';
export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const DEFAULT_THEME_ID = 'dark' as const;

export const THEME_IDS = [
  'light',
  'dark',
  'arcade',
  'sunset',
  'mint',
  'candy',
  'terminal',
  'cosmic',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  description: string;
  isDark: boolean;
  /** Preview swatches for the picker cards */
  swatches: [string, string, string, string];
};

export const THEMES: ThemeDefinition[] = [
  {
    id: 'light',
    label: 'Light',
    description: 'Clean and bright',
    isDark: false,
    swatches: ['#f0f0f5', '#ffffff', '#3a6ad4', '#d8d8e4'],
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Low-light default',
    isDark: true,
    swatches: ['#0e0f16', '#212433', '#5b8def', '#1a1c28'],
  },
  {
    id: 'arcade',
    label: 'Speedcube Arcade',
    description: 'Neon grids & energy',
    isDark: true,
    swatches: ['#140e28', '#2a1f55', '#3d7fff', '#ff4d9a'],
  },
  {
    id: 'sunset',
    label: 'Sunset Circuit',
    description: 'Warm coral & purple',
    isDark: true,
    swatches: ['#2a1428', '#7a3a28', '#f08a3a', '#e060a0'],
  },
  {
    id: 'mint',
    label: 'Mint Laboratory',
    description: 'Clean experimental lab',
    isDark: false,
    swatches: ['#e4f0e4', '#e8f5ee', '#1f7a6e', '#3d8a7a'],
  },
  {
    id: 'candy',
    label: 'Candy Cube',
    description: 'Soft pastels',
    isDark: false,
    swatches: ['#f3e8f6', '#fce8f4', '#b06bc4', '#7ec8d4'],
  },
  {
    id: 'terminal',
    label: 'Retro Terminal',
    description: 'Phosphor green CRT',
    isDark: true,
    swatches: ['#070d09', '#142018', '#3dd68c', '#d4a017'],
  },
  {
    id: 'cosmic',
    label: 'Cosmic Scramble',
    description: 'Deep space violet',
    isDark: true,
    swatches: ['#0c0a22', '#2a2458', '#9b6dff', '#e050c0'],
  },
];

export const THEME_BY_ID: Record<ThemeId, ThemeDefinition> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
) as Record<ThemeId, ThemeDefinition>;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** Resolve stored value including legacy light/dark key. */
export function resolveStoredThemeId(raw: string | null): ThemeId {
  if (isThemeId(raw)) return raw;
  return DEFAULT_THEME_ID;
}

export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === 'undefined') return;
  const theme = THEME_BY_ID[themeId];
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.classList.toggle('dark', theme.isDark);
}
