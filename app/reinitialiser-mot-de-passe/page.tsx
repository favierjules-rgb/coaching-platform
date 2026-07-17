import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Nouveau mot de passe — Seth Préparation Physique",
};

export default function ReinitialiserMotDePassePage() {
  return <ResetPasswordForm supabaseConfigured={isSupabaseConfigured()} />;
}
