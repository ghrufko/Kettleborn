export type HuntRank = 'S' | 'A' | 'B' | 'C';

export function getHuntRank(
  elapsedSeconds: number,
  targetTimeSeconds: number,
  isPersonalRecord: boolean
): HuntRank {
  if (isPersonalRecord || elapsedSeconds <= targetTimeSeconds * 0.85) {
    return 'S';
  }
  if (elapsedSeconds <= targetTimeSeconds) {
    return 'A';
  }
  if (elapsedSeconds <= targetTimeSeconds * 1.15) {
    return 'B';
  }
  return 'C';
}
