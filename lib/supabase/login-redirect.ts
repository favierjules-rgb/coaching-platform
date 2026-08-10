import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUserRole } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * L'INVERSE D'UN GUARD : renvoie chez lui quelqu'un qui est DÉJÀ connecté.
 *
 * Appelé par /connexion, et il n'existe que pour le chantier PWA. Le
 * manifeste ouvre l'application sur /connexion (`app/manifest.ts`) — c'est
 * la demande : l'application est l'espace de l'élève, pas la vitrine. Sans
 * cette redirection, un élève déjà connecté qui lance l'application depuis
 * son écran d'accueil tomberait à chaque fois sur un formulaire de
 * connexion dont il n'a pas besoin. Les deux morceaux ne valent
 * qu'ensemble.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER, ET PAS `guards.ts`
 * ────────────────────────────────────────────────────────────────────────
 * `lib/supabase/guards.ts` tient un invariant vérifié par
 * `scripts/tests/security-hardening.mts` (point 15, audit M-4) : TOUT ce
 * qui y est exporté passe par `shouldSkipGuards()`, la garde qui refuse
 * l'accès en production quand Supabase n'est pas configuré. Cet invariant
 * existe précisément pour qu'aucune fonction nouvelle ne s'y glisse en
 * court-circuitant le fail-closed.
 *
 * Or cette fonction-ci doit faire l'inverse : sans configuration Supabase,
 * la page de connexion doit RESTER affichée — le formulaire annonce
 * lui-même le problème, et une panne de configuration ne doit jamais rendre
 * la connexion inatteignable. Plutôt que d'affaiblir la règle en ajoutant
 * une exception dans son fichier, on la laisse intacte et on sort d'ici.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE N'EST PAS UNE PROTECTION
 * ────────────────────────────────────────────────────────────────────────
 * Elle ne referme aucune porte, elle en ouvre une plus courte. Ce qui
 * protège /dashboard et /admin reste `requireStudent` et
 * `requireAdminOrCoach`, côté serveur, plus les politiques RLS en base.
 *
 * Un compte authentifié SANS ligne `profiles` (rôle inconnu — cas normal
 * entre l'inscription et la validation par le coach) n'est envoyé nulle
 * part : `LoginForm` sait déjà expliquer ce cas, et l'expédier vers
 * /dashboard ne ferait que le renvoyer ici.
 */
export async function redirectAuthenticatedAwayFromLogin(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  const role = await getCurrentUserRole();
  if (role === "student") {
    redirect("/dashboard");
  }
  if (role === "admin" || role === "coach") {
    redirect("/admin");
  }
}
