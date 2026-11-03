import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStaffForStudent } from "@/lib/api/authz";
import { workoutFeedbackPayloadSchema } from "@/lib/api/schemas/workout-feedback";
import { parseJsonBody } from "@/lib/api/validate";
import { controlerContenuRetour } from "@/lib/api/workout-feedback-controles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveWorkoutFeedback } from "@/lib/supabase/workout-feedback";

export const dynamic = "force-dynamic";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MODE PRÉSENTIEL — ENREGISTREMENT D'UN RETOUR DE SÉANCE POUR UN ÉLÈVE
 * ════════════════════════════════════════════════════════════════════════════
 * La route sœur de `/api/student/workout-feedback`. Une seule différence, et
 * elle est entière : ici, l'élève visé est DÉCLARÉ par le client — et c'est
 * précisément pour cela que tout le reste de ce fichier existe.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE ROUTE À PART PLUTÔT QU'UN DRAPEAU SUR L'EXISTANTE
 * ════════════════════════════════════════════════════════════════════════════
 * La route élève porte une promesse tenue par son schéma `.strict()` : le
 * corps NE PEUT PAS transporter de `studentId`, et `corpsPourServeur()` le
 * retire avant l'envoi. Ajouter un mode « sauf si tu es coach » reviendrait à
 * créer, dans le chemin le plus sensible de l'application, une branche où la
 * clé interdite devient acceptée. Un jour, quelqu'un lirait le schéma strict
 * et en conclurait — à tort — que la clé est refusée partout.
 *
 * Deux routes, deux contrats lisibles séparément. Le CONTENU, lui, n'est pas
 * dupliqué : les deux appellent `controlerContenuRetour`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES GARANTIES, DANS L'ORDRE
 * ════════════════════════════════════════════════════════════════════════════
 *  1. `requireStaffForStudent(studentId, { entrainement, ecriture })` tranche
 *     AVANT tout. Un admin de cabinet passe ; un coach autonome ne passe que
 *     sur SES élèves (`students.coach_id`) ; un collaborateur ne passe que
 *     sur un élève qui lui est explicitement affecté ET avec la permission
 *     d'écriture en entraînement. L'exigence de catégorie n'est pas
 *     décorative : sans elle, `requireStaffForStudent` REFUSE tout
 *     collaborateur — c'est son comportement documenté.
 *  2. Le client Supabase reste celui de l'utilisateur : la RLS
 *     `workout_feedback_student_or_staff_insert` est le second rempart, et
 *     elle juge sur `student_ids_entrainement_ecriture()`. Aucun droit n'est
 *     ouvert par cette route — elle emprunte un droit qui existait déjà.
 *  3. Les contrôles de contenu sont les MÊMES que ceux de la route élève.
 *  4. Le snapshot du prescrit est construit par la base à partir des lignes
 *     réelles. Le coach ne peut pas réécrire ce qu'il avait programmé : le
 *     trigger ne lit même pas ce que l'appelant enverrait.
 *  5. La traçabilité est posée par le trigger, qui ne croit pas davantage le
 *     corps de la requête. Elle n'apparaît donc pas ici — et c'est exprès.
 */

/** ~256 Ko : très large pour une séance, bloque l'abus. Aligné sur la route élève. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Le corps de la route élève, PLUS l'élève visé — et rien d'autre.
 *
 * ⚠️ `.strict()` EST CONSERVÉ. Le schéma partagé refuse déjà toute clé
 * inconnue ; on l'étend d'exactement une clé. Un `.passthrough()` ici ferait
 * de cette route la faille que la route élève s'interdit.
 */
const corpsPresentielSchema = workoutFeedbackPayloadSchema.extend({
  studentId: z.string().uuid("Élève invalide."),
});

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corps de requête trop volumineux." }, { status: 413 });
  }

  // Le corps D'ABORD : sans `studentId`, il n'y a aucun droit à évaluer.
  const parsedBody = await parseJsonBody(request, corpsPresentielSchema);
  if (!parsedBody.success) return parsedBody.response;
  const { studentId, ...payload } = parsedBody.data;

  /*
   * ⚠️ L'AUTORISATION AVANT LE CLIENT SUPABASE, ET AVANT TOUTE LECTURE.
   * `requireStaffForStudent` fait autorité : il connaît les trois rôles de
   * staff et le modèle de permissions par catégorie posé par P13-B. On ne
   * rejoue sa logique nulle part — la rejouer, c'est la laisser diverger.
   */
  const autorisation = await requireStaffForStudent(studentId, {
    categorie: "entrainement",
    niveau: "ecriture",
  });
  if (!autorisation.ok) return autorisation.response;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // Contrôles de contenu — identiques à la route élève, par construction.
  const refus = await controlerContenuRetour(supabase, studentId, payload);
  if (refus) return refus;

  /*
   * Écriture par le MÊME chemin que l'élève. `saveWorkoutFeedback` ne sait pas
   * qui l'appelle, et n'a pas à le savoir : l'élève lui est imposé, le
   * snapshot est construit en base, la traçabilité est dérivée par le trigger.
   */
  const saved = await saveWorkoutFeedback(supabase, { ...payload, studentId });
  if (!saved) {
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
  return NextResponse.json({ feedback: saved });
}
