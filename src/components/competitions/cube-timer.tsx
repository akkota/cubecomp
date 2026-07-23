'use client';

import { useState, useRef, useEffect, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw, AlertTriangle, Ban, Check, Timer as TimerIcon } from 'lucide-react';

export type TimerState = 'idle' | 'inspection' | 'running' | 'stopped';
export type TimerPenalty = 'none' | '+2' | 'DNF';

export interface TimerResult {
  solveNumber: number;
  timeMs: number;
  penalty: TimerPenalty;
}

interface Props {
  solveIndex: number;
  solveCount: number;
  onTimeRecorded: (result: TimerResult) => boolean;
  onStateChange: (state: TimerState) => void;
}

export function CubeTimer({ solveIndex, solveCount, onTimeRecorded, onStateChange }: Props) {
  const [state, setState] = useState<TimerState>('idle');
  const [time, setTime] = useState(0);
  const [inspection, setInspection] = useState(15);
  const [penalty, setPenalty] = useState<TimerPenalty>('none');
  const [inspectionActive, setInspectionActive] = useState(false);
  const [armed, setArmed] = useState(false);

  // ── Refs — updated every render, never stale ──
  const stateRef = useRef<TimerState>('idle');
  const onTimeRecordedRef = useRef(onTimeRecorded);
  const onStateChangeRef = useRef(onStateChange);
  const solveIndexRef = useRef(solveIndex);
  const solveCountRef = useRef(solveCount);
  const penaltyRef = useRef<TimerPenalty>('none');
  const timeRef = useRef(0);
  const recordingRef = useRef(false);
  const startTimeRef = useRef(0);
  const rafRef = useRef(0);
  const inspectionRafRef = useRef(0);
  const inspectionStartRef = useRef(0);
  const holdStartRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { onTimeRecordedRef.current = onTimeRecorded; }, [onTimeRecorded]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { solveIndexRef.current = solveIndex; }, [solveIndex]);
  useEffect(() => { solveCountRef.current = solveCount; }, [solveCount]);

  // Keep keyboard focus on the timer so Space doesn't scroll the page.
  useEffect(() => {
    if (solveIndex >= solveCount) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [solveIndex, solveCount]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(inspectionRafRef.current);
  }, []);

  const transitionTo = useCallback((nextState: TimerState) => {
    stateRef.current = nextState;
    setState(nextState);
    onStateChangeRef.current(nextState);
  }, []);

  const reset = useCallback(() => {
    cleanup();
    timeRef.current = 0;
    penaltyRef.current = 'none';
    holdStartRef.current = 0;
    recordingRef.current = false;
    transitionTo('idle');
    setTime(0);
    setInspection(15);
    setPenalty('none');
    setInspectionActive(false);
    setArmed(false);
    queueMicrotask(() => rootRef.current?.focus({ preventScroll: true }));
  }, [cleanup, transitionTo]);

  useEffect(() => () => {
    cleanup();
    onStateChangeRef.current('idle');
  }, [cleanup]);

  const isLastSolve = solveIndex >= solveCount;

  // ── Record the time and advance to next solve ──
  // Accept is the only path that records a stopped result.
  const recordAndAdvance = useCallback(() => {
    if (
      stateRef.current !== 'stopped'
      || recordingRef.current
      || solveIndexRef.current >= solveCountRef.current
    ) return;

    recordingRef.current = true;
    const accepted = onTimeRecordedRef.current({
      solveNumber: solveIndexRef.current + 1,
      timeMs: timeRef.current,
      penalty: penaltyRef.current,
    });

    if (accepted) {
      reset();
    } else {
      recordingRef.current = false;
    }
  }, [reset]);

  // ── Penalty toggles — mutually exclusive ──
  const togglePlus2 = useCallback(() => {
    const nextPenalty = penaltyRef.current === '+2' ? 'none' : '+2';
    penaltyRef.current = nextPenalty;
    setPenalty(nextPenalty);
  }, []);

  const toggleDNF = useCallback(() => {
    const nextPenalty = penaltyRef.current === 'DNF' ? 'none' : 'DNF';
    penaltyRef.current = nextPenalty;
    setPenalty(nextPenalty);
  }, []);

  // ── Keyboard handlers ──
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement
      && (
        target.isContentEditable
        || !!target.closest('input, textarea, select, [contenteditable="true"]')
      );

    const isTimerControlTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement
      && !!target.closest('[data-timer-controls]');

    const timerOwnsSpace = () => solveIndexRef.current < solveCountRef.current;

    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (isEditableTarget(e.target)) return;
      if (!timerOwnsSpace()) return;

      // Always block page scroll while the timer is active — do this before any other logic.
      e.preventDefault();
      e.stopPropagation();

      if (e.repeat || isTimerControlTarget(e.target)) return;

      const st = stateRef.current;
      if (st === 'idle') {
        transitionTo('inspection');
        setInspection(15);
        setInspectionActive(true);
        inspectionStartRef.current = Date.now();
        holdStartRef.current = 0;
        setArmed(false);
      } else if (st === 'inspection') {
        holdStartRef.current = Date.now();
        setArmed(true);
      } else if (st === 'running') {
        const elapsed = Date.now() - startTimeRef.current;
        timeRef.current = elapsed;
        setTime(elapsed);
        transitionTo('stopped');
        cleanup();
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (isEditableTarget(e.target)) return;
      if (!timerOwnsSpace()) return;

      e.preventDefault();
      e.stopPropagation();

      if (isTimerControlTarget(e.target)) return;

      const st = stateRef.current;
      if (st === 'inspection' && holdStartRef.current > 0) {
        if (Date.now() - holdStartRef.current >= 500) {
          setInspectionActive(false);
          startTimeRef.current = Date.now();
          transitionTo('running');
        }
        holdStartRef.current = 0;
        setArmed(false);
      }
    };

    // Capture phase so we beat the browser's default Space → scroll behavior.
    window.addEventListener('keydown', onDown, { capture: true, passive: false });
    window.addEventListener('keyup', onUp, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keydown', onDown, { capture: true });
      window.removeEventListener('keyup', onUp, { capture: true });
    };
  }, [cleanup, transitionTo]);

  // ── Mouse / touch handlers ──
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [role="button"]')) return;
    if (solveIndexRef.current >= solveCountRef.current) return;
    const st = stateRef.current;
    if (st === 'idle') {
      transitionTo('inspection');
      setInspection(15);
      setInspectionActive(true);
      inspectionStartRef.current = Date.now();
      holdStartRef.current = 0;
      setArmed(false);
    } else if (st === 'inspection') {
      holdStartRef.current = Date.now();
      setArmed(true);
    } else if (st === 'running') {
      const elapsed = Date.now() - startTimeRef.current;
      timeRef.current = elapsed;
      setTime(elapsed);
      transitionTo('stopped');
      cleanup();
    }
  }, [cleanup, transitionTo]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [role="button"]')) return;
    if (solveIndexRef.current >= solveCountRef.current) return;
    const st = stateRef.current;
    if (st === 'inspection' && holdStartRef.current > 0) {
      if (Date.now() - holdStartRef.current >= 500) {
        setInspectionActive(false);
        startTimeRef.current = Date.now();
        transitionTo('running');
      }
      holdStartRef.current = 0;
      setArmed(false);
    }
  }, [transitionTo]);

  // ── Timer animation loop ──
  useEffect(() => {
    if (state === 'running') {
      const tick = () => {
        const elapsed = Date.now() - startTimeRef.current;
        timeRef.current = elapsed;
        setTime(elapsed);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
  }, [state]);

  // ── Inspection countdown ──
  useEffect(() => {
    if (inspectionActive && state === 'inspection') {
      const tick = () => {
        const remaining = Math.max(0, 15 - (Date.now() - inspectionStartRef.current) / 1000);
        setInspection(remaining);
        if (remaining <= 0) {
          setInspectionActive(false);
          startTimeRef.current = Date.now();
          transitionTo('running');
          return;
        }
        inspectionRafRef.current = requestAnimationFrame(tick);
      };
      inspectionRafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(inspectionRafRef.current);
    }
  }, [inspectionActive, state, transitionTo]);

  // ── Display ──
  const fmt = (ms: number) => {
    const s = ms / 1000;
    if (s < 10) return s.toFixed(2);
    if (s < 60) return s.toFixed(2);
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  };

  const color = () => {
    if (state === 'inspection') {
      if (inspection <= 5) return 'text-destructive';
      if (inspection <= 10) return 'text-cube-orange';
      return 'text-cube-green';
    }
    if (state === 'running') return 'text-cube-blue';
    if (state === 'stopped' && penalty === 'DNF') return 'text-destructive';
    if (state === 'stopped') return 'text-foreground';
    return 'text-text-tertiary';
  };

  const border = () =>
    state === 'inspection' ? 'border-cube-green/30' :
    state === 'running' ? 'border-cube-blue/30' :
    state === 'stopped' ? 'border-border' : 'border-border';

  const bg = () =>
    state === 'stopped' ? 'bg-surface-hover/50' :
    state === 'inspection' ? 'bg-cube-green/5' : 'bg-surface-hover/5';
  const displayedTime = penalty === '+2' ? time + 2000 : time;

  if (isLastSolve) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/20 p-6 text-center">
        <TimerIcon className="mx-auto mb-2 h-6 w-6 text-text-tertiary/40" />
        <p className="text-sm text-text-secondary">All {solveCount} solves recorded. Submit your times below.</p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="space-y-3 select-none outline-none"
      onMouseDown={(event) => {
        // Keep focus on the timer pad (not page chrome) without scrolling.
        if (event.target instanceof Element && event.target.closest('[data-timer-controls]')) return;
        rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <div
        className={`relative cursor-pointer rounded-xl border-2 transition-all duration-200 ${bg()} ${border()}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          if (stateRef.current === 'inspection') {
            holdStartRef.current = 0;
            setArmed(false);
          }
        }}
      >
        {state === 'inspection' && (
          <div className="absolute top-3 left-0 right-0 text-center flex items-center justify-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary/50">Inspect</span>
            {inspection <= 5 && <span className="text-xs text-destructive font-medium">— release soon!</span>}
          </div>
        )}
        <div className={`flex flex-col items-center justify-center py-8 sm:py-12 ${color()}`}>
          {state === 'inspection' ? (
            <div className="text-center">
              <span className={`font-mono text-6xl sm:text-8xl font-bold tabular-nums tracking-tighter ${inspection <= 5 ? 'animate-pulse' : ''}`}>
                {Math.ceil(inspection)}
              </span>
              <div className="mt-2 text-xs text-text-tertiary/50">Hold spacebar/click to arm the timer</div>
            </div>
          ) : (
            <span className="font-mono text-6xl sm:text-8xl font-bold tabular-nums tracking-tighter">
              {state === 'idle' ? `Solve ${solveIndex + 1}/${solveCount}` :
               penalty === 'DNF' ? 'DNF' :
               state === 'stopped' && penalty === '+2' ? `${fmt(displayedTime)}+` :
               state === 'stopped' || state === 'running' ? fmt(time) :
               '0.00'}
            </span>
          )}
          {state === 'stopped' && penalty === '+2' && (
            <span className="mt-1 text-xs font-medium text-cube-orange">
              {fmt(time)} + 2.00 = {fmt(displayedTime)}
            </span>
          )}
        </div>

        {state === 'stopped' && (
          <div
            data-timer-controls
            className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2 flex-wrap"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={reset}
              className="h-7 cursor-pointer text-xs gap-1 text-text-secondary hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
            <Button
              variant={penalty === '+2' ? 'default' : 'ghost'}
              size="sm"
              type="button"
              onClick={togglePlus2}
              className={`h-7 cursor-pointer text-xs gap-1 ${
                penalty === '+2'
                  ? 'bg-cube-orange text-primary-foreground hover:bg-cube-orange/90'
                  : 'text-cube-orange hover:bg-cube-orange/15 hover:text-cube-orange'
              }`}
            >
              <AlertTriangle className="h-3 w-3" /> +2
            </Button>
            <Button
              variant={penalty === 'DNF' ? 'default' : 'ghost'}
              size="sm"
              type="button"
              onClick={toggleDNF}
              className={`h-7 cursor-pointer text-xs gap-1 ${
                penalty === 'DNF'
                  ? 'bg-destructive text-primary-foreground hover:bg-destructive/90'
                  : 'text-destructive hover:bg-destructive/15 hover:text-destructive'
              }`}
            >
              <Ban className="h-3 w-3" /> DNF
            </Button>
            <Button
              variant="default"
              size="sm"
              type="button"
              onClick={recordAndAdvance}
              className="h-7 cursor-pointer text-xs gap-1"
            >
              <Check className="h-3 w-3" /> Accept
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-text-secondary px-1">
        <span>
          {state === 'idle' && 'Tap space or click → inspection → hold 0.5s → release to solve → tap to stop'}
          {state === 'inspection' && (armed ? 'Hold to arm…' : 'Hold spacebar to arm the timer')}
          {state === 'running' && 'Tap space or click to stop'}
          {state === 'stopped' && (penalty === 'DNF' ? 'DNF — Accept to record' : penalty === '+2' ? `${fmt(displayedTime)}+ — Accept to record` : `${fmt(time)} — Accept to record`)}
        </span>
      </div>
    </div>
  );
}
