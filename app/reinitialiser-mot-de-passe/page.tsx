import { Suspense } from "react";
import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Nouveau mot de passe — Seth Préparation Physique",
  // Aucun robot n'a de raison d'indexer une page atteinte par jeton, et
  // `noarchive` évite qu'un cache public en conserve une copie.
  robots: { index: false, follow: false, noarchive: true, nocache: true },
  // Le lien d'activation ne doit fuiter vers aucune origine tierce.
  referrer: "no-referrer",
};

/**
 * Cette page reçoit un jeton à usage unique en paramètre d'URL. Elle est
 * rendue dynamiquement et jamais mise en cache : un intermédiaire qui en
 * conserverait une copie servirait une URL porteuse de jeton.
 *
 * `ResetPasswordForm` ne vérifie RIEN au chargement — voir le commentaire
 * détaillé du composant : le jeton n'est échangé qu'au clic explicite de
 * l'utilisateur, car un simple GET automatique (relais de sécurité, aperçu
 * de lien, préchargement) suffirait sinon à le consommer.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Suspense requis par Next.js dès qu'un descendant utilise useSearchParams
// (lecture de ?token_hash=...&type=... dans ResetPasswordForm).
export default function ReinitialiserMotDePassePage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm supabaseConfigured={isSupabaseConfigured()} />
    </Suspense>
  );
}
