'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { calculateResult, formatTime, getEventByKey } from '@/lib/wca-events';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { Solve } from '@/types/database';
import { CuboidIcon as CubeIcon, Medal, Award, Trophy } from 'lucide-react';

interface Props {
  roundId: string;
  eventKey: string;
  format: 'average' | 'mean';
  solveCount: number;
}

type SolveRow = {
  competitor_id: string;
  username: string;
  display_name: string | null;
  solves: (number | null)[];
};

const TOP_BADGES = [
  { icon: 'trophy', className: 'text-cube-yellow bg-cube-yellow/10 border-cube-yellow/20', label: '1st' },
  { icon: 'medal', className: 'text-muted-foreground bg-muted/50 border-border', label: '2nd' },
  { icon: 'award', className: 'text-cube-orange bg-cube-orange/10 border-cube-orange/20', label: '3rd' },
];

export function RoundLeaderboard({ roundId, eventKey, format, solveCount }: Props) {
  const [solves, setSolves] = useState<SolveRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSolves = async () => {
      const supabase = createClient();

      const { data: solvesData } = await supabase
        .from('solves')
        .select('*, competitor:competitor_id (*, user:user_id (id, username, display_name))')
        .eq('round_id', roundId)
        .order('competitor_id')
        .order('solve_number');

      if (!solvesData) { setLoading(false); return; }

      const grouped = new Map<string, (number | null)[]>();
      const meta = new Map<string, { username: string; display_name: string | null }>();

      for (const solve of solvesData as any[]) {
        const cId = solve.competitor_id;
        if (!meta.has(cId)) {
          meta.set(cId, {
            username: solve.competitor?.user?.username ?? 'Unknown',
            display_name: solve.competitor?.user?.display_name ?? null,
          });
        }
        if (!grouped.has(cId)) grouped.set(cId, []);
        const time = solve.penalty === 'DNF' ? null
          : solve.penalty === '+2' && solve.time_ms !== null ? solve.time_ms + 2000
          : solve.penalty === 'DNS' ? null
          : solve.time_ms;
        grouped.get(cId)!.push(time);
      }

      const rows: SolveRow[] = [];
      for (const [cId, solves] of grouped) {
        const m = meta.get(cId)!;
        rows.push({ competitor_id: cId, username: m.username, display_name: m.display_name, solves });
      }

      rows.sort((a, b) => {
        const resA = calculateResult(a.solves, format);
        const resB = calculateResult(b.solves, format);
        if (resA === 'DNF' && resB === 'DNF') return 0;
        if (resA === 'DNF') return 1;
        if (resB === 'DNF') return -1;
        if (resA === null) return 1;
        if (resB === null) return -1;
        return (resA as number) - (resB as number);
      });

      setSolves(rows);
      setLoading(false);
    };

    fetchSolves();
  }, [roundId]);

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <div className="animate-pulse text-center">
        <CubeIcon className="mx-auto h-6 w-6 text-muted-foreground/40" />
        <p className="mt-2 text-xs text-muted-foreground">Loading leaderboard...</p>
      </div>
    </div>
  );

  if (solves.length === 0) return (
    <div className="flex flex-col items-center gap-2 py-8">
      <CubeIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No times submitted yet.</p>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 text-xs uppercase tracking-wider text-muted-foreground">#</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Competitor</TableHead>
            {Array.from({ length: solveCount }, (_, i) => (
              <TableHead key={i} className="text-center text-xs uppercase tracking-wider text-muted-foreground w-16">
                S{i + 1}
              </TableHead>
            ))}
            <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {solves.map((row, idx) => {
            const result = calculateResult(row.solves, format);
            return (
              <TableRow key={row.competitor_id} className={idx < 3 ? 'bg-muted/20' : ''}>
                <TableCell className="font-mono text-sm font-bold">
                  {idx < 3 ? (
                    <span className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs ${TOP_BADGES[idx].className}`}>
                      {idx === 0 ? <Trophy className="mr-1 h-3 w-3" /> : idx === 1 ? <Medal className="mr-1 h-3 w-3" /> : <Award className="mr-1 h-3 w-3" />}
                      {TOP_BADGES[idx].label}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{idx + 1}</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  {row.display_name || row.username}
                </TableCell>
                {Array.from({ length: solveCount }, (_, i) => (
                  <TableCell key={i} className="text-center font-mono text-xs">
                    {i < row.solves.length ? (
                      <span className={row.solves[i] === null ? 'text-destructive' : ''}>
                        {formatTime(row.solves[i])}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-sm font-bold">
                  {result === null ? (
                    <span className="text-muted-foreground/40">—</span>
                  ) : result === 'DNF' ? (
                    <span className="text-destructive">DNF</span>
                  ) : (
                    formatTime(result)
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
