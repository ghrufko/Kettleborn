const TITLES_BY_LEVEL: [minLevel: number, title: string][] = [
  [1, 'Novice Hunter'],
  [5, 'Hunter'],
  [10, 'Veteran'],
  [20, 'Slayer'],
  [35, 'Champion'],
  [50, 'Legend'],
];

export function getHunterTitle(level: number): string {
  let title = TITLES_BY_LEVEL[0][1];
  for (const [minLevel, levelTitle] of TITLES_BY_LEVEL) {
    if (level >= minLevel) {
      title = levelTitle;
    }
  }
  return title;
}
