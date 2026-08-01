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

  // 5. Écriture : student_id imposé par le serveur, snapshot construit par la
  //    couche à partir des lignes réelles, immutabilité garantie en aval.
  const saved = await saveWorkoutFeedback(supabase, { ...payload, studentId: studentRow.id });
  if (!saved) {
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
  return NextResponse.json({ feedback: saved });
}
