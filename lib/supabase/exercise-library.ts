import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExerciseLibraryItem, MuscleGroup } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès à la banque d'exercices Supabase (table `exercise_library`,
 * déjà créée en base mais jamais branchée à l'app avant ce chantier — voir
 * lib/supabase/programs.ts, dont le commentaire documentait ce report).
 *
 * Même principe que les autres fichiers lib/supabase/* : toute lecture
 * renvoie un résultat "vide" (jamais d'exception) aussi bien quand Supabase
 * n'a réellement aucune donnée qu'en cas d'erreur — warning dev uniquement,
 * pour préserver le repli mock côté appelant.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type ExerciseLibraryRow = Database["public"]["Tables"]["exercise_library"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function asMuscleGroup(value: string | null | undefined): MuscleGroup {
  return (value?.trim() || "autre") as MuscleGroup;
}

function asMuscleGroupList(value: unknown): MuscleGroup[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) as MuscleGroup[];
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function mapExerciseLibraryRow(row: ExerciseLibraryRow): ExerciseLibraryItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    muscleGroup: asMuscleGroup(row.muscle_group),
    secondaryMuscles: asMuscleGroupList(row.secondary_muscles),
    category: (row.category?.trim() || "Technique") as ExerciseLibraryItem["category"],
    exerciseType: (row.exercise_type?.trim() || row.category?.trim() || "Technique") as ExerciseLibraryItem["exerciseType"],
    equipment: (row.equipment?.trim() || "Aucun") as ExerciseLibraryItem["equipment"],
    level: (row.level?.trim() || "débutant") as ExerciseLibraryItem["level"],
    videoUrl: row.video_url ?? "",
    alternativeVideoUrl: row.alternative_video_url ?? "",
    technicalNote: row.technical_cues ?? "",
    commonMistakes: row.common_mistakes ?? "",
    coachInstructions: row.notes ?? "",
    defaultTempo: row.default_tempo ?? "",
    defaultRestSeconds: row.default_rest_seconds ?? null,
    tags: asStringList(row.tags),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Tous les exercices de la banque (actifs et archivés) — pour /admin/exercices et l'onglet "Banque d'exercices". */
export async function getExerciseLibrary(supabase: TypedSupabaseClient): Promise<ExerciseLibraryItem[]> {
  const { data, error } = await supabase.from("exercise_library").select("*").order("name", { ascending: true });
  devWarn("getExerciseLibrary", error);
  return (data ?? []).map(mapExerciseLibraryRow);
}

type ExerciseLibraryWritableFields = Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">;

function toInsertFields(data: ExerciseLibraryWritableFields): Database["public"]["Tables"]["exercise_library"]["Insert"] {
  return {
    name: data.name,
    description: data.description,
    muscle_group: data.muscleGroup,
    secondary_muscles: data.secondaryMuscles,
    category: data.category,
    exercise_type: data.exerciseType,
    equipment: data.equipment,
    level: data.level,
    video_url: data.videoUrl,
    alternative_video_url: data.alternativeVideoUrl,
    technical_cues: data.technicalNote,
    common_mistakes: data.commonMistakes,
    notes: data.coachInstructions,
    default_tempo: data.defaultTempo,
    default_rest_seconds: data.defaultRestSeconds,
    tags: data.tags,
    status: data.status,
  };
}

/** Crée un exercice de banque réel. Retourne l'id créé, ou null en cas d'échec (RLS, réseau...). */
export async function createExerciseLibraryItem(
  supabase: TypedSupabaseClient,
  data: ExerciseLibraryWritableFields,
): Promise<string | null> {
  const fields = toInsertFields(data);
  const { data: row, error } = await supabase.from("exercise_library").insert(fields).select("id").single();
  devWarn("createExerciseLibraryItem", error);
  return row?.id ?? null;
}

const PARTIAL_FIELD_MAP: {
  [K in keyof Partial<ExerciseLibraryWritableFields>]: (
    value: NonNullable<ExerciseLibraryWritableFields[K]>,
  ) => Partial<Database["public"]["Tables"]["exercise_library"]["Update"]>;
} = {
  name: (v) => ({ name: v as string }),
  description: (v) => ({ description: v as string }),
  muscleGroup: (v) => ({ muscle_group: v as string }),
  secondaryMuscles: (v) => ({ secondary_muscles: v as string[] }),
  category: (v) => ({ category: v as string }),
  exerciseType: (v) => ({ exercise_type: v as string }),
  equipment: (v) => ({ equipment: v as string }),
  level: (v) => ({ level: v as string }),
  videoUrl: (v) => ({ video_url: v as string }),
  alternativeVideoUrl: (v) => ({ alternative_video_url: v as string }),
  technicalNote: (v) => ({ technical_cues: v as string }),
  commonMistakes: (v) => ({ common_mistakes: v as string }),
  coachInstructions: (v) => ({ notes: v as string }),
  defaultTempo: (v) => ({ default_tempo: v as string }),
  defaultRestSeconds: (v) => ({ default_rest_seconds: v as number | null }),
  tags: (v) => ({ tags: v as string[] }),
  status: (v) => ({ status: v as "active" | "archived" }),
};

/** Met à jour un exercice existant (édition partielle) — n'affecte que les champs fournis, jamais les workout_exercises déjà créés depuis cet exercice (copiés par valeur). */
export async function updateExerciseLibraryItem(
  supabase: TypedSupabaseClient,
  id: string,
  partial: Partial<ExerciseLibraryWritableFields>,
): Promise<boolean> {
  let update: Database["public"]["Tables"]["exercise_library"]["Update"] = {};
  for (const key of Object.keys(partial) as (keyof ExerciseLibraryWritableFields)[]) {
    const value = partial[key];
    if (value === undefined) continue;
    const mapper = PARTIAL_FIELD_MAP[key];
    if (!mapper) continue;
    update = { ...update, ...mapper(value as never) };
  }
  update.updated_at = new Date().toISOString();

  const { error } = await supabase.from("exercise_library").update(update).eq("id", id);
  devWarn("updateExerciseLibraryItem", error);
  return !error;
}

/**
 * Supprime définitivement un exercice de la banque (jamais un archivage).
 * `workout_exercises.exercise_library_id` passe à null (ON DELETE SET
 * NULL) : les séances déjà construites depuis cet exercice conservent
 * intégralement leur contenu, copié par valeur à l'ajout — seul le lien
 * vers la fiche de banque source disparaît.
 */
export async function deleteExerciseLibraryItem(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("exercise_library").delete().eq("id", id);
  devWarn("deleteExerciseLibraryItem", error);
  return !error;
}

/** Archive/désarchive un exercice — jamais de suppression réelle (préserve l'historique des programmes qui le référencent). */
export async function setExerciseLibraryStatus(
  supabase: TypedSupabaseClient,
  id: string,
  status: "active" | "archived",
): Promise<boolean> {
  const { error } = await supabase
    .from("exercise_library")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  devWarn("setExerciseLibraryStatus", error);
  return !error;
}
