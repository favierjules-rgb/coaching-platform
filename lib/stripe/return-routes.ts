import type { UserRole } from "@/types";

/**
 * Destinations du bouton "Retour à mon espace" / "Réessayer" sur
 * /paiement/success et /paiement/cancel (chantier
 * "supabase-stripe-payments-subscriptions"). `/dashboard` existe bien dans
 * ce repo (app/(student)/dashboard) — utilisé pour l'élève ; `/admin/billing`
 * n'existe pas, la vraie route admin est `/admin/paiements` (voir
 * components/admin/AdminSidebar.tsx).
 */

/** Espace général de l'utilisateur (dashboard élève, ou liste paiements admin/coach). */
export function resolveSpaceHref(role: UserRole | null): string {
  if (role === "admin" || role === "coach") return "/admin/paiements";
  if (role === "student") return "/dashboard";
  return "/connexion";
}

/** Page où relancer un paiement (retour élève sur /profil où vit "Activer mon abonnement", admin sur /admin/paiements où vit "Créer lien de paiement"). */
export function resolveRetryHref(role: UserRole | null): string {
  if (role === "admin" || role === "coach") return "/admin/paiements";
  if (role === "student") return "/profil";
  return "/connexion";
}
