'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ThemePicker } from '@/components/theme/theme-picker';
import { createClient } from '@/lib/supabase/client';
import { useCurrentProfile } from '@/hooks/use-current-profile';
import { publicHandle } from '@/lib/public-identity';
import { Menu, X } from 'lucide-react';

function CubeLogo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(15 16 16)">
        <polygon points="16,2 30,10 16,18 2,10" fill="var(--cube-white)" stroke="currentColor" strokeWidth="0.8"/>
        <polygon points="30,10 30,24 16,32 16,18" fill="var(--cube-red)" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4"/>
        <polygon points="2,10 16,18 16,32 2,24" fill="var(--cube-blue)" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4"/>
        <line x1="8" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
        <line x1="16" y1="2" x2="16" y2="32" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
        <line x1="8" y1="17" x2="24" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
        <line x1="2" y1="10" x2="2" y2="24" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
        <line x1="30" y1="10" x2="30" y2="24" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
        <line x1="2" y1="17" x2="16" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
        <line x1="16" y1="17" x2="30" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.6"/>
      </g>
    </svg>
  );
}

export function Navbar() {
  const { profile, isSignedIn, loading } = useCurrentProfile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const handleLabel = profile ? publicHandle(profile) : null;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setMobileOpen(false);
    router.push('/');
    router.refresh();
  };

  const linkClass = (p: string) =>
    `relative text-sm font-medium transition-colors duration-200 ${
      pathname === p
        ? 'text-foreground'
        : 'text-text-secondary hover:text-foreground'
    }`;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-navbar/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5 shrink-0" onClick={() => setMobileOpen(false)}>
          <CubeLogo className="h-7 w-7 transition-transform duration-300 group-hover:scale-110" />
          <span className="text-lg font-bold tracking-tight">
            <span className="text-cube-blue">Cube</span>
            <span className="text-cube-red">Comp</span>
          </span>
        </Link>

        {/* Desktop */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/competitions" className={linkClass('/competitions')}>
            Competitions
            {pathname === '/competitions' && <span className="absolute -bottom-[18px] left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-cube-blue" />}
          </Link>
          {!loading && isSignedIn && <Link href="/dashboard" className={linkClass('/dashboard')}>
            Dashboard
            {pathname === '/dashboard' && <span className="absolute -bottom-[18px] left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-cube-blue" />}
          </Link>}
          <ThemePicker />
          {!loading && (isSignedIn ? (
            <div className="flex items-center gap-3">
              <Link href="/profile">
                <span className="hidden lg:block rounded-full bg-surface-hover px-3 py-1 text-xs text-text-secondary hover:text-foreground transition-colors cursor-pointer">
                  {handleLabel ?? 'Profile'}
                </span>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-text-secondary">Sign Out</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login"><Button variant="ghost" size="sm">Log In</Button></Link>
              <Link href="/signup"><Button size="sm" className="shadow-sm">Sign Up</Button></Link>
            </div>
          ))}
        </nav>

        {/* Mobile toggle */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemePicker />
          <button className="p-2 text-text-secondary" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-navbar/98 backdrop-blur-xl p-4 space-y-1">
          <Link href="/competitions" className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-hover" onClick={() => setMobileOpen(false)}>Competitions</Link>
          {isSignedIn && <Link href="/dashboard" className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-hover" onClick={() => setMobileOpen(false)}>Dashboard</Link>}
          {isSignedIn && <Link href="/profile" className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-hover" onClick={() => setMobileOpen(false)}>Profile</Link>}
          {isSignedIn ? (
            <>
              <div className="border-t border-border my-2" />
              {handleLabel && (
                <span className="block px-3 py-1 text-xs text-text-secondary">{handleLabel}</span>
              )}
              <button onClick={handleSignOut} className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-destructive/10">Sign Out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-hover" onClick={() => setMobileOpen(false)}>Log In</Link>
              <Link href="/signup" className="block rounded-md px-3 py-2 text-sm font-medium text-cube-blue hover:bg-surface-hover" onClick={() => setMobileOpen(false)}>Sign Up</Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
