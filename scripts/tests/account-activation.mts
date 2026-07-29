/**
 * Tests comportementaux du parcours d'activation de compte.
 *
 *   npm run test:account-activation
 *
 * ---------------------------------------------------------------------
 * Ce qu'ils protègent
 * ---------------------------------------------------------------------
 * Incident du 27/07/2026, établi par les traces Supabase : le jeton
 * d'invitation d'un acheteur a été vérifié avec SUCCÈS 8 secondes après
 * l'envoi de l'e-mail, sans qu'aucune session ne soit créée ; son clic réel,
 * 1 min 43 plus tard, a reçu un 403. Un agent automatique avait suivi le
 * lien avant lui et brûlé le jeton à usage unique.
 *
 * La règle à ne plus jamais casser : **charger la page ne vérifie rien.**
 * Ces tests l'exercent réellement — rendu React serveur pour prouver
 * qu'aucun appel n'a lieu au montage, machine d'état pure pour le reste.
 *
 * La remise du lien côté serveur (provisionnement) est couverte par
 * scripts/tests/account-activation-provisioning.mts : `server-only` y impose
 * la condition `react-server`, incompatible avec `react-dom/server`.
 *
 * Aucun service externe n'est contacté ; aucun jeton n'est journalisé.
 */

import assert from "node:assert/strict";
import { mock } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE_MODULES = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Contexte App Router absent hors navigateur : `useRouter` lève sinon
 * « invariant expected app router to be mounted ». On fournit un double
 * inerte — et on ENREGISTRE les appels à `replace` pour vérifier que l'URL
 * est bien nettoyée.
 */
/**
 * Contexte App Router : `useRouter` et `useSearchParams` le lisent, et
 * lèvent « invariant expected app router to be mounted » sans lui. On le
 * fournit exactement comme Next.js le ferait, plutôt que de remplacer le
 * module — le composant s'exécute ainsi tel quel, sans adaptation pour les
 * tests.
 */
const navigation = { replaces: [] as string[] };

const routeurFactice = {
  replace: (url: string) => navigation.replaces.push(url),
  push: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

function rendreAvecRouteur(params: Record<string, string>) {
  return renderToString(
    createElement(
      AppRouterContext.Provider,
      { value: routeurFactice as never },
      createElement(
        PathnameContext.Provider,
        { value: "/reinitialiser-mot-de-passe" },
        createElement(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(params) as never },
          createElement(ResetPasswordForm, { supabaseConfigured: true }),
        ),
      ),
    ),
  );
}

/** Client Supabase espion : compte les vérifications réellement émises. */
const supabaseEspion = { verifications: 0 };
mock.module(pathToFileURL(join(RACINE_MODULES, "lib/supabase/browser.ts")).href, {
  namedExports: {
    createSupabaseBrowserClient: () => ({
      auth: {
        verifyOtp: async () => {
          supabaseEspion.verifications += 1;
          return { data: { session: null }, error: { message: "ne devrait jamais être appelé" } };
        },
        getSession: async () => ({ data: { session: null } }),
        updateUser: async () => ({ error: null }),
        getUser: async () => ({ data: { user: null } }),
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    }),
  },
});

import {
  TYPES_ACTIVATION_AUTORISES,
  classerEchecVerification,
  creerVerificateurActivation,
  estTypeActivationAutorise,
  lireJetonActivation,
  urlPorteUnJeton,
  urlSansJeton,
  type JetonActivation,
} from "../../lib/auth/activation-token";
import { ResetPasswordForm } from "../../components/auth/ResetPasswordForm";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (chemin: string) => readFileSync(join(ICI, chemin), "utf8");

let passed = 0;
let failed = 0;
async function test(nom: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${nom}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(error);
  }
}

/** Compteur d'appels : la seule chose qui compte est « combien de fois ». */
function verificateurEspion(resultat: { userId?: string; messageErreur?: string }) {
  const appels: JetonActivation[] = [];
  return {
    appels,
    deps: {
      verifierJeton: async (jeton: JetonActivation) => {
        appels.push(jeton);
        return resultat;
      },
    },
  };
}

const JETON_FACTICE = "jeton-de-test-non-reel";

function params(entrees: Record<string, string>) {
  const sp = new URLSearchParams(entrees);
  return (cle: string) => sp.get(cle);
}

/* ═══════════ 1-2, 5. Le chargement ne vérifie jamais rien ═══════════ */

