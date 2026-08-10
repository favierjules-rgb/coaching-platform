/**
 * LA SEULE FRONTIÈRE INJECTÉE : LE RÉSEAU, ET SON HUMEUR.
 *
 * `esbuild` substitue ce module à `@/lib/supabase/browser`. Tout le reste —
 * les pages réelles, `useEtatOfflineEleve`, `useSeanceHorsLigne`,
 * `DepotOffline`, `MoteurIndexedDB`, IndexedDB, React — est le code de
 * production.
 *
 * Le mode est lu à CHAQUE appel, pas au chargement : un même bundle joue
 * ainsi les quatre situations que le produit doit distinguer.
 *
 *   • `offline`  → panne de transport, avec le message de WebKit
 *                  (« Load failed »), et non celui de Chrome.
 *   • `erreur`   → le serveur A RÉPONDU, et il a répondu 500. Ce cas ne doit
 *                  JAMAIS ouvrir le dépôt local ni la démonstration.
 *   • `online`   → tout répond.
 *   • `non_configure` → aucun client : le seul chemin vers la démonstration.
 */

export type ModeReseau = "offline" | "erreur" | "online" | "non_configure";

const USER = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function mode(): ModeReseau {
  return ((globalThis as unknown as { __MODE_RESEAU?: ModeReseau }).__MODE_RESEAU ?? "offline");
}

export const SESSION_LOCALE = {
  access_token: "jeton-de-test-NE-DOIT-PAS-SORTIR",
  refresh_token: "rafraichissement-NE-DOIT-PAS-SORTIR",
  expires_at: 4_102_444_800,
  user: { id: USER, email: "eleve@example.com" },
};

/** Ce que rend une requête, selon l'humeur du réseau. */
async function reponse(donnees: unknown) {
  const m = mode();
  if (m === "offline") {
    return { data: null, error: { message: "Load failed" } };
  }
  if (m === "erreur") {
    // Un statut HTTP : le serveur a répondu. `classerErreur` doit conclure
    // « serveur », jamais « reseau ».
    return { data: null, error: { message: "Internal Server Error", status: 500 } };
  }
  return { data: donnees, error: null };
}

function requete(table: string) {
  const donnees = table === "students" ? { id: ELEVE, access_type: "coaching" } : null;
  const chaine = {
    select: () => chaine,
    eq: () => chaine,
    in: () => chaine,
    order: () => chaine,
    limit: () => chaine,
    maybeSingle: () => reponse(donnees),
    single: () => reponse(donnees),
    then: (resoudre: (v: unknown) => unknown) => reponse(null).then(resoudre),
  };
  return chaine;
}

export function createSupabaseBrowserClient() {
  if (mode() === "non_configure") {
    return null as unknown as ReturnType<typeof import("@/lib/supabase/browser").createSupabaseBrowserClient>;
  }
  return {
    auth: {
      getSession: async () => ({ data: { session: SESSION_LOCALE }, error: null }),
      getUser: async () =>
        mode() === "online"
          ? { data: { user: SESSION_LOCALE.user }, error: null }
          : { data: { user: null }, error: { message: "Load failed" } },
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => requete(table),
    rpc: () => reponse(null),
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => {},
    storage: { from: () => ({ createSignedUrl: () => reponse(null), upload: () => reponse(null) }) },
  } as unknown as ReturnType<typeof import("@/lib/supabase/browser").createSupabaseBrowserClient>;
}
