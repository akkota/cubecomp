'use client';

import { useEffect, useRef } from 'react';

/**
 * A pure-CSS 3D Rubik's Cube that rotates smoothly with optional mouse
 * parallax. Respects prefers-reduced-motion — falls back to a static cube.
 */
export function RotatingCube({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Check reduced motion preference
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const px = (e.clientX - cx) / rect.width;  // -0.5 .. 0.5
      const py = (e.clientY - cy) / rect.height; // -0.5 .. 0.5
      const rotateX = py * 25;
      const rotateY = px * 35 - 20; // base rotation offset

      el.style.transform = `scale(var(--cube-scale, 1)) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  // Each face is a 3×3 grid of colored tiles (white, red, blue, green, yellow, orange)
  const faces = [
    { face: 'front',  bg: 'var(--cube-white)',  tiles: ['w','w','w','w','w','w','w','w','w'] },
    { face: 'right',  bg: 'var(--cube-red)',    tiles: ['r','r','r','r','r','r','r','r','r'] },
    { face: 'back',   bg: 'var(--cube-orange)',  tiles: ['o','o','o','o','o','o','o','o','o'] },
    { face: 'left',   bg: 'var(--cube-blue)',   tiles: ['b','b','b','b','b','b','b','b','b'] },
    { face: 'top',    bg: 'var(--cube-yellow)',  tiles: ['y','y','y','y','y','y','y','y','y'] },
    { face: 'bottom', bg: 'var(--cube-green)',   tiles: ['g','g','g','g','g','g','g','g','g'] },
  ] as const;

  const tileColor = (t: string) => {
    const map: Record<string, string> = {
      w: 'var(--cube-white)', r: 'var(--cube-red)', b: 'var(--cube-blue)',
      g: 'var(--cube-green)', y: 'var(--cube-yellow)', o: 'var(--cube-orange)',
    };
    return map[t] ?? t;
  };

  const faceTransforms: Record<string, string> = {
    front:  'translateZ(80px)',
    right:  'rotateY(90deg) translateZ(80px)',
    back:   'rotateY(180deg) translateZ(80px)',
    left:   'rotateY(-90deg) translateZ(80px)',
    top:    'rotateX(90deg) translateZ(80px)',
    bottom: 'rotateX(-90deg) translateZ(80px)',
  };

  return (
    <div className={`perspective-[600px] ${className}`}>
      <div
        ref={containerRef}
        id="cube-scene"
        className="relative mx-auto h-44 w-44 sm:h-56 sm:w-56 transform-gpu"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.15s ease-out',
          ['--cube-scale' as string]: '1',
        }}
      >
        {/* Auto-rotate wrapper */}
        <div
          className="absolute inset-0 animate-cube-spin"
          style={{
            transformStyle: 'preserve-3d',
            animationPlayState: 'running',
          }}
        >
          {faces.map(({ face, bg, tiles }) => (
            <div
              key={face}
              className="absolute inset-0 rounded-[12px]"
              style={{
                backgroundColor: bg,
                transform: faceTransforms[face],
                backfaceVisibility: 'hidden',
              }}
            >
              {/* 3×3 tile grid */}
              <div
                className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[2px] p-[4px]"
                style={{ borderRadius: '8px', overflow: 'hidden' }}
              >
                {tiles.map((t, i) => (
                  <div
                    key={i}
                    className="rounded-[3px]"
                    style={{
                      backgroundColor: tileColor(t),
                      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(0,0,0,0.25)',
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes cubeSpin {
          0%   { transform: rotateX(-18deg) rotateY(-35deg); }
          100% { transform: rotateX(-18deg) rotateY(325deg); }
        }
        .animate-cube-spin {
          animation: cubeSpin 30s linear infinite;
          transform-style: preserve-3d;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-cube-spin {
            animation: none;
            transform: rotateX(-18deg) rotateY(-35deg);
          }
        }
        .perspective-\\[600px\\] {
          perspective: 600px;
        }
      `}</style>
    </div>
  );
}
