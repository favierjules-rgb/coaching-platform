import type { ReactNode } from "react";

import { requireEntrainementAccess } from "@/lib/supabase/guards";

/**
 * Contenu payant (chantier "supabase-stripe-access-control"), avec exception
 * pour les comptes "programme_seul" (chantier module Programmation, étape 6
 * — achat unique, jamais un abonnement Stripe) — voir
 * requireEntrainementAccess dans lib/supabase/guards.ts.
 */
export default async function EntrainementLayout({ children }: { children: ReactNode }) {
  await requireEntrainementAccess();
  return <>{children}</>;
}
