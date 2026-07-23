'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { UserPlus, Mail, Lock, User } from 'lucide-react';

export function SignupForm() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: `${window.location.origin}/callback` } });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success('Account created! Check your email for the verification link.');
    setLoading(false);
  };

  return (
    <Card className="w-full max-w-md border-border/30 shadow-md">
      <CardHeader className="pb-4 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cube-green/10">
          <UserPlus className="h-6 w-6 text-cube-green" />
        </div>
        <CardTitle className="text-xl">Create Account</CardTitle>
        <CardDescription>Join CubeComp and start competing</CardDescription>
      </CardHeader>
      <form onSubmit={handleSignup}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" /><Input id="username" placeholder="speedcuber123" value={username} onChange={e => setUsername(e.target.value)} className="pl-9 h-10" required /></div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" /><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-9 h-10" required /></div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" /><Input id="password" type="password" placeholder="Min. 6 characters" value={password} onChange={e => setPassword(e.target.value)} className="pl-9 h-10" required minLength={6} /></div>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-4 pt-2">
          <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Creating account…' : 'Create Account'}</Button>
          <p className="text-sm text-text-secondary">Already have an account? <a href="/login" className="font-medium text-cube-blue hover:underline">Log in</a></p>
        </CardFooter>
      </form>
    </Card>
  );
}
