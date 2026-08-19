/**
 * Harnais — COURSES C4.3c : L'ADAPTATEUR OVERPASS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'une requête Overpass encode EXPLICITEMENT la France et `admin_level=8`
 * plutôt que d'espérer qu'un nom de ville soit unique au monde ; qu'elle est
 * bornée AMONT aux catégories alimentaires plutôt que de télécharger tous les
 * commerces pour trier ensuite ; que sept issues sont distinguées, dont trois
 * pannes qui ne se déguisent jamais en « aucun résultat » ; et que ce module ne
 * contient AUCUNE logique métier, AUCUN Supabase, AUCUN Open Prices.
 *
 * ⚠️ AUCUN APPEL RÉSEAU RÉEL. Le transport est injecté. Overpass n'est jamais
 * contacté depuis cette suite — la mesure réelle se fera ailleurs, avec JULES.
 *
 * Lancement : npm run test:overpass-c4-3c
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OVERPASS_ELEMENTS_MAX,
  OVERPASS_TIMEOUT_MS,
  OVERPASS_TIMEOUT_S,
  echapperValeurOverpass,
  idZoneDepuisRelation,
  interrogerOverpass,
  requeteElement,
  requeteMagasinsAutour,
  requeteMagasinsDansZone,
  requeteZoneCommune,
} from "../../lib/openstreetmap/overpass";
import { SHOP_ALCOOL_EXCLUS, SHOP_ALIMENTAIRES } from "../../lib/nutrition/magasins-osm";
import { OFF_USER_AGENT_ENV } from "../../lib/open-food-facts/contrat";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const ADAPTATEUR = lire("../../lib/openstreetmap/overpass.ts");

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** Un transport qui rend une réponse fabriquée, et note ce qu'on lui a demandé. */
function transportFige(reponse: Response | (() => Promise<Response>)) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const transport = async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return typeof reponse === "function" ? reponse() : reponse;
  };
  return { transport, appels };
}

