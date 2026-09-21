export interface Lore {
  monsterId: string;
  origin: string;
  story: string;
  /** Optional — Campaign I's canonical source has no "weakness" concept; only populated where content actually states one. */
  weakness?: string;
  quotes: string[];
  unlockText: string;
  victoryText: string;
  /** Sprint 22: Campaign I's canonical physical/mental demands list, shown verbatim from source. */
  demands?: string[];
  /** Sprint 22: the canonical training rule for this monster's trial, shown verbatim from source. */
  rule?: string;
  /** Sprint 22: the canonical hunter's-advice line, shown verbatim from source. */
  hunterAdvice?: string;
}
