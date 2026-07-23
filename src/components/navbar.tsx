'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { Menu, X } from 'lucide-react';

function CubeLogo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 3D cube icon */}
      <g transform="rotate(15 16 16)">
        {/* Top face */}
        <polygon points="16,2 30,10 16,18 2,10" fill="var(--cube-white)" stroke="currentColor" strokeWidth="0.8" />
        {/* Front right face */}
        <polygon points="30,10 30,24 16,32 16,18" fill="var(--cube-red)" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4" />
        {/* Front left face */}
        <polygon points="2,10 16,18 16,32 2,24" fill="var(--cube-blue)" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4" />
        {/* Grid lines on faces */}
        <line x1="8" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
        <line x1="16" y1="2" x2="16" y2="32" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
        <line x1="8" y1="17" x2="24" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
        <line x1="2" y1="10" x2="2" y2="24" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
        <line x1="30" y1="10" x2="30" y2="24" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
        <line x1="2" y1="17" x2="16" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
        <line x1="16" y1="17" x2="30" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
      </g>
    </svg>
  );
}

export function Navbar() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMobileOpen(false);
    router.push('/');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          onClick={() => setMobileOpen(false)}
        >
          <CubeLogo className="h-7 w-7 transition-transform duration-300 group-hover:scale-110" />
          <span className="text-lg font-bold tracking-tight">
            <span className="text-cube-blue">Cube</span>
            <span className="text-cube-red">Comp</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/"
            className={`text-sm font-medium transition-colors hover:text-foreground ${
              pathname === '/' ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            Competitions
          </Link>

          {!loading && user && (
            <Link
              href="/dashboard"
              className={`text-sm font-medium transition-colors hover:text-foreground ${
                pathname === '/dashboard' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              Dashboard
            </Link>
          )}

          {!loading && (
            user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="hidden lg:inline">{user.email}</span>
                  <span className="lg:hidden">Account</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm">Log In</Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm">Sign Up</Button>
                </Link>
              </div>
            )
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl">
          <div className="flex flex-col gap-1 px-4 py-4">
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
              onClick={() => setMobileOpen(false)}
            >
              Competitions
            </Link>
            {user && (
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                onClick={() => setMobileOpen(false)}
              >
                Dashboard
              </Link>
            )}
            {user ? (
              <>
                <div className="border-t border-border/40 my-2" />
                <span className="px-3 py-1 text-xs text-muted-foreground">{user.email}</span>
                <button
                  onClick={handleSignOut}
                  className="rounded-md px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <div className="border-t border-border/40 my-2" />
                <Link
                  href="/login"
                  className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                  onClick={() => setMobileOpen(false)}
                >
                  Log In
                </Link>
                <Link
                  href="/signup"
                  className="rounded-md px-3 py-2 text-sm font-medium text-cube-blue hover:bg-accent"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