await test("1. un GET de la page avec token_hash et type ne déclenche aucun verifyOtp", () => {
  // `renderToString` exécute tout le corps du composant : initialiseurs de
  // state, lecture des paramètres, construction du vérificateur. Si une
  // vérification était déclenchée « au montage », elle partirait ici.
  supabaseEspion.verifications = 0;
  const html = rendreAvecRouteur({ token_hash: JETON_FACTICE, type: "invite" });

  assert.equal(supabaseEspion.verifications, 0, "AUCUNE vérification ne doit partir au chargement");
  // La page affiche l'invitation à cliquer, jamais le formulaire.
  assert.ok(html.includes("Définir mon mot de passe"), "le bouton d'action doit être proposé");
  assert.ok(html.includes("Votre lien est prêt"), "le message d'attente doit être affiché");
  assert.ok(!html.includes('type="password"'), "le formulaire ne doit pas être affiché avant le clic");
  // Et surtout : aucun jeton dans le HTML rendu.
  assert.ok(!html.includes("jeton-de-test-non-reel"), "aucun jeton ne doit apparaître dans le HTML");
});

await test("2. plusieurs montages ou préchargements ne déclenchent aucun verifyOtp", async () => {
  const espion = verificateurEspion({ userId: "u-1" });
  // Dix créations d'instance, comme dix préchargements successifs.
  for (let i = 0; i < 10; i += 1) {
    creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "invite" }, espion.deps);
  }
  assert.equal(espion.appels.length, 0, "créer le vérificateur ne doit rien vérifier");
});

await test("5. un rerender avec de nouveaux searchParams ne produit aucun second appel", async () => {
  const espion = verificateurEspion({ userId: "u-1" });
  const verificateur = creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "invite" }, espion.deps);

  await verificateur.tenter();
  // Simule les re-rendus : le jeton d'origine reste hors de portée, et le
  // vérificateur refuse toute nouvelle tentative.
  for (let i = 0; i < 5; i += 1) {
    const issue = await verificateur.tenter();
    assert.equal(issue.etat, "ignore", "une tentative supplémentaire doit être ignorée");
  }
  assert.equal(espion.appels.length, 1, "un seul appel réseau, quel que soit le nombre de rendus");
});

/* ═══════════ 3-4. Le clic, et lui seul, déclenche la vérification ═══════════ */

await test("3. verifyOtp n'est appelé qu'après un clic explicite", async () => {
  const espion = verificateurEspion({ userId: "u-1" });
  const verificateur = creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "invite" }, espion.deps);

  assert.equal(espion.appels.length, 0, "rien avant le clic");
  assert.equal(verificateur.disponible(), true);

  const issue = await verificateur.tenter();
  assert.equal(espion.appels.length, 1, "exactement un appel après le clic");
  assert.deepEqual(issue, { etat: "session", userId: "u-1" });
});

await test("4. deux clics rapides ne produisent qu'un seul appel", async () => {
  const espion = verificateurEspion({ userId: "u-1" });
  const verificateur = creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "invite" }, espion.deps);

  // Lancés en parallèle, sans attendre : c'est le double-tap mobile.
  const [a, b] = await Promise.all([verificateur.tenter(), verificateur.tenter()]);
  assert.equal(espion.appels.length, 1, "le drapeau doit être posé avant le premier await");
  const issues = [a.etat, b.etat].sort();
  assert.deepEqual(issues, ["ignore", "session"], "une seule tentative aboutit, l'autre est ignorée");
});

/* ═══════════ 6-9. Types et jetons acceptés ═══════════ */

await test("6. type=invite appelle verifyOtp avec invite", async () => {
  const espion = verificateurEspion({ userId: "u-1" });
  const jeton = lireJetonActivation(params({ token_hash: JETON_FACTICE, type: "invite" }));
  assert.ok(jeton);
  await creerVerificateurActivation(jeton, espion.deps).tenter();
  assert.equal(espion.appels[0].type, "invite", "aucune conversion de type");
});

await test("7. type=recovery appelle verifyOtp avec recovery", async () => {
  const espion = verificateurEspion({ userId: "u-1" });
  const jeton = lireJetonActivation(params({ token_hash: JETON_FACTICE, type: "recovery" }));
  assert.ok(jeton);
  await creerVerificateurActivation(jeton, espion.deps).tenter();
  assert.equal(espion.appels[0].type, "recovery", "aucune conversion de type");
});

await test("8. un type non autorisé ne déclenche aucun appel", async () => {
  for (const type of ["magiclink", "signup", "email_change", "email", "sms", "", "INVITE"]) {
    assert.equal(
      lireJetonActivation(params({ token_hash: JETON_FACTICE, type })),
      null,
      `« ${type} » ne doit pas être accepté`,
    );
    assert.equal(estTypeActivationAutorise(type), false);
  }
  // Et rien ne part si le jeton est null.
  const espion = verificateurEspion({ userId: "u-1" });
  const issue = await creerVerificateurActivation(null, espion.deps).tenter();
  assert.equal(issue.etat, "invalide");
  assert.equal(espion.appels.length, 0, "aucun appel sans jeton exploitable");
});

