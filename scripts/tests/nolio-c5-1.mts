/**
 * Harnais — NOLIO C5.1 : LA CONNEXION OAUTH2 D'UN ÉLÈVE À SON COMPTE NOLIO.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Qu'un jeton n'est JAMAIS écrit en clair ; qu'un chiffré altéré d'un octet
 * ne se déchiffre pas en silence ; qu'une clé tronquée est refusée alors que
 * `Buffer.from(x, "base64")` ne lève jamais ; que le `redirect_uri` part
 * octet pour octet tel qu'il est déclaré ; qu'aucun `scope` n'est inventé ;
 * qu'un `state` invalide fait échouer AVANT que le code ne soit consommé ;
 * qu'une réponse Nolio sans nouveau refresh_token est refusée parce que Nolio
 * ROTE ; que deux rafraîchissements concurrents ne se marchent pas dessus ;
 * et que le `client_secret` n'existe nulle part hors du module serveur qui
 * signe l'en-tête Basic.
 *
 * ════════════════════════════════════════════════════════════════════════
 * COMMENT IL LE PROUVE — ET POURQUOI PAS AUTREMENT
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN RÉSEAU, AUCUNE BASE. `globalThis.fetch` est remplacé par un
 * standard téléphonique qui route sur le NOM D'HÔTE : `faux.supabase.test`
 * répond comme PostgREST, `www.nolio.io` comme Nolio. Le client Supabase
 * réel est construit par-dessus.
 *
 * ⚠️ CE N'EST PAS UNE FAUSSE BASE ÉCRITE À LA MAIN, ET C'EST LE POINT. Un
 * faux client maison valide la requête que le test IMAGINE ; ici on lit l'URL
 * PostgREST réellement produite par `@supabase/supabase-js`, filtres compris.
 * Un `.or(...)` mal écrit — la prise de bail — se verrait.
 *
 * Lancement : npm run test:nolio-c5-1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/* ════════════════════════════════════════════════════════════════════════
 * LE STANDARD TÉLÉPHONIQUE — POSÉ AVANT TOUT IMPORT DE MODULE APPLICATIF
 * ════════════════════════════════════════════════════════════════════════ */

interface AppelHttp {
  readonly url: string;
  readonly methode: string;
  readonly corps: string;
  readonly entetes: Record<string, string>;
}

let appels: AppelHttp[] = [];

/** Réponses PostgREST à servir, dans l'ordre. */
let filePostgrest: Array<{ statut: number; corps: unknown }> = [];
/** Réponses Nolio, indexées par fin de chemin. */
let reponsesNolio: Record<string, { statut: number; corps: unknown } | "panne"> = {};

function reinitialiserReseau() {
  appels = [];
  filePostgrest = [];
  reponsesNolio = {};
}

globalThis.fetch = (async (entree: unknown, init: RequestInit = {}) => {
  const url = typeof entree === "string" ? entree : String((entree as { url: string }).url);
  const entetes: Record<string, string> = {};
  new Headers(init.headers ?? {}).forEach((v, k) => {
    entetes[k.toLowerCase()] = v;
  });
  appels.push({
    url,
    methode: (init.method ?? "GET").toUpperCase(),
    corps: typeof init.body === "string" ? init.body : "",
    entetes,
  });

  const hote = new URL(url).host;

  if (hote === "www.nolio.io") {
    const cle = Object.keys(reponsesNolio).find((k) => url.includes(k));
    const prevue = cle ? reponsesNolio[cle] : undefined;
    if (prevue === "panne") throw new TypeError("réseau simulé indisponible");
    if (!prevue) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(prevue.corps), {
      status: prevue.statut,
      headers: { "Content-Type": "application/json" },
    });
  }

  const suivante = filePostgrest.shift() ?? { statut: 200, corps: [] };
  return new Response(JSON.stringify(suivante.corps), {
    status: suivante.statut,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

/* ── Environnement de test. AUCUNE VALEUR RÉELLE, aucune ne le ressemble. ── */

const CLE_A = randomBytes(32).toString("base64");
const CLE_B = randomBytes(32).toString("base64");
const REDIRECT = "https://exemple.test/api/nolio/callback";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faux.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-test";
process.env.NOLIO_CLIENT_ID = "identifiant-de-test";
process.env.NOLIO_CLIENT_SECRET = "secret-de-test-jamais-reel";
process.env.NOLIO_REDIRECT_URI = REDIRECT;
process.env.NOLIO_TOKEN_ENCRYPTION_KEY = CLE_A;

/* ⚠️ IMPORTS DYNAMIQUES : les statiques sont hissés AVANT les lignes
 * ci-dessus, et les modules liraient alors un environnement vide. */
const crypto = await import("../../lib/nolio/crypto");
const oauth = await import("../../lib/nolio/oauth");
const stockage = await import("../../lib/supabase/nolio");

/* ── Harnais ─────────────────────────────────────────────────────────────── */

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  reinitialiserReseau();
  process.env.NOLIO_TOKEN_ENCRYPTION_KEY = CLE_A;
  process.env.NOLIO_CLIENT_ID = "identifiant-de-test";
  process.env.NOLIO_CLIENT_SECRET = "secret-de-test-jamais-reel";
  process.env.NOLIO_REDIRECT_URI = REDIRECT;
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

/** Le motif d'une `NolioCryptoErreur` / `NolioErreur`, ou `null`. */
function motifLeve(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { motif?: string }).motif ?? `SANS-MOTIF:${String(e)}`;
  }
}

async function motifLeveAsync(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { motif?: string }).motif ?? `SANS-MOTIF:${String(e)}`;
  }
}

const JETONS_NOLIO = {
  access_token: "acces-simule-AAAA",
  refresh_token: "rafraichir-simule-RRRR",
  token_type: "bearer",
  expires_in: 86_400,
  scope: "read write",
};

/* ════════════════════════════════════════════════════════════════════════
 * I. LE CHIFFREMENT — CE QUI PROTÈGE UN REFRESH_TOKEN QUI N'EXPIRE JAMAIS
 * ════════════════════════════════════════════════════════════════════════ */

await test("N1. un jeton chiffré se relit à l'identique", () => {
  const clair = "acces-AAAA.bbbb-CCCC";
  assert.equal(crypto.dechiffrerJeton(crypto.chiffrerJeton(clair)), clair);
});

await test("N2. le chiffré ne contient jamais le clair, même en fragment", () => {
  const clair = "MOTIF-RECONNAISSABLE-1234567890";
  const enveloppe = crypto.chiffrerJeton(clair);
  assert.ok(!enveloppe.includes(clair), "le clair apparaît tel quel");
  // ⚠️ ON CHERCHE AUSSI DES MORCEAUX. Un chiffrement par bloc mal câblé peut
  // laisser passer un préfixe : la présence du clair entier n'est pas la
  // seule fuite possible.
  for (let i = 0; i + 8 <= clair.length; i += 1) {
    assert.ok(!enveloppe.includes(clair.slice(i, i + 8)), `fragment « ${clair.slice(i, i + 8)} » présent`);
  }
});

await test("N3. deux chiffrements du MÊME clair diffèrent — l'IV n'est jamais réutilisé", () => {
  const a = crypto.chiffrerJeton("identique");
  const b = crypto.chiffrerJeton("identique");
  assert.notEqual(a, b, "deux enveloppes identiques : IV figé");
  // ⚠️ RÉUTILISER UN IV EN GCM NE FUITE PAS SEULEMENT LE CLAIR : cela permet
  // de retrouver la clé d'authentification. C'est la garde la plus coûteuse
  // à perdre du module.
  assert.notEqual(a.split(".")[1], b.split(".")[1], "IV identique entre deux chiffrements");
});

await test("N4. le format est auto-descriptif : v<version>.<iv>.<tag>.<chiffré>", () => {
  const morceaux = crypto.chiffrerJeton("x").split(".");
  assert.equal(morceaux.length, 4);
  assert.equal(morceaux[0], `v${crypto.VERSION_DE_CLE_COURANTE}`);
  // base64url n'emploie ni `.`, ni `+`, ni `/` : le point reste un séparateur sûr.
  for (const champ of morceaux.slice(1)) {
    assert.match(champ, /^[A-Za-z0-9_-]+$/, `champ non base64url : ${champ}`);
  }
  assert.equal(Buffer.from(morceaux[1], "base64url").length, 12, "IV de 12 octets");
  assert.equal(Buffer.from(morceaux[2], "base64url").length, 16, "tag de 16 octets");
});

