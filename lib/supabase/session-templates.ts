import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveSessionType } from "@/lib/training-blocks";
import { strengthExercisesFromBlocks } from "@/lib/training-block-editing";
import {
  cardioBlocksFromBlocks,
  isCanonicalTemplateContent,
  templateBlocksFromContent,
  toCanonicalTemplateContent,
} from "@/lib/session-template-content";
import type { AdminWorkoutSession, SessionTemplate, SessionType, TrainingBlock } from "@/types";
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
type SessionTemplateUpdate = Database["public"]["Tables"]["session_templates"]["Update"];

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

/**
 * Vue LEGACY du contenu (affichage uniquement). Pour un modèle canonique, elle
 * est DÉRIVÉE des blocs (exercices agrégés des blocs strength, cardio reconstruit
 * des blocs cardio) — jamais persistée. Pour un ancien modèle legacy, elle est
 * lue telle quelle.
 */
function toDisplayContent(raw: unknown, blocks: TrainingBlock[]): SessionTemplate["content"] {
  if (isCanonicalTemplateContent(raw)) {
    return {
      warmup: raw.metadata.warmup ?? "",
      coachNotes: raw.metadata.coachNotes ?? "",
      exercises: strengthExercisesFromBlocks(blocks),
      cardioBlocks: cardioBlocksFromBlocks(blocks),
    };
  }
  return asContent(raw);
}

function mapSessionTemplateRow(row: SessionTemplateRow): SessionTemplate {
  // Discrimination EXPLICITE legacy/canonique (jamais `blocks ?? legacy`).
  const blocks = templateBlocksFromContent(row.content);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    sessionType: (row.session_type ?? "strength") as SessionType,
    muscleGroup: row.muscle_group ?? "",
    durationMinutes: row.duration_minutes,
    content: toDisplayContent(row.content, blocks),
    blocks,
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
  // Enregistrement CANONIQUE (dernière passe Lot 4) : lecture EXCLUSIVE de
  // session.blocks[] — jamais exercises[]/cardioBlocks[]. Le session_type colonne
  // est DÉRIVÉ des blocs. Le contenu stocké porte blocks[] (format versionné).
  const blocks = session.blocks ?? [];
  const derivedType = deriveSessionType(blocks);
  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      name,
      description,
      session_type: derivedType === "rest" ? "strength" : derivedType,
      muscle_group: session.muscleGroup,
      duration_minutes: session.durationMinutes || null,
      content: toCanonicalTemplateContent({
        blocks,
        warmup: session.warmup,
        coachNotes: session.coachNotes,
        muscleGroup: session.muscleGroup,
        durationMinutes: session.durationMinutes,
        name,
      }),
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

/**
 * Met à jour les métadonnées d'un modèle (nom, description, type, groupe
 * musculaire, durée) — pas son contenu (exercices/cardio), qui reste
 * uniquement modifiable en le reconstruisant depuis le builder (voir
 * "Enregistrer comme modèle"). Utilisé par la page /admin/seances (V3
 * chantier module Programmation, étape 3).
 */
export async function updateSessionTemplateMeta(
  supabase: TypedSupabaseClient,
  id: string,
  partial: { name?: string; description?: string; sessionType?: SessionType; muscleGroup?: string; durationMinutes?: number | null },
): Promise<boolean> {
  const payload: SessionTemplateUpdate = {};
  if (partial.name !== undefined) payload.name = partial.name;
  if (partial.description !== undefined) payload.description = partial.description;
  if (partial.sessionType !== undefined) payload.session_type = partial.sessionType;
  if (partial.muscleGroup !== undefined) payload.muscle_group = partial.muscleGroup;
  if (partial.durationMinutes !== undefined) payload.duration_minutes = partial.durationMinutes;

  const { error } = await supabase.from("session_templates").update(payload).eq("id", id);
  devWarn("updateSessionTemplateMeta", error);
  return !error;
}

/** Duplique un modèle (nouveau nom, même contenu copié par valeur avec de nouveaux ids). */
export async function duplicateSessionTemplate(supabase: TypedSupabaseClient, template: SessionTemplate): Promise<string | null> {
  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      name: `${template.name} (copie)`,
      description: template.description,
      session_type: template.sessionType,
      muscle_group: template.muscleGroup,
      duration_minutes: template.durationMinutes,
      content: template.content,
    })
    .select("id")
    .single();
  devWarn("duplicateSessionTemplate", error);
  return data?.id ?? null;
}