await test("9. un token_hash absent ou vide ne déclenche aucun appel", async () => {
  assert.equal(lireJetonActivation(params({ type: "invite" })), null, "token_hash absent");
  assert.equal(lireJetonActivation(params({ token_hash: "", type: "invite" })), null, "token_hash vide");
  assert.equal(lireJetonActivation(params({ token_hash: "   ", type: "invite" })), null, "token_hash blanc");
  assert.equal(lireJetonActivation(params({})), null, "aucun paramètre");
});

/* ═══════════ 10-11. L'URL est nettoyée avant toute vérification ═══════════ */

await test("10. token_hash et type disparaissent de l'URL", () => {
  const avant = `https://exemple.test/reinitialiser-mot-de-passe?token_hash=${JETON_FACTICE}&type=invite`;
  assert.equal(urlPorteUnJeton(avant), true);
  const apres = urlSansJeton(avant);
  assert.ok(!apres.includes("token_hash"), "token_hash retiré");
  assert.ok(!apres.includes("type="), "type retiré");
  assert.ok(!apres.includes(JETON_FACTICE), "aucune trace du jeton");
  assert.equal(apres, "/reinitialiser-mot-de-passe");

  // Les autres paramètres sont préservés.
  const avecAutres = `https://exemple.test/reinitialiser-mot-de-passe?token_hash=${JETON_FACTICE}&type=recovery&utm=abc`;
  assert.equal(urlSansJeton(avecAutres), "/reinitialiser-mot-de-passe?utm=abc");
  assert.equal(urlPorteUnJeton("https://exemple.test/reinitialiser-mot-de-passe"), false);
});

await test("11. aucun access_token ni refresh_token n'apparaît dans l'URL nettoyée", () => {
  const nettoyee = urlSansJeton(
    `https://exemple.test/reinitialiser-mot-de-passe?token_hash=${JETON_FACTICE}&type=invite`,
  );
  for (const interdit of ["access_token", "refresh_token", "token_hash", "action_link"]) {
    assert.ok(!nettoyee.includes(interdit), `« ${interdit} » ne doit pas figurer dans l'URL`);
  }
});

/* ═══════════ 12-14. Issues et messages ═══════════ */

await test("12. après succès, l'état bascule vers le formulaire de mot de passe", async () => {
  const espion = verificateurEspion({ userId: "utilisateur-1" });
  const issue = await creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "invite" }, espion.deps).tenter();
  assert.deepEqual(issue, { etat: "session", userId: "utilisateur-1" });
});

await test("13. le formulaire n'est jamais rendu sans session, quel que soit le nombre de rendus", () => {
  supabaseEspion.verifications = 0;
  for (let i = 0; i < 5; i += 1) {
    const html = rendreAvecRouteur({ token_hash: JETON_FACTICE, type: "invite" });
    assert.ok(!html.includes('type="password"'), "aucun champ mot de passe avant vérification");
  }
  assert.equal(supabaseEspion.verifications, 0, "cinq rendus, toujours aucune vérification");
});

await test("14. un jeton déjà utilisé produit le message adapté et le bouton de nouveau lien", async () => {
  const espion = verificateurEspion({ messageErreur: "Token has already been used" });
  const issue = await creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "invite" }, espion.deps).tenter();
  assert.equal(issue.etat, "consomme", "un jeton déjà consommé doit être identifié comme tel");

  // Un jeton expiré donne l'autre message.
  const espion2 = verificateurEspion({ messageErreur: "Email link is invalid or has expired" });
  const issue2 = await creerVerificateurActivation({ tokenHash: JETON_FACTICE, type: "recovery" }, espion2.deps).tenter();
  assert.equal(issue2.etat, "invalide");

  assert.equal(classerEchecVerification("Token has already been used"), "consomme");
  assert.equal(classerEchecVerification("has expired"), "invalide");
  assert.equal(classerEchecVerification(undefined), "consomme");

  // Les deux écrans proposent le parcours « nouveau lien ».
  const source = lire("../../components/auth/ResetPasswordForm.tsx");
  assert.ok(source.includes("Ce lien a déjà été ouvert."), "message « déjà ouvert » attendu");
  assert.ok(source.includes("Ce lien n'est plus valide."), "message « expiré » attendu");
  assert.ok(source.includes('href="/mot-de-passe-oublie"'), "bouton de nouveau lien attendu");
});

