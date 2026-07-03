import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

/**
 * Client Supabase "service role" — contourne Row Level Security, réservé
 * aux opérations serveur de confiance (scripts d'admin, tâches de fond,
 * webhooks). L'import de `server-only` fait échouer le build si ce fichier
 * est importé depuis un Client Component ("use client"), pour qu'une clé
 * service role ne se retrouve jamais exposée au navigateur.
 *
 * Ne jamais utiliser ce client pour répondre à une requête initiée par un
 * utilisateur sans revérifier ses droits manuellement : il n'y a plus de
 * RLS pour vous protéger d'une faille d'autorisation.
 *
 * Renvoie `null` si Supabase (ou la clé service role) n'est pas encore
 * configuré — jamais d'erreur bloquante.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Supabase] SUPABASE_SERVICE_ROLE_KEY absente. Client admin indisponible (mock/localStorage utilisé à la place).",
      );
    }
    return null;
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