await test("N5. NÉGATIF — un chiffré altéré d'un seul octet ne se déchiffre pas en silence", () => {
  const enveloppe = crypto.chiffrerJeton("acces-AAAA");
  const [v, iv, tag, chiffre] = enveloppe.split(".");
  const octets = Buffer.from(chiffre, "base64url");
  octets[0] ^= 0x01;
  const altere = [v, iv, tag, octets.toString("base64url")].join(".");
  // ⚠️ C'EST LA RAISON D'ÊTRE DE GCM. En CBC, ce déchiffrement rendrait des
  // octets arbitraires — qu'on enverrait ensuite à Nolio comme un jeton.
  assert.equal(motifLeve(() => crypto.dechiffrerJeton(altere)), "authentification-echouee");
});

await test("N6. NÉGATIF — un tag d'authentification altéré est refusé", () => {
  const [v, iv, tag, chiffre] = crypto.chiffrerJeton("acces-AAAA").split(".");
  const octets = Buffer.from(tag, "base64url");
  octets[15] ^= 0xff;
  const altere = [v, iv, octets.toString("base64url"), chiffre].join(".");
  assert.equal(motifLeve(() => crypto.dechiffrerJeton(altere)), "authentification-echouee");
});

await test("N7. NÉGATIF — un chiffré d'une AUTRE clé ne se déchiffre pas", () => {
  const enveloppe = crypto.chiffrerJeton("acces-AAAA");
  process.env.NOLIO_TOKEN_ENCRYPTION_KEY = CLE_B;
  assert.equal(motifLeve(() => crypto.dechiffrerJeton(enveloppe)), "authentification-echouee");
});

await test("N8. NÉGATIF — clé absente : refus explicite, jamais de repli en clair", () => {
  delete process.env.NOLIO_TOKEN_ENCRYPTION_KEY;
  assert.equal(crypto.cleDeChiffrementDisponible(), false);
  assert.equal(motifLeve(() => crypto.chiffrerJeton("x")), "cle-absente");
  assert.equal(motifLeve(() => crypto.dechiffrerJeton("v1.a.b.c")), "cle-absente");
});

await test("N9. NÉGATIF — clé TRONQUÉE refusée, alors que Buffer.from ne lève jamais", () => {
  // ⚠️ C'EST LE PIÈGE QUE LA GARDE DE LONGUEUR EXISTE POUR FERMER.
  // `Buffer.from(x, "base64")` ignore les caractères invalides et rend un
  // tampon PLUS COURT sans jamais lever : sans contrôle explicite, une clé de
  // 16 octets passerait le premier filtre.
  assert.doesNotThrow(() => Buffer.from(randomBytes(16).toString("base64"), "base64"));
  process.env.NOLIO_TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
  assert.equal(crypto.cleDeChiffrementDisponible(), false);
  assert.equal(motifLeve(() => crypto.chiffrerJeton("x")), "cle-invalide");

  process.env.NOLIO_TOKEN_ENCRYPTION_KEY = randomBytes(48).toString("base64");
  assert.equal(motifLeve(() => crypto.chiffrerJeton("x")), "cle-invalide", "clé trop LONGUE acceptée");
});

await test("N10. NÉGATIF — une version inconnue a son propre motif, distinct du format", () => {
  const [, iv, tag, chiffre] = crypto.chiffrerJeton("x").split(".");
  assert.equal(motifLeve(() => crypto.dechiffrerJeton(["v9", iv, tag, chiffre].join("."))), "version-inconnue");
  // ⚠️ DEUX MOTIFS, PARCE QUE DEUX RÉPONSES. Le jour de la rotation il faudra
  // distinguer « illisible » de « génération précédente, à re-chiffrer ».
  assert.equal(motifLeve(() => crypto.dechiffrerJeton("v1.deux.champs")), "format-invalide");
  assert.equal(motifLeve(() => crypto.dechiffrerJeton("x1.a.b.c")), "format-invalide");
});

await test("N11. NÉGATIF — aucune erreur du module ne porte le clair ni la clé", () => {
  const clair = "SECRET-A-NE-PAS-VOIR-9999";
  const enveloppe = crypto.chiffrerJeton(clair);
  process.env.NOLIO_TOKEN_ENCRYPTION_KEY = CLE_B;
  try {
    crypto.dechiffrerJeton(enveloppe);
    assert.fail("aurait dû lever");
  } catch (e) {
    const texte = `${(e as Error).message}\n${(e as Error).stack ?? ""}`;
    assert.ok(!texte.includes(clair), "le clair apparaît dans l'erreur");
    assert.ok(!texte.includes(CLE_A) && !texte.includes(CLE_B), "une clé apparaît dans l'erreur");
    assert.ok(!texte.includes(enveloppe), "le chiffré apparaît dans l'erreur");
  }
});

await test("N12. le state est de l'aléa cryptographique, comparé en temps constant", () => {
  const a = crypto.genererState();
  const b = crypto.genererState();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, 32, "moins de 32 octets d'aléa");
  assert.match(a, /^[A-Za-z0-9_-]+$/);

  assert.equal(crypto.comparerEnTempsConstant(a, a), true);
  assert.equal(crypto.comparerEnTempsConstant(a, b), false);
  // ⚠️ `timingSafeEqual` LÈVE SUR DES LONGUEURS DIFFÉRENTES. Sans le contrôle
  // préalable, un `state` tronqué ferait planter le callback au lieu de le
  // refuser proprement.
  assert.doesNotThrow(() => crypto.comparerEnTempsConstant(a, a.slice(0, 5)));
  assert.equal(crypto.comparerEnTempsConstant(a, a.slice(0, 5)), false);
  assert.equal(crypto.comparerEnTempsConstant("", ""), true);

  // ⚠️ ET ICI ON LIT LA SOURCE, PARCE QUE LE COMPORTEMENT NE SUFFIT PAS.
  // Un `a === b` rend exactement les mêmes réponses que `timingSafeEqual` :
  // aucune assertion sur les valeurs ne peut les distinguer. Ce qui les
  // sépare est le TEMPS de réponse, qu'un test ne peut pas mesurer sans
  // devenir instable. Le sabotage l'a prouvé — remplacer l'appel par `===`
  // laissait ce test vert. La seule garde honnête est structurelle.
  const source = lire("../../lib/nolio/crypto.ts");
  const corps = source.slice(source.indexOf("export function comparerEnTempsConstant"));
  assert.match(corps, /return timingSafeEqual\(ba, bb\);/, "comparaison de state non constante");
  assert.ok(!/return a === b|return a == b/.test(corps), "comparaison de state par ===");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LE PROTOCOLE OAUTH — CE QUE NOLIO REÇOIT EXACTEMENT
 * ════════════════════════════════════════════════════════════════════════ */

await test("N13. l'URL d'autorisation est celle de la documentation, sans invention", () => {
  const url = new URL(oauth.urlDAutorisation("ETAT-123"));
  assert.equal(url.origin, "https://www.nolio.io");
  assert.equal(url.pathname, "/api/authorize/");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "identifiant-de-test");
  assert.equal(url.searchParams.get("state"), "ETAT-123");
  // ⚠️ AUCUN `scope`. La documentation est explicite : ce paramètre n'est pas
  // demandé, toutes les routes sont accessibles par défaut. En envoyer un
  // serait inventer une API.
  assert.equal(url.searchParams.get("scope"), null, "un paramètre scope a été inventé");
});

await test("N14. le redirect_uri part OCTET POUR OCTET tel qu'il est déclaré", () => {
  const url = new URL(oauth.urlDAutorisation("s"));
  // ⚠️ NOLIO COMPARE SANS URL-DÉCODER. Et `sethcoaching.fr` comme
  // `www.sethcoaching.fr` répondent 200 : une URL reconstruite depuis
  // `request.url` varierait selon le domaine d'arrivée, et l'échange
  // échouerait par intermittence, jamais de façon reproductible.
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
  assert.ok(!url.searchParams.get("redirect_uri")!.endsWith("/"), "barre oblique finale ajoutée");
});

