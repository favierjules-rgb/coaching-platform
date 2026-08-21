/**
 * Aucun client navigateur : `ChoixMagasinProche` renonce à sa lecture du
 * magasin déjà choisi et n'ouvre aucune connexion. Le composant reste RÉEL —
 * seule sa source de données disparaît.
 */
export function createSupabaseBrowserClient() {
  return null as unknown as ReturnType<typeof import("@/lib/supabase/browser").createSupabaseBrowserClient>;
}
