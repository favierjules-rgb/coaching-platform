import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/supabase";

/**
 * Client Supabase pour Server Components / Server Actions / Route Handlers
 * (clé anon, session utilisateur lue depuis les cookies via `next/headers`).
 * Renvoie `null` si Supabase n'est pas encore configuré, à vérifier avant
 * usage — jamais d'erreur bloquante tant que .env.local est incomplet.
 *
 * `cookies()` est asynchrone dans cette version de Next.js (App Router) :
 * cette fonction doit donc être `await`ée par l'appelant.
 */
export async function createSupabaseServerClient() {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `set` échoue silencieusement quand appelé depuis un Server
          // Component (cookies en lecture seule) — attendu tant qu'aucune
          // route/Server Action ne rafraîchit la session. À gérer via un
          // proxy.ts dédié le jour où l'authentification Supabase est
          // réellement branchée (voir README.md, prochaine étape).
        }
      },
    },
  });
}
