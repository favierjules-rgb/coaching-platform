import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminWorkoutSession, SessionTemplate, SessionType } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès à la banque de séances Supabase (table `session_templates`,
 * V3 étape 4 — voir migration
 * supabase/migrations/20260716_training_v3_session_templates.sql). Même
 * principe que lib/supabase/exercise-library.ts : toute lecture renvoie un
 * résultat "vide" (jamais d'exception), warning dev uniquement en cas
 * d'erreur (RLS, réseau...).
 *
 * Le contenu (exercices + blocs cardio) est stocké tel quel en jsonb : ce
 * sont des snapshots copiés par valeur au moment de l'enregistrement du
 * modèle, puis à nouveau copiés par valeur (avec de nouveaux ids générés
 * côté client) au moment de l'application du modèle à une séance — jamais
 * de référence vivante entre un modèle et les séances construites depuis
 * lui.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type SessionTemplateRow = Database["public"]["Tables"]["session_templates"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

interface SessionTemplateContent {
  warmup: string;
  coachNotes: string;
  exercises: AdminWorkoutSession["exercises"];
  cardioBlocks: NonNullable<AdminWorkoutSession["cardioBlocks"]>;
}

function asContent(value: unknown): SessionTemplateContent {
  const raw = (value && typeof value === "object" ? (value as Record<string, unknown>) : {}) as Record<string, unknown>;
  return {
    warmup: typeof raw.warmup === "string" ? raw.warmup : "",
    coachNotes: typeof raw.coachNotes === "string" ? raw.coachNotes : "",
    exercises: Array.isArray(raw.exercises) ? (raw.exercises as SessionTemplateContent["exercises"]) : [],
    cardioBlocks: Array.isArray(raw.cardioBlocks) ? (raw.cardioBlocks as SessionTemplateContent["cardioBlocks"]) : [],
  };
}

function mapSessionTemplateRow(row: SessionTemplateRow): SessionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    sessionType: (row.session_type ?? "strength") as SessionType,
    muscleGroup: row.muscle_group ?? "",
    durationMinutes: row.duration_minutes,
    content: asContent(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Toute la banque de séances — pour le picker "Utiliser un modèle" dans le builder. */
export async function getSessionTemplates(supabase: TypedSupabaseClient): Promise<SessionTemplate[]> {
  const { data, error } = await supabase.from("session_templates").select("*").order("name", { ascending: true });
  devWarn("getSessionTemplates", error);
  return (data ?? []).map(mapSessionTemplateRow);
}

/** Enregistre la séance donnée (nom + description choisis par le coach) comme nouveau modèle réutilisable. */
export async function createSessionTemplate(
  supabase: TypedSupabaseClient,
  session: AdminWorkoutSession,
  name: string,
  description: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      name,
      description,
      session_type: session.sessionType ?? "strength",
      muscle_group: session.muscleGroup,
      duration_minutes: session.durationMinutes || null,
      content: {
        warmup: session.warmup,
        coachNotes: session.coachNotes,
        exercises: session.exercises,
        cardioBlocks: session.cardioBlocks ?? [],
      },
    })
    .select("id")
    .single();
  devWarn("createSessionTemplate", error);
  return data?.id ?? null;
}

/** Supprime un modèle de la banque — n'affecte jamais les séances déjà construites depuis lui (contenu copié par valeur). */
export async function deleteSessionTemplate(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("session_templates").delete().eq("id", id);
  devWarn("deleteSessionTemplate", error);
  return !error;
}
