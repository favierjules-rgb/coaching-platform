import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getOnboardingCompleted } from "@/lib/supabase/onboarding";
import { getStudentAccessStatus } from "@/lib/supabase/student-access";
import type { Database } from "@/types/supabase";

/**
 * `access_type` de la fiche élève (chantier module Programmation, étape 6) —
 * "coaching" (défaut) ou "programme_seul" (compte auto-créé après achat/
 * réclamation d'un programme public, accès restreint à /entrainement
 * uniquement). Lecture minimale (une seule colonne), pas de dépendance vers
 * lib/supabase/students.ts pour éviter d'alourdir chaque guard.
 */
async function getStudentAccessType(
  supabase: SupabaseClient<Database>,
  studentId: string,
): Promise<"coaching" | "programme_seul"> {
  const { data } = await supabase.from("students").select("access_type").eq("id", studentId).maybeSingle();
  return data?.access_type ?? "coaching";
}

/**
 * Guards à appeler en tête d'un layout/page Server Component protégé. Tant
 * que Supabase n'est pas configuré, toutes les guards deviennent des
 * no-op — le mode mock actuel (accès libre) est préservé pendant la
 * transition, comme demandé.
 */

/** Élève connecté requis. Redirige vers /connexion si personne n'est connecté. */
export async function requireAuth(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  const user = await getCurrentUser();
  if (!user) {
    redirect("/connexion");
  }
}

/**
 * Espace admin : rôle admin ou coach requis. Un student authentifié est
 * redirigé vers /acces-refuse plutôt que /connexion (il est bien connecté,
 * juste pas autorisé ici) ; un compte sans profil (rôle inconnu) est
 * traité comme non autorisé, jamais laissé passer par défaut.
 */
export async function requireAdminOrCoach(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  await requireAuth();
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    redirect("/acces-refuse");
  }
}

/**
 * Espace élève : authentification requise, mais pas de restriction stricte
 * au rôle "student" — un coach/admin doit pouvoir prévisualiser l'espace
 * élève (lien "Espace élève" du menu admin), donc seul l'accès anonyme est
 * bloqué ici.
 *
 * Si le compte connecté est bien un élève (jamais pour un coach/admin en
 * prévisualisation) et que son onboarding n'est pas terminé, redirige vers
 * /onboarding — voir app/onboarding. Un élève sans fiche `students` du tout
 * (cas normal juste après création par le coach, avant tout lien) n'a rien
 * à compléter ici et n'est pas redirigé. Un compte "programme_seul" (chantier
 * module Programmation, étape 6) n'a jamais de questionnaire à compléter —
 * son onboarding est considéré terminé par construction.
 */
export async function requireStudent(): Promise<void> {
  await requireAuth();
  if (!isSupabaseConfigured()) {
    return;
  }
  const role = await getCurrentUserRole();
  if (role !== "student") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return;
  }
  const studentId = await getCurrentStudentId(supabase);
  if (!studentId) {
    return;
  }
  if ((await getStudentAccessType(supabase, studentId)) === "programme_seul") {
    return;
  }
  const completed = await getOnboardingCompleted(supabase, studentId);
  if (!completed) {
    redirect("/onboarding");
  }
}

/**
 * Contenu élève payant (nutrition, documents, progression — chantier
 * "supabase-stripe-access-control") : nécessite un abonnement Stripe actif/
 * trialing, sauf dérogation manuelle du coach (`billing_access_mode`). Un
 * coach/admin en prévisualisation n'est jamais bloqué (même logique que
 * `requireStudent`) ; un élève sans fiche `students` du tout n'a rien à
 * vérifier ici (cas déjà géré ailleurs). Redirige vers /acces-limite (jamais
 * /acces-refuse, qui signifie "mauvais rôle" et non "paiement requis") si
 * l'accès est refusé.
 *
 * Un compte "programme_seul" (chantier module Programmation, étape 6) n'a
 * jamais accès à ces pages, quel que soit son statut d'abonnement (il n'y en
 * a pas) — redirigé directement vers /entrainement, son seul périmètre. Pour
 * /entrainement lui-même, voir requireEntrainementAccess ci-dessous (jamais
 * cette fonction, qui bloquerait un accès payé par achat unique).
 */
