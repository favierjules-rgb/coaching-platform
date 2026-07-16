import type { ReactNode } from "react";

import { requireCoachingFeature } from "@/lib/supabase/guards";

/**
 * La prise de rendez-vous coach n'a pas de sens pour un compte
 * "programme_seul" (chantier module Programmation, étape 6) — redirigé
 * directement vers /entrainement, son seul périmètre.
 */
export default async function RendezVousLayout({ children }: { children: ReactNode }) {
  await requireCoachingFeature();
  return <>{children}</>;
}
