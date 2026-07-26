/**
 * Vérification centralisée de la configuration Supabase. Tant que
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ne sont pas
 * renseignées (.env.local), l'application doit continuer à fonctionner
 * normalement en mock/localStorage — aucun des clients de lib/supabase/
 * ne doit planter l'app, ils renvoient simplement `null`.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

let warned = false;

/**
 * Renvoie les variables d'environnement Supabase si les deux sont
 * renseignées, sinon `null`. Affiche un warning une seule fois en
 * développement (jamais en production, jamais une erreur bloquante).
 */
export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (process.env.NODE_ENV === "development" && !warned) {
      warned = true;
      console.warn(
        "[Supabase] NEXT_PUBLIC_SUPABASE_URL et/ou NEXT_PUBLIC_SUPABASE_ANON_KEY absentes. " +
          "L'application continue en mock/localStorage (voir README.md pour configurer Supabase).",
      );
    }
    return null;
  }

  return { url, anonKey };
}

/** Vrai si les deux variables publiques Supabase sont renseignées. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

/**
 * Le mode « mock » (Supabase absent ⇒ accès libre) est-il tolérable ?
 *
 * Audit de sécurité, juillet 2026, point M-4 : les guards de page
 * (`lib/supabase/guards.ts`) devenaient des no-op dès que Supabase n'était
 * pas configuré. Pratique en développement, mais « fail-open » en ligne :
 * une variable d'environnement oubliée lors d'un déploiement ouvrait
 * l'espace administrateur à tout visiteur.
 *
 * Désormais, ce repli n'existe QUE hors production. En production, une
 * configuration absente est une panne — et une panne se traduit par un
 * refus d'accès, jamais par une porte ouverte.
 */
export function isMockModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}