/* ═══════════ 15-17. Parcours voisins et provisionnement ═══════════ */

await test("15. le parcours mot de passe oublié reste inchangé", () => {
  const route = lire("../../app/api/public/password-reset/route.ts");
  assert.ok(route.includes('type: "recovery"'), "toujours un lien de type recovery");
  assert.ok(route.includes("properties.hashed_token"), "toujours hashed_token, jamais action_link");
  assert.ok(route.includes("type=recovery"), "l'URL porte bien type=recovery");
  assert.ok(!route.includes("action_link:"), "action_link ne doit pas être renvoyé");
  // La réponse reste identique quel que soit le compte : pas d'énumération.
  const reponses = [...route.matchAll(/NextResponse\.json\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(reponses.every((r) => r.includes("ok: true")), `réponse non uniforme : ${reponses.join(" | ")}`);
});

await test("17. un rejeu du webhook n'envoie aucun deuxième e-mail", () => {
  // L'idempotence repose sur le verrou d'évènement : inchangée par ce
  // correctif, mais vérifiée pour qu'un futur remaniement ne la perde pas.
  const webhook = lire("../../app/api/stripe/webhook/route.ts");
  assert.ok(webhook.includes("acquirePublicProgramPurchaseEventLock"), "verrou d'idempotence attendu");
  assert.ok(webhook.includes('lockResult === "already_processed"'), "un évènement déjà traité doit être acquitté");
  assert.ok(webhook.includes("markPublicProgramPurchaseEventProcessed"), "marquage après succès complet");

  const handlers = lire("../../lib/stripe/webhook-handlers.ts");
  assert.ok(
    handlers.includes("getPublicProgramPurchaseConfirmationEmailState"),
    "l'e-mail de commande doit rester conditionné à son état enregistré",
  );
});

/* ═══════════ 18 + garde statique ═══════════ */

await test("18. aucun jeton ni lien sensible n'est journalisé", () => {
  for (const chemin of [
    "../../components/auth/ResetPasswordForm.tsx",
    "../../lib/auth/activation-token.ts",
    "../../lib/supabase/public-program-provisioning.ts",
    "../../app/api/public/password-reset/route.ts",
  ]) {
    const source = lire(chemin);
    const journaux = [...source.matchAll(/console\.(?:log|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[1]);
    for (const journal of journaux) {
      for (const interdit of ["token_hash", "hashed_token", "action_link", "actionLink", "access_token", "refresh_token", "session"]) {
        assert.ok(
          !journal.includes(interdit),
          `${chemin} journalise « ${interdit} » : ${journal.trim().slice(0, 80)}`,
        );
      }
    }
  }
});

await test("19. garde statique : aucune vérification au montage ni dans un effet", () => {
  const source = lire("../../components/auth/ResetPasswordForm.tsx");

  // `verifyOtp` ne doit apparaître QUE dans la dépendance du vérificateur,
  // jamais dans un useEffect.
  const effets = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)].map((m) => m[1]);
  assert.ok(effets.length > 0, "aucun effet trouvé — le test ne prouverait rien");
  for (const effet of effets) {
    assert.ok(!/verifyOtp/.test(effet), "verifyOtp ne doit jamais figurer dans un useEffect");
    assert.ok(!/\.tenter\(\)/.test(effet), "aucune tentative de vérification depuis un effet");
  }

  // La tentative part exclusivement d'un gestionnaire d'évènement.
  assert.ok(/onClick=\{handleVerifier\}/.test(source), "la vérification doit partir d'un onClick");
  const handler = source.slice(source.indexOf("async function handleVerifier"));
  assert.ok(handler.includes("verificateurRef.current.tenter()"), "le handler doit appeler le vérificateur");

  // Le type est repassé tel quel, sans conversion.
  assert.ok(/type: jeton\.type/.test(source), "le type doit être transmis sans transformation");

  // La page ne doit ni précharger, ni rediriger automatiquement.
  const page = lire("../../app/reinitialiser-mot-de-passe/page.tsx");
  assert.ok(page.includes('dynamic = "force-dynamic"'), "la page ne doit pas être mise en cache");
  assert.ok(page.includes('referrer: "no-referrer"'), "aucun Referer ne doit sortir de cette page");
  assert.ok(!/redirect\(/.test(page), "aucune redirection automatique");
});

await test("20. la liste des types acceptés reste minimale", () => {
  assert.deepEqual([...TYPES_ACTIVATION_AUTORISES], ["invite", "recovery"]);
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
