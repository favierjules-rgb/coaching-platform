import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { removeAllStudentCoachReplyVideos } from "@/lib/supabase/storage-coach-reply-videos";
import { removeAllStudentFeedbackVideos } from "@/lib/supabase/storage-feedback-videos";
import { PROGRESS_PHOTOS_BUCKET } from "@/lib/supabase/storage-progress-photos";
import type { Database } from "@/types/supabase";

/**
 * Suppression complète et définitive d'un élève ("profil et tout ce qui va
 * avec", demande explicite de Jules — bouton dans /admin/eleves/[studentId]).
 *
 * Cascade FK déjà en place sur `students.id` (voir supabase/schema.sql) :
 * supprimer la ligne `students` nettoie automatiquement student_profiles,
 * progress_photos, body_measurements, custom_measurements, payments,
 * payment_entries, programs (owner_student_id), nutrition_plans,
 * document_assignments, workout_feedback, exercise_feedback,
 * exercise_set_feedback, coach_notes, assignments, weight_entries,
 * nutrition_daily_logs, appointments, activity_events, billing_customers,
 * subscriptions, stripe_payments — tout ON DELETE CASCADE sauf
 * training_change_history (ON DELETE SET NULL, conservé à des fins
 * d'historique/audit, jamais réattribuable à un autre élève).
 *
 * Deux choses restent hors de portée d'un simple DELETE SQL, traitées ici
 * explicitement :
 * 1. Le compte `auth.users` lui-même (jamais touché par une cascade sur une
 *    table `public.*`) — supprimé via l'Admin API après la ligne `students`.
 * 2. Les fichiers Storage — un objet Storage n'est pas une ligne
 *    PostgreSQL, aucune cascade ne le supprime. TROIS buckets sont concernés,
 *    tous cloisonnés par `{studentId}/...` :
 *      • `progress-photos` (photos de progression) ;
 *      • `feedback-videos` (vidéos de technique, F4) — oublier ce dossier
 *        laisserait des vidéos d'un élève supprimé sur nos serveurs, ce qui
 *        n'est pas un défaut de ménage mais un manquement RGPD ;
 *      • `coach-reply-videos` (réponses vidéo du coach, F5) — même exigence,
 *        et il faut se méfier de l'intuition inverse : ce n'est pas parce que
 *        le COACH a filmé cette vidéo qu'elle ne concerne pas l'élève. Elle
 *        le nomme, commente sa technique, et vit dans SON dossier. Elle part
 *        avec lui.
 *    On efface TOUT le dossier, pas seulement les chemins encore référencés :
 *    un fichier déposé puis jamais rattaché à un retour est tout aussi
 *    personnel. Suppression best-effort avant le DELETE SQL (n'échoue jamais
 *    l'opération globale — mêmes garanties que deleteProgressPhotoFile).
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export type DeleteStudentResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "delete_error" | "storage_error" };

function devError(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}`);
  }
}

/** Best-effort : vide le dossier Storage `{studentId}/...` du bucket photos de progression. N'échoue jamais l'appelant. */
async function deleteStudentProgressPhotoFiles(supabase: TypedSupabaseClient, studentId: string): Promise<void> {
  const { data: files, error: listError } = await supabase.storage.from(PROGRESS_PHOTOS_BUCKET).list(studentId);
  devError("deleteStudentProgressPhotoFiles (list)", listError);
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${studentId}/${f.name}`);
  const { error: removeError } = await supabase.storage.from(PROGRESS_PHOTOS_BUCKET).remove(paths);
  devError("deleteStudentProgressPhotoFiles (remove)", removeError);
}

export async function deleteStudentCompletely(supabase: TypedSupabaseClient, studentId: string): Promise<DeleteStudentResult> {
  const { data: student, error: fetchError } = await supabase
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .maybeSingle();
  devError("deleteStudentCompletely (fetch)", fetchError);
  if (!student) {
    return { ok: false, error: "not_found" };
  }

  await deleteStudentProgressPhotoFiles(supabase, studentId);

  // Vidéos de technique (F4). Le dossier ENTIER, orphelins compris.
  //
  // ET ICI ON S'ARRÊTE EN CAS D'ÉCHEC. Les photos de progression restent
  // best-effort par héritage ; les vidéos, non. La raison n'est pas
  // esthétique : une fois la ligne `students` supprimée, plus rien ne relie
  // `feedback-videos/<student_id>/` à qui que ce soit — l'identifiant du
  // dossier ne désigne plus personne, et les fichiers deviennent
  // introuvables autrement qu'à la main. Un compte effacé qui laisse
  // derrière lui des vidéos privées d'un élève n'est pas une suppression
  // partielle, c'est une suppression ratée. On préfère refuser franchement
  // et laisser l'administrateur réessayer.
  const videos = await removeAllStudentFeedbackVideos(supabase, studentId);
  if (!videos.complet) {
    console.error(
      `[delete-student] Purge incomplète de feedback-videos/${studentId}/ (${videos.supprimes} objet(s) retiré(s)). ` +
        "L'élève n'a PAS été supprimé : réessayer, ou vider le dossier à la main avant de relancer.",
    );
    return { ok: false, error: "storage_error" };
  }

  // Réponses vidéo du coach (F5). Même règle, et pour la même raison : une
  // fois la ligne `students` supprimée, `coach-reply-videos/<student_id>/` ne
  // désigne plus personne.
  const reponses = await removeAllStudentCoachReplyVideos(supabase, studentId);
  if (!reponses.complet) {
    console.error(
      `[delete-student] Purge incomplète de coach-reply-videos/${studentId}/ (${reponses.supprimes} objet(s) retiré(s)). ` +
        "L'élève n'a PAS été supprimé : réessayer, ou vider le dossier à la main avant de relancer.",
    );
    return { ok: false, error: "storage_error" };
  }

  const { error: deleteError } = await supabase.from("students").delete().eq("id", studentId);
  devError("deleteStudentCompletely (delete students)", deleteError);
  if (deleteError) {
    return { ok: false, error: "delete_error" };
  }

  if (student.user_id) {
    const { error: authError } = await supabase.auth.admin.deleteUser(student.user_id);
    // Best-effort : la fiche élève est déjà supprimée à ce stade (l'essentiel
    // de la demande de Jules) — un échec ici laisse un compte auth orphelin
    // (sans fiche students), jamais bloquant, mais journalisé clairement
    // pour une intervention manuelle si besoin.
    if (authError) {
      console.error(`[coach-student-provisioning] Échec de suppression du compte auth ${student.user_id} : ${authError.message}. Fiche élève déjà supprimée — intervention manuelle possible.`);
    }
  }

  return { ok: true };
}
