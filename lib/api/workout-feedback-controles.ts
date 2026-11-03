import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CorpsWorkoutFeedback } from "@/lib/workout-feedback-payload";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LES CONTRÔLES DE CONTENU D'UN RETOUR DE SÉANCE — UNE SEULE FOIS
 * ════════════════════════════════════════════════════════════════════════════
 * Extraits mot pour mot de `app/api/student/workout-feedback/route.ts`, où ils
 * vivaient seuls tant qu'il n'existait qu'une voie d'écriture. Le mode
 * présentiel en ouvre une seconde — et deux copies de quatre règles de
 * sécurité, c'est la garantie qu'elles divergeront : on corrigerait un jour
 * l'une sans l'autre, et la voie oubliée deviendrait la porte d'entrée.
 *
 * ⚠️ CE MODULE NE DÉCIDE PAS QUI A LE DROIT D'ÉCRIRE. C'est la responsabilité
 * de chaque route : la route élève dérive l'identité de la session
 * authentifiée, la route présentielle la valide par `requireStaffForStudent`.
 * Ici, l'élève visé est reçu en argument, et on vérifie seulement que le
 * CONTENU du retour est cohérent avec lui.
 *
 * ⚠️ CES CONTRÔLES NE REMPLACENT PAS LES TRIGGERS. `enforce_exercise_feedback_substitution`
 * et `enforce_exercise_feedback_write` restent les derniers remparts, et ils
 * protègent aussi les appels PostgREST qui ne passent par aucune route. Mais
 * un refus de trigger arrive au MILIEU de l'écriture, exercice par exercice.
 * On tranche donc ici, avant la moindre ligne écrite, pour rendre un 400
 * explicite plutôt qu'un enregistrement partiel.
 */

/** Un refus prêt à rendre, ou `null` quand tout est conforme. */
export type RefusControle = NextResponse | null;

/**
 * La séance visée appartient-elle à un programme de CET élève ?
 *
 * Les deux formes légitimes : programme possédé (`owner_student_id`) ou
 * assigné (`assignments`). Sans `sessionId`, il n'y a rien à vérifier — un
 * retour libre n'est rattaché à aucune séance.
 */
