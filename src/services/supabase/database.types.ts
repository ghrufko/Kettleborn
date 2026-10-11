/**
 * Hand-derived from the actual SQL in supabase/migrations/ (not generated
 * via `supabase gen types` — no real project exists to generate from, see
 * supabase/VALIDATION_REPORT.md). Covers exactly the columns those four
 * migration files create. Regenerate this file (ideally via
 * `supabase gen types typescript`) once a real hosted project exists and
 * migrations have been applied to it — treat this as a reasonable
 * approximation until then, not a guaranteed match.
 */

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          total_xp: number;
          level: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
        };
        Update: {
          display_name?: string;
        };
        Relationships: [];
      };
      content_workouts: {
        Row: {
          workout_id: string;
          target_time_seconds: number;
          min_elapsed_seconds: number;
          gear_weight_kg: number;
          min_weight_kg: number;
          max_weight_kg: number;
          gear_count: number;
          rounds: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      content_hunts: {
        Row: {
          hunt_id: string;
          monster_id: string;
          workout_id: string;
          encounter_order: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workout_results: {
        Row: {
          id: string;
          user_id: string;
          monster_id: string;
          workout_id: string;
          hunt_id: string;
          canonical_weight_kg: number;
          weight_b_kg: number | null;
          gear_count: number;
          elapsed_seconds: number;
          rank: string;
          is_custom_hunt: boolean;
          app_version: string | null;
          content_version: string | null;
          client_result_id: string | null;
          completed_at: string;
        };
        Insert: {
          // user_id, monster_id, rank, completed_at are forced server-side
          // by workout_results_before_insert() regardless of what's sent —
          // included here as optional so a client submission can omit or
          // supply a placeholder without a type error, matching the SQL's
          // actual trust boundary (see that trigger's own comment).
          user_id?: string;
          monster_id?: string;
          workout_id: string;
          hunt_id: string;
          canonical_weight_kg: number;
          weight_b_kg?: number | null;
          gear_count: number;
          elapsed_seconds: number;
          rank?: string;
          is_custom_hunt?: boolean;
          app_version?: string | null;
          content_version?: string | null;
          client_result_id?: string | null;
        };
        // No UPDATE grant exists for `authenticated` on this table — see
        // 20250615120200_workout_results.sql. Immutable after insert.
        Update: never;
        Relationships: [];
      };
      leaderboard_entries: {
        Row: {
          user_id: string;
          workout_id: string;
          monster_id: string;
          best_result_id: string;
          elapsed_seconds: number;
          rank: string;
          achieved_at: string;
          updated_at: string;
        };
        // No INSERT/UPDATE/DELETE grant exists for `authenticated` at all
        // — the only path in is the sync_leaderboard_entry() trigger.
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
