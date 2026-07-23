'use client';

import dynamic from 'next/dynamic';

const CubeCanvas = dynamic(() => import('./cube-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center" style={{ minHeight: 280, minWidth: 280 }}>
      <svg className="h-40 w-40 animate-pulse text-cube-blue/20" viewBox="0 0 100 100">
        <rect x="10" y="10" width="60" height="60" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="15" y="15" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="37" y="15" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="15" y="37" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="37" y="37" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
        <line x1="70" y1="10" x2="85" y2="5" stroke="currentColor" strokeWidth="1.5" />
        <line x1="70" y1="70" x2="85" y2="65" stroke="currentColor" strokeWidth="1.5" />
        <rect x="70" y="5" width="20" height="60" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="90" y1="10" x2="90" y2="70" stroke="currentColor" strokeWidth="1.5" />
        <line x1="70" y1="25" x2="90" y2="25" stroke="currentColor" strokeWidth="1" />
        <line x1="70" y1="45" x2="90" y2="45" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  ),
});

export function RotatingCube({ className = '' }: { className?: string }) {
  return <CubeCanvas className={className} />;
}
