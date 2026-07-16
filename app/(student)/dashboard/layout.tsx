import type { ReactNode } from "react";

import { requireCoachingFeature } from "@/lib/supabase/guards";

/**
 * Le dashboard élève complet (statistiques multi-domaines : entraînement,
 * nutrition, rendez-vous, documents) n'a pas de sens pour un compte
 * "programme_seul" (chantier module Programmation, étape 6) — redirigé
 * directement vers /entrainement, son seul périmètre.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireCoachingFeature();
  return <>{children}</>;
}