export async function controlerSeanceDeLEleve(
  supabase: SupabaseClient,
  studentId: string,
  sessionId: string | null | undefined,
): Promise<RefusControle> {
  if (!sessionId) return null;

  const { data: sessionRow } = await supabase
    .from("workout_sessions")
    .select("id, program_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow) {
    return NextResponse.json({ error: "Séance introuvable." }, { status: 404 });
  }

  const [{ data: owned }, { data: assigned }] = await Promise.all([
    supabase
      .from("programs")
      .select("id")
      .eq("id", sessionRow.program_id)
      .eq("owner_student_id", studentId)
      .maybeSingle(),
    supabase
      .from("assignments")
      .select("id")
      .eq("student_id", studentId)
      .eq("content_type", "programme")
      .eq("content_id", sessionRow.program_id)
      .maybeSingle(),
  ]);
  if (!owned && !assigned) {
    return NextResponse.json(
      { error: "Cette séance n'est pas accessible à cet élève." },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Les remplacements d'exercice déclarés sont-ils légitimes ?
 *
 * La règle, identique à celle du trigger : l'exercice prescrit doit être
 * identifié, appartenir à CETTE séance, venir de la banque ; le remplaçant
 * doit être un AUTRE exercice, actif, de MÊME pattern de mouvement.
 */
export async function controlerRemplacements(
  supabase: SupabaseClient,
  payload: Pick<CorpsWorkoutFeedback, "exercises" | "sessionId">,
): Promise<RefusControle> {
  const remplacements = payload.exercises.filter((e) => e.substituteExerciseLibraryId);
  if (remplacements.length === 0) return null;

  if (!payload.sessionId) {
    return NextResponse.json(
      { error: "Un remplacement ne peut être déclaré que sur une séance réelle." },
      { status: 400 },
    );
  }
  const idsPrescrits = remplacements.map((e) => e.exerciseId);
  if (idsPrescrits.some((id) => !id)) {
    return NextResponse.json(
      { error: "Remplacement sans exercice prescrit identifié." },
      { status: 400 },
    );
  }

  // Les lignes prescrites, lues sous RLS et RESTREINTES à la séance visée :
  // un identifiant emprunté à une autre séance ne remonte tout simplement pas.
  const { data: lignesPrescrites } = await supabase
    .from("workout_exercises")
    .select("id, exercise_library_id")
    .eq("session_id", payload.sessionId)
    .in("id", idsPrescrits as string[]);
  const parExerciceId = new Map((lignesPrescrites ?? []).map((r) => [r.id, r.exercise_library_id]));

  const idsBanque = new Set<string>();
  for (const e of remplacements) {
    const source = parExerciceId.get(e.exerciseId as string);
    if (source === undefined) {
      return NextResponse.json(
        { error: "Cet exercice n'appartient pas à la séance." },
        { status: 400 },
      );
    }
    if (!source) {
      return NextResponse.json(
        { error: "Cet exercice n'a pas de fiche de banque : aucun remplacement possible." },
        { status: 400 },
      );
    }
    idsBanque.add(source);
    idsBanque.add(e.substituteExerciseLibraryId as string);
  }

  // Statuts et patterns, en UNE lecture pour toute la séance.
  const { data: fiches } = await supabase
    .from("exercise_library")
    .select("id, movement_pattern, status")
    .in("id", [...idsBanque]);
  const parFiche = new Map((fiches ?? []).map((r) => [r.id, r]));

  for (const e of remplacements) {
    const sourceId = parExerciceId.get(e.exerciseId as string) as string;
    const substitutId = e.substituteExerciseLibraryId as string;
    if (sourceId === substitutId) {
      return NextResponse.json(
        { error: "Le remplaçant est l'exercice prescrit lui-même." },
        { status: 400 },
      );
    }
    const source = parFiche.get(sourceId);
    const substitut = parFiche.get(substitutId);
    // `substitut` absent = fiche inexistante OU archivée : les deux se refusent pareil.
    if (!source || !substitut || substitut.status !== "active") {
      return NextResponse.json(
        { error: "Exercice de remplacement indisponible." },
        { status: 400 },
      );
    }
    if (!source.movement_pattern || source.movement_pattern !== substitut.movement_pattern) {
      return NextResponse.json(
        { error: "Ce remplaçant ne partage pas le pattern de mouvement de l'exercice prescrit." },
        { status: 400 },
      );
    }
  }
  return null;
}

/**
 * Les vidéos de technique désignent-elles le dossier de CET élève ?
 *
 * ⚠️ `studentId` VIENT TOUJOURS DU SERVEUR — dérivé de la session pour la
 * route élève, validé par `requireStaffForStudent` pour la route présentielle.
 * C'est ce qui rend ce contrôle non contournable : le schéma a validé la
 * FORME du chemin, il ne peut rien dire de son APPARTENANCE.
 */
export function controlerVideos(
  studentId: string,
  payload: Pick<CorpsWorkoutFeedback, "exercises">,
): RefusControle {
  const etrangere = payload.exercises.find(
    (e) => e.videoPath && e.videoPath.split("/")[0] !== studentId,
  );
  if (etrangere) {
    return NextResponse.json(
      { error: "Cette vidéo n'appartient pas à l'élève de ce retour." },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Les trois contrôles, dans l'ordre, au premier refus.
 *
 * Les routes appellent CECI plutôt que les trois fonctions : oublier un appel
 * serait précisément le défaut que l'extraction cherche à rendre impossible.
 */
export async function controlerContenuRetour(
  supabase: SupabaseClient,
  studentId: string,
  payload: CorpsWorkoutFeedback,
): Promise<RefusControle> {
  return (
    (await controlerSeanceDeLEleve(supabase, studentId, payload.sessionId)) ??
    (await controlerRemplacements(supabase, payload)) ??
    controlerVideos(studentId, payload)
  );
}
