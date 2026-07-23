export type AdvancementResult = {
  success: boolean;
  error?: string;
  advanced?: number;
  total?: number;
  registered?: number;
  dnfCount?: number;
  roundNumber?: number;
  nextRoundNumber?: number;
  alreadyCalculated?: boolean;
};