export async function requireActiveStudentAccess(): Promise<void> {
  await requireAuth();
  if (!isSupabaseConfigured()) {
    return;
  }
  const role = await getCurrentUserRole();
  if (role !== "student") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return;
  }
  const studentId = await getCurrentStudentId(supabase);
  if (!studentId) {
    return;
  }
  if ((await getStudentAccessType(supabase, studentId)) === "programme_seul") {
    redirect("/entrainement");
  }
  const status = await getStudentAccessStatus(supabase, studentId);
  if (!status.allowed) {
    redirect("/acces-limite");
  }
}

/**
 * Accès à /entrainement (chantier module Programmation, étape 6) : un
 * compte "programme_seul" y a toujours accès — son achat unique n'est
 * jamais un abonnement Stripe, donc jamais soumis au contrôle
 * `getStudentAccessStatus` (pensé pour les formules récurrentes). Son
 * périmètre reste borné ailleurs, par l'assignation réelle (RLS
 * `programs_select_assigned_student`) : il ne verra jamais que le(s)
 * programme(s) qui lui ont été assignés. Un compte "coaching" classique
 * repasse par la vérification d'abonnement habituelle.
 */
export async function requireEntrainementAccess(): Promise<void> {
  await requireAuth();
  if (!isSupabaseConfigured()) {
    return;
  }
  const role = await getCurrentUserRole();
  if (role !== "student") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return;
  }
  const studentId = await getCurrentStudentId(supabase);
  if (!studentId) {
    return;
  }
  if ((await getStudentAccessType(supabase, studentId)) === "programme_seul") {
    return;
  }
  const status = await getStudentAccessStatus(supabase, studentId);
  if (!status.allowed) {
    redirect("/acces-limite");
  }
}

/**
 * Fonctionnalités "coaching complet" hors périmètre payant explicite
 * (dashboard, rendez-vous — jamais gérées par requireActiveStudentAccess,
 * qui ne concerne que le contenu conditionné à un abonnement) : un compte
 * "programme_seul" (chantier module Programmation, étape 6) y est toujours
 * redirigé vers /entrainement, son seul périmètre.
 */
export async function requireCoachingFeature(): Promise<void> {
  await requireAuth();
  if (!isSupabaseConfigured()) {
    return;
  }
  const role = await getCurrentUserRole();
  if (role !== "student") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return;
  }
  const studentId = await getCurrentStudentId(supabase);
  if (!studentId) {
    return;
  }
  if ((await getStudentAccessType(supabase, studentId)) === "programme_seul") {
    redirect("/entrainement");
  }
}

/**
 * Guard pour /onboarding lui-même : authentification requise. Un coach/admin
 * n'a jamais rien à onboarder, redirigé vers /admin. Un élève ayant déjà
 * terminé son onboarding (ou sans fiche `students` du tout) est redirigé
 * vers /dashboard plutôt que de repasser le questionnaire. Un compte
 * "programme_seul" (chantier module Programmation, étape 6) n'a jamais de
 * questionnaire à faire, redirigé directement vers /entrainement.
 */
export async function requireOnboarding(): Promise<void> {
  await requireAuth();
  if (!isSupabaseConfigured()) {
    return;
  }
  const role = await getCurrentUserRole();
  if (role === "admin" || role === "coach") {
    redirect("/admin");
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return;
  }
  const studentId = await getCurrentStudentId(supabase);
  if (!studentId) {
    redirect("/dashboard");
  }
  if ((await getStudentAccessType(supabase, studentId)) === "programme_seul") {
    redirect("/entrainement");
  }
  const completed = await getOnboardingCompleted(supabase, studentId);
  if (completed) {
    redirect("/dashboard");
  }
}
