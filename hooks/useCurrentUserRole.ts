"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { UserRole } from "@/types";

export interface CurrentUserRoleState {
  ready: boolean;
  role: UserRole | null;
}

/**
 * Rôle de l'utilisateur connecté, résolu côté navigateur (chantier
 * "supabase-stripe-payments-subscriptions", pages /paiement/success et
 * /paiement/cancel — bouton "Retour à mon espace" différent élève/staff).
 * Mirroir client de lib/supabase/auth.ts::getCurrentUserRole (server-only,
 * inutilisable depuis un Client Component) — même requête `profiles`
 * (RLS : chacun lit son propre profil). `role` reste `null` si Supabase
 * n'est pas configuré, si personne n'est connecté, ou si le compte n'a pas
 * encore de profil.
 */
export function useCurrentUserRole(): CurrentUserRoleState {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        if (!cancelled) setReady(true);
        return;
      }
      const { data } = await supabase.from("profiles").select("role").eq("user_id", userData.user.id).maybeSingle();
      if (!cancelled) {
        setRole(data?.role ?? null);
        setReady(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, role };
}
