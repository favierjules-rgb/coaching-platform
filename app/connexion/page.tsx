import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/LoginForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Connexion — Seth Préparation Physique",
};

export default function ConnexionPage() {
  return <LoginForm supabaseConfigured={isSupabaseConfigured()} />;
}
