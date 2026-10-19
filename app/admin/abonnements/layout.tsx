import type { ReactNode } from "react";

import { interdireCollaborateur } from "@/lib/supabase/guards";

/**
 * Rubrique GLOBALE : interdite aux collaborateurs, y compris par URL directe.
 *
 * ⚠️ POURQUOI UN LAYOUT ET PAS UNE VÉRIFICATION DANS LA PAGE. Le layout est un
 * Server Component : il s'exécute AVANT tout rendu et peut rediriger. C'est le
 * seul endroit où « taper l'URL » peut être arrêté sans rien envoyer — et la
 * seule garde que `/admin/layout.tsx` (`requireAdminOrCoach()`) n'apporte pas,
 * puisqu'un collaborateur est bien un `coach` au sens de `profiles.role`.
 *
 * ⚠️ CE N'EST PAS LA PROTECTION, C'EST SA FAÇADE. Les données elles-mêmes sont
 * refusées en base : le catalogue d'offres par la policy
 * `subscription_templates_select_active_or_staff`, les abonnés newsletter par
 * `newsletter_subscribers_select_staff` (`est_staff_global()`), les trois
 * colonnes d'attribution d'offre par un privilège de colonne, et les routes
 * `/api/admin/subscription-templates/*` comme `/api/admin/newsletter/resync`
 * par `requireAdmin()`. Si cette garde disparaissait, un collaborateur
 * verrait un écran vide — pas des données. La checklist SQL le vérifie en base.
 */
export default async function RubriqueGlobaleLayout({ children }: { children: ReactNode }) {
  await interdireCollaborateur();
  return <>{children}</>;
}
