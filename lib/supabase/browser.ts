"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/supabase";

/**
 * Client Supabase pour les Client Components (clé anon, exposée au
 * navigateur — jamais la service role key ici, voir lib/supabase/admin.ts).
 * Renvoie `null` si Supabase n'est pas encore configuré : à chaque appel,
 * vérifier la valeur avant de l'utiliser plutôt que de supposer qu'il
 * existe, pour ne jamais planter le mock/localStorage actuel.
 */
export function createSupabaseBrowserClient() {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }
  return createBrowserClient<Database>(env.url, env.anonKey);
}
