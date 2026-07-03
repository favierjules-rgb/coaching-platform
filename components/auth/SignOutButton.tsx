"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface SignOutButtonProps {
  className: string;
  onBeforeNavigate?: () => void;
  label?: string;
}

/**
 * Bouton de déconnexion réutilisable (sidebar élève, sidebar admin, page
 * accès refusé). En mode mock (Supabase non configuré), il n'y a pas de
 * session réelle à couper — redirige simplement vers /connexion.
 */
export function SignOutButton({ className, onBeforeNavigate, label = "Déconnexion" }: SignOutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    onBeforeNavigate?.();
    router.refresh();
    router.push("/connexion");
  }

  return (
    <button type="button" onClick={handleSignOut} disabled={loading} className={className}>
      <LogOut size={18} />
      {label}
    </button>
  );
}
