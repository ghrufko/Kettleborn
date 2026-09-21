import { getDatabase } from './db';
import { StopwatchResult } from '../models';

interface StopwatchResultRow {
  id: string;
  user_id: string;
  completed_at: string;
  elapsed_seconds: number;
  lap_seconds_json: string | null;
  note: string | null;
}

function toStopwatchResult(row: StopwatchResultRow): StopwatchResult {
  return {
    id: row.id,
    completedAt: row.completed_at,
    elapsedSeconds: row.elapsed_seconds,
    laps: row.lap_seconds_json ? JSON.parse(row.lap_seconds_json) : [],
    note: row.note,
  };
}

export const StopwatchRepository = {
  async saveResult(userId: string, result: StopwatchResult): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO stopwatch_result
        (id, user_id, completed_at, elapsed_seconds, lap_seconds_json, note)
       VALUES (?, ?, ?, ?, ?, ?);`,
      result.id,
      userId,
      result.completedAt,
      result.elapsedSeconds,
      result.laps.length > 0 ? JSON.stringify(result.laps) : null,
      result.note
    );
  },

  /** Every Stopwatch result for this user, newest first — for the Chronicle "Stopwatch Sessions" section. */
  async getAllForUser(userId: string): Promise<StopwatchResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<StopwatchResultRow>(
      'SELECT * FROM stopwatch_result WHERE user_id = ? ORDER BY completed_at DESC;',
      userId
    );
    return rows.map(toStopwatchResult);
  },
};
