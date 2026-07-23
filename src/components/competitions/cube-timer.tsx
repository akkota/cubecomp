'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw, AlertTriangle, Ban, Check, Timer as TimerIcon } from 'lucide-react';

type TimerState = 'idle' | 'inspection' | 'armed' | 'running' | 'stopped';

interface Props {
  solveIndex: number;       // 0-based index of current solve
  solveCount: number;        // total solves needed (3 or 5)
  onTimeRecorded: (timeMs: number, penalty: string) => void;
}

export function CubeTimer({ solveIndex, solveCount, onTimeRecorded }: Props) {
  const [state, setState] = useState<TimerState>('idle');
  const [time, setTime] = useState(0);
  const [inspection, setInspection] = useState(15);
  const [penalty, setPenalty] = useState<string | null>(null);
  const [inspectionActive, setInspectionActive] = useState(false);

  const startTimeRef = useRef(0);
  const rafRef = useRef(0);
  const inspectionRafRef = useRef(0);
  const inspectionStartRef = useRef(0);
  const holdStartRef = useRef(0);
  const stateRef = useRef<TimerState>('idle');
  const armedRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(inspectionRafRef.current);
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setState('idle');
    setTime(0);
    setInspection(15);
    setPenalty(null);
    setInspectionActive(false);
    armedRef.current = false;
  }, [cleanup]);

  const isLastSolve = solveIndex >= solveCount;

  // ── Spacebar key handlers ──
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isLastSolve) return;
      e.preventDefault();
      const st = stateRef.current;

      if (st === 'idle') {
        // Start inspection
        setState('inspection');
        setInspection(15);
        setInspectionActive(true);
        inspectionStartRef.current = Date.now();
        holdStartRef.current = 0;
        armedRef.current = false;
      } else if (st === 'inspection') {
        // Start holding — start tracking hold duration
        holdStartRef.current = Date.now();
      } else if (st === 'running') {
        // Stop timer
        const elapsed = Date.now() - startTimeRef.current;
        setTime(elapsed);
        setState('stopped');
        cleanup();
      } else if (st === 'stopped') {
        // Accept the time, go to next
        handleAccept();
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isLastSolve) return;
      e.preventDefault();
      const st = stateRef.current;

      if (st === 'inspection' && holdStartRef.current > 0) {
        const held = Date.now() - holdStartRef.current;
        if (held >= 500) {
          // Held long enough — start solving timer
          setInspectionActive(false);
          startTimeRef.current = Date.now();
          setState('running');
          armedRef.current = false;
          holdStartRef.current = 0;
        } else {
          // Too short, cancel the arm
          holdStartRef.current = 0;
        }
      }
    };

    window.addEventListener('keydown', onDown, { passive: false });
    window.addEventListener('keyup', onUp, { passive: false });
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [isLastSolve, cleanup]);

  // ── Mouse/touch handlers ──
  const handlePointerDown = useCallback(() => {
    if (isLastSolve) return;
    const st = stateRef.current;
    if (st === 'idle') {
      setState('inspection');
      setInspection(15);
      setInspectionActive(true);
      inspectionStartRef.current = Date.now();
      holdStartRef.current = 0;
      armedRef.current = false;
    } else if (st === 'inspection') {
      holdStartRef.current = Date.now();
    } else if (st === 'running') {
      const elapsed = Date.now() - startTimeRef.current;
      setTime(elapsed);
      setState('stopped');
      cleanup();
    } else if (st === 'stopped') {
      handleAccept();
    }
  }, [isLastSolve, cleanup]);

  const handlePointerUp = useCallback(() => {
    if (isLastSolve) return;
    const st = stateRef.current;
    if (st === 'inspection' && holdStartRef.current > 0) {
      const held = Date.now() - holdStartRef.current;
      if (held >= 500) {
        setInspectionActive(false);
        startTimeRef.current = Date.now();
        setState('running');
        armedRef.current = false;
        holdStartRef.current = 0;
      } else {
        holdStartRef.current = 0;
      }
    }
  }, [isLastSolve]);

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
        const elapsed = Date.now() - inspectionStartRef.current;
        const remaining = Math.max(0, 15 - elapsed / 1000);
        setInspection(remaining);
        if (remaining <= 0) {
          // Inspection expired — auto-start solving timer
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

  // ── Penalty handlers ──
  const applyPenalty = (p: string) => {
    if (p === '+2') {
      setTime(prev => prev + 2000);
      setPenalty('+2');
    } else if (p === 'DNF') {
      setPenalty('DNF');
    }
  };

  const handleAccept = () => {
    if (isLastSolve) return;
    const effectiveMs = penalty === 'DNF' ? 0 : time;
    const penaltyStr = penalty || 'none';
    onTimeRecorded(effectiveMs, penaltyStr);
    reset();
  };

  // ── Display formatting ──
  const formatDisplay = (ms: number) => {
    if (penalty === 'DNF') return 'DNF';
    const seconds = ms / 1000;
    if (seconds < 10) return seconds.toFixed(2);
    if (seconds < 60) return seconds.toFixed(2);
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  };

  const getTimerColor = () => {
    if (state === 'inspection') {
      if (inspection <= 5) return 'text-destructive';
      if (inspection <= 10) return 'text-cube-orange';
      return 'text-cube-green';
    }
    if (state === 'armed') return 'text-cube-green';
    if (state === 'running') return 'text-cube-blue';
    if (state === 'stopped') return penalty === 'DNF' ? 'text-destructive' : 'text-foreground';
    return 'text-text-tertiary';
  };

  const getTimerBorder = () => {
    if (state === 'inspection') return 'border-cube-green/30';
    if (state === 'running') return 'border-cube-blue/30';
    if (state === 'stopped') return 'border-border/50';
    return 'border-border/20';
  };

  const getTimerBg = () => {
    if (state === 'stopped') return 'bg-surface-hover/50';
    if (state === 'inspection') return 'bg-cube-green/5';
    return 'bg-surface-hover/5';
  };

  if (isLastSolve) {
    return (
      <div className="rounded-xl border border-dashed border-border/30 bg-surface/20 p-6 text-center">
        <TimerIcon className="mx-auto mb-2 h-6 w-6 text-text-tertiary/40" />
        <p className="text-sm text-text-secondary">All {solveCount} solves recorded. Submit your times below.</p>
      </div>
    );
  }

  const showInspection = state === 'inspection' || state === 'armed';

  return (
    <div className="space-y-3 select-none">
      {/* Timer display */}
      <div
        className={`relative cursor-pointer rounded-xl border-2 transition-all duration-200 ${getTimerBg()} ${getTimerBorder()}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          if (stateRef.current === 'inspection' && holdStartRef.current > 0) {
            holdStartRef.current = 0;
          }
        }}
      >
        {/* Inspection countdown */}
        {showInspection && (
          <div className="absolute top-3 left-0 right-0 text-center flex items-center justify-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary/50">Inspect</span>
            {inspection <= 5 && (
              <span className="text-xs text-destructive font-medium">— release soon!</span>
            )}
          </div>
        )}

        <div className={`flex flex-col items-center justify-center py-8 sm:py-12 ${getTimerColor()}`}>
          {showInspection ? (
            <div className="text-center">
              <span className={`font-mono text-6xl sm:text-8xl font-bold tabular-nums tracking-tighter ${inspection <= 5 ? 'animate-pulse' : ''}`}>
                {Math.ceil(inspection)}
              </span>
              <div className="mt-2 text-xs text-text-tertiary/50">
                {holdStartRef.current > 0
                  ? 'Hold to arm…'
                  : 'Hold spacebar/click to arm the timer'}
              </div>
            </div>
          ) : (
            <span className="font-mono text-6xl sm:text-8xl font-bold tabular-nums tracking-tighter">
              {state === 'idle' ? `Solve ${solveIndex + 1}/${solveCount}` :
               state === 'running' ? formatDisplay(time) :
               state === 'stopped' ? formatDisplay(time) :
               '0.00'}
            </span>
          )}
        </div>

        {/* Stopped state controls */}
        {state === 'stopped' && (
          <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { reset(); }}
              className="h-7 text-xs gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>

            {penalty !== 'DNF' && (
              <Button
                variant={penalty === '+2' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => applyPenalty(penalty === '+2' ? '+2' : '+2')}
                className={`h-7 text-xs gap-1 ${penalty === '+2' ? 'bg-cube-orange hover:bg-cube-orange/90' : 'text-cube-orange'}`}
              >
                <AlertTriangle className="h-3 w-3" /> +2
              </Button>
            )}

            {penalty !== '+2' && (
              <Button
                variant={penalty === 'DNF' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => applyPenalty('DNF')}
                className={`h-7 text-xs gap-1 ${penalty === 'DNF' ? 'bg-destructive hover:bg-destructive/90' : 'text-destructive'}`}
              >
                <Ban className="h-3 w-3" /> DNF
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={handleAccept}
              className="h-7 text-xs gap-1"
            >
              <Check className="h-3 w-3" /> Accept
            </Button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="flex items-center justify-between text-xs text-text-secondary px-1">
        <span>
          {state === 'idle' && 'Tap space or click → inspection → hold 0.5s → release to solve → tap to stop'}
          {state === 'inspection' && (holdStartRef.current > 0 ? 'Hold to arm…' : 'Hold spacebar to arm the timer')}
          {state === 'running' && 'Tap space or click to stop'}
          {state === 'stopped' && 'Apply +2/DNF, then Accept or Retry'}
        </span>
        {penalty && state === 'stopped' && (
          <span className="font-semibold text-cube-orange">{penalty === 'DNF' ? 'DNF' : `+${((time/1000) - ((time-2000)/1000)).toFixed(2)}`}</span>
        )}
      </div>
    </div>
  );
}
