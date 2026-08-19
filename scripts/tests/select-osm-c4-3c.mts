/**
 * Harnais — COURSES C4.3c : LA SÉLECTION D'UN MAGASIN PAR SON IDENTITÉ OSM.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Que le navigateur DÉSIGNE un magasin sans le DÉCRIRE ; que le serveur relit
 * la fiche canonique chez OpenStreetMap ; que le pont Open Prices est un appel
 * EXACT — jamais une recherche, jamais un rapprochement par nom ; et qu'une
 * panne du pont n'est pas une absence de pont, ni au moment du choix, ni en
 * base.
 *
 * ⚠️ AUCUN APPEL RÉSEAU RÉEL, AUCUNE BASE. Transports injectés, client Supabase
 * simulé.
 *
 * Lancement : npm run test:select-osm-c4-3c
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OFF_USER_AGENT_ENV } from "../../lib/open-food-facts/contrat";
import { lireElementCanonique } from "../../lib/openstreetmap/decouverte";
import { OPEN_PRICES_PONT_OSM_URL, lirePontOsm, pontPourEcriture } from "../../lib/open-prices/pont-osm";
import { choixMagasinOsmBodySchema } from "../../lib/api/schemas/magasins";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const PONT = lire("../../lib/open-prices/pont-osm.ts");
const ROUTE_SELECT = lire("../../app/api/student/stores/select/route.ts");

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function transportFige(reponse: Response | (() => Promise<Response>)) {
  const urls: string[] = [];
  const transport = async (url: string, init: RequestInit) => {
    urls.push(url);
    void init;
    return typeof reponse === "function" ? reponse() : reponse;
  };
  return { transport, urls };
}

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });

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

const ENV = (elements: unknown[]) => ({ version: 0.6, generator: "Overpass API", elements });

// ════════════════════════════════════════════════════════════════════════════
// A. LE CORPS DE LA REQUÊTE — DÉSIGNER, PAS DÉCRIRE
// ════════════════════════════════════════════════════════════════════════════

await test("SEL-61/62 — le navigateur désigne une identité OSM, et RIEN d'autre", () => {
  assert.equal(choixMagasinOsmBodySchema.safeParse({ osmType: "NODE", osmId: 9928912836 }).success, true);
  assert.equal(choixMagasinOsmBodySchema.safeParse({ osmType: "node", osmId: 1 }).success, true);

  // ⚠️ 61 — LE CLIENT NE PEUT PAS DÉCRIRE LE MAGASIN. Sans ce refus, n'importe
  // qui ferait apparaître « Mon faux magasin » dans un référentiel que TOUS les
  // élèves lisent.
  for (const forge of [
    { osmType: "NODE", osmId: 1, name: "Mon faux magasin" },
    { osmType: "NODE", osmId: 1, lat: 0, lon: 0 },
    { osmType: "NODE", osmId: 1, brand: "Carrefour" },
    { osmType: "NODE", osmId: 1, brandWikidata: "Q151954" },
    { osmType: "NODE", osmId: 1, city: "Paris" },
  ]) {
    assert.equal(choixMagasinOsmBodySchema.safeParse(forge).success, false, JSON.stringify(forge));
  }

  // ⚠️ 62 — ET SURTOUT PAS `opLocationId`. Le pont est établi par le SERVEUR,
  // par un appel exact. Le laisser venir du navigateur permettrait de rattacher
  // son magasin aux prix d'un autre.
  assert.equal(
    choixMagasinOsmBodySchema.safeParse({ osmType: "NODE", osmId: 1, opLocationId: 4877 }).success,
    false,
  );

  // Et l'identité elle-même est bornée.
  for (const mauvais of [
    { osmType: "AREA", osmId: 1 },
    { osmType: "NODE", osmId: 0 },
    { osmType: "NODE", osmId: -1 },
    { osmType: "NODE", osmId: 1.5 },
    { osmType: "NODE", osmId: 2 ** 53 },
    { osmType: "NODE", osmId: "1" },
    { osmId: 1 },
    { osmType: "NODE" },
  ]) {
    assert.equal(choixMagasinOsmBodySchema.safeParse(mauvais).success, false, JSON.stringify(mauvais));
  }
});

// ════════════════════════════════════════════════════════════════════════════
// B. LA CANONICALISATION — LE SERVEUR RELIT CHEZ OSM
// ════════════════════════════════════════════════════════════════════════════

await test("SEL-61b — les données canoniques du serveur gagnent sur tout", async () => {
  const { transport } = transportFige(
    json(
      ENV([
        {
          type: "node",
          id: 9928912836,
          lat: 43.1242,
          lon: 5.928,
          tags: {
            shop: "supermarket",
            name: "Naturalia",
            brand: "Naturalia",
            "brand:wikidata": "Q3336090",
            "addr:city": "Toulon",
          },
        },
      ]),
    ),
  );
  const r = await avecUserAgent(() => lireElementCanonique("NODE", 9928912836, { transport }));
  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") throw new Error("statut inattendu");
  assert.equal(r.magasin.name, "Naturalia");
  assert.equal(r.magasin.brandWikidata, "Q3336090");
  assert.equal(r.magasin.lat, 43.1242);
  assert.equal(r.magasin.osmType, "NODE");
  assert.equal(r.magasin.osmId, 9928912836);
});

await test("SEL-canon — absent, non exploitable et panne sont trois issues", async () => {
  const vide = transportFige(json(ENV([])));
  assert.deepEqual(await avecUserAgent(() => lireElementCanonique("NODE", 1, { transport: vide.transport })), {
    statut: "absent",
  });

  // ⚠️ « CET ÉLÉMENT N'EXISTE PAS » ET « CET ÉLÉMENT N'EST PAS UN MAGASIN » SONT
  // DEUX REFUS DIFFÉRENTS, ET L'ÉLÈVE MÉRITE DE SAVOIR LEQUEL.
  for (const tags of [{ shop: "hairdresser", name: "Coiffeur" }, { shop: "supermarket" }, { name: "X" }]) {
    const t = transportFige(json(ENV([{ type: "node", id: 1, lat: 43, lon: 5, tags }])));
    assert.deepEqual(
      await avecUserAgent(() => lireElementCanonique("NODE", 1, { transport: t.transport })),
      { statut: "non_exploitable" },
      JSON.stringify(tags),
    );
  }

  // ⚠️ ET L'IDENTITÉ RENDUE DOIT ÊTRE CELLE DEMANDÉE. Un amont qui répondrait
  // autre chose ne doit pas faire enregistrer un magasin que personne n'a
  // choisi.
  const autre = transportFige(
    json(ENV([{ type: "node", id: 999, lat: 43, lon: 5, tags: { shop: "bakery", name: "Autre" } }])),
  );
  assert.deepEqual(
    await avecUserAgent(() => lireElementCanonique("NODE", 1, { transport: autre.transport })),
    { statut: "non_exploitable" },
  );

  for (const [status, raison] of [
    [429, "rate_limited"],
    [503, "unavailable"],
    [504, "timeout"],
  ] as const) {
    const t = transportFige(new Response("", { status }));
    assert.deepEqual(
      await avecUserAgent(() => lireElementCanonique("NODE", 1, { transport: t.transport })),
      { statut: "echec", raison },
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
// C. LE PONT OPEN PRICES — EXACT, JAMAIS APPROCHANT
// ════════════════════════════════════════════════════════════════════════════

await test("SEL-37 — le pont est un appel EXACT par identité OSM", async () => {
  const { transport, urls } = transportFige(json({ id: 4877, osm_type: "NODE", osm_id: 9928912836 }));
  const r = await avecUserAgent(() => lirePontOsm("NODE", 9928912836, { transport }));

  assert.deepEqual(r, { statut: "ponte", opLocationId: 4877 });
  assert.equal(urls.length, 1);
  assert.ok(urls[0]!.endsWith("/locations/osm/NODE/9928912836"), `URL exacte, reçue : ${urls[0]}`);
  assert.ok(urls[0]!.startsWith(OPEN_PRICES_PONT_OSM_URL));

  // ⚠️ 41/42 — AUCUN FUZZY, AUCUN RAPPROCHEMENT PAR NOM. L'URL ne porte aucune
  // chaîne de requête : ni `osm_name`, ni `q`, ni ville. Chercher « Naturalia »
  // rattacherait un magasin toulonnais aux prix d'un magasin parisien.
  assert.equal(urls[0]!.includes("?"), false, "aucun paramètre de recherche");
  const nu = sansCommentaires(PONT);
  for (const motif of [/osm_name/, /osm_address_city/, /brand/i, /icontains/, /__like/, /search/i, /\bq=/]) {
    assert.equal(motif.test(nu), false, `le pont ne doit pas porter ${motif}`);
  }
});

await test("SEL-38/39/40/63 — 404 est une PREUVE, 429/503/timeout n'en sont pas", async () => {
  // ⚠️ 404 = ABSENCE PROUVÉE. Open Prices a répondu, il ne connaît pas ce lieu.
  const absent = transportFige(new Response("", { status: 404 }));
  assert.deepEqual(await avecUserAgent(() => lirePontOsm("NODE", 1, { transport: absent.transport })), {
    statut: "absent",
  });

  // ⚠️ ET TOUT LE RESTE EST UN DOUTE. Une panne transformée en 404 ferait
  // écrire en base « ce magasin n'a pas de prix » — une absence PROUVÉE — sur la
  // foi d'un réseau qui a lâché. C'est le défaut S23, et il est mortel : la
  // preuve fausse survit à la panne.
  for (const [status, cause] of [
    [429, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
    [504, "timeout"],
  ] as const) {
    const t = transportFige(new Response("", { status }));
    const r = await avecUserAgent(() => lirePontOsm("NODE", 1, { transport: t.transport }));
    assert.deepEqual(r, { statut: "indetermine", cause }, `${status} ne doit pas devenir une preuve`);
    assert.notEqual(r.statut, "absent");
  }

  const reseau = transportFige(async () => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(await avecUserAgent(() => lirePontOsm("NODE", 1, { transport: reseau.transport })), {
    statut: "indetermine",
    cause: "unavailable",
  });

  const abandon = transportFige(async () => {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  });
  assert.deepEqual(await avecUserAgent(() => lirePontOsm("NODE", 1, { transport: abandon.transport })), {
    statut: "indetermine",
    cause: "timeout",
  });

  // Un 200 illisible, ou sans identifiant exploitable, est un doute AUSSI —
  // jamais une absence.
  for (const corps of [{}, { id: null }, { id: "4877" }, { id: 0 }, { id: -1 }, { id: 2 ** 53 }, null]) {
    const t = transportFige(json(corps));
    const r = await avecUserAgent(() => lirePontOsm("NODE", 1, { transport: t.transport }));
    assert.equal(r.statut, "indetermine", `corps ${JSON.stringify(corps)} → doute`);
  }
  const illisible = transportFige(new Response("<html>", { status: 200 }));
  assert.equal(
    (await avecUserAgent(() => lirePontOsm("NODE", 1, { transport: illisible.transport }))).statut,
    "indetermine",
  );
});

await test("SEL-41b — le type OSM voyage tel quel dans le chemin, jamais deviné", async () => {
  for (const [type, attendu] of [
    ["NODE", "NODE"],
    ["WAY", "WAY"],
    ["RELATION", "RELATION"],
  ] as const) {
    const { transport, urls } = transportFige(json({ id: 1 }));
    await avecUserAgent(() => lirePontOsm(type, 42, { transport }));
    assert.ok(urls[0]!.endsWith(`/osm/${attendu}/42`), `${type} → ${urls[0]}`);
  }
  for (const mauvais of [0, -1, 1.5, 2 ** 53]) {
    await assert.rejects(() => avecUserAgent(() => lirePontOsm("NODE", mauvais)));
  }
});

// ════════════════════════════════════════════════════════════════════════════
// D. LA ROUTE — UNE PANNE DU PONT N'EMPÊCHE PAS DE CHOISIR
// ════════════════════════════════════════════════════════════════════════════

await test("SEL-43/44/63b — le magasin OSM reste sélectionnable, ponté ou non", () => {
  const route = sansCommentaires(ROUTE_SELECT);

  assert.ok(/choixMagasinOsmBodySchema/.test(route), "le corps est une identité OSM");
  assert.ok(/lireElementCanonique/.test(route), "le serveur relit la fiche canonique");
  assert.ok(/lirePontOsm/.test(route), "le pont exact est tenté");
  assert.ok(/upserterMagasinOsm/.test(route), "l'écriture passe par l'identité OSM");

  // ⚠️ RESSERRÉ APRÈS UN SABOTAGE PASSÉ AU VERT — ET LA LEÇON EST ÉCRITE ICI.
  // La version précédente cherchait une condition rédigée d'une certaine
  // façon (`pont.statut === "indetermine"`) ; il suffisait de renommer la
  // variable en `lu` pour l'endormir, et un `return 503` pouvait alors refuser
  // la sélection sans faire rougir quoi que ce soit. Un contrôle qui dépend du
  // nom d'une variable ne contrôle rien.
  //
  // Deux contrôles le remplacent. Le premier est STRUCTUREL et ne nomme aucune
  // variable : entre la lecture du pont et l'écriture, il ne doit exister
  // AUCUNE sortie en erreur, quelle qu'en soit la condition.
  // ⚠️ ON VISE LES APPELS, PAS LES IMPORTS — DEUXIÈME CORRECTION DU MÊME TEST.
  // La première version bornait la région avec `indexOf`, qui tombait sur les
  // lignes d'import en tête de fichier : la « région » examinée ne contenait
  // que des imports, et TROIS sabotages différents y sont passés au vert. Un
  // test qui regarde au mauvais endroit est pire qu'un test absent, parce
  // qu'il rassure.
  const debutEcriture = route.indexOf("upserterMagasinOsm(admin");
  assert.ok(debutEcriture > 0, "l'appel d'écriture doit être trouvable");
  const appelPont = route.lastIndexOf("lirePontOsm(", debutEcriture);
  assert.ok(appelPont > 0, "l'appel de lecture du pont doit précéder l'écriture");
  // ⚠️ LA RÉGION COMMENCE AU DÉBUT DE LA LIGNE, PAS AU MILIEU DE L'APPEL. Dans
  // `pont = pontPourEcriture(await lirePontOsm(…))`, la traduction est écrite
  // AVANT la lecture : couper sur `lirePontOsm(` la laisserait hors du champ,
  // et le contrôle accuserait la bonne version.
  const debutPont = route.lastIndexOf("\n", appelPont) + 1;
  const entreLesDeux = route.slice(debutPont, debutEcriture);
  assert.ok(entreLesDeux.length > 40, "la région examinée doit être le vrai corps, pas deux imports");
  assert.equal(
    /return\s+NextResponse\.json\([\s\S]*?status:\s*[45]\d\d/.test(entreLesDeux),
    false,
    "aucune sortie en erreur ne peut suivre la lecture du pont",
  );

  // Le second est COMPORTEMENTAL : la règle vit dans une fonction totale, dont
  // aucune entrée ne produit un refus. C'est le type qui porte la garantie.
  for (const cause of ["rate_limited", "unavailable", "timeout", "corps_illisible"] as const) {
    assert.deepEqual(pontPourEcriture({ statut: "indetermine", cause }), { statut: "indetermine" });
  }
  assert.deepEqual(pontPourEcriture({ statut: "absent" }), { statut: "absent" });
  assert.deepEqual(pontPourEcriture({ statut: "ponte", opLocationId: 4877 }), {
    statut: "ponte",
    opLocationId: 4877,
  });
  // ⚠️ TROISIÈME CORRECTION, ET LA DERNIÈRE FUITE : S21d contournait la
  // fonction totale en fabriquant le `PontConnu` à la main — `y.statut ===
  // "ponte" ? … : { statut: "absent" }` — ce qui transformait une PANNE en
  // absence PROUVÉE. La présence de `pontPourEcriture` quelque part dans le
  // fichier ne prouvait rien : elle restait dans la ligne d'import.
  //
  // La règle est donc : entre la lecture et l'écriture, le pont ne se
  // FABRIQUE PAS. Il se traduit, par la fonction totale, et par elle seule.
  assert.ok(entreLesDeux.includes("pontPourEcriture("), "la traduction passe par la fonction totale");
  for (const litteral of ['statut: "absent"', 'statut: "ponte"', 'statut: "indetermine"']) {
    assert.equal(
      entreLesDeux.includes(litteral),
      false,
      `le pont ne doit pas être fabriqué à la main : ${litteral}`,
    );
  }

  // ⚠️ ET L'ANCIEN CHEMIN EST FERMÉ. `opLocationId` ne doit plus entrer par le
  // corps de la requête, ni servir de clé de relecture.
  assert.equal(/choixMagasinBodySchema/.test(route), false, "l'ancien corps est retiré");
  assert.equal(/lireMagasinCanonique/.test(route), false, "l'ancienne relecture Open Prices est retirée");
  assert.equal(/parsed\.data\.opLocationId/.test(route), false, "le client ne fournit plus d'identifiant amont");

  // Les gardes de C4.3a restent.
  assert.ok(/auth\.getUser\(\)/.test(route));
  assert.ok(/consumeRateLimit/.test(route));
  assert.ok(/createSupabaseAdminClient/.test(route), "seul le rôle serveur écrit dans stores");
  assert.ok(/enregistrerMagasinChoisi/.test(route), "le choix reste écrit sous la RLS de l'élève");
});


await test("SEL-45 — le choix de l'élève pointe l'identifiant de LIGNE, jamais l'amont", () => {
  const route = sansCommentaires(ROUTE_SELECT);
  // ⚠️ `student_selected_store.store_id` RÉFÉRENCE `stores.id`. Y ranger un
  // `op_location_id` — ou une identité OSM — casserait la clé étrangère de
  // C4.2 et, pire, rendrait le choix de l'élève impossible à résoudre pour un
  // magasin sans pont.
  assert.match(
    route,
    /enregistrerMagasinChoisi\(\s*supabase,\s*studentId,\s*upsert\.storeId\s*\)/,
    "le choix enregistre l'identifiant de ligne rendu par l'upsert",
  );
  // Et l'élève écrit sous SA RLS, jamais avec le rôle serveur.
  assert.equal(
    /enregistrerMagasinChoisi\(\s*admin/.test(route),
    false,
    "le choix personnel ne passe pas par le rôle serveur",
  );
});

await test("SEL-53/54 — aucun stock, aucune disponibilité, aucun repli C3", () => {
  const lot = [sansCommentaires(ROUTE_SELECT), sansCommentaires(PONT)];
  for (const source of lot) {
    for (const motif of [
      /stock/i,
      /disponibilit/i,
      /inventaire/i,
      /budget-courses/,
      /estimated_price/,
      /price_cents/,
      /calculerBudgetListe/,
    ]) {
      assert.equal(motif.test(source), false, `hors périmètre : ${motif}`);
    }
  }
});

await test("SEL-14 — l'état de couverture rendu suit ce qui a RÉELLEMENT été écrit", () => {
  const route = sansCommentaires(ROUTE_SELECT);
  // ⚠️ IL DÉRIVE DE `upsert.opLocationId`, PAS DU PONT LU. La nuance est tout
  // le §14 : sur une panne, l'upsert a pu CONSERVER un pont connu, et l'écran
  // doit alors dire « ponté » — pas « sans couverture ». Lire `pont.statut` ici
  // annoncerait une absence là où la base porte un pont valide.
  assert.match(
    route,
    /upsert\.opLocationId === null[\s\S]{0,120}magasin_sans_couverture_prix/,
    "l'état vient de la ligne écrite, pas de la lecture amont",
  );
  const retour = route.slice(route.indexOf("couvertureMagasin"));
  assert.equal(/pont\.statut/.test(retour), false, "le pont lu ne décide pas de l'affichage");
  // Et l'identifiant amont ne sort pas vers le client.
  assert.equal(/opLocationId:/.test(retour), false, "aucun identifiant Open Prices rendu au navigateur");
});

console.log("\n✅ C4.3c — sélection par identité OSM : suite verte.");
