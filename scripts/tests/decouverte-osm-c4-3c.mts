/**
 * Harnais — COURSES C4.3c : LA DÉCOUVERTE DES MAGASINS PAR OPENSTREETMAP.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'une ville se résout en DEUX temps — la zone administrative d'abord, ses
 * commerces ensuite — et qu'une ambiguïté s'annonce au lieu de se trancher au
 * hasard ; que le filtre local reste en place derrière le filtre amont ; que
 * les bornes se déclarent au lieu de couper en silence ; et que CHERCHER
 * n'appelle JAMAIS Open Prices.
 *
 * ⚠️ AUCUN APPEL RÉSEAU RÉEL. Le transport est injecté.
 *
 * Lancement : npm run test:decouverte-osm-c4-3c
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAGASINS_MAX_UI,
  decouvrirAutour,
  decouvrirParVille,
  httpDecouverte,
} from "../../lib/openstreetmap/decouverte";
import { OFF_USER_AGENT_ENV } from "../../lib/open-food-facts/contrat";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const DECOUVERTE = lire("../../lib/openstreetmap/decouverte.ts");
const ROUTE_SEARCH = lire("../../app/api/student/stores/search/route.ts");
const ROUTE_NEARBY = lire("../../app/api/student/stores/nearby/route.ts");

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** Un transport scripté : une réponse par appel, dans l'ordre, et on note tout. */
function transportScripte(reponses: readonly unknown[]) {
  const corpsEnvoyes: string[] = [];
  let i = 0;
  const transport = async (_url: string, init: RequestInit) => {
    corpsEnvoyes.push(String(init.body ?? ""));
    const corps = reponses[i] ?? { elements: [] };
    i += 1;
    if (corps instanceof Response) return corps;
    return new Response(JSON.stringify(corps), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { transport, corpsEnvoyes, appels: () => i };
}

const ENV = (elements: unknown[]) => ({ version: 0.6, generator: "Overpass API", elements });

const zone = (id: number, nom: string) => ({
  type: "relation",
  id,
  tags: { name: nom, boundary: "administrative", admin_level: "8" },
});

const commerce = (id: number, tags: Record<string, unknown>, lat = 43.12, lon = 5.93) => ({
  type: "node",
  id,
  lat,
  lon,
  tags,
});

/**
 * ⚠️ ASYNCHRONE, ET C'EST UN CORRECTIF, PAS UN CONFORT. Une première version
 * restaurait la variable dans un `finally` SYNCHRONE : elle disparaissait donc
 * avant la seconde requête d'un enchaînement, et la découverte par ville
 * échouait sur « agent absent » au lieu de tester ce qu'elle annonçait.
 */
async function avecUserAgent<T>(fn: () => T | Promise<T>): Promise<T> {
  const avant = process.env[OFF_USER_AGENT_ENV];
  process.env[OFF_USER_AGENT_ENV] = "SETH/1.0 (contact@example.test)";
  try {
    return await fn();
  } finally {
    if (avant === undefined) delete process.env[OFF_USER_AGENT_ENV];
    else process.env[OFF_USER_AGENT_ENV] = avant;
  }
}

const decode = (corps: string) => decodeURIComponent(corps.replace(/^data=/, ""));

// ════════════════════════════════════════════════════════════════════════════
// A. LA RÉSOLUTION D'UNE COMMUNE — EN DEUX TEMPS, SANS ARBITRAIRE
// ════════════════════════════════════════════════════════════════════════════

await test("DEC-25 — Toulon : zone administrative d'abord, commerces ensuite", async () => {
  const { transport, corpsEnvoyes } = transportScripte([
    ENV([zone(74283, "Toulon")]),
    ENV([commerce(1, { shop: "supermarket", name: "Naturalia" })]),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));

  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.equal(r.magasins.length, 1);
  assert.equal(r.magasins[0]!.name, "Naturalia");

  assert.equal(corpsEnvoyes.length, 2, "deux requêtes : résoudre, puis chercher");
  const [q1, q2] = corpsEnvoyes.map(decode);
  assert.ok(/ISO3166-1["\s]*[=~]\s*"FR"/.test(q1!), "la première borne la France");
  assert.ok(/"admin_level"\s*=\s*"8"/.test(q1!), "la première vise la commune");
  assert.ok(/area\(3600074283\)/.test(q2!), "la seconde interroge LA zone résolue");
  assert.ok(/supermarket/.test(q2!), "la seconde est bornée aux catégories alimentaires");
});

await test("DEC-25b — aucune commune de ce nom : introuvable, jamais « aucun magasin »", async () => {
  const { transport, appels } = transportScripte([ENV([])]);
  const r = await avecUserAgent(() => decouvrirParVille("Zzzz-sur-Rien", { transport }));

  // ⚠️ « CETTE VILLE N'EXISTE PAS » ET « CETTE VILLE N'A PAS DE MAGASIN » SONT
  // DEUX PHRASES DIFFÉRENTES. La première invite à corriger la saisie ; la
  // seconde envoie chercher ailleurs pour rien.
  assert.deepEqual(r, { statut: "echec", raison: "ville_introuvable" });
  assert.equal(appels(), 1, "aucune seconde requête sur une zone qui n'existe pas");
});

await test("DEC-25c — deux communes homonymes : ambigu, et SURTOUT pas la première", async () => {
  const { transport, appels } = transportScripte([
    ENV([zone(111, "Sainte-Marie"), zone(222, "Sainte-Marie")]),
    ENV([commerce(9, { shop: "supermarket", name: "Ne doit jamais être lu" })]),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Sainte-Marie", { transport }));

  // ⚠️ PRENDRE LA PREMIÈRE SERAIT UN CHOIX ARBITRAIRE ET INVISIBLE. La France
  // compte des dizaines de communes homonymes ; l'élève verrait les magasins
  // d'une autre commune sans qu'aucun message ne le lui dise.
  assert.deepEqual(r, { statut: "echec", raison: "ville_ambigue" });
  assert.equal(appels(), 1, "aucune requête de commerces sur une zone non tranchée");
});

await test("DEC-25d — une zone dont le nom ne correspond pas est écartée localement", async () => {
  // Double barrière : l'amont a été filtré, on revérifie. Ici Overpass rend
  // une zone parasite ; sans filtre local, elle rendrait la résolution ambiguë.
  const { transport } = transportScripte([
    ENV([zone(74283, "Toulon"), zone(999, "Toulouse")]),
    ENV([commerce(1, { shop: "bakery", name: "Boulangerie" })]),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
  assert.equal(r.statut, "ok", "une seule zone correspond réellement");
});

await test("DEC-25e — la comparaison locale ignore casse et accents", async () => {
  const { transport } = transportScripte([
    ENV([zone(1, "Saint-Étienne")]),
    ENV([commerce(1, { shop: "bakery", name: "B" })]),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("saint-etienne", { transport }));
  assert.equal(r.statut, "ok");
});

// ════════════════════════════════════════════════════════════════════════════
// B. LE FILTRE LOCAL RESTE EN PLACE DERRIÈRE LE FILTRE AMONT
// ════════════════════════════════════════════════════════════════════════════

await test("DEC-26 — un commerce sans addr:city est retenu", async () => {
  // ⚠️ C'EST LA ZONE QUI DÉCIDE, PAS L'ÉTIQUETTE DU COMMERÇANT. Un contributeur
  // qui a oublié l'adresse ne doit pas faire disparaître son magasin.
  const { transport } = transportScripte([
    ENV([zone(74283, "Toulon")]),
    ENV([commerce(1, { shop: "greengrocer", name: "Primeur sans adresse" })]),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.equal(r.magasins.length, 1);
  assert.equal(r.magasins[0]!.city, null);
});

await test("DEC-24 — l'amont peut se tromper : le filtre local refuse quand même", async () => {
  const { transport } = transportScripte([
    ENV([zone(74283, "Toulon")]),
    ENV([
      commerce(1, { shop: "newsagent", name: "Relay" }),
      commerce(2, { shop: "alcohol", name: "Caviste" }),
      commerce(3, { shop: "supermarket" }), // sans nom
      commerce(4, { shop: "supermarket", name: "Bon" }),
      { type: "node", id: 5, tags: { shop: "supermarket", name: "Sans lieu" } },
    ]),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.deepEqual(
    r.magasins.map((m) => m.name),
    ["Bon"],
    "seul le commerce alimentaire, nommé et situé, survit",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// C. LES BORNES SE DÉCLARENT
// ════════════════════════════════════════════════════════════════════════════

await test("DEC-27 — la borne d'affichage est signalée, jamais silencieuse", async () => {
  const beaucoup = Array.from({ length: MAGASINS_MAX_UI + 5 }, (_, i) =>
    commerce(i + 1, { shop: "bakery", name: `Boulangerie ${i}` }),
  );
  const { transport } = transportScripte([ENV([zone(74283, "Toulon")]), ENV(beaucoup)]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));

  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.equal(r.magasins.length, MAGASINS_MAX_UI, "la liste est bornée");
  assert.equal(r.tronque, true, "et la troncature est DITE");
});

await test("DEC-27b — la troncature d'Overpass se propage telle quelle", async () => {
  // Même sous la borne d'affichage : si l'amont s'est arrêté sur SA borne, la
  // liste est incomplète, et le taire la présenterait comme exhaustive.
  const { transport } = transportScripte([
    ENV([zone(74283, "Toulon")]),
    ENV(Array.from({ length: 400 }, (_, i) => commerce(i + 1, { shop: "bakery", name: `B${i}` }))),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.equal(r.tronque, true);
});

await test("DEC-28 — zéro magasin dans une commune réelle n'est PAS une panne", async () => {
  const { transport } = transportScripte([ENV([zone(74283, "Toulon")]), ENV([])]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
  assert.equal(r.statut, "ok", "la commune existe, elle n'a simplement rien de cartographié");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.deepEqual(r.magasins, []);
  assert.equal(r.tronque, false);
});

// ════════════════════════════════════════════════════════════════════════════
// D. LES PANNES SE PROPAGENT, CHACUNE AVEC SON CODE
// ════════════════════════════════════════════════════════════════════════════

await test("DEC-29/30/31 — 429, 503 et timeout restent distincts jusqu'au HTTP", async () => {
  const cas = [
    [429, "rate_limited", 429],
    [503, "unavailable", 503],
    [504, "timeout", 504],
  ] as const;

  for (const [statutAmont, raison, statutSortie] of cas) {
    const { transport, appels } = transportScripte([new Response("", { status: statutAmont })]);
    const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
    assert.deepEqual(r, { statut: "echec", raison }, `${statutAmont} → ${raison}`);
    assert.equal(appels(), 1, "aucun réessai");
    assert.equal(httpDecouverte(raison).status, statutSortie);
  }

  // ⚠️ ET AUCUNE PANNE NE PARTAGE LE CODE D'UNE ABSENCE.
  assert.equal(httpDecouverte("ville_introuvable").status, 404);
  assert.equal(httpDecouverte("ville_ambigue").status, 409);
  for (const panne of ["rate_limited", "unavailable", "timeout", "invalid_json", "invalid_envelope"] as const) {
    assert.notEqual(httpDecouverte(panne).status, 404, `${panne} ne doit jamais dire « introuvable »`);
    assert.notEqual(httpDecouverte(panne).status, 200);
  }

  // Chaque raison porte un code lisible, distinct, et sans détail interne.
  const codes = new Set(
    (
      [
        "rate_limited",
        "unavailable",
        "timeout",
        "invalid_json",
        "invalid_envelope",
        "ville_introuvable",
        "ville_ambigue",
      ] as const
    ).map((r) => httpDecouverte(r).code),
  );
  assert.equal(codes.size, 7, "sept raisons, sept codes");
});

await test("DEC-31c — une panne de la SECONDE requête n'invente pas une ville introuvable", async () => {
  const { transport } = transportScripte([
    ENV([zone(74283, "Toulon")]),
    new Response("", { status: 503 }),
  ]);
  const r = await avecUserAgent(() => decouvrirParVille("Toulon", { transport }));
  assert.deepEqual(r, { statut: "echec", raison: "unavailable" });
});

// ════════════════════════════════════════════════════════════════════════════
// E. CHERCHER N'APPELLE JAMAIS OPEN PRICES
// ════════════════════════════════════════════════════════════════════════════

await test("DEC-S20 — la découverte ne connaît pas Open Prices", () => {
  // ⚠️ TRENTE MAGASINS TROUVÉS NE DOIVENT PAS FAIRE TRENTE APPELS OPEN PRICES.
  // Le pont se fait à la SÉLECTION, sur un seul magasin. C'est la décision
  // structurante de C4.3c, et elle se prouve ici : le module ne peut pas
  // appeler ce qu'il n'importe pas.
  const nu = sansCommentaires(DECOUVERTE);
  for (const motif of [/open-prices/i, /openprices/i, /opLocationId/, /op_location_id/, /locations\//]) {
    assert.equal(motif.test(nu), false, `la découverte ne doit pas porter ${motif}`);
  }
  const route = sansCommentaires(ROUTE_SEARCH);
  for (const motif of [/open-prices/i, /opLocationId/, /chercherMagasinsParVille/]) {
    assert.equal(motif.test(route), false, `/search ne doit pas porter ${motif}`);
  }
  assert.ok(/decouvrirParVille/.test(route), "/search est désormais servie par OSM");
});

await test("DEC-S20b — /search garde son auth, sa limite de débit, et n'écrit rien", () => {
  const route = sansCommentaires(ROUTE_SEARCH);
  assert.ok(/auth\.getUser\(\)/.test(route), "authentification exigée");
  assert.ok(/consumeRateLimit/.test(route), "limite de débit conservée");
  assert.ok(/magasinsParVilleBodySchema/.test(route), "corps validé");
  assert.ok(/villeValide/.test(route), "seconde barrière sur la ville");
  assert.ok(/PAYS_CODE/.test(route), "le pays reste une constante serveur");
  for (const motif of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /createSupabaseAdminClient/]) {
    assert.equal(motif.test(route), false, `chercher n'est pas choisir : ${motif}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// F. AUTOUR D'UN POINT
// ════════════════════════════════════════════════════════════════════════════

await test("DEC-32/33/34 — around borné, distance calculée, résultats triés", async () => {
  const { transport, corpsEnvoyes } = transportScripte([
    ENV([
      commerce(1, { shop: "supermarket", name: "Loin" }, 43.2, 5.93),
      commerce(2, { shop: "bakery", name: "Près" }, 43.121, 5.93),
    ]),
  ]);
  const r = await avecUserAgent(() =>
    decouvrirAutour({ lat: 43.12, lon: 5.93, rayonKm: 5 }, { transport }),
  );

  assert.equal(corpsEnvoyes.length, 1, "une seule requête : pas de zone à résoudre");
  assert.ok(/around:5000,43.12,5.93/.test(decode(corpsEnvoyes[0]!)), "le rayon part en mètres");

  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.deepEqual(r.magasins.map((m) => m.name), ["Près", "Loin"], "trié par distance croissante");
  assert.ok(r.magasins[0]!.distanceKm !== null && r.magasins[0]!.distanceKm < 0.2);
  assert.ok(r.magasins[1]!.distanceKm !== null && r.magasins[1]!.distanceKm > 8);

  // ⚠️ LE RAYON DU CLIENT N'EST PAS CRU. La borne est vérifiée ici aussi.
  await assert.rejects(() =>
    avecUserAgent(() => decouvrirAutour({ lat: 43.12, lon: 5.93, rayonKm: 999 }, { transport })),
  );
  await assert.rejects(() =>
    avecUserAgent(() => decouvrirAutour({ lat: 91, lon: 5.93, rayonKm: 5 }, { transport })),
  );
});

await test("DEC-35/36 — aucune position persistée, aucune position journalisée", () => {
  const nu = sansCommentaires(DECOUVERTE);
  // Aucune écriture, nulle part.
  for (const motif of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /localStorage/, /sessionStorage/, /cookie/i]) {
    assert.equal(motif.test(nu), false, `aucune persistance : ${motif}`);
  }
  // Et aucun journal ne porte la position.
  const logs = [...nu.matchAll(/console\.(log|error|warn|info)\(([^;]*)\)/g)].map((m) => m[2] ?? "");
  for (const argument of logs) {
    for (const interdit of [/\blat\b/, /\blon\b/, /around/, /position/i, /rayon/i]) {
      assert.equal(interdit.test(argument), false, `journal interdit : ${argument}`);
    }
  }
  assert.equal(/console\.log\(/.test(nu), false);
  assert.ok(/^import "server-only";/m.test(DECOUVERTE), "module serveur seulement");
});


await test("DEC-32b — /nearby est servie par OSM, et le rayon reste borné côté serveur", () => {
  const route = sansCommentaires(ROUTE_NEARBY);

  // ⚠️ LA SOURCE CHANGE, LES GARDES RESTENT. C'est le même écran, la même
  // position, la même confidentialité — seul l'annuaire est remplacé.
  assert.ok(/decouvrirAutour/.test(route), "/nearby doit passer par la découverte OSM");
  assert.equal(/chercherMagasinsProches/.test(route), false, "Open Prices n'est plus l'annuaire");
  for (const motif of [/open-prices/i, /opLocationId/]) {
    assert.equal(motif.test(route), false, `/nearby ne doit pas porter ${motif}`);
  }

  assert.ok(/auth\.getUser\(\)/.test(route), "authentification exigée");
  assert.ok(/consumeRateLimit/.test(route), "limite de débit conservée");
  assert.ok(/magasinsProchesBodySchema/.test(route), "corps validé et strict");
  // ⚠️ TROIS BARRIÈRES SUR LE RAYON, ET C'EST VOULU : le schéma, la règle
  // produit, puis la découverte. Le rayon du client n'est jamais utilisé tel
  // quel — il est REMPLACÉ par celui que `bornerRayon` accepte.
  assert.ok(/bornerRayon\(/.test(route), "la règle produit borne le rayon");
  assert.ok(/httpDecouverte/.test(route), "les pannes gardent leur code propre");

  // Chercher n'est pas choisir : aucune écriture.
  for (const motif of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /createSupabaseAdminClient/]) {
    assert.equal(motif.test(route), false, `${motif} n'a rien à faire dans une recherche`);
  }
});

await test("DEC-35b/36b — /nearby ne persiste ni ne journalise aucune position", () => {
  const route = sansCommentaires(ROUTE_NEARBY);
  for (const motif of [/localStorage/, /sessionStorage/, /cookie/i, /\.from\("student_selected_store"\)/]) {
    assert.equal(motif.test(route), false, `aucune persistance de position : ${motif}`);
  }
  const logs = [...route.matchAll(/console\.(log|error|warn|info)\(([^;]*)\)/g)].map((m) => m[2] ?? "");
  for (const argument of logs) {
    for (const interdit of [/\blat\b/, /\blon\b/, /parsed\.data/, /rayon/i]) {
      assert.equal(interdit.test(argument), false, `journal interdit : ${argument}`);
    }
  }
  // ⚠️ RESSERRÉ APRÈS COUP, ET LA RAISON EST ÉCRITE ICI POUR QU'ELLE SE VOIE.
  // Ce cas était VERT avant l'implémentation : la confidentialité venait de
  // C4.3a et le changement de source ne la menaçait pas. Un test qui passe
  // avant qu'on écrive quoi que ce soit ne prouve rien du lot en cours — on
  // exige donc davantage : la position ne doit apparaître QUE dans l'appel à
  // la découverte, et nulle part ailleurs dans le fichier.
  const occurrences = [...route.matchAll(/\b(lat|lon)\b/g)].length;
  const dansLAppel = [...route.matchAll(/(lat|lon):\s*parsed\.data\.(lat|lon)/g)].length;
  assert.equal(
    occurrences,
    dansLAppel * 2,
    "lat/lon ne doivent apparaître que dans l'appel à la découverte",
  );
  assert.equal(dansLAppel, 2, "exactement une latitude et une longitude transmises");
});

console.log("\n✅ C4.3c — découverte OSM : suite verte.");
