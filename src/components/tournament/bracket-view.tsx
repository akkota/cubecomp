'use client';

import { useMemo } from 'react';
import type { BracketMatchDef } from '@/lib/tournament/bracket-engine';

interface BracketViewProps {
  matches: any[];
  participants: any[];
  tournamentType: 'single' | 'double';
  onMatchClick?: (match: any) => void;
}

export function BracketView({ matches, participants, tournamentType, onMatchClick }: BracketViewProps) {
  const grouped = useMemo(() => {
    const wb = matches.filter(m => m.bracket_type === 'winners');
    const lb = matches.filter(m => m.bracket_type === 'losers');
    const finals = matches.filter(m =>
      m.bracket_type === 'grand_final' || m.bracket_type === 'reset_final'
    );

    // Group by round
    const groupByRound = (ms: any[]) => {
      const rounds: Record<number, any[]> = {};
      for (const m of ms) {
        if (!rounds[m.bracket_round]) rounds[m.bracket_round] = [];
        rounds[m.bracket_round].push(m);
      }
      return Object.entries(rounds)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([r, ms]) => ({ round: Number(r), matches: ms as any[] }));
    };

    return {
      winners: groupByRound(wb),
      losers: groupByRound(lb),
      finals: finals,
    };
  }, [matches]);

  const getParticipantName = (id: string | null) => {
    if (!id) return '—';
    const p = participants.find(p => p.id === id);
    return p?.display_name_snapshot ?? 'Unknown';
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-6 min-w-[600px]">
        {/* Winners Bracket */}
        <div className="flex gap-4">
          {grouped.winners.map(({ round, matches: ms }) => (
            <div key={`wb-r${round}`} className="flex flex-col gap-3 min-w-[180px]">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary text-center mb-1">
                {round === grouped.winners.length ? 'WBF' : `WR${round}`}
              </div>
              {ms.map(m => (
                <BracketMatchCard
                  key={m.id}
                  match={m}
                  getParticipantName={getParticipantName}
                  onClick={() => onMatchClick?.(m)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Losers Bracket (double elim only) */}
        {tournamentType === 'double' && grouped.losers.length > 0 && (
          <div className="flex gap-4 border-l border-border pl-4">
            {grouped.losers.map(({ round, matches: ms }) => (
              <div key={`lb-r${round}`} className="flex flex-col gap-3 min-w-[180px]">
                <div className="text-xs font-semibold uppercase tracking-wider text-cube-orange text-center mb-1">
                  {round === grouped.losers.length ? 'LBF' : `LR${round}`}
                </div>
                {ms.map(m => (
                  <BracketMatchCard
                    key={m.id}
                    match={m}
                    getParticipantName={getParticipantName}
                    onClick={() => onMatchClick?.(m)}
                    variant="losers"
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Finals */}
        {grouped.finals.length > 0 && (
          <div className="flex gap-4 border-l border-border pl-4">
            {grouped.finals.map(m => (
              <div key={m.id} className="flex flex-col gap-1 min-w-[180px]">
                <div className="text-xs font-semibold uppercase tracking-wider text-cube-green text-center mb-1">
                  {m.bracket_type === 'reset_final' ? 'Reset' : 'Final'}
                </div>
                <BracketMatchCard
                  match={m}
                  getParticipantName={getParticipantName}
                  onClick={() => onMatchClick?.(m)}
                  variant="final"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Single Match Card ──────────────────────────────────────────────

interface BracketMatchCardProps {
  match: any;
  getParticipantName: (id: string | null) => string;
  onClick?: () => void;
  variant?: 'winners' | 'losers' | 'final';
}

function BracketMatchCard({ match, getParticipantName, onClick, variant = 'winners' }: BracketMatchCardProps) {
  const borderColor =
    variant === 'losers' ? 'border-cube-orange/30' :
    variant === 'final' ? 'border-cube-green/40' :
    'border-border';

  const statusColor =
    match.status === 'completed' ? 'border-cube-green/40' :
    match.status === 'active' ? 'border-cube-blue/40' :
    match.auto_advance ? 'border-border opacity-50' :
    'border-border';

  const setsDisplay = match.competitor1_sets_won > 0 || match.competitor2_sets_won > 0
    ? `${match.competitor1_sets_won}–${match.competitor2_sets_won}`
    : null;

  return (
    <div
      className={`rounded-lg border p-2.5 text-xs cursor-pointer transition-all duration-200
        hover:shadow-md hover:-translate-y-0.5 bg-surface ${borderColor} ${statusColor}`}
      onClick={onClick}
    >
      <div className="flex justify-between items-center gap-2 mb-1">
        <span className={`truncate font-medium flex-1 ${match.winner_id && match.winner_id === match.competitor1_id ? 'text-cube-green' : ''}`}>
          {match.competitor1_id ? getParticipantName(match.competitor1_id) : 'BYE'}
        </span>
        {!match.auto_advance && match.competitor1_id && match.competitor2_id && setsDisplay && (
          <span className="text-text-tertiary shrink-0 text-[10px]">{setsDisplay}</span>
        )}
      </div>
      <div className="flex justify-between items-center gap-2">
        <span className={`truncate font-medium flex-1 ${match.winner_id && match.winner_id === match.competitor2_id ? 'text-cube-green' : ''}`}>
          {match.competitor2_id ? getParticipantName(match.competitor2_id) : 'BYE'}
        </span>
      </div>
      {match.auto_advance && (
        <div className="text-[10px] text-text-tertiary mt-1 italic">Auto-advance</div>
      )}
    </div>
  );
}
