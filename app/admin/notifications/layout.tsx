import type { ReactNode } from "react";

import { interdireCollaborateur } from "@/lib/supabase/guards";

/**
 * Rubrique GLOBALE : interdite aux collaborateurs, y compris par URL directe.
 *
 * ⚠️ UN LAYOUT, PAS UNE VÉRIFICATION DANS LA PAGE. La page est un Client
 * Component : elle ne peut pas refuser avant de s'afficher. Le layout est un
 * Server Component, il s'exécute AVANT tout rendu et peut rediriger — c'est
 * le seul endroit où « taper l'URL » peut être arrêté sans rien envoyer.
 *
 * ⚠️ CE N'EST PAS LA PROTECTION, C'EST SA FAÇADE. Les données elles-mêmes sont
 * refusées par la RLS et par `requireStaff()` sur les routes d'API. Si cette
 * garde disparaissait, le collaborateur verrait un écran vide, pas des
 * données — et les tests de la checklist SQL le vérifient en base.
 */
export default async function RubriqueGlobaleLayout({ children }: { children: ReactNode }) {
  await interdireCollaborateur();
  return <>{children}</>;
}
