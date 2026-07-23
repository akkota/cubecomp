'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Square, RotateCcw, AlertTriangle, Ban } from 'lucide-react';

type TimerState = 'idle' | 'arming' | 'ready' | 'running' | 'stopped';

interface Props {
  solveIndex: number;
  solveLabel: string;
  currentValue: string;
  onTimeRecorded: (timeMs: number) => void;
  onPenalty: (penalty: string) => void;
}

export function CubeTimer({ solveIndex, solveLabel, currentValue, onTimeRecorded, onPenalty }: Props) {
  const [state, setState] = useState<TimerState>('idle');
  const [time, setTime] = useState(0);
  const [inspection, setInspection] = useState(15);
  const [inspectionActive, setInspectionActive] = useState(false);
  const [penalty, setPenalty] = useState<string>('');

  const startRef = useRef(0);
  const rafRef = useRef(0);
  const inspectionRef = useRef(0);
  const inspectionStartRef = useRef(0);
  const spaceDownRef = useRef(false);
  const stateRef = useRef<TimerState>('idle');

  // Keep ref in sync
  useEffect(() => { stateRef.current = state; }, [state]);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(inspectionRef.current);
    setState('idle');
    setTime(0);
    setInspection(15);
    setInspectionActive(false);
    setPenalty('');
  }, []);

  // Keyboard handling
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
      const st = stateRef.current;

      if (st === 'idle') {
        // Start arming
        setState('arming');
        startRef.current = Date.now();
      } else if (st === 'running') {
        // Stop
        const elapsed = Date.now() - startRef.current;
        setTime(elapsed);
        setState('stopped');
        onTimeRecorded(elapsed);
      } else if (st === 'stopped') {
        // Reset
        reset();
        onTimeRecorded(0);
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      const st = stateRef.current;

      if (st === 'arming') {
        const held = Date.now() - startRef.current;
        if (held >= 300) {
          // Armed long enough → ready state with inspection
          setInspectionActive(true);
          setInspection(15);
          inspectionStartRef.current = Date.now();
          setState('ready');
        } else {
          // Too short, go back to idle
          setState('idle');
        }
      } else if (st === 'ready' && inspectionActive) {
        // Start solving after inspection
        setInspectionActive(false);
        startRef.current = Date.now();
        setState('running');
      } else if (st === 'ready' && !inspectionActive) {
        // Shouldn't happen, but reset
        setState('idle');
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [reset, onTimeRecorded]);

  // Timer animation loop
  useEffect(() => {
    if (state === 'running') {
      const tick = () => {
        setTime(Date.now() - startRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
  }, [state]);

  // Inspection countdown
  useEffect(() => {
    if (inspectionActive && state === 'ready') {
      const tick = () => {
        const elapsed = Date.now() - inspectionStartRef.current;
        const remaining = Math.max(0, 15 - elapsed / 1000);
        setInspection(remaining);
        if (remaining <= 0) {
          setInspectionActive(false);
          // Auto-start if inspection expires
          startRef.current = Date.now();
          setState('running');
          return;
        }
        inspectionRef.current = requestAnimationFrame(tick);
      };
      inspectionRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(inspectionRef.current);
    }
  }, [inspectionActive, state]);

  // Mouse/touch interaction for mobile
  const handlePointerDown = () => {
    const st = stateRef.current;
    if (st === 'idle') {
      setState('arming');
      startRef.current = Date.now();
    } else if (st === 'running') {
      const elapsed = Date.now() - startRef.current;
      setTime(elapsed);
      setState('stopped');
      onTimeRecorded(elapsed);
    } else if (st === 'stopped') {
      reset();
      onTimeRecorded(0);
    }
  };

  const handlePointerUp = () => {
    const st = stateRef.current;
    if (st === 'arming') {
      const held = Date.now() - startRef.current;
      if (held >= 300) {
        setInspectionActive(true);
        setInspection(15);
        inspectionStartRef.current = Date.now();
        setState('ready');
      } else {
        setState('idle');
      }
    } else if (st === 'ready' && inspectionActive) {
      setInspectionActive(false);
      startRef.current = Date.now();
      setState('running');
    }
  };

  const formatDisplay = (ms: number) => {
    const seconds = ms / 1000;
    if (seconds < 10) return seconds.toFixed(2);
    if (seconds < 60) return seconds.toFixed(2);
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  };

  const getTimerColor = () => {
    if (state === 'arming') return 'text-cube-yellow';
    if (state === 'ready') {
      if (inspection <= 5) return 'text-destructive';
      if (inspection <= 10) return 'text-cube-orange';
      return 'text-cube-green';
    }
    if (state === 'running') return 'text-cube-blue';
    if (state === 'stopped') return 'text-foreground';
    return 'text-text-tertiary';
  };

  const getTimerBg = () => {
    if (state === 'stopped') return 'bg-surface-hover/50';
    if (state === 'ready') return 'bg-cube-green/5';
    return 'bg-surface-hover/10';
  };

  const handlePenaltySet = (p: string) => {
    setPenalty(p);
    onPenalty(p);
  };

  return (
    <div className="space-y-3">
      {/* Timer display */}
      <div
        className={`relative cursor-pointer select-none rounded-xl border-2 transition-all duration-200 ${getTimerBg()} ${
          state === 'stopped' ? 'border-border/50' :
          state === 'ready' ? 'border-cube-green/30' :
          state === 'running' ? 'border-cube-blue/30' :
          'border-border/20'
        }`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { if (stateRef.current === 'arming') setState('idle'); }}
      >
        {inspectionActive && (
          <div className="absolute top-3 left-0 right-0 text-center">
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary/50">Inspection</span>
          </div>
        )}
        <div className={`flex flex-col items-center justify-center py-8 sm:py-12 ${getTimerColor()}`}>
          {inspectionActive ? (
            <span className={`font-mono text-6xl sm:text-8xl font-bold tabular-nums tracking-tighter ${inspection <= 5 ? 'animate-pulse' : ''}`}>
              {Math.ceil(inspection)}
            </span>
          ) : (
            <span className={`font-mono text-6xl sm:text-8xl font-bold tabular-nums tracking-tighter ${state === 'running' ? 'animate-none' : ''}`}>
              {state === 'idle' ? `${solveLabel}` :
               state === 'arming' ? '...' :
               formatDisplay(time)}
            </span>
          )}
        </div>
        <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2">
          {state === 'idle' && (
            <span className="text-xs text-text-tertiary/40">Hold spacebar or tap to arm</span>
          )}
          {state === 'stopped' && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-xs gap-1">
                <RotateCcw className="h-3 w-3" /> Retry
              </Button>
              <Button
                variant={penalty === '+2' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => handlePenaltySet(penalty === '+2' ? '' : '+2')}
                className={`h-7 text-xs gap-1 ${penalty === '+2' ? 'bg-cube-orange hover:bg-cube-orange/90' : 'text-cube-orange'}`}
              >
                <AlertTriangle className="h-3 w-3" /> +2
              </Button>
              <Button
                variant={penalty === 'DNF' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => handlePenaltySet(penalty === 'DNF' ? '' : 'DNF')}
                className={`h-7 text-xs gap-1 ${penalty === 'DNF' ? 'bg-destructive hover:bg-destructive/90' : 'text-destructive'}`}
              >
                <Ban className="h-3 w-3" /> DNF
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Solve info */}
      <div className="flex items-center justify-between text-xs text-text-secondary px-1">
        <span>Spacebar: hold to arm, release for inspection, tap to stop</span>
        {state === 'stopped' && (
          <span className="font-mono text-text-primary">{formatDisplay(time)}</span>
        )}
      </div>
    </div>
  );
}
