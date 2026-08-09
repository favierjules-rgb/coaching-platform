/**
 * PWA — L'ÉCRAN DE LANCEMENT, EXÉCUTÉ.
 *
 *   npm run test:pwa-lancement
 *
 * Le manifeste fait démarrer l'application installée sur /connexion. Cette
 * page doit donc s'effacer devant quelqu'un qui est DÉJÀ connecté, sinon
 * chaque lancement depuis l'écran d'accueil montre un formulaire inutile.
 *
 * Ces tests APPELLENT la vraie page `app/connexion/page.tsx` et la vraie
 * fonction `redirectAuthenticatedAwayFromLogin`, avec Supabase remplacé par
 * un double au niveau du module (`mock.module`, d'où
 * `--experimental-test-module-mocks`). Rien de distant n'est contacté.
 *
 * Ce qui est vérifié tient en une phrase : la bonne destination pour chaque
 * rôle, et AUCUNE redirection dans les trois cas où rediriger créerait une
 * boucle ou fermerait la porte.
 */

import assert from "node:assert/strict";
import { mock } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const moduleUrl = (relatif: string) => pathToFileURL(join(RACINE, relatif)).href;

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ═════════════════════ État piloté par les tests ═════════════════════ */

const etat: { role: string | null; supabaseConfigure: boolean } = {
  role: null,
  supabaseConfigure: true,
};

/**
 * `next/navigation` N'EST PAS REMPLACÉ : c'est le VRAI `redirect` de Next.js
 * qui s'exécute, et c'est son erreur qu'on lit.
 *
 * Le remplacer aurait été plus simple et aurait moins prouvé : le
 * comportement qui compte ici est que `redirect()` LÈVE — il n'y a pas de
 * « code après la redirection ». Un faux `redirect` qui rendrait la main
 * laisserait passer une seconde redirection sans qu'aucun test ne la voie.
 *
 * Next.js encode la destination dans le `digest` de l'erreur, sous la forme
 * `NEXT_REDIRECT;replace;/dashboard;307;`.
 */
function destinationDeLErreur(erreur: unknown): string | null {
  const digest = (erreur as { digest?: unknown })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) {
    return null;
  }
  const morceaux = digest.split(";");
  return morceaux[2] ?? null;
}

// `server-only` refuse d'être importé hors d'un contexte serveur React. Ce
// n'est pas une protection qu'on affaiblit : elle existe pour empêcher un
// module serveur d'atterrir dans un bundle navigateur, ce qui n'a aucun sens
// dans un test Node. On la neutralise ici, et ici seulement.
mock.module("server-only", { namedExports: {} });

mock.module(moduleUrl("lib/supabase/auth.ts"), {
  namedExports: {
    getCurrentUserRole: async () => etat.role,
    getCurrentUser: async () => (etat.role ? { id: "u1" } : null),
    getCurrentProfile: async () => null,
    getProfileByUserId: async () => null,
  },
});

mock.module(moduleUrl("lib/supabase/env.ts"), {
  namedExports: {
    isSupabaseConfigured: () => etat.supabaseConfigure,
    isMockModeAllowed: () => false,
  },
});

const { redirectAuthenticatedAwayFromLogin } = await import(moduleUrl("lib/supabase/login-redirect.ts"));
const moduleConnexion = await import(moduleUrl("app/connexion/page.tsx"));
const ConnexionPage = (moduleConnexion.default?.default ?? moduleConnexion.default) as () => Promise<unknown>;

/** Exécute la vraie page et rapporte où elle envoie — ou `null`. */
async function ouvrirLaPage(): Promise<string | null> {
  try {
    await ConnexionPage();
    return null;
  } catch (erreur) {
    const destination = destinationDeLErreur(erreur);
    if (destination === null) {
      throw erreur;
    }
    return destination;
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * I. CHAQUE RÔLE CHEZ LUI
 * ════════════════════════════════════════════════════════════════════════ */

await test("L1. un ÉLÈVE déjà connecté est envoyé sur son tableau de bord", async () => {
  etat.role = "student";
  etat.supabaseConfigure = true;
  assert.equal(await ouvrirLaPage(), "/dashboard");
});

await test("L2. un COACH est envoyé sur l'espace d'administration", async () => {
  etat.role = "coach";
  assert.equal(await ouvrirLaPage(), "/admin");
});

await test("L3. un ADMIN aussi", async () => {
  etat.role = "admin";
  assert.equal(await ouvrirLaPage(), "/admin");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LES TROIS CAS OÙ IL NE FAUT SURTOUT PAS REDIRIGER
 * ════════════════════════════════════════════════════════════════════════ */

await test("L4. personne n'est connecté : le formulaire s'affiche", async () => {
  // C'est LA garantie anti-boucle. Rediriger un visiteur anonyme vers
  // /dashboard le renverrait ici par `requireStudent`, qui le renverrait
  // là-bas : l'application ne s'ouvrirait jamais.
  etat.role = null;
  assert.equal(await ouvrirLaPage(), null);
});

await test("L5. compte sans profil (rôle inconnu) : le formulaire s'affiche", async () => {
  // Cas normal entre l'inscription et la validation par le coach.
  // `LoginForm` sait expliquer ce cas ; l'expédier vers /dashboard ne ferait
  // que le renvoyer ici.
  etat.role = "inconnu";
  assert.equal(await ouvrirLaPage(), null);
});

await test("L6. Supabase non configuré : la connexion reste ATTEIGNABLE", async () => {
  // Une panne de configuration ne doit jamais rendre la page de connexion
  // inaccessible — c'est la raison pour laquelle cette fonction vit hors de
  // `guards.ts` et ne passe pas par `shouldSkipGuards()`.
  etat.role = "student";
  etat.supabaseConfigure = false;
  assert.equal(await ouvrirLaPage(), null);
  etat.supabaseConfigure = true;
});

/* ════════════════════════════════════════════════════════════════════════
 * III. AUCUNE BOUCLE, ET UNE SEULE REDIRECTION
 * ════════════════════════════════════════════════════════════════════════ */

await test("L7. la destination n'est JAMAIS /connexion", async () => {
  for (const role of ["student", "coach", "admin", "inconnu", null]) {
    etat.role = role;
    const destination = await ouvrirLaPage();
    assert.notEqual(destination, "/connexion", `rôle ${role} : renvoyé sur lui-même`);
  }
});

await test("L8. la fonction s'arrête à la PREMIÈRE redirection", async () => {
  // `redirect` lève : le code qui suit n'est jamais atteint. Si la fonction
  // enveloppait un jour l'appel dans un try/catch, elle poursuivrait sa
  // cascade de `if` et pourrait rediriger une seconde fois — l'erreur
  // remontée ne serait alors plus celle de /dashboard, et ce test le dirait.
  etat.role = "student";
  try {
    await redirectAuthenticatedAwayFromLogin();
    assert.fail("aucune redirection alors qu'un élève est connecté");
  } catch (erreur) {
    assert.equal(destinationDeLErreur(erreur), "/dashboard", "une seule redirection, vers /dashboard");
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
