import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Mot de passe oublié — Seth Préparation Physique",
};

export default function MotDePasseOubliePage() {
  return <ForgotPasswordForm supabaseConfigured={isSupabaseConfigured()} />;
}
