import type { Metadata } from "next";

import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { requireOnboarding } from "@/lib/supabase/guards";

export const metadata: Metadata = {
  title: "Complète ton profil — Seth Préparation Physique",
};

/**
 * Page dédiée, sans StudentShell (pas de nav élève tant que le
 * questionnaire n'est pas terminé) — voir requireOnboarding pour les
 * redirections (coach/admin jamais ici, élève déjà onboardé renvoyé vers
 * /dashboard).
 */
export default async function OnboardingPage() {
  await requireOnboarding();
  return <OnboardingWizard />;
}
