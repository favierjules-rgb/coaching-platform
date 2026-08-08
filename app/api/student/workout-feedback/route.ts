import { NextResponse } from "next/server";

import { workoutFeedbackPayloadSchema } from "@/lib/api/schemas/workout-feedback";
import { parseJsonBody } from "@/lib/api/validate";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveWorkoutFeedback } from "@/lib/supabase/workout-feedback";

export const dynamic = "force-dynamic";

/**
 * Soumission d'un retour de séance — COUCHE SERVEUR authentifiée (contrôle
 * technique phase 1, feat/student-workout-history).
 *
 * Garanties, dans l'ordre :
 *  1. utilisateur authentifié (session Supabase côté serveur, cookies) ;
 *  2. `student_id` DÉRIVÉ de l'authentification — jamais lu du corps ;
 *  3. la séance visée doit être réellement accessible à cet élève (programme
 *     possédé via owner_student_id, ou assigné via assignments) ;
 *  4. le corps ne peut transporter QUE le réalisé (schéma strict ci-dessous) :
 *     ni prescribed_snapshot, ni student_id, ni session_status — toute clé
 *     inconnue est rejetée ;
 *  5. le snapshot du prescrit est construit par la couche d'écriture à partir
 *     des lignes lues en base (loadSessionRowsForSnapshot), posé à la première
 *     validation seulement, puis protégé par le trigger d'immutabilité.
 *
 * Le client Supabase utilisé est celui de l'utilisateur (RLS active) : la
 * politique workout_feedback_student_or_staff reste le dernier rempart.
 */

/**
 * Schéma STRICT partagé : lib/api/schemas/workout-feedback.ts — bornes
 * alignées sur le contrat cardio réel (correctif incident du 01/08/2026 :
 * `exerciseOrder = 900 + position` et enveloppe JSON dans `comment`,
 * émis par lib/cardio-feedback.ts::serializeCardioBlockResult, étaient
 * rejetés en 400). Testé contre le payload exact du composant dans
 * scripts/tests/student-workout-history.mts.
 */

/** ~256 Ko : très large pour une séance (60 exercices × 50 séries), bloque l'abus. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corps de requête trop volumineux." }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // 1-2. Identité : l'élève est celui de la session authentifiée, point.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const { data: studentRow } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!studentRow) {
    return NextResponse.json({ error: "Aucun profil élève." }, { status: 403 });
  }

  // 4. Corps strictement borné au réalisé (schéma .strict() : toute clé
  //    inconnue — prescribed_snapshot, studentId, sessionStatus… — = 400).
  const parsedBody = await parseJsonBody(request, workoutFeedbackPayloadSchema);
  if (!parsedBody.success) return parsedBody.response;
  const payload = parsedBody.data;

  // 3. La séance appartient-elle bien à un programme de CET élève ?
  //    (programme possédé, ou assigné — les deux formes légitimes.)
  if (payload.sessionId) {
    const { data: sessionRow } = await supabase
      .from("workout_sessions")
      .select("id, program_id")
      .eq("id", payload.sessionId)
      .maybeSingle();
    if (!sessionRow) {
      return NextResponse.json({ error: "Séance introuvable." }, { status: 404 });
    }
    const [{ data: owned }, { data: assigned }] = await Promise.all([
      supabase
        .from("programs")
        .select("id")
        .eq("id", sessionRow.program_id)
        .eq("owner_student_id", studentRow.id)
        .maybeSingle(),
      supabase
        .from("assignments")
        .select("id")
        .eq("student_id", studentRow.id)
        .eq("content_type", "programme")
        .eq("content_id", sessionRow.program_id)
        .maybeSingle(),
    ]);
    if (!owned && !assigned) {
      return NextResponse.json({ error: "Cette séance ne t'est pas accessible." }, { status: 403 });
    }
  }

  // 4-bis. REMPLACEMENTS D'EXERCICE — vérifiés ici ET en base.
  //
  //   Le trigger `enforce_exercise_feedback_substitution` est le dernier
  //   rempart : il refuserait de toute façon un remplacement illégitime, et
  //   il protège aussi les appels PostgREST directs qui ne passent jamais
  //   par cette route. Mais un refus au niveau du trigger arriverait en
  //   plein milieu de l'écriture, exercice par exercice. On répète donc la
  //   règle ICI, avant la moindre écriture, pour rendre un 400 explicite
  //   plutôt qu'un enregistrement partiel.
  //
  //   La règle, identique des deux côtés : l'exercice prescrit doit être
  //   identifié, appartenir à CETTE séance, venir de la banque ; le
  //   remplaçant doit être un AUTRE exercice, actif, de MÊME pattern.
  const remplacements = payload.exercises.filter((e) => e.substituteExerciseLibraryId);
  if (remplacements.length > 0) {
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
      // `substitut` absent = fiche inexistante OU archivée (la RLS élève ne
      // montre que les fiches actives) : les deux se refusent pareil.
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
  }

  // 5. Écriture : student_id imposé par le serveur, snapshot construit par la
  //    couche à partir des lignes réelles, immutabilité garantie en aval.
  const saved = await saveWorkoutFeedback(supabase, { ...payload, studentId: studentRow.id });
  if (!saved) {
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
  return NextResponse.json({ feedback: saved });
}
