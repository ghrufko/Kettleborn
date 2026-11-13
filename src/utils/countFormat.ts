/** "1 day", "2 days", "0 days" — a count with its noun agreeing. */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
