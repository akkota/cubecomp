'use client';

import { useMemo } from 'react';

interface BracketViewProps {
  matches: any[];
  participants: any[];
  tournamentType: 'single' | 'double';
  selectedMatchId?: string | null;
  onMatchClick?: (match: any) => void;
}

type RoundGroup = { round: number; matches: any[]; label: string };

const CARD_H = 94;
const GAP = 20;
const COL_W = 220;
const CONNECTOR_W = 28;

function roundLabel(round: number, totalRounds: number, kind: 'winners' | 'losers' | 'final') {
  if (kind === 'final') return round === 2 ? 'Reset Final' : 'Grand Final';
  if (kind === 'losers') {
    return round === totalRounds ? 'Losers Final' : `Losers R${round}`;
  }
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  const bracketSize = 2 ** (totalRounds - round + 1);
  return `Round of ${bracketSize}`;
}

function groupByRound(ms: any[]): { round: number; matches: any[] }[] {
  const rounds: Record<number, any[]> = {};
  for (const m of ms) {
    if (!rounds[m.bracket_round]) rounds[m.bracket_round] = [];
    rounds[m.bracket_round].push(m);
  }
  return Object.entries(rounds)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([r, list]) => ({
      round: Number(r),
      matches: [...list].sort((a, b) => a.match_number - b.match_number),
    }));
}

function spacingForRound(roundIndex: number) {
  const stride = 2 ** roundIndex;
  return {
    paddingTop: ((stride - 1) * (CARD_H + GAP)) / 2,
    gap: stride * (CARD_H + GAP) - CARD_H,
  };
}

export function BracketView({ matches, participants, tournamentType, selectedMatchId, onMatchClick }: BracketViewProps) {
  const { winners, losers, finals } = useMemo(() => {
    const wb = matches.filter(m => m.bracket_type === 'winners');
    const lb = matches.filter(m => m.bracket_type === 'losers');
    const fin = matches.filter(m =>
      m.bracket_type === 'grand_final' || m.bracket_type === 'reset_final',
    );
    return {
      winners: groupByRound(wb),
      losers: groupByRound(lb),
      finals: fin.sort((a, b) => a.match_number - b.match_number),
    };
  }, [matches]);

  const getParticipant = (id: string | null) => {
    if (!id) return null;
    return participants.find(p => p.id === id) ?? null;
  };

  const winnerRounds: RoundGroup[] = winners.map((r, i, arr) => ({
    ...r,
    label: roundLabel(r.round, arr.length, 'winners'),
  }));

  const loserRounds: RoundGroup[] = losers.map((r, i, arr) => ({
    ...r,
    label: roundLabel(r.round, arr.length, 'losers'),
  }));

  const finalRounds: RoundGroup[] = finals.length
    ? [{
        round: 1,
        matches: finals,
        label: finals.length > 1 ? 'Finals' : 'Grand Final',
      }]
    : [];

  if (matches.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Bracket not generated yet.
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      {/* Desktop tree */}
      <div className="hidden md:block space-y-10">
        <BracketTree
          title={tournamentType === 'double' ? 'Winners Bracket' : undefined}
          rounds={winnerRounds}
          getParticipant={getParticipant}
          selectedMatchId={selectedMatchId}
          onMatchClick={onMatchClick}
          accent="winners"
        />
        {tournamentType === 'double' && loserRounds.length > 0 && (
          <BracketTree
            title="Losers Bracket"
            rounds={loserRounds}
            getParticipant={getParticipant}
            selectedMatchId={selectedMatchId}
            onMatchClick={onMatchClick}
            accent="losers"
          />
        )}
        {finalRounds.length > 0 && (
          <BracketTree
            title={tournamentType === 'double' ? 'Grand Finals' : undefined}
            rounds={finalRounds}
            getParticipant={getParticipant}
            selectedMatchId={selectedMatchId}
            onMatchClick={onMatchClick}
            accent="final"
          />
        )}
      </div>

      {/* Mobile round-by-round list */}
      <div className="md:hidden space-y-6">
        <MobileRoundList
          sections={[
            ...(tournamentType === 'double'
              ? [{ title: 'Winners', rounds: winnerRounds }]
              : [{ title: null, rounds: winnerRounds }]),
            ...(tournamentType === 'double' && loserRounds.length
              ? [{ title: 'Losers', rounds: loserRounds }]
              : []),
            ...(finalRounds.length
              ? [{ title: tournamentType === 'double' ? 'Finals' : null, rounds: finalRounds }]
              : []),
          ]}
          getParticipant={getParticipant}
          selectedMatchId={selectedMatchId}
          onMatchClick={onMatchClick}
        />
      </div>
    </div>
  );
}

