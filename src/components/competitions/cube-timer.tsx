'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw, AlertTriangle, Ban, Check, Timer as TimerIcon } from 'lucide-react';

type TimerState = 'idle' | 'inspection' | 'running' | 'stopped';

interface Props {
  solveIndex: number;
  solveCount: number;
  onTimeRecorded: (timeMs: number, penalty: string) => void;
}

export function CubeTimer({ solveIndex, solveCount, onTimeRecorded }: Props) {
  const [state, setState] = useState<TimerState>('idle');
  const [time, setTime] = useState(0);
  const [inspection, setInspection] = useState(15);
  const [penalty, setPenalty] = useState<'none' | '+2' | 'DNF'>('none');
  const [inspectionActive, setInspectionActive] = useState(false);

  // ── Refs — updated every render, never stale ──
  const stateRef = useRef<TimerState>('idle');
  const onTimeRecordedRef = useRef(onTimeRecorded);
  const solveIndexRef = useRef(solveIndex);
  const solveCountRef = useRef(solveCount);
  const penaltyRef = useRef<'none' | '+2' | 'DNF'>('none');
  const timeRef = useRef(0);
  const baseTimeRef = useRef(0); // time at stop, before any +2 adjustment
  const startTimeRef = useRef(0);
  const rafRef = useRef(0);
  const inspectionRafRef = useRef(0);
  const inspectionStartRef = useRef(0);
  const holdStartRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onTimeRecordedRef.current = onTimeRecorded; }, [onTimeRecorded]);
  useEffect(() => { solveIndexRef.current = solveIndex; }, [solveIndex]);
  useEffect(() => { solveCountRef.current = solveCount; }, [solveCount]);
  useEffect(() => { penaltyRef.current = penalty; }, [penalty]);
  useEffect(() => { timeRef.current = time; }, [time]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(inspectionRafRef.current);
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setState('idle');
    setTime(0);
    setInspection(15);
    setPenalty('none');
    setInspectionActive(false);
  }, [cleanup]);

  const isLastSolve = solveIndex >= solveCount;

  // ── Record the time and advance to next solve ──
  // This is called by spacebar, pointer, or Accept button click.
  // All paths use onTimeRecordedRef so the latest parent handler fires.
  const recordAndAdvance = useCallback(() => {
    if (solveIndexRef.current >= solveCountRef.current) return;
    const effPenalty = penaltyRef.current;
    const effTime = timeRef.current;
    // Send the adjusted time (+2 is already baked into effTime).
    // Leaderboard: penalty 'none' → uses time as-is. 'DNF' → treats as DNF.
    onTimeRecordedRef.current(effPenalty === 'DNF' ? 0 : effTime, effPenalty);
    reset();
  }, [reset]);

  // ── Penalty toggles — mutually exclusive ──
  const togglePlus2 = useCallback(() => {
    if (penaltyRef.current === '+2') {
      // Undo +2: restore to base time
      setTime(baseTimeRef.current);
      setPenalty('none');
    } else {
      // Apply +2 (clear DNF if set)
      setTime(prev => prev + 2000);
      setPenalty('+2');
    }
  }, []);

  const toggleDNF = useCallback(() => {
    if (penaltyRef.current === 'DNF') {
      // Undo DNF: restore to base time
      setTime(baseTimeRef.current);
      setPenalty('none');
    } else {
      // Apply DNF
      setPenalty('DNF');
    }
  }, []);

  // ── Keyboard handlers ──
  useEffect(() => {
    let onDown: (e: KeyboardEvent) => void;
    let onUp: (e: KeyboardEvent) => void;

    onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      // Read everything from refs — always fresh, zero stale closures
      if (solveIndexRef.current >= solveCountRef.current) return;
      e.preventDefault();
      const st = stateRef.current;
      if (st === 'idle') {
        setState('inspection');
        setInspection(15);
        setInspectionActive(true);
        inspectionStartRef.current = Date.now();
        holdStartRef.current = 0;
      } else if (st === 'inspection') {
        holdStartRef.current = Date.now();
      } else if (st === 'running') {
        const elapsed = Date.now() - startTimeRef.current;
        baseTimeRef.current = elapsed;
        setTime(elapsed);
        setState('stopped');
        cleanup();
      } else if (st === 'stopped') {
        recordAndAdvance();
      }
    };

    onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (solveIndexRef.current >= solveCountRef.current) return;
      e.preventDefault();
      const st = stateRef.current;
      if (st === 'inspection' && holdStartRef.current > 0) {
        if (Date.now() - holdStartRef.current >= 500) {
          setInspectionActive(false);
          startTimeRef.current = Date.now();
          setState('running');
        }
        holdStartRef.current = 0;
      }
    };

    window.addEventListener('keydown', onDown, { passive: false });
    window.addEventListener('keyup', onUp, { passive: false });
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [cleanup, recordAndAdvance]);

  // ── Mouse / touch handlers ──
  const handlePointerDown = useCallback(() => {
    if (solveIndexRef.current >= solveCountRef.current) return;
    const st = stateRef.current;
    if (st === 'idle') {
      setState('inspection');
      setInspection(15);
      setInspectionActive(true);
      inspectionStartRef.current = Date.now();
      holdStartRef.current = 0;
    } else if (st === 'inspection') {
      holdStartRef.current = Date.now();
    } else if (st === 'running') {
      const elapsed = Date.now() - startTimeRef.current;
      baseTimeRef.current = elapsed;
      setTime(elapsed);
      setState('stopped');
      cleanup();
    } else if (st === 'stopped') {
      recordAndAdvance();
    }
  }, [cleanup, recordAndAdvance]);

  const handlePointerUp = useCallback(() => {
    if (solveIndexRef.current >= solveCountRef.current) return;
    const st = stateRef.current;
    if (st === 'inspection' && holdStartRef.current > 0) {
      if (Date.now() - holdStartRef.current >= 500) {
        setInspectionActive(false);
        startTimeRef.current = Date.now();
        setState('running');
      }
      holdStartRef.current = 0;
    }
  }, []);

  // ── Timer animation loop ──
  useEffect(() => {
    if (state === 'running') {
      const tick = () => {
        setTime(Date.now() - startTimeRef.current);
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
          setState('running');
          return;
        }
        inspectionRafRef.current = requestAnimationFrame(tick);
      };
      inspectionRafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(inspectionRafRef.current);
    }
  }, [inspectionActive, state]);

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
    state === 'stopped' ? 'border-border/50' : 'border-border/20';

  const bg = () =>
    state === 'stopped' ? 'bg-surface-hover/50' :
    state === 'inspection' ? 'bg-cube-green/5' : 'bg-surface-hover/5';

  if (isLastSolve) {
    return (
      <div className="rounded-xl border border-dashed border-border/30 bg-surface/20 p-6 text-center">
        <TimerIcon className="mx-auto mb-2 h-6 w-6 text-text-tertiary/40" />
        <p className="text-sm text-text-secondary">All {solveCount} solves recorded. Submit your times below.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 select-none">
      <div
        className={`relative cursor-pointer rounded-xl border-2 transition-all duration-200 ${bg()} ${border()}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { if (stateRef.current === 'inspection') holdStartRef.current = 0; }}
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
               state === 'stopped' || state === 'running' ? fmt(time) :
               '0.00'}
            </span>
          )}
          {state === 'stopped' && penalty === '+2' && (
            <span className="mt-1 text-xs font-medium text-cube-orange">+2 penalty applied</span>
          )}
        </div>

        {state === 'stopped' && (
          <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-xs gap-1">
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
            <Button
              variant={penalty === '+2' ? 'default' : 'ghost'}
              size="sm"
              onClick={togglePlus2}
              className={`h-7 text-xs gap-1 ${penalty === '+2' ? 'bg-cube-orange hover:bg-cube-orange/90' : 'text-cube-orange'}`}
            >
              <AlertTriangle className="h-3 w-3" /> +2
            </Button>
            <Button
              variant={penalty === 'DNF' ? 'default' : 'ghost'}
              size="sm"
              onClick={toggleDNF}
              className={`h-7 text-xs gap-1 ${penalty === 'DNF' ? 'bg-destructive hover:bg-destructive/90' : 'text-destructive'}`}
            >
              <Ban className="h-3 w-3" /> DNF
            </Button>
            <Button variant="default" size="sm" onClick={recordAndAdvance} className="h-7 text-xs gap-1">
              <Check className="h-3 w-3" /> Accept
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-text-secondary px-1">
        <span>
          {state === 'idle' && 'Tap space or click → inspection → hold 0.5s → release to solve → tap to stop'}
          {state === 'inspection' && (holdStartRef.current > 0 ? 'Hold to arm…' : 'Hold spacebar to arm the timer')}
          {state === 'running' && 'Tap space or click to stop'}
          {state === 'stopped' && (penalty === 'DNF' ? 'DNF — Accept to record' : penalty === '+2' ? `${fmt(time)} (+2) — Accept to record` : `${fmt(time)} — Accept to record`)}
        </span>
      </div>
    </div>
  );
}
