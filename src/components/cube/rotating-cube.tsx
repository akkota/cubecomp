'use client';

import dynamic from 'next/dynamic';

const CubeCanvas = dynamic(() => import('./cube-canvas'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center"
      style={{ width: 'min(480px, calc(100vw - 64px))', height: 'min(480px, calc(100vw - 64px))' }}
    >
      <svg className="h-24 w-24 animate-pulse text-cube-blue/20" viewBox="0 0 100 100" fill="none">
        <rect x="15" y="15" width="70" height="70" rx="8" stroke="currentColor" strokeWidth="1.5" />
        <rect x="19" y="19" width="22" height="22" rx="3" fill="currentColor" opacity="0.3" />
        <rect x="43" y="19" width="22" height="22" rx="3" fill="currentColor" opacity="0.2" />
        <rect x="19" y="43" width="22" height="22" rx="3" fill="currentColor" opacity="0.2" />
      </svg>
    </div>
  ),
});

export function RotatingCube({ className = '' }: { className?: string }) {
  return <CubeCanvas className={className} />;
}
