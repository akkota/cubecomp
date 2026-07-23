'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { calculateResult, formatTime, getEventByKey } from '@/lib/wca-events';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Round, Solve, Competitor } from '@/types/database';

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

export function RoundLeaderboard({ roundId, eventKey, format, solveCount }: Props) {
  const [solves, setSolves] = useState<SolveRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSolves = async () => {
      const supabase = createClient();

      // Fetch teammates for these solves
      const { data: solvesData } = await supabase
        .from('solves')
        .select('*, competitor:competitor_id (*, user:user_id (id, username, display_name))')
        .eq('round_id', roundId)
        .order('competitor_id')
        .order('solve_number');

      if (!solvesData) { setLoading(false); return; }

      // Group solves by competitor
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
        rows.push({
          competitor_id: cId,
          username: m.username,
          display_name: m.display_name,
          solves,
        });
      }

      // Sort by result (best first)
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

  if (loading) return <p className="text-muted-foreground">Loading leaderboard...</p>;
  if (solves.length === 0) return <p className="text-muted-foreground">No times submitted yet.</p>;

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Competitor</TableHead>
            {Array.from({ length: solveCount }, (_, i) => (
              <TableHead key={i} className="text-center">S{i + 1}</TableHead>
            ))}
            <TableHead className="text-right font-bold">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {solves.map((row, idx) => {
            const result = calculateResult(row.solves, format);
            return (
              <TableRow key={row.competitor_id}>
                <TableCell className="font-bold">{idx + 1}</TableCell>
                <TableCell>
                  {row.display_name || row.username}
                  {idx < 3 && <Badge variant="secondary" className="ml-2">Top {idx + 1}</Badge>}
                </TableCell>
                {Array.from({ length: solveCount }, (_, i) => (
                  <TableCell key={i} className="text-center font-mono text-sm">
                    {i < row.solves.length ? formatTime(row.solves[i]) : '—'}
                  </TableCell>
                ))}
                <TableCell className="text-right font-bold font-mono">
                  {result === null ? '—' : formatTime(result)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
