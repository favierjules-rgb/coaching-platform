import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getOnboardingCompleted } from "@/lib/supabase/onboarding";
import { getStudentAccessStatus } from "@/lib/supabase/student-access";

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
 * à compléter ici et n'est pas redirigé.
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
  const completed = await getOnboardingCompleted(supabase, studentId);
  if (!completed) {
    redirect("/onboarding");
  }
}

/**
 * Contenu élève payant (entraînement, nutrition, documents, progression —
 * chantier "supabase-stripe-access-control") : nécessite un abonnement
 * Stripe actif/trialing, sauf dérogation manuelle du coach
 * (`billing_access_mode`). Un coach/admin en prévisualisation n'est jamais
 * bloqué (même logique que `requireStudent`) ; un élève sans fiche
 * `students` du tout n'a rien à vérifier ici (cas déjà géré ailleurs).
 * Redirige vers /acces-limite (jamais /acces-refuse, qui signifie "mauvais
 * rôle" et non "paiement requis") si l'accès est refusé.
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
  const status = await getStudentAccessStatus(supabase, studentId);
  if (!status.allowed) {
    redirect("/acces-limite");
  }
}

/**
 * Guard pour /onboarding lui-même : authentification requise. Un coach/admin
 * n'a jamais rien à onboarder, redirigé vers /admin. Un élève ayant déjà
 * terminé son onboarding (ou sans fiche `students` du tout) est redirigé
 * vers /dashboard plutôt que de repasser le questionnaire.
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
  const completed = await getOnboardingCompleted(supabase, studentId);
  if (completed) {
    redirect("/dashboard");
  }
}
