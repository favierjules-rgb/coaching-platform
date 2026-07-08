const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Distingue un vrai id Supabase (uuid) d'un id mock (ex: "prog-1",
 * "session-upper") — utilisé pour savoir si un sessionId/programId reçu en
 * prop peut être envoyé tel quel dans une colonne uuid (session_id/
 * program_id de `workout_feedback`), sous peine d'erreur Postgres.
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
