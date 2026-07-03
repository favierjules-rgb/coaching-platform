import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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
 */
export async function requireStudent(): Promise<void> {
  await requireAuth();
}