function reponseJson(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ENVELOPPE = (elements: unknown[]) => ({
  version: 0.6,
  generator: "Overpass API",
  osm3s: {},
  elements,
});

/**
 * ⚠️ L'AGENT VIENT DE LA VARIABLE DÉJÀ DÉPLOYÉE, ET C'EST UN COMPROMIS ASSUMÉ.
 *
 * `OPENFOODFACTS_USER_AGENT` porte l'identité de l'APPLICATION — « SETH/1.0
 * (contact) » — et non un identifiant propre à Open Food Facts. C'est
 * exactement la chaîne qu'OpenStreetMap demande d'envoyer. Créer une seconde
 * variable pour la même valeur ajouterait une étape de déploiement dont
 * l'oubli couperait la découverte des magasins sans que rien ne le dise.
 *
 * La contrepartie est réelle et doit être connue : retirer la configuration
 * Open Food Facts casserait aussi Overpass. Une variable dédiée est un
 * one-liner le jour où c'est jugé préférable.
 */
const UA = { valeur: "SETH/1.0 (contact@example.test)" };

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

await test("OVP-33b — sans agent identifiant, l'appel ne part PAS", async () => {
  // ⚠️ UN REPLI GÉNÉRIQUE SERAIT PIRE QUE L'ÉCHEC. OSM bannit les agents
  // anonymes ; un `"SETH"` fabriqué à la volée ferait passer l'oubli de
  // configuration inaperçu jusqu'au jour du blocage, sur toute l'application.
  const avant = process.env[OFF_USER_AGENT_ENV];
  delete process.env[OFF_USER_AGENT_ENV];
  try {
    const { transport, appels } = transportFige(reponseJson(ENVELOPPE([])));
    await assert.rejects(() => interrogerOverpass("[out:json];", { transport }));
    assert.equal(appels.length, 0, "aucune requête ne doit partir sans agent");
  } finally {
    if (avant !== undefined) process.env[OFF_USER_AGENT_ENV] = avant;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// A. LA RÉSOLUTION D'UNE COMMUNE — FRANCE, EXPLICITEMENT
// ════════════════════════════════════════════════════════════════════════════

await test("OVP-25 — la résolution d'une ville encode la France ET admin_level=8", () => {
  const q = requeteZoneCommune("Toulon");

  // ⚠️ « Toulon » N'EST PAS UN IDENTIFIANT MONDIAL. Sans contexte, Overpass
  // rendrait toutes les zones du monde portant ce nom. Deux bornes sont donc
  // écrites dans la requête, et un test les exige toutes les deux.
  assert.ok(/ISO3166-1["\s]*[=~]\s*"FR"/.test(q), "le pays doit être encodé par son code ISO");
  assert.ok(/"admin_level"\s*=\s*"2"/.test(q), "la zone France est admin_level=2");
  assert.ok(/"admin_level"\s*=\s*"8"/.test(q), "la commune est admin_level=8");
  assert.ok(/"boundary"\s*=\s*"administrative"/.test(q), "une commune est une limite administrative");
  assert.ok(/Toulon/.test(q), "le nom cherché doit y être");

  // ⚠️ ET LA RECHERCHE NE S'APPUIE PAS SUR `addr:city`. Un commerce mal
  // renseigné disparaîtrait de sa propre ville — c'est la zone administrative
  // qui décide, pas l'étiquette du commerçant.
  assert.equal(/addr:city/.test(q), false, "la zone administrative, jamais addr:city");

  // Bornes de la requête elle-même.
  assert.ok(new RegExp(`\\[timeout:${OVERPASS_TIMEOUT_S}\\]`).test(q), "timeout Overpass borné");
  assert.ok(/\[out:json\]/.test(q), "réponse JSON demandée explicitement");
});

await test("OVP-25b — le nom de ville est échappé, jamais concaténé brut", () => {
  // Une saisie qui contient un guillemet ou un métacaractère de regex ne doit
  // pas pouvoir refermer la valeur et injecter une autre clause Overpass.
  assert.equal(echapperValeurOverpass('Toulon"]["shop"="alcohol'), 'Toulon\\"\\]\\[\\"shop\\"\\=\\"alcohol');
  assert.equal(echapperValeurOverpass("Saint-Étienne"), "Saint\\-Étienne");
  assert.equal(echapperValeurOverpass("L'Haÿ-les-Roses"), "L'Haÿ\\-les\\-Roses");

  const q = requeteZoneCommune('X"]["shop"="alcohol');
  assert.equal(/\["shop"="alcohol"\]/.test(q), false, "aucune clause injectée");
});

await test("OVP-25c — l'identifiant de zone dérive de la relation, sans magie", () => {
  // Overpass numérote les zones : relation N → area 3600000000 + N.
  assert.equal(idZoneDepuisRelation(1), 3_600_000_001);
  assert.equal(idZoneDepuisRelation(74283), 3_600_074_283);
  for (const mauvais of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
    assert.throws(() => idZoneDepuisRelation(mauvais), `relation ${mauvais} refusée`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// B. LA REQUÊTE ALIMENTAIRE — BORNÉE AMONT, PAS TRIÉE APRÈS
// ════════════════════════════════════════════════════════════════════════════

await test("OVP-26 — la requête magasins est bornée aux catégories autorisées", () => {
  const q = requeteMagasinsDansZone(3_600_074_283);

  // ⚠️ JAMAIS `["shop"]` NU. Cette forme télécharge TOUS les commerces de la
  // ville — coiffeurs, garages, opticiens — pour n'en garder qu'une fraction.
  // C'est du débit pris à un service bénévole pour rien.
  assert.equal(/\["shop"\]/.test(q), false, "aucun téléchargement de tous les commerces");

  for (const shop of SHOP_ALIMENTAIRES) {
    assert.ok(q.includes(shop), `${shop} doit être demandé à l'amont`);
  }
  for (const exclu of SHOP_ALCOOL_EXCLUS) {
    assert.equal(
      new RegExp(`[|^(]${exclu}[|)$]`).test(q),
      false,
      `${exclu} ne doit pas être demandé`,
    );
  }
  assert.equal(/newsagent/.test(q), false, "le marchand de journaux n'est pas demandé");
  for (const mort of ["organic", "grocery", "rice"]) {
    assert.equal(
      new RegExp(`[|^(]${mort}[|)$]`).test(q),
      false,
      `${mort} ne doit pas revenir comme shop=* principal`,
    );
  }

  assert.ok(/3600074283/.test(q), "la zone résolue doit être celle interrogée");
  assert.ok(/out center tags/.test(q), "center pour les WAY et RELATION, tags pour la doctrine");
  assert.ok(new RegExp(`out center tags ${OVERPASS_ELEMENTS_MAX}`).test(q), "la sortie est bornée");
  assert.equal(/addr:city/.test(q), false, "un commerce sans addr:city reste retenu");
});

await test("OVP-32 — la requête « autour » borne le rayon en mètres", () => {
  const q = requeteMagasinsAutour({ lat: 43.1242, lon: 5.928, rayonM: 5000 });
  assert.ok(/around:5000,43.1242,5.928/.test(q), "around: rayon,lat,lon");
  assert.equal(/\["shop"\]/.test(q), false);
  assert.ok(q.includes("supermarket") && q.includes("pastry"));
  assert.ok(new RegExp(`out center tags ${OVERPASS_ELEMENTS_MAX}`).test(q));
  for (const mauvais of [
    { lat: 91, lon: 0, rayonM: 1000 },
    { lat: 0, lon: 181, rayonM: 1000 },
    { lat: 43, lon: 5, rayonM: 0 },
    { lat: 43, lon: 5, rayonM: -1 },
    { lat: 43, lon: 5, rayonM: 1.5 },
  ]) {
    assert.throws(() => requeteMagasinsAutour(mauvais), `entrée ${JSON.stringify(mauvais)} refusée`);
  }
});

await test("OVP-37b — la requête par identité vise UN élément, par son type", () => {
  assert.ok(/node\(9928912836\)/.test(requeteElement("NODE", 9928912836)));
  assert.ok(/way\(274420431\)/.test(requeteElement("WAY", 274420431)));
  assert.ok(/(rel|relation)\(1834502\)/.test(requeteElement("RELATION", 1834502)));
  // Un seul élément attendu : la borne de sortie le dit.
  assert.ok(/out center tags 1;/.test(requeteElement("NODE", 1)));
  for (const mauvais of [0, -1, 1.5, 2 ** 53]) {
    assert.throws(() => requeteElement("NODE", mauvais));
  }
});

// ════════════════════════════════════════════════════════════════════════════
// C. LES SEPT ISSUES — ET AUCUNE PANNE NE SE DÉGUISE EN ABSENCE
// ════════════════════════════════════════════════════════════════════════════

await test("OVP-27/28 — succès, borne de troncature, et zéro résultat ≠ panne", async () => {
  const element = { type: "node", id: 1, lat: 43, lon: 5, tags: { shop: "bakery", name: "X" } };

  const { transport } = transportFige(reponseJson(ENVELOPPE([element, element])));
  const ok = await avecUserAgent(() => interrogerOverpass("[out:json];", { transport }));
  assert.equal(ok.statut, "success");
  if (ok.statut !== "success") throw new Error("statut inattendu");
  assert.equal(ok.elements.length, 2);
  assert.equal(ok.tronque, false);

  // ⚠️ LA BORNE NE COUPE PAS EN SILENCE. Atteindre `OVERPASS_ELEMENTS_MAX`
  // signifie « il y en avait peut-être davantage » : l'écran doit pouvoir le
  // dire plutôt que présenter une liste partielle comme exhaustive.
  const beaucoup = Array.from({ length: OVERPASS_ELEMENTS_MAX }, () => element);
  const { transport: t2 } = transportFige(reponseJson(ENVELOPPE(beaucoup)));
  const plein = await avecUserAgent(() => interrogerOverpass("[out:json];", { transport: t2 }));
  assert.equal(plein.statut, "success");
  if (plein.statut !== "success") throw new Error("statut inattendu");
  assert.equal(plein.tronque, true, "la borne atteinte doit être signalée");

  // ⚠️ ZÉRO RÉSULTAT EST UN FAIT, PAS UNE PANNE. Une commune sans commerce
  // alimentaire cartographié existe ; le dire « indisponible » enverrait
  // l'élève réessayer indéfiniment.
  const { transport: t3 } = transportFige(reponseJson(ENVELOPPE([])));
  const vide = await avecUserAgent(() => interrogerOverpass("[out:json];", { transport: t3 }));
  assert.equal(vide.statut, "zero_results");
});

await test("OVP-29/30 — 429 → rate_limited, 503 → unavailable, et AUCUN retry", async () => {
  const { transport, appels } = transportFige(new Response("", { status: 429 }));
  const limite = await avecUserAgent(() => interrogerOverpass("[out:json];", { transport }));
  assert.deepEqual(limite, { statut: "echec", raison: "rate_limited" });
  // ⚠️ AUCUN RETRY AGRESSIF. La politique d'Overpass demande de faire une PAUSE
  // après un 429 ; réessayer immédiatement est exactement ce qui fait bannir.
  assert.equal(appels.length, 1, "un seul appel, jamais de réessai");

  const { transport: t2, appels: a2 } = transportFige(new Response("", { status: 503 }));
  assert.deepEqual(await avecUserAgent(() => interrogerOverpass("[out:json];", { transport: t2 })), {
    statut: "echec",
    raison: "unavailable",
  });
  assert.equal(a2.length, 1);

  // ⚠️ ET 429 ≠ 503. Deux causes, deux conduites : attendre, ou réessayer.
  assert.notEqual("rate_limited", "unavailable");
});

await test("OVP-31 — l'expiration est un timeout, pas une indisponibilité", async () => {
  const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
  const { transport } = transportFige(async () => {
    throw abort;
  });
  assert.deepEqual(await avecUserAgent(() => interrogerOverpass("[out:json];", { transport })), {
    statut: "echec",
    raison: "timeout",
  });

  // Overpass rend 504 quand SA propre borne expire : c'est le même fait.
  const { transport: t2 } = transportFige(new Response("", { status: 504 }));
  assert.deepEqual(await avecUserAgent(() => interrogerOverpass("[out:json];", { transport: t2 })), {
    statut: "echec",
    raison: "timeout",
  });
});

await test("OVP-31b — une erreur réseau est unavailable, jamais zero_results", async () => {
  const { transport } = transportFige(async () => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(await avecUserAgent(() => interrogerOverpass("[out:json];", { transport })), {
    statut: "echec",
    raison: "unavailable",
  });
});

await test("OVP-31c — 200 illisible → invalid_json / invalid_envelope, JAMAIS zero_results", async () => {
  const { transport } = transportFige(
    new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
  );
  assert.deepEqual(await avecUserAgent(() => interrogerOverpass("[out:json];", { transport })), {
    statut: "echec",
    raison: "invalid_json",
  });

  // ⚠️ UNE ENVELOPPE SANS `elements` N'EST PAS UNE ENVELOPPE VIDE. Overpass
  // rend parfois un corps d'erreur en 200 ; le lire comme « aucun magasin »
  // ferait conclure à l'absence sur une réponse qui n'a rien mesuré.
  for (const corps of [{}, { elements: null }, { elements: "aucun" }, { elements: {} }, null, 42, []]) {
    const { transport: t } = transportFige(reponseJson(corps));
    const r = await avecUserAgent(() => interrogerOverpass("[out:json];", { transport: t }));
    assert.deepEqual(
      r,
      { statut: "echec", raison: "invalid_envelope" },
      `enveloppe ${JSON.stringify(corps)} refusée`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
// D. TRANSPORT, IDENTITÉ, JOURNAUX
// ════════════════════════════════════════════════════════════════════════════

await test("OVP-33 — User-Agent identifiant, requête en corps, annulation armée", async () => {
  const { transport, appels } = transportFige(reponseJson(ENVELOPPE([])));
  await avecUserAgent(() => interrogerOverpass("[out:json];node(1);out;", { transport }));

  assert.equal(appels.length, 1);
  const { url, init } = appels[0]!;
  assert.ok(url.includes("overpass"), "l'endpoint Overpass");
  assert.equal(init.method, "POST", "une requête Overpass se poste, elle ne s'empile pas dans une URL");

  const entetes = new Headers(init.headers);
  assert.equal(entetes.get("user-agent"), UA.valeur, "OSM demande un agent identifiant");
  assert.equal(entetes.has("authorization"), false, "aucun jeton : Overpass est ouvert");
  assert.equal(entetes.has("cookie"), false);

  assert.ok(init.signal !== undefined && init.signal !== null, "l'annulation doit être armée");
  assert.ok(typeof init.body === "string" && init.body.includes("node(1)"), "la requête voyage en corps");

  // ⚠️ ET LA REQUÊTE N'EST PAS DANS L'URL. Une requête Overpass en chaîne de
  // requête finirait dans les journaux d'accès — avec, pour /nearby, les
  // coordonnées de l'élève.
  assert.equal(url.includes("node(1)"), false, "la requête ne doit pas transiter par l'URL");
});

await test("OVP-36 — aucun corps, aucun GPS, aucun secret dans les journaux", () => {
  const nu = sansCommentaires(ADAPTATEUR);
  const logs = [...nu.matchAll(/console\.(log|error|warn|info)\(([^;]*)\)/g)].map((m) => m[2] ?? "");

  for (const argument of logs) {
    for (const interdit of [/\blat\b/, /\blon\b/, /requete/, /body/, /corps/, /texte/, /userAgent/, /around:/]) {
      assert.equal(
        interdit.test(argument),
        false,
        `un journal ne doit pas porter ${interdit} : ${argument}`,
      );
    }
  }
  // Et aucun `console.log` du tout : seule une erreur classée mérite une trace.
  assert.equal(/console\.log\(/.test(nu), false);
});

await test("OVP-34 — l'adaptateur ne fait QUE du transport", () => {
  const nu = sansCommentaires(ADAPTATEUR);

  // ⚠️ AUCUNE LOGIQUE MÉTIER ICI. Ce module construit, appelle, classe. Il ne
  // décide pas ce qu'est un magasin, ne calcule aucune distance, n'écrit rien.
  for (const motif of [
    /@\/lib\/supabase/,
    /@\/lib\/open-prices/,
    /@\/lib\/open-food-facts\/(?!client|contrat)/,
    /openfoodfacts/i,
    /\.insert\(/,
    /\.update\(/,
    /\.upsert\(/,
    /\.rpc\(/,
    /student/i,
    /budget/i,
    /haversine/i,
    /distanceKm/,
    /Math\.(sin|cos|atan2)/,
    /normaliserElementOsm/,
    /dedupliquer/,
  ]) {
    assert.equal(motif.test(nu), false, `l'adaptateur ne doit pas porter ${motif}`);
  }

  // ⚠️ `server-only` N'EST PAS DÉCORATIF. La position d'un élève transite par
  // ici ; un composant client qui importerait ce fichier l'enverrait à Overpass
  // avec l'IP de l'élève, sans borne de rayon ni limite de débit.
  assert.ok(/^import "server-only";/m.test(ADAPTATEUR), "le module doit être serveur-seulement");

  // Les bornes sont des constantes nommées, pas des nombres semés.
  assert.ok(Number.isInteger(OVERPASS_TIMEOUT_S) && OVERPASS_TIMEOUT_S > 0);
  assert.ok(Number.isInteger(OVERPASS_TIMEOUT_MS) && OVERPASS_TIMEOUT_MS > OVERPASS_TIMEOUT_S * 1000);
  assert.ok(Number.isInteger(OVERPASS_ELEMENTS_MAX) && OVERPASS_ELEMENTS_MAX > 0);
});

console.log("\n✅ C4.3c — adaptateur Overpass : suite verte.");
