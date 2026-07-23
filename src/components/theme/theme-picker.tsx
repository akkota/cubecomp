'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { THEMES, type ThemeId } from '@/lib/themes';
import { useTheme } from '@/components/theme/theme-provider';
import { cn } from '@/lib/utils';

export function ThemePicker() {
  const { themeId, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (id: ThemeId) => {
    setTheme(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-foreground"
        aria-label="Choose theme"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Theme picker"
          className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-border bg-surface-elevated p-3 shadow-lg"
        >
          <p className="mb-2 px-1 text-xs font-medium text-text-secondary">
            Appearance
          </p>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((theme) => {
              const selected = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => select(theme.id)}
                  className={cn(
                    'group relative flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary/60 bg-accent/40 ring-1 ring-primary/30'
                      : 'border-border bg-surface',
                  )}
                  aria-pressed={selected}
                >
                  <div
                    className="flex h-8 overflow-hidden rounded-md ring-1 ring-border/40"
                    aria-hidden
                  >
                    {theme.swatches.map((color, i) => (
                      <span
                        key={i}
                        className="h-full flex-1"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div className="min-w-0 pr-5">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {theme.label}
                    </div>
                    <div className="truncate text-[10px] text-text-tertiary">
                      {theme.description}
                    </div>
                  </div>
                  {selected && (
                    <Check
                      className="absolute top-2 right-2 h-3.5 w-3.5 text-primary"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