function BracketTree({
  title,
  rounds,
  getParticipant,
  selectedMatchId,
  onMatchClick,
  accent,
}: {
  title?: string;
  rounds: RoundGroup[];
  getParticipant: (id: string | null) => any;
  selectedMatchId?: string | null;
  onMatchClick?: (match: any) => void;
  accent: 'winners' | 'losers' | 'final';
}) {
  if (rounds.length === 0) return null;

  return (
    <div className="space-y-3">
      {title && (
        <h3 className={`text-xs font-semibold uppercase tracking-[0.14em] ${
          accent === 'losers' ? 'text-cube-orange' :
          accent === 'final' ? 'text-cube-green' :
          'text-muted-foreground'
        }`}>
          {title}
        </h3>
      )}
      <div className="overflow-x-auto pb-2">
        <div className="mx-auto flex w-max items-start justify-center px-2">
          {rounds.map((round, roundIndex) => {
            const { paddingTop, gap } = spacingForRound(roundIndex);
            const isLast = roundIndex === rounds.length - 1;
            return (
              <div key={`${accent}-r${round.round}`} className="flex items-stretch">
                <div className="flex flex-col" style={{ width: COL_W }}>
                  <div className="mb-3 h-5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {round.label}
                  </div>
                  <div className="flex flex-col" style={{ paddingTop, gap }}>
                    {round.matches.map(m => (
                      <div key={m.id} className="relative" style={{ height: CARD_H }}>
                        <MatchCard
                          match={m}
                          getParticipant={getParticipant}
                          selected={selectedMatchId === m.id}
                          onClick={onMatchClick ? () => onMatchClick(m) : undefined}
                          accent={accent}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                {!isLast && (
                  <div className="relative" style={{ width: CONNECTOR_W, marginTop: 20 + paddingTop }}>
                    {round.matches.map((m, i) => {
                      if (i % 2 === 1) return null;
                      const pairGap = gap;
                      const pairHeight = CARD_H + pairGap + CARD_H;
                      const top = (i / 2) * (pairHeight + gap);
                      return (
                        <div
                          key={`conn-${m.id}`}
                          className="absolute"
                          style={{ top, height: pairHeight, width: CONNECTOR_W }}
                        >
                          {/* Horizontal stubs from each match */}
                          <span className="absolute left-0 top-[47px] h-px w-1/2 bg-border" />
                          <span
                            className="absolute left-0 h-px w-1/2 bg-border"
                            style={{ top: CARD_H + pairGap + 47 }}
                          />
                          {/* Vertical join */}
                          <span
                            className="absolute left-1/2 w-px -translate-x-1/2 bg-border"
                            style={{ top: 47, height: CARD_H + pairGap }}
                          />
                          {/* Out to next round */}
                          <span
                            className="absolute left-1/2 top-1/2 h-px w-1/2 bg-border"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MobileRoundList({
  sections,
  getParticipant,
  selectedMatchId,
  onMatchClick,
}: {
  sections: { title: string | null; rounds: RoundGroup[] }[];
  getParticipant: (id: string | null) => any;
  selectedMatchId?: string | null;
  onMatchClick?: (match: any) => void;
}) {
  return (
    <div className="space-y-6">
      {sections.map((section, si) => (
        <div key={si} className="space-y-4">
          {section.title && (
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {section.title}
            </h3>
          )}
          {section.rounds.map(round => (
            <div key={`${si}-${round.round}`} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {round.label}
              </div>
              <div className="space-y-2">
                {round.matches.map(m => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    getParticipant={getParticipant}
                    selected={selectedMatchId === m.id}
                    onClick={onMatchClick ? () => onMatchClick(m) : undefined}
                    accent={
                      m.bracket_type === 'losers' ? 'losers' :
                      m.bracket_type === 'grand_final' || m.bracket_type === 'reset_final' ? 'final' :
                      'winners'
                    }
                    fullWidth
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MatchCard({
  match,
  getParticipant,
  onClick,
  accent,
  fullWidth,
  selected,
}: {
  match: any;
  getParticipant: (id: string | null) => any;
  onClick?: () => void;
  accent: 'winners' | 'losers' | 'final';
  fullWidth?: boolean;
  selected?: boolean;
}) {
  const p1 = getParticipant(match.competitor1_id);
  const p2 = getParticipant(match.competitor2_id);
  const isActive = match.status === 'active';
  const isCompleted = match.status === 'completed';
  const isBye = !!match.auto_advance;

  const shell =
    selected
      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
      : isActive
      ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/20'
      : isCompleted
        ? 'border-border bg-surface'
        : isBye
          ? 'border-border/60 bg-muted/30 opacity-70'
          : 'border-border bg-surface';

  const accentBar =
    accent === 'losers' ? 'bg-cube-orange/70' :
    accent === 'final' ? 'bg-cube-green/70' :
    isActive || selected ? 'bg-primary' : 'bg-border';

  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={`relative flex h-[94px] flex-col overflow-hidden rounded-lg border text-left transition-all duration-200 ${shell} ${
        fullWidth ? 'w-full' : 'w-[220px]'
      } ${onClick ? 'hover:border-primary/40 hover:bg-surface-hover cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex h-[18px] shrink-0 items-center justify-end gap-1 px-2">
        {isActive && (
          <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
            Live
          </span>
        )}
        {isBye && !isActive && (
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Bye
          </span>
        )}
      </div>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${accentBar}`} />
      <div className="flex min-h-0 flex-1 flex-col">
        <SlotRow
          name={p1?.display_name_snapshot}
          seed={p1?.seed}
          sets={match.competitor1_sets_won}
          isWinner={!!(isCompleted && match.competitor1_id && match.winner_id === match.competitor1_id)}
          isLoser={!!(isCompleted && match.competitor1_id && match.winner_id && match.winner_id !== match.competitor1_id)}
          emptyLabel={match.competitor1_id ? 'Unknown' : 'TBD'}
          showScore={!isBye && (match.competitor1_sets_won > 0 || match.competitor2_sets_won > 0 || isActive || isCompleted)}
        />
        <div className="mx-2 border-t border-border/60" />
        <SlotRow
          name={p2?.display_name_snapshot}
          seed={p2?.seed}
          sets={match.competitor2_sets_won}
          isWinner={!!(isCompleted && match.competitor2_id && match.winner_id === match.competitor2_id)}
          isLoser={!!(isCompleted && match.competitor2_id && match.winner_id && match.winner_id !== match.competitor2_id)}
          emptyLabel={match.competitor2_id ? 'Unknown' : 'TBD'}
          showScore={!isBye && (match.competitor1_sets_won > 0 || match.competitor2_sets_won > 0 || isActive || isCompleted)}
        />
      </div>
    </button>
  );
}

function SlotRow({
  name,
  seed,
  sets,
  isWinner,
  isLoser,
  emptyLabel,
  showScore,
}: {
  name?: string;
  seed?: number | null;
  sets: number;
  isWinner: boolean;
  isLoser: boolean;
  emptyLabel: string;
  showScore: boolean;
}) {
  return (
    <div className={`flex flex-1 items-center gap-2 px-3 ${isWinner ? 'bg-cube-green/10' : ''}`}>
      {seed != null ? (
        <span className="w-4 shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {seed}
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span
        className={`min-w-0 flex-1 truncate text-[13px] leading-tight ${
          isWinner
            ? 'font-semibold text-foreground'
            : isLoser
              ? 'text-muted-foreground line-through decoration-muted-foreground/50'
              : name
                ? 'font-medium text-foreground'
                : 'text-muted-foreground'
        }`}
      >
        {name || emptyLabel}
      </span>
      {showScore && (
        <span
          className={`w-4 shrink-0 text-right text-xs tabular-nums ${
            isWinner ? 'font-bold text-cube-green' : 'text-muted-foreground'
          }`}
        >
          {sets ?? 0}
        </span>
      )}
    </div>
  );
}