await test("N15. l'origine du site est DÉRIVÉE du redirect_uri, pas de NEXT_PUBLIC_APP_URL", () => {
  const ancienne = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://un-autre-domaine.invalide";
  try {
    assert.equal(oauth.origineDuSite(), "https://exemple.test");
    process.env.NOLIO_REDIRECT_URI = "https://www.autre.test/api/nolio/callback";
    assert.equal(oauth.origineDuSite(), "https://www.autre.test", "l'origine ne suit pas le redirect_uri");
  } finally {
    if (ancienne === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ancienne;
  }
});

await test("N16. NÉGATIF — configuration incomplète : refus, sans nommer la variable absente", () => {
  for (const variable of ["NOLIO_CLIENT_ID", "NOLIO_CLIENT_SECRET", "NOLIO_REDIRECT_URI"]) {
    const ancienne = process.env[variable];
    delete process.env[variable];
    assert.equal(oauth.nolioEstConfigure(), false, `${variable} absente non détectée`);
    const motif = motifLeve(() => oauth.urlDAutorisation("s"));
    assert.equal(motif, "configuration-absente");
    // ⚠️ NOMMER LA VARIABLE MANQUANTE DANS UNE ERREUR QUI ATTEINT UN JOURNAL
    // PARTAGÉ, c'est cartographier la configuration du serveur.
    try {
      oauth.urlDAutorisation("s");
    } catch (e) {
      assert.ok(!(e as Error).message.includes(variable), `l'erreur nomme ${variable}`);
    }
    process.env[variable] = ancienne;
  }
  // ⚠️ UNE CHAÎNE VIDE OU BLANCHE N'EST PAS UNE CONFIGURATION.
  process.env.NOLIO_CLIENT_SECRET = "   ";
  assert.equal(oauth.nolioEstConfigure(), false, "un secret blanc est accepté");
});

await test("N17. l'échange de code envoie un Basic, pas un secret dans le corps", async () => {
  reponsesNolio = { "/api/token/": { statut: 200, corps: JETONS_NOLIO } };
  const jetons = await oauth.echangerCode("CODE-ABC");

  const appel = appels.find((a) => a.url.includes("/api/token/"))!;
  assert.equal(appel.methode, "POST");
  assert.equal(appel.entetes["content-type"], "application/x-www-form-urlencoded");
  const attendu = Buffer.from("identifiant-de-test:secret-de-test-jamais-reel").toString("base64");
  assert.equal(appel.entetes["authorization"], `Basic ${attendu}`);

  const corps = new URLSearchParams(appel.corps);
  assert.equal(corps.get("grant_type"), "authorization_code");
  assert.equal(corps.get("code"), "CODE-ABC");
  assert.equal(corps.get("redirect_uri"), REDIRECT, "redirect_uri absent ou modifié à l'échange");
  // ⚠️ LE SECRET N'A RIEN À FAIRE DANS LE CORPS. Un corps est journalisé par
  // bien plus d'intermédiaires qu'un en-tête d'autorisation.
  assert.equal(corps.get("client_secret"), null, "client_secret placé dans le corps");
  assert.ok(!appel.url.includes("secret"), "secret dans l'URL");

  assert.equal(jetons.accessToken, "acces-simule-AAAA");
  assert.equal(jetons.refreshToken, "rafraichir-simule-RRRR");
  assert.equal(jetons.scope, "read write");
  const restant = jetons.expiresAt.getTime() - Date.now();
  assert.ok(restant > 86_000_000 && restant <= 86_400_000, `échéance improbable : ${restant}`);
});

await test("N18. NÉGATIF — une réponse SANS refresh_token est refusée : Nolio rote", async () => {
  reponsesNolio = {
    "/api/token/": { statut: 200, corps: { access_token: "a", expires_in: 86_400 } },
  };
  // ⚠️ ACCEPTER CETTE RÉPONSE, C'EST GARDER LE REFRESH_TOKEN QU'ON VIENT
  // D'INVALIDER — et perdre la connexion au rafraîchissement suivant,
  // silencieusement, des heures plus tard.
  assert.equal(await motifLeveAsync(() => oauth.echangerCode("c")), "reponse-illisible");

  reponsesNolio = { "/api/token/": { statut: 200, corps: { refresh_token: "r" } } };
  assert.equal(await motifLeveAsync(() => oauth.echangerCode("c")), "reponse-illisible");

  reponsesNolio = { "/api/token/": { statut: 200, corps: { access_token: "  ", refresh_token: "r" } } };
  assert.equal(await motifLeveAsync(() => oauth.echangerCode("c")), "reponse-illisible", "jeton blanc accepté");
});

await test("N19. NÉGATIF — code refusé, amont muet, JSON illisible : trois motifs distincts", async () => {
  reponsesNolio = { "/api/token/": { statut: 400, corps: { error: "invalid_grant" } } };
  assert.equal(await motifLeveAsync(() => oauth.echangerCode("c")), "code-invalide");

  reponsesNolio = { "/api/token/": "panne" };
  assert.equal(await motifLeveAsync(() => oauth.echangerCode("c")), "amont-indisponible");

  reponsesNolio = { "/api/token/": { statut: 200, corps: "pas du json objet" } };
  assert.equal(await motifLeveAsync(() => oauth.echangerCode("c")), "reponse-illisible");
});

await test("N20. expires_in absent : repli sur les 24 h documentées, jamais sur l'éternité", async () => {
  reponsesNolio = {
    "/api/token/": { statut: 200, corps: { access_token: "a", refresh_token: "r" } },
  };
  const jetons = await oauth.echangerCode("c");
  const restant = jetons.expiresAt.getTime() - Date.now();
  assert.ok(restant > 86_000_000 && restant <= 86_400_000, `repli incorrect : ${restant}`);
});

await test("N21. le rafraîchissement emploie grant_type=refresh_token, sans redirect_uri", async () => {
  reponsesNolio = { "/api/token/": { statut: 200, corps: JETONS_NOLIO } };
  await oauth.rafraichirJetons("ancien-RRRR");
  const corps = new URLSearchParams(appels.find((a) => a.url.includes("/api/token/"))!.corps);
  assert.equal(corps.get("grant_type"), "refresh_token");
  assert.equal(corps.get("refresh_token"), "ancien-RRRR");
  assert.equal(corps.get("client_secret"), null);
});

await test("N22. NÉGATIF — un refresh_token rejeté a son propre motif", async () => {
  reponsesNolio = { "/api/token/": { statut: 401, corps: {} } };
  // ⚠️ DISTINCT DE `code-invalide`. Le stockage s'en sert pour décider si
  // l'échec est DÉFINITIF (revoked) ou seulement passager (error).
  assert.equal(await motifLeveAsync(() => oauth.rafraichirJetons("r")), "jeton-invalide");
});

await test("N23. la déautorisation NE LÈVE JAMAIS — une déconnexion doit aboutir", async () => {
  reponsesNolio = { "/api/deauthorize/": { statut: 200, corps: {} } };
  assert.equal(await oauth.deautoriser("a"), true);

  reponsesNolio = { "/api/deauthorize/": "panne" };
  assert.equal(await oauth.deautoriser("a"), false, "une panne amont a levé");

  reponsesNolio = { "/api/deauthorize/": { statut: 500, corps: {} } };
  assert.equal(await oauth.deautoriser("a"), false);

  // ⚠️ MÊME SANS CONFIGURATION. Garder la ligne locale parce que le
  // client_secret manque laisserait l'élève incapable de se déconnecter.
  delete process.env.NOLIO_CLIENT_SECRET;
  assert.equal(await oauth.deautoriser("a"), false);
});

await test("N24. l'identité Nolio n'est acceptée qu'en entier strictement positif", async () => {
  reponsesNolio = { "/api/get/user/": { statut: 200, corps: { id: 4242, first_name: "X" } } };
  assert.equal(await oauth.lireIdentiteNolio("acces-AAAA"), 4242);
  const appel = appels.find((a) => a.url.includes("/api/get/user/"))!;
  assert.equal(appel.entetes["authorization"], "Bearer acces-AAAA");
  // ⚠️ SANS `athlete_id` : on veut le TITULAIRE du jeton, pas un athlète géré.
  assert.ok(!appel.url.includes("athlete_id"), "athlete_id envoyé alors que hors périmètre");

  // ⚠️ LA COLONNE EST `bigint` AVEC `> 0`. Laisser passer un 0, un flottant ou
  // une chaîne ferait échouer l'écriture bien plus loin, sur une erreur de
  // base incompréhensible — à un endroit où plus personne ne cherche.
  for (const mauvais of [0, -1, 4.5, "4242", null, undefined]) {
    reponsesNolio = { "/api/get/user/": { statut: 200, corps: { id: mauvais } } };
    assert.equal(
      await motifLeveAsync(() => oauth.lireIdentiteNolio("a")),
      "identite-illisible",
      `id ${JSON.stringify(mauvais)} accepté`,
    );
  }

  reponsesNolio = { "/api/get/user/": { statut: 401, corps: {} } };
  assert.equal(await motifLeveAsync(() => oauth.lireIdentiteNolio("a")), "jeton-invalide");
});

await test("N25. NÉGATIF — aucune erreur OAuth ne porte le client_secret", async () => {
  const secret = process.env.NOLIO_CLIENT_SECRET!;
  reponsesNolio = { "/api/token/": { statut: 400, corps: { error: secret } } };
  try {
    await oauth.echangerCode("c");
    assert.fail("aurait dû lever");
  } catch (e) {
    const texte = `${(e as Error).message}\n${(e as Error).stack ?? ""}`;
    // ⚠️ MÊME QUAND L'AMONT LE RENVOIE. Le corps de la réponse n'est jamais
    // recopié dans l'erreur : c'est ce qui rend cette garde vraie même si
    // Nolio se met un jour à refléter la requête.
    assert.ok(!texte.includes(secret), "le client_secret a fui par l'erreur");
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LE STOCKAGE — CE QUI PART VRAIMENT VERS POSTGREST
 * ════════════════════════════════════════════════════════════════════════ */

const ELEVE = "11111111-1111-4111-8111-111111111111";
const AUTRE_ELEVE = "22222222-2222-4222-8222-222222222222";

const jetonsPourEcriture = (acces = "acces-AAAA", refresh = "refresh-RRRR") => ({
  accessToken: acces,
  refreshToken: refresh,
  expiresAt: new Date(Date.now() + 86_400_000),
  scope: "read write",
});

const appelsPostgrest = () => appels.filter((a) => a.url.includes("faux.supabase.test"));

await test("N26. les deux jetons partent CHIFFRÉS — aucun clair ne quitte le processus", async () => {
  filePostgrest = [
    { statut: 200, corps: null }, // contrôle de collision : personne
    { statut: 201, corps: [] }, // upsert
  ];
  await stockage.enregistrerConnexion(ELEVE, 4242, jetonsPourEcriture("acces-EN-CLAIR", "refresh-EN-CLAIR"));

  const ecriture = appelsPostgrest().find((a) => a.methode === "POST")!;
  assert.ok(ecriture, "aucune écriture émise");
  // ⚠️ LA PREUVE EST DANS LE CORPS HTTP, pas dans une intention. C'est
  // l'octet exact que PostgREST recevrait.
  assert.ok(!ecriture.corps.includes("acces-EN-CLAIR"), "access_token en clair dans la requête");
  assert.ok(!ecriture.corps.includes("refresh-EN-CLAIR"), "refresh_token en clair dans la requête");

  const charge = JSON.parse(ecriture.corps) as Record<string, unknown>;
  assert.match(String(charge.access_token), /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.match(String(charge.refresh_token), /^v1\./);
  assert.equal(crypto.dechiffrerJeton(String(charge.access_token)), "acces-EN-CLAIR");
  assert.equal(charge.key_version, crypto.VERSION_DE_CLE_COURANTE);
  assert.equal(charge.status, "active");
  // ⚠️ REMIS À NULL : une erreur d'hier ne doit pas rester affichée sur une
  // connexion qui vient de réussir, ni un bail figé bloquer le prochain
  // rafraîchissement.
  assert.equal(charge.last_error, null);
  assert.equal(charge.refresh_lock_at, null);
});

await test("N27. NÉGATIF — un compte Nolio déjà lié à un autre élève n'est pas réattribué", async () => {
  filePostgrest = [{ statut: 200, corps: { student_id: AUTRE_ELEVE } }];
  const motif = await motifLeveAsync(() => stockage.enregistrerConnexion(ELEVE, 4242, jetonsPourEcriture()));
  assert.equal(motif, "deja-liee-autre-eleve");
  // ⚠️ ET SURTOUT : RIEN N'A ÉTÉ ÉCRIT. Réattribuer donnerait au second élève
  // les séances du premier au prochain import.
  assert.equal(appelsPostgrest().filter((a) => a.methode !== "GET").length, 0, "une écriture a eu lieu");
});

await test("N28. reconnexion du MÊME élève au même compte : autorisée, en upsert", async () => {
  filePostgrest = [
    { statut: 200, corps: { student_id: ELEVE } },
    { statut: 201, corps: [] },
  ];
  await stockage.enregistrerConnexion(ELEVE, 4242, jetonsPourEcriture());
  const ecriture = appelsPostgrest().find((a) => a.methode === "POST")!;
  assert.ok(ecriture, "la reconnexion a été refusée à tort");
  assert.ok(
    ecriture.url.includes("on_conflict=student_id"),
    "l'upsert ne cible pas student_id : une seconde ligne serait créée",
  );
});

await test("N29. l'état de connexion lit la VUE sans jetons, jamais la table", async () => {
  filePostgrest = [
    {
      statut: 200,
      corps: {
        nolio_user_id: 4242,
        status: "active",
        connected_at: "2026-09-01T10:00:00Z",
        last_sync_at: null,
      },
    },
  ];
  const etat = await stockage.etatConnexion(ELEVE);

  const lecture = appelsPostgrest()[0];
  // ⚠️ LA VUE, ET C'EST UNE DÉFENSE EN PROFONDEUR : `nolio_connexion_etat` ne
  // SÉLECTIONNE aucun jeton. Même une faute de frappe dans le `.select()`
  // ci-dessus ne pourrait pas en faire remonter un.
  assert.ok(lecture.url.includes("/nolio_connexion_etat"), `lit ${lecture.url}`);
  assert.ok(!lecture.url.includes("/nolio_connections?"), "lit la table au lieu de la vue");
  assert.ok(!lecture.url.includes("access_token") && !lecture.url.includes("refresh_token"));

  assert.equal(etat.connecte, true);
  assert.equal(etat.nolioUserId, 4242);
  assert.ok(!Object.keys(etat).some((c) => /token|jeton|secret/i.test(c)), "un champ jeton dans l'état");
});

await test("N30. aucune ligne : état « non connecté », jamais une erreur à l'écran", async () => {
  filePostgrest = [{ statut: 200, corps: null }];
  assert.deepEqual(await stockage.etatConnexion(ELEVE), stockage.ETAT_NON_CONNECTE);
  assert.equal(stockage.ETAT_NON_CONNECTE.connecte, false);
});

await test("N31. un jeton encore frais est rendu sans appeler Nolio", async () => {
  const chiffre = crypto.chiffrerJeton("acces-FRAIS");
  filePostgrest = [
    {
      statut: 200,
      corps: {
        access_token: chiffre,
        refresh_token: crypto.chiffrerJeton("r"),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        status: "active",
      },
    },
  ];
  assert.equal(await stockage.jetonDAcces(ELEVE), "acces-FRAIS");
  // ⚠️ ZÉRO APPEL SORTANT. Nolio plafonne à 200 requêtes/heure en
  // développement : rafraîchir un jeton valable 23 h brûlerait le quota.
  assert.equal(appels.filter((a) => a.url.includes("nolio.io")).length, 0, "Nolio appelé sans raison");
});

await test("N32. un jeton proche de l'échéance est rafraîchi SOUS BAIL", async () => {
  filePostgrest = [
    {
      statut: 200,
      corps: {
        access_token: crypto.chiffrerJeton("acces-VIEUX"),
        refresh_token: crypto.chiffrerJeton("refresh-ANCIEN"),
        expires_at: new Date(Date.now() + 60_000).toISOString(), // < marge de 5 min
        status: "active",
      },
    },
    { statut: 200, corps: [{ student_id: ELEVE }] }, // bail pris
    { statut: 200, corps: [{ student_id: ELEVE }] }, // écriture conditionnelle
  ];
  reponsesNolio = {
    "/api/token/": {
      statut: 200,
      corps: { access_token: "acces-NEUF", refresh_token: "refresh-NEUF", expires_in: 86_400 },
    },
  };

  assert.equal(await stockage.jetonDAcces(ELEVE), "acces-NEUF");

  const prise = appelsPostgrest()[1];
  // ⚠️ LA PRISE DE BAIL EST UN `UPDATE ... WHERE` CONDITIONNEL, et c'est la
  // seule construction atomique disponible ici : `pg_advisory_xact_lock` ne
  // tient que le temps d'une transaction, pas celui d'un aller-retour HTTP
  // vers Nolio.
  assert.equal(prise.methode, "PATCH", "la prise de bail n'est pas un UPDATE");
  assert.ok(prise.url.includes("or="), "aucune clause « libre ou périmé » sur la prise de bail");
  assert.ok(
    decodeURIComponent(prise.url).includes("refresh_lock_at.is.null"),
    "un bail déjà posé ne pourrait jamais être repris",
  );
  assert.ok(decodeURIComponent(prise.url).includes("refresh_lock_at.lt."), "aucune péremption de bail");

  const corpsRafraichi = new URLSearchParams(appels.find((a) => a.url.includes("/api/token/"))!.corps);
  assert.equal(corpsRafraichi.get("refresh_token"), "refresh-ANCIEN");

  const ecriture = appelsPostgrest()[2];
  // ⚠️ CONDITIONNÉE AU BAIL QU'ON DÉTIENT ENCORE. Si Nolio a été lent et
  // qu'un autre processus a repris le bail, on n'écrase pas SON couple de
  // jetons — le seul valide, puisque l'ancien vient d'être invalidé.
  assert.ok(
    decodeURIComponent(ecriture.url).includes("refresh_lock_at=eq."),
    "l'écriture n'est pas conditionnée au bail détenu",
  );
  const charge = JSON.parse(ecriture.corps) as Record<string, unknown>;
  assert.ok(!ecriture.corps.includes("acces-NEUF"), "nouveau access_token écrit en clair");
  assert.ok(!ecriture.corps.includes("refresh-NEUF"), "nouveau refresh_token écrit en clair");
  assert.equal(crypto.dechiffrerJeton(String(charge.refresh_token)), "refresh-NEUF", "rotation non enregistrée");
  assert.equal(charge.refresh_lock_at, null, "bail non relâché");
});

await test("N33. NÉGATIF — bail perdu : on ne rafraîchit PAS, on rend null", async () => {
  filePostgrest = [
    {
      statut: 200,
      corps: {
        access_token: crypto.chiffrerJeton("a"),
        refresh_token: crypto.chiffrerJeton("r"),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        status: "active",
      },
    },
    { statut: 200, corps: [] }, // bail déjà détenu ailleurs
  ];
  reponsesNolio = { "/api/token/": { statut: 200, corps: JETONS_NOLIO } };

  assert.equal(await stockage.jetonDAcces(ELEVE), null);
  // ⚠️ C'EST LA GARDE CENTRALE DE LA ROTATION. Présenter le refresh_token
  // pendant qu'un autre processus le rote, c'est le présenter APRÈS son
  // invalidation : la connexion serait perdue, et l'élève devrait tout
  // reconnecter à la main.
  assert.equal(appels.filter((a) => a.url.includes("nolio.io")).length, 0, "Nolio appelé sans le bail");
});

await test("N34. NÉGATIF — une connexion non active ne rend aucun jeton", async () => {
  for (const statut of ["revoked", "error", "expired"]) {
    reinitialiserReseau();
    filePostgrest = [
      {
        statut: 200,
        corps: {
          access_token: crypto.chiffrerJeton("a"),
          refresh_token: crypto.chiffrerJeton("r"),
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          status: statut,
        },
      },
    ];
    assert.equal(await stockage.jetonDAcces(ELEVE), null, `statut ${statut} a rendu un jeton`);
  }
});

await test("N35. un refresh_token REJETÉ est définitif ; une panne amont ne l'est pas", async () => {
  const ligne = {
    statut: 200,
    corps: {
      access_token: crypto.chiffrerJeton("a"),
      refresh_token: crypto.chiffrerJeton("r"),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      status: "active",
    },
  };

  filePostgrest = [ligne, { statut: 200, corps: [{ student_id: ELEVE }] }, { statut: 200, corps: [] }];
  reponsesNolio = { "/api/token/": { statut: 401, corps: {} } };
  assert.equal(await stockage.jetonDAcces(ELEVE), null);
  let echec = JSON.parse(appelsPostgrest().at(-1)!.corps) as Record<string, unknown>;
  // ⚠️ « revoked » PARCE QUE RÉESSAYER EST INUTILE. Un refresh_token rejeté
  // ne le sera jamais moins : une boucle de tentatives brûlerait le quota
  // sans jamais aboutir.
  assert.equal(echec.status, "revoked");

  reinitialiserReseau();
  filePostgrest = [ligne, { statut: 200, corps: [{ student_id: ELEVE }] }, { statut: 200, corps: [] }];
  reponsesNolio = { "/api/token/": "panne" };
  assert.equal(await stockage.jetonDAcces(ELEVE), null);
  echec = JSON.parse(appelsPostgrest().at(-1)!.corps) as Record<string, unknown>;
  assert.equal(echec.status, "error", "une panne passagère marquée définitive");
  assert.equal(echec.refresh_lock_at, null, "bail non relâché après échec : blocage d'une minute");
});

await test("N36. NÉGATIF — last_error ne porte qu'un motif court, jamais un jeton", async () => {
  filePostgrest = [
    {
      statut: 200,
      corps: {
        access_token: crypto.chiffrerJeton("a"),
        refresh_token: crypto.chiffrerJeton("refresh-SECRET-NE-PAS-JOURNALISER"),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        status: "active",
      },
    },
    { statut: 200, corps: [{ student_id: ELEVE }] },
    { statut: 200, corps: [] },
  ];
  reponsesNolio = { "/api/token/": { statut: 401, corps: { error: "refresh-SECRET-NE-PAS-JOURNALISER" } } };
  await stockage.jetonDAcces(ELEVE);

  const echec = JSON.parse(appelsPostgrest().at(-1)!.corps) as Record<string, unknown>;
  // ⚠️ CETTE COLONNE EST LISIBLE PAR UN ADMINISTRATEUR. Elle doit rester
  // sans valeur pour quiconque y accéderait.
  assert.ok(!String(echec.last_error).includes("SECRET"), `last_error porte un jeton : ${echec.last_error}`);
  assert.ok(String(echec.last_error).length <= 64, "last_error non borné : un corps de réponse pourrait y entrer");

  // ⚠️ ET LE BORNAGE EST VÉRIFIÉ DANS LA SOURCE, faute de pouvoir l'atteindre.
  // Aujourd'hui tous les motifs qui parviennent à `marquerEchec` viennent
  // d'une énumération courte : l'assertion de longueur ci-dessus passe même
  // si le `slice` disparaît — le sabotage l'a montré. Le `slice` est une
  // défense en profondeur contre un motif FUTUR non borné ; c'est donc sa
  // présence, et non son effet observable, qui doit être gardée.
  const source = lire("../../lib/supabase/nolio.ts");
  const corps = source.slice(source.indexOf("async function marquerEchec"));
  assert.match(corps, /last_error: motif\.slice\(0, \d+\)/, "last_error écrit sans bornage");
});

await test("N37. NÉGATIF — un chiffré illisible marque l'erreur et n'appelle pas Nolio", async () => {
  filePostgrest = [
    {
      statut: 200,
      corps: {
        access_token: crypto.chiffrerJeton("a"),
        refresh_token: "v1.pas.un.chiffre",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        status: "active",
      },
    },
    { statut: 200, corps: [{ student_id: ELEVE }] },
    { statut: 200, corps: [] },
  ];
  assert.equal(await stockage.jetonDAcces(ELEVE), null);
  assert.equal(appels.filter((a) => a.url.includes("nolio.io")).length, 0, "un chiffré illisible envoyé à Nolio");
  const echec = JSON.parse(appelsPostgrest().at(-1)!.corps) as Record<string, unknown>;
  assert.equal(echec.status, "error");
});

await test("N38. la déconnexion révoque chez Nolio PUIS supprime, et reste idempotente", async () => {
  filePostgrest = [
    { statut: 200, corps: { access_token: crypto.chiffrerJeton("acces-A-REVOQUER") } },
    { statut: 204, corps: [] },
  ];
  reponsesNolio = { "/api/deauthorize/": { statut: 200, corps: {} } };

  assert.equal(await stockage.supprimerConnexion(ELEVE), true);
  const deautorisation = appels.find((a) => a.url.includes("/api/deauthorize/"))!;
  assert.ok(deautorisation, "aucune révocation envoyée à Nolio");
  assert.equal(new URLSearchParams(deautorisation.corps).get("token"), "acces-A-REVOQUER");
  assert.ok(appelsPostgrest().some((a) => a.methode === "DELETE"), "la ligne n'a pas été supprimée");

  // ⚠️ ABSENTE = SUCCÈS. Un second clic ou un rechargement ne doit pas
  // afficher une erreur à un élève qui a déjà obtenu ce qu'il voulait.
  reinitialiserReseau();
  filePostgrest = [{ statut: 200, corps: null }];
  assert.equal(await stockage.supprimerConnexion(ELEVE), false);
  assert.equal(appelsPostgrest().filter((a) => a.methode === "DELETE").length, 0);
});

await test("N39. Nolio injoignable : la ligne locale est SUPPRIMÉE quand même", async () => {
  filePostgrest = [
    { statut: 200, corps: { access_token: crypto.chiffrerJeton("a") } },
    { statut: 204, corps: [] },
  ];
  reponsesNolio = { "/api/deauthorize/": "panne" };
  assert.equal(await stockage.supprimerConnexion(ELEVE), true);
  // ⚠️ GARDER LA LIGNE « AU CAS OÙ » LAISSERAIT DES JETONS VIVANTS EN BASE et
  // l'élève sans aucun moyen de se déconnecter.
  assert.ok(appelsPostgrest().some((a) => a.methode === "DELETE"), "suppression annulée par une panne amont");
});

await test("N40. un chiffré illisible n'empêche pas la déconnexion", async () => {
  filePostgrest = [{ statut: 200, corps: { access_token: "illisible" } }, { statut: 204, corps: [] }];
  assert.equal(await stockage.supprimerConnexion(ELEVE), true);
  assert.ok(appelsPostgrest().some((a) => a.methode === "DELETE"));
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. LA MIGRATION — CE QUE LA BASE INTERDIT D'ELLE-MÊME
 * ════════════════════════════════════════════════════════════════════════ */

const MIGRATION = lire("../../supabase/migrations/20260922090000_c5_1_connexions_nolio.sql");
const sansProse = (sql: string) => sql.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");
const SQL = sansProse(MIGRATION);

await test("N41. la table refuse ce que le code pourrait laisser passer", () => {
  assert.match(SQL, /create table if not exists public\.nolio_connections/);
  // Un élève, une connexion — et un compte Nolio, un élève.
  assert.match(SQL, /student_id uuid not null unique references public\.students \(id\) on delete cascade/);
  assert.match(SQL, /nolio_user_id bigint not null unique/);
  // ⚠️ LES CONTRAINTES SONT LE DERNIER MOT. Le contrôle de collision côté
  // code donne un message lisible ; c'est `unique` qui ferme la course entre
  // deux callbacks simultanés, qu'aucune vérification préalable ne peut fermer.
  assert.match(SQL, /nolio_connections_nolio_user_id_positive check \(nolio_user_id > 0\)/);
  assert.match(SQL, /check \(status in \('active', 'expired', 'revoked', 'error'\)\)/);
  assert.match(SQL, /nolio_connections_tokens_non_vides/);
  assert.match(SQL, /length\(btrim\(access_token\)\) > 0/);
  assert.match(SQL, /refresh_lock_at timestamptz/);
  assert.match(SQL, /key_version smallint not null default 1/);
});

await test("N42. NÉGATIF — `authenticated` n'a AUCUN privilège sur les jetons", () => {
  assert.match(SQL, /alter table public\.nolio_connections enable row level security/);
  assert.match(SQL, /revoke all on table public\.nolio_connections from public, anon, authenticated/);
  assert.match(SQL, /grant all on table public\.nolio_connections to service_role/);
  // ⚠️ ON CHERCHE UN GRANT DE TROP, PAS SEULEMENT LA PRÉSENCE DU REVOKE.
  // Un `grant select ... to authenticated` ajouté plus bas annulerait le
  // revoke sans rien changer aux lignes ci-dessus.
  const grants = [...SQL.matchAll(/grant\s+[^;]*?\s+to\s+([^;]+);/gi)].map((m) => m[1]);
  for (const beneficiaires of grants) {
    assert.ok(
      !/\b(anon|authenticated|public)\b/.test(beneficiaires),
      `un grant profite à « ${beneficiaires.trim()} » : un élève pourrait lire les jetons`,
    );
  }
  // La seule policy est administrative — aucune policy « propriétaire ».
  const policies = [...SQL.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(policies, ["nolio_connections_manage_admin"]);
  assert.ok(!/current_student_id\(\)/.test(SQL), "une policy ouvre la table à l'élève propriétaire");
});

await test("N43. la vue d'état ne SÉLECTIONNE aucun jeton, et reste en security_invoker", () => {
  const vue = SQL.slice(SQL.indexOf("create or replace view public.nolio_connexion_etat"));
  const selection = vue.slice(0, vue.indexOf("from public.nolio_connections"));
  // ⚠️ LA VUE EST UNE DÉFENSE DE STRUCTURE, PAS UNE CONVENTION. Y ajouter
  // `access_token` suffirait à exposer un jeton à tout appelant de la vue.
  assert.ok(!/access_token|refresh_token/.test(selection), "la vue expose un jeton");
  assert.match(vue, /with \(security_invoker = true\)/);
  assert.match(SQL, /revoke all on public\.nolio_connexion_etat from public, anon, authenticated/);
});

await test("N44. la migration est ADDITIVE : elle ne touche à aucune table existante", () => {
  // ⚠️ AUCUN `alter table` SUR AUTRE CHOSE QUE LA TABLE QU'ELLE CRÉE, et
  // surtout rien sur `students` : `students.user_id` reste hors périmètre C5.1.
  for (const [, cible] of SQL.matchAll(/alter table\s+(?:if exists\s+)?([\w.]+)/gi)) {
    assert.equal(cible, "public.nolio_connections", `la migration altère ${cible}`);
  }
  assert.ok(!/drop table|drop column|truncate/i.test(SQL), "geste destructeur dans la migration");
  assert.ok(!/create or replace function/i.test(SQL), "la migration redonne une fonction hors périmètre");
  assert.ok(!/insert into/i.test(SQL), "insertion de données métier");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LES ROUTES — L'ORDRE DES CONTRÔLES EST LA SÉCURITÉ
 * ════════════════════════════════════════════════════════════════════════ */

const CONNECT = lire("../../app/api/nolio/connect/route.ts");
const CALLBACK = lire("../../app/api/nolio/callback/route.ts");
const DISCONNECT = lire("../../app/api/nolio/disconnect/route.ts");
const ETAT = lire("../../app/api/nolio/etat/route.ts");

const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

/**
 * Le corps du handler exporté, sans commentaires ni imports.
 *
 * ⚠️ SANS CETTE COUPE, TOUT TEST D'ORDRE SERAIT FAUX. Les `import` du haut de
 * fichier nomment `consumeRateLimit` et `echangerCode` avant le moindre
 * contrôle : un `indexOf` sur le fichier entier mesurerait l'ordre des
 * imports, jamais celui de l'exécution — et resterait vert même si le quota
 * était consommé en dernier.
 */
function corpsDuHandler(source: string): string {
  const code = sansCommentaires(source);
  const debut = code.search(/export async function (GET|POST)\(/);
  assert.ok(debut > 0, "aucun handler exporté trouvé");
  return code.slice(debut);
}

await test("N45. le cookie de state est étroit, éphémère et invisible au JavaScript", () => {
  const code = sansCommentaires(CONNECT);
  assert.match(code, /httpOnly:\s*true/);
  assert.match(code, /secure:\s*process\.env\.NODE_ENV === "production"/);
  // ⚠️ `lax` ET NON `strict`. Le retour de Nolio est une navigation
  // CROSS-SITE : en `strict`, le navigateur n'enverrait pas le cookie et le
  // callback rejetterait TOUTES les connexions légitimes.
  assert.match(code, /sameSite:\s*"lax"/);
  assert.ok(!/sameSite:\s*"strict"/.test(code), "sameSite strict casserait le retour de Nolio");
  assert.match(code, /path:\s*"\/api\/nolio"/);
  assert.match(code, /maxAge:\s*DUREE_COOKIE_STATE_S/);
  assert.equal(600, 600);
  assert.match(code, /DUREE_COOKIE_STATE_S = 600/);
  // ⚠️ LE COOKIE NE PORTE QUE DE L'ALÉA. Le lien avec l'élève se refait
  // côté callback par la SESSION, seule source d'identité fiable.
  assert.match(code, /value:\s*state/);
  assert.ok(!/student|email|user_id/i.test(code.slice(code.indexOf("cookies.set"))), "le cookie porte une identité");
});

await test("N46. connect refuse AVANT de poser le cookie si Nolio n'est pas configuré", () => {
  const code = sansCommentaires(CONNECT);
  const configure = code.indexOf("nolioEstConfigure()");
  const cookie = code.indexOf("cookies.set");
  assert.ok(configure > 0 && cookie > 0);
  assert.ok(configure < cookie, "le cookie est posé avant le contrôle de configuration");
  assert.match(code, /status:\s*503/);
});

await test("N47. connect exige une session, un profil élève, puis consomme un quota", () => {
  // ⚠️ ON MESURE DANS LE CORPS DU HANDLER, PAS DANS LE FICHIER. Les `import`
  // du haut nomment `consumeRateLimit` bien avant tout contrôle : mesurer sur
  // le fichier entier rendrait ce test vert quel que soit l'ordre réel.
  const code = corpsDuHandler(CONNECT);
  const session = code.indexOf("auth.getUser()");
  const eleve = code.indexOf('.from("students")');
  const quota = code.indexOf("consumeRateLimit");
  const redirection = code.indexOf("NextResponse.redirect");
  assert.ok(session > 0 && eleve > session && quota > eleve && redirection > quota, "ordre des contrôles rompu");
  assert.match(code, /status:\s*401/);
  assert.match(code, /status:\s*403/);
});

await test("N48. le callback vérifie le state AVANT d'échanger le code", () => {
  // ⚠️ DANS LE CORPS DU HANDLER, ET C'EST LE SABOTAGE QUI L'A EXIGÉ. Mesuré
  // sur le fichier entier, `comparerEnTempsConstant` était trouvé dans la
  // ligne d'`import` — donc toujours avant `echangerCode`, quel que soit
  // l'ordre réel des instructions. Le test restait vert sur un callback qui
  // échangeait le code en premier : exactement la faute qu'il prétend fermer.
  const code = corpsDuHandler(CALLBACK);
  const comparaison = code.indexOf("comparerEnTempsConstant");
  const echange = code.indexOf("echangerCode(");
  assert.ok(comparaison > 0 && echange > 0);
  // ⚠️ LE DÉFAUT CLASSIQUE SERAIT L'INVERSE : un attaquant ferait consommer à
  // Sethcoaching un code qu'il contrôle, et le refus arriverait trop tard —
  // les jetons auraient déjà été émis pour SON compte Nolio.
  assert.ok(comparaison < echange, "le code est échangé avant la vérification du state");
  // ⚠️ ET LA COMPARAISON EST À TEMPS CONSTANT. Un `===` fuite le nombre de
  // caractères corrects par le temps de réponse.
  assert.ok(
    !/stateRecu\s*===\s*stateAttendu|stateAttendu\s*===\s*stateRecu/.test(code),
    "comparaison de state par === ",
  );
});

await test("N49. le callback consomme un quota avant tout appel sortant", () => {
  const code = corpsDuHandler(CALLBACK);
  assert.ok(code.indexOf("consumeRateLimit") < code.indexOf("echangerCode("), "quota consommé après l'appel Nolio");
  assert.ok(code.indexOf("auth.getUser()") < code.indexOf("consumeRateLimit"), "quota avant la session");
});

await test("N50. NÉGATIF — aucun jeton ne transite par l'URL de redirection", () => {
  const code = sansCommentaires(CALLBACK);
  const redirections = [...code.matchAll(/versProfil\("([^"]*)"\)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(redirections)].sort(),
    ["code-absent", "code-invalide", "connecte", "deja-liee", "echec", "etat-invalide"],
  );
  // ⚠️ DES MOTS-CLÉS, PAS DES DÉTAILS. Ni statut HTTP amont, ni corps de
  // réponse : le mot suffit à l'écran et ne renseigne pas un attaquant.
  for (const mot of redirections) {
    assert.match(mot, /^[a-z-]+$/, `mot-clé suspect : ${mot}`);
  }
  assert.ok(!/accessToken|refreshToken|access_token/.test(code.slice(code.indexOf("function versProfil"), code.indexOf("export async function GET"))));
  // L'origine vient du redirect_uri, jamais d'un littéral ni de request.url.
  assert.match(code, /origineDuSite\(\)/);
  assert.ok(!/sethcoaching\.fr/.test(code), "domaine en dur dans le callback");
  assert.ok(!/NEXT_PUBLIC_APP_URL/.test(code), "le callback dérive son origine de NEXT_PUBLIC_APP_URL");
  assert.ok(!/new URL\(request\.url\)\.origin/.test(code), "origine dérivée de request.url");
});

await test("N51. le cookie de state est effacé sur CHAQUE sortie du callback", () => {
  const code = sansCommentaires(CALLBACK);
  const versProfil = code.slice(code.indexOf("function versProfil"), code.indexOf("export async function GET"));
  // ⚠️ TOUTES LES SORTIES PASSENT PAR LA MÊME FONCTION, et c'est elle qui
  // efface : un `state` qui survit à son usage est un `state` rejouable.
  assert.match(versProfil, /cookies\.set\(\{[^}]*maxAge:\s*0/);
  assert.match(versProfil, /path:\s*"\/api\/nolio"/);
});

await test("N52. la déconnexion est en POST, idempotente, et ne rend aucun identifiant", () => {
  const code = sansCommentaires(DISCONNECT);
  assert.match(code, /export async function POST\(/);
  assert.ok(!/export async function DELETE\(/.test(code), "DELETE est réservé aux routes admin par ressource");
  assert.match(code, /deconnecte:\s*true/);
  assert.ok(!/nolio_user_id|nolioUserId/.test(code), "l'identifiant Nolio sort d'une confirmation de déconnexion");
  assert.ok(!/access_token|refresh_token/.test(code));
});

await test("N53. la route d'état ne rend jamais de jeton, et exige une session", () => {
  const code = sansCommentaires(ETAT);
  assert.match(code, /auth\.getUser\(\)/);
  assert.match(code, /status:\s*401/);
  // ⚠️ CETTE ROUTE EXISTE PARCE QUE `authenticated` N'A AUCUN PRIVILÈGE SUR
  // LA TABLE : le navigateur ne peut pas interroger `nolio_connections`, même
  // avec la bonne RLS. Elle ne montre que ce que la vue contient.
  assert.match(code, /etatConnexion\(/);
  assert.ok(!/access_token|refresh_token|jetonDAcces/.test(code), "la route d'état touche à un jeton");
});

await test("N54. les quatre routes sont dynamiques — jamais mises en cache", () => {
  for (const [nom, code] of [
    ["connect", CONNECT],
    ["callback", CALLBACK],
    ["disconnect", DISCONNECT],
    ["etat", ETAT],
  ] as const) {
    assert.match(code, /export const dynamic = "force-dynamic"/, `${nom} n'est pas force-dynamic`);
  }
});

await test("N55. les quotas Nolio sont déclarés avec les autres règles du dépôt", () => {
  const regles = lire("../../lib/security/rules.ts");
  for (const nom of ["NOLIO_CONNECT", "NOLIO_CALLBACK", "NOLIO_DISCONNECT"]) {
    assert.ok(regles.includes(`export const ${nom}: RateLimitRule`), `${nom} non déclarée`);
  }
  assert.match(regles, /name:\s*"nolio_connect"/);
  assert.match(regles, /name:\s*"nolio_callback"/);
  assert.match(regles, /name:\s*"nolio_disconnect"/);
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. ANTI-FUITE — LE SECRET N'EXISTE QUE LÀ OÙ IL SIGNE
 * ════════════════════════════════════════════════════════════════════════ */

const CRYPTO_SRC = lire("../../lib/nolio/crypto.ts");
const OAUTH_SRC = lire("../../lib/nolio/oauth.ts");
const STOCKAGE_SRC = lire("../../lib/supabase/nolio.ts");
const CARTE = lire("../../components/student/NolioConnexionCard.tsx");
const ENV_EXEMPLE = lire("../../.env.example");

await test("N56. les trois modules Nolio sont strictement serveur", () => {
  for (const [nom, source] of [
    ["lib/nolio/crypto.ts", CRYPTO_SRC],
    ["lib/nolio/oauth.ts", OAUTH_SRC],
    ["lib/supabase/nolio.ts", STOCKAGE_SRC],
  ] as const) {
    // ⚠️ `server-only` EN PREMIÈRE LIGNE FAIT ÉCHOUER LE BUILD si un composant
    // client l'importe. C'est une garantie du compilateur, pas une convention.
    assert.ok(source.startsWith('import "server-only";'), `${nom} ne commence pas par server-only`);
    assert.ok(!source.includes('"use client"'), `${nom} porte "use client"`);
  }
});

await test("N57. NÉGATIF — aucune variable Nolio ne porte le préfixe NEXT_PUBLIC_", () => {
  const tout = [CRYPTO_SRC, OAUTH_SRC, STOCKAGE_SRC, CONNECT, CALLBACK, DISCONNECT, ETAT, CARTE, ENV_EXEMPLE].join("\n");
  // ⚠️ CE PRÉFIXE INSCRIRAIT LA VALEUR DANS LE CODE ENVOYÉ À CHAQUE VISITEUR.
  assert.ok(!/NEXT_PUBLIC_NOLIO/.test(tout), "une variable NEXT_PUBLIC_NOLIO_* existe");
});

await test("N58. NÉGATIF — le client_secret n'est lu que par le module qui signe", () => {
  // Il n'apparaît QUE dans oauth.ts (lecture + en-tête Basic) et dans la
  // documentation d'environnement. Nulle part ailleurs.
  assert.ok(OAUTH_SRC.includes("NOLIO_CLIENT_SECRET"));
  assert.ok(ENV_EXEMPLE.includes("NOLIO_CLIENT_SECRET="));
  for (const [nom, source] of [
    ["lib/nolio/crypto.ts", CRYPTO_SRC],
    ["lib/supabase/nolio.ts", STOCKAGE_SRC],
    ["connect/route.ts", CONNECT],
    ["callback/route.ts", CALLBACK],
    ["disconnect/route.ts", DISCONNECT],
    ["etat/route.ts", ETAT],
    ["NolioConnexionCard.tsx", CARTE],
  ] as const) {
    assert.ok(!source.includes("NOLIO_CLIENT_SECRET"), `${nom} lit le client_secret`);
  }
});

await test("N59. NÉGATIF — le composant client ne connaît ni jeton, ni secret, ni base", () => {
  assert.ok(CARTE.startsWith('"use client"'), "la carte n'est pas un composant client");
  // ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. La carte a le droit d'EXPLIQUER en
  // commentaire pourquoi elle ne voit aucun jeton ; elle n'a pas le droit d'en
  // manipuler un. Sans ce dépouillement, sa propre documentation la rougirait.
  const codeCarte = sansCommentaires(CARTE);
  for (const interdit of [
    "NOLIO_CLIENT_ID",
    "NOLIO_CLIENT_SECRET",
    "NOLIO_TOKEN_ENCRYPTION_KEY",
    "NOLIO_REDIRECT_URI",
    "access_token",
    "refresh_token",
    "process.env",
    "lib/nolio/",
    "lib/supabase/nolio",
    "createSupabaseAdminClient",
  ]) {
    assert.ok(!codeCarte.includes(interdit), `la carte cliente contient « ${interdit} »`);
  }
  // ⚠️ LA CONNEXION EST UNE NAVIGATION, PAS UN `fetch`. Un `fetch` suivrait
  // la redirection 302 vers Nolio en arrière-plan et l'élève ne verrait
  // jamais l'écran de consentement.
  assert.match(CARTE, /href="\/api\/nolio\/connect"/);
  assert.match(CARTE, /"\/api\/nolio\/etat"/);
});

await test("N60. NÉGATIF — aucune valeur secrète, réelle ou fictive, dans le dépôt", () => {
  for (const [nom, source] of [
    ["lib/nolio/crypto.ts", CRYPTO_SRC],
    ["lib/nolio/oauth.ts", OAUTH_SRC],
    ["lib/supabase/nolio.ts", STOCKAGE_SRC],
    [".env.example", ENV_EXEMPLE],
  ] as const) {
    // ⚠️ PAS MÊME UN FAUX. Un secret fictif commité finit par être copié dans
    // une configuration réelle « en attendant », puis oublié.
    for (const variable of [
      "NOLIO_CLIENT_ID",
      "NOLIO_CLIENT_SECRET",
      "NOLIO_REDIRECT_URI",
      "NOLIO_TOKEN_ENCRYPTION_KEY",
    ]) {
      const affectations = [...source.matchAll(new RegExp(`^[^\\S\\n]*${variable}[^\\S\\n]*=[^\\S\\n]*(.*)$`, "gm"))];
      for (const [, valeur] of affectations) {
        assert.equal(valeur.trim(), "", `${nom} : ${variable} porte une valeur`);
      }
    }
  }
  // Les quatre variables SONT documentées — l'absence de valeur n'excuse pas
  // l'absence de documentation.
  for (const variable of [
    "NOLIO_CLIENT_ID",
    "NOLIO_CLIENT_SECRET",
    "NOLIO_REDIRECT_URI",
    "NOLIO_TOKEN_ENCRYPTION_KEY",
  ]) {
    assert.ok(ENV_EXEMPLE.includes(`${variable}=`), `${variable} non documentée dans .env.example`);
  }
});

await test("N61. NÉGATIF — aucun endpoint Nolio inventé", () => {
  // ⚠️ QUATRE URL, TOUTES DOCUMENTÉES. Un cinquième chemin serait une API
  // devinée — et échouerait en production, jamais en test.
  const chemins = [...OAUTH_SRC.matchAll(/\$\{BASE_NOLIO\}(\/[a-z/]+\/)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(chemins)].sort(), ["/authorize/", "/deauthorize/", "/get/user/", "/token/"]);
  assert.match(OAUTH_SRC, /const BASE_NOLIO = "https:\/\/www\.nolio\.io\/api"/);
  assert.ok(!/http:\/\/(?!localhost)/.test(OAUTH_SRC), "un appel Nolio en clair (http)");
  // Tout appel sortant est borné dans le temps : un amont muet ne doit pas
  // immobiliser une fonction serverless jusqu'à son plafond.
  assert.equal((OAUTH_SRC.match(/AbortSignal\.timeout\(DELAI_MS\)/g) ?? []).length, 3);
});

await test("N62. NÉGATIF — rien de sensible n'est journalisé", () => {
  for (const [nom, source] of [
    ["lib/nolio/crypto.ts", CRYPTO_SRC],
    ["lib/nolio/oauth.ts", OAUTH_SRC],
    ["lib/supabase/nolio.ts", STOCKAGE_SRC],
    ["connect/route.ts", CONNECT],
    ["callback/route.ts", CALLBACK],
    ["disconnect/route.ts", DISCONNECT],
    ["etat/route.ts", ETAT],
  ] as const) {
    const code = sansCommentaires(source);
    // ⚠️ UN SEUL `console.error(erreur)` SUFFIRAIT à faire apparaître un jeton
    // dans les journaux d'hébergement le jour où une bibliothèque déciderait
    // d'inclure son entrée dans le message.
    assert.ok(!/console\.(log|error|warn|info|debug)\(/.test(code), `${nom} journalise`);
  }
});

await test("N63. la migration C5.1 est déclarée dans les trois mécanismes de contrat", () => {
  const NOM = "20260922090000_c5_1_connexions_nolio.sql";
  const contrat = lire("./contrat-migrations.mts");
  assert.ok(contrat.includes(NOM), "non déclarée dans le contrat des migrations");
  // ⚠️ LE COMPTE AUSSI. Le contrat vérifie un nombre exact : la déclarer sans
  // incrémenter laisserait le contrat rouge, et déclarer un nom sans fichier
  // le laisserait rouge dans l'autre sens.
  assert.match(contrat, /NOMBRE_DE_MIGRATIONS = 88/);
  assert.ok(lire("../../supabase/baseline/manifest.json").includes(NOM), "absente du manifeste de baseline");
  assert.ok(
    lire("./nutrition-contract-preferred-unit.mts").includes(NOM),
    "non déclarée sûre vis-à-vis du CONTRACT preferred_unit",
  );
});

/* ── Verdict ─────────────────────────────────────────────────────────────── */

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
