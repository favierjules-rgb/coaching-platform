import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityActorType, ActivityEvent, ActivityEventType } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès au centre d'activité Supabase (table `activity_events`,
 * chantier "supabase-activity-notifications"). Aucune table équivalente
 * n'existait avant ce chantier (voir docs/supabase-activity-notifications-model.md).
 *
 * `logActivityEvent` est appelée en best-effort à la fin de chaque fonction
 * d'écriture concernée (onboarding, poids, retour entraînement, suivi
 * nutrition, rendez-vous, assignation programme/nutrition/document, note
 * coach) — une erreur d'écriture du journal n'échoue jamais l'action
 * principale (même principe que devWarn partout ailleurs : avertissement
 * dev, jamais bloquant).
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type ActivityEventRow = Database["public"]["Tables"]["activity_events"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function mapActivityEventRow(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    studentId: row.student_id,
    actorType: row.actor_type,
    eventType: row.event_type as ActivityEventType,
    title: row.title,
    description: row.description ?? "",
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

export interface LogActivityEventInput {
  studentId: string | null;
  actorType: ActivityActorType;
  eventType: ActivityEventType;
  title: string;
  description?: string;
  /** Généralement { link: "/admin/eleves/<id>" } — voir buildStudentActivityLink. */
  metadata?: Record<string, unknown>;
}

/** Lien admin construit pour chaque évènement — pointe vers la fiche élève concernée (toujours disponible, contrairement à un lien profond par contenu). */
export function buildStudentActivityLink(studentId: string | null): Record<string, unknown> {
  return studentId ? { link: `/admin/eleves/${studentId}` } : {};
}

/** Insertion best-effort — ne lève jamais, ne bloque jamais l'action principale qui l'appelle. */
export async function logActivityEvent(supabase: TypedSupabaseClient, input: LogActivityEventInput): Promise<void> {
  const { error } = await supabase.from("activity_events").insert({
    student_id: input.studentId,
    actor_type: input.actorType,
    event_type: input.eventType,
    title: input.title,
    description: input.description ?? "",
    metadata: input.metadata ?? buildStudentActivityLink(input.studentId),
  });
  devWarn("logActivityEvent", error);
}

/** Centre d'activité admin — toutes les activités, plus récentes en premier. */
export async function getRecentActivityEvents(supabase: TypedSupabaseClient, limit = 200): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from("activity_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  devWarn("getRecentActivityEvents", error);
  return (data ?? []).map(mapActivityEventRow);
}

/** Historique récent d'un élève précis, pour /admin/eleves/[studentId]. */
export async function getActivityEventsForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
  limit = 30,
): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from("activity_events")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  devWarn("getActivityEventsForStudent", error);
  return (data ?? []).map(mapActivityEventRow);
}

export async function markActivityEventRead(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("activity_events").update({ is_read: true }).eq("id", id);
  devWarn("markActivityEventRead", error);
  return !error;
}
