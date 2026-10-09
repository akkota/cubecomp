'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LogIn, Mail, Lock } from 'lucide-react';

interface Props { redirectTo?: string; }

export function LoginForm({ redirectTo = '/dashboard' }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) { toast.error(error?.message || 'Sign in failed.'); setLoading(false); return; }
    toast.success('Welcome back!');
    window.location.href = redirectTo;
  };

  return (
    <Card className="w-full max-w-md shadow-md">
      <CardHeader className="pb-4 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cube-blue/10">
          <LogIn className="h-6 w-6 text-cube-blue" />
        </div>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your CubeComp account</CardDescription>
      </CardHeader>
      <form onSubmit={handleLogin}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" /><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-9 h-10" required /></div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" /><Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="pl-9 h-10" required /></div>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</Button>
          <p className="text-center text-sm text-text-secondary">Don&apos;t have an account? <a href="/signup" className="font-medium text-cube-blue hover:underline">Sign up</a></p>
        </CardContent>
      </form>
    </Card>
  );
}
