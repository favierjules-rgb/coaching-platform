import { Suspense } from "react";
import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Nouveau mot de passe — Seth Préparation Physique",
};

// Suspense requis par Next.js dès qu'un descendant utilise useSearchParams
// (lecture de ?token_hash=...&type=... dans ResetPasswordForm).
export default function ReinitialiserMotDePassePage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm supabaseConfigured={isSupabaseConfigured()} />
    </Suspense>
  );
}
