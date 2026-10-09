'use client';

import { useEffect, useRef, useState } from 'react';
import { TwistyPlayer } from 'cubing/twisty';
import { puzzleForScrambleEvent } from '@/lib/scramble-visualization';

interface ScrambleCardProps {
  eventKey: string;
  scramble: string;
  label?: string | number;
  compact?: boolean;
}

export function ScrambleCard({ eventKey, scramble, label, compact = false }: ScrambleCardProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visualizationFailed, setVisualizationFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    host.replaceChildren();
    // Reset external widget failure when rebuilding it for a different scramble.
    setVisualizationFailed(false);

    try {
      if (!cancelled) {
        const player = new TwistyPlayer({
          puzzle: puzzleForScrambleEvent(eventKey) as never,
          visualization: '2D',
          experimentalSetupAlg: scramble,
          experimentalSetupAnchor: 'end',
          background: 'none',
          controlPanel: 'none',
          hintFacelets: 'none',
        });
        player.style.width = '100%';
        player.style.height = compact ? '8rem' : '12rem';
        player.setAttribute('aria-label', `${eventKey} scramble visualization`);
        host.replaceChildren(player);
      }
    } catch (error) {
      console.error('Failed to render scramble visualization', error);
      // The external renderer can fail synchronously during construction.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!cancelled) setVisualizationFailed(true);
    }

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [compact, eventKey, retryKey, scramble]);

  return (
    <div className="rounded-lg border border-border bg-muted p-3">
      <div className="flex items-start gap-2.5">
        {label !== undefined && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-cube-blue/10 text-xs font-bold text-cube-blue">
            {label}
          </span>
        )}
        <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed wrap-break-word">
          {scramble}
        </code>
      </div>
      {visualizationFailed ? (
        <div className="mt-3 flex h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          <button
            type="button"
            className="rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              setVisualizationFailed(false);
              setRetryKey((key) => key + 1);
            }}
          >
            Visualization unavailable — retry
          </button>
        </div>
      ) : (
        <div
          ref={hostRef}
          className={compact ? 'mt-3 h-32 w-full overflow-hidden' : 'mt-3 h-48 w-full overflow-hidden'}
        />
      )}
    </div>
  );
}
