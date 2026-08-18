/**
 * Harnais — COURSES C4.4 : LES PRIX OBSERVÉS, EN LECTURE SEULE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'une ligne de courses se résout en N code-barres et non en un seul ; que
 * N > 1 n'est jamais un état d'erreur ni une ambiguïté ; qu'aucun produit n'est
 * élu ; qu'un prix CATEGORY, une remise, une devise étrangère ou une ligne sans
 * date ne peuvent pas devenir une observation ; que la pagination est bornée ET
 * que sa troncature se DIT ; qu'une panne amont ne se déguise jamais en
 * « aucun relevé » ; et que rien n'est écrit nulle part.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Le transport est injecté, les réponses
 * sont des fixtures. Open Food Facts étant indisponible pour la curation, AUCUN
 * test ne dépend d'un rapprochement réel : les GTIN de ce fichier sont des
 * fixtures locales, et rien n'est écrit en base distante.
 *
 * Lancement : npm run test:prix-observes-c4-4
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_OBSERVATIONS_PAGES,
  type ObservationPrix,
  cleInstantIso,
  etatPrixObserves,
  montantMilliDepuis,
  normaliserObservation,
  trierObservations,
  verifierMagasinDesObservations,
} from "../../lib/nutrition/prix-observes";
import {
  OPEN_PRICES_OBSERVATIONS_SIZE,
  lireObservationsPrix,
  urlObservations,
} from "../../lib/open-prices/observations";
import { gtinsParIdentite } from "../../lib/nutrition/prix-observes";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const PUR = lire("../../lib/nutrition/prix-observes.ts");
const ADAPTATEUR = lire("../../lib/open-prices/observations.ts");
const BASE = lire("../../lib/supabase/prix-observes.ts");
const LOT = [PUR, ADAPTATEUR, BASE];
const NOMS = [
  "lib/nutrition/prix-observes.ts",
  "lib/open-prices/observations.ts",
  "lib/supabase/prix-observes.ts",
];

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/**
 * ⚠️ UN USER-AGENT DE TEST, ET C'EST UNE FIXTURE — PAS UN SECRET. `userAgentOff()`
 * refuse volontairement de fabriquer un repli générique : l'oubli doit se voir
 * (A3-OFF11). Le harnais fournit donc une valeur locale, qui ne quitte jamais ce
 * fichier et n'atteint aucun réseau — le transport est injecté partout.
 */
process.env.OPENFOODFACTS_USER_AGENT ??= "CoachingPlatformTests/0.0 (tests@local)";

const MAGASIN = 12345;

/** Un relevé Open Prices bien formé — le point de départ de chaque variante. */
function prixBrut(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 900001,
    type: "PRODUCT",
    product_code: "3017620422003",
    price: "2.990",
    currency: "EUR",
    price_is_discounted: false,
    price_per: null,
    date: "2026-08-01",
    created: "2026-08-02T10:00:00.123456Z",
    location_id: MAGASIN,
    ...surcharge,
  };
}

/** L'enveloppe de pagination d'Open Prices : `{items, page, pages, size, total}`. */
function enveloppe(items: readonly unknown[], page = 1, pages = 1, total?: number) {
  return { items, page, pages, size: OPEN_PRICES_OBSERVATIONS_SIZE, total: total ?? items.length };
}

function reponse(corps: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
  } as unknown as Response;
}

// ════════════════════════════════════════════════════════════════════════════
// A. LE GRAPHE : LIGNE DE COURSES → N CODE-BARRES
// ════════════════════════════════════════════════════════════════════════════

await test("C4.4-16 — ligne DIRECTE product_id → le GTIN de ce produit, et lui seul", () => {
  const carte = gtinsParIdentite({
    produitsDirects: [{ productId: "prod-1", gtin: "3017620422003" }],
    produitsRelies: [],
  });
  assert.deepEqual(carte.get("product:prod-1"), ["3017620422003"]);
  // Une ligne directe ne récupère PAS les frères de son aliment générique :
  // l'élève a désigné CE produit.
  assert.equal(carte.size, 1);
});

await test("C4.4-17 — ligne GÉNÉRIQUE catalog_food_id → TOUS les food_products reliés", () => {
  const carte = gtinsParIdentite({
    produitsDirects: [],
    produitsRelies: [
      { foodId: "avoine", gtin: "3560070976478" },
      { foodId: "avoine", gtin: "20087090" },
      { foodId: "avoine", gtin: "3596710352104" },
      { foodId: "riz", gtin: "3175681840607" },
    ],
  });
  assert.deepEqual(carte.get("catalog_food:avoine"), [
    "3560070976478",
    "20087090",
    "3596710352104",
  ]);
  assert.deepEqual(carte.get("catalog_food:riz"), ["3175681840607"]);
});

await test("C4.4-02 — aliment générique SANS GTIN relié → aucun_produit_relie", () => {
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: [],
    lecture: null,
  });
  assert.equal(r.etat, "aucun_produit_relie");
  assert.deepEqual(r.observations, []);
});

await test("C4.4-01 — aucun magasin sélectionné → aucun_magasin, AVANT toute lecture", () => {
  const r = etatPrixObserves({
    opLocationId: null,
    gtins: ["3017620422003", "20087090"],
    lecture: null,
  });
  assert.equal(r.etat, "aucun_magasin");
  assert.deepEqual(r.observations, []);
});

// ════════════════════════════════════════════════════════════════════════════
// B. LE CŒUR : N GTIN, AUCUNE ÉLECTION, AUCUNE AMBIGUÏTÉ
// ════════════════════════════════════════════════════════════════════════════

function obs(
  gtin: string,
  date: string,
  montantMilli = 2990,
  id = 1,
  createdLe = "2026-08-02T10:00:00.123456Z",
): ObservationPrix {
  return {
    priceId: id,
    gtin,
    montantMilli,
    devise: "EUR",
    observeLe: date,
    createdLe,
    opLocationId: MAGASIN,
    pricePer: null,
  };
}

await test("C4.4-03 — 1 seul GTIN relié : ses relevés, sans traitement particulier", () => {
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["3017620422003"],
    lecture: { ok: true, observations: [obs("3017620422003", "2026-08-01")], tronque: false, ignores: 0 },
  });
  assert.equal(r.etat, "releves");
  assert.equal(r.observations.length, 1);
});

await test("C4.4-04/05/07/18 — N GTIN : A et C ont des relevés, B non → A + C, jamais un choix", () => {
  // ⚠️ LE CAS OBLIGATOIRE DU CADRAGE. Trois code-barres reliés au même aliment
  // générique, un seul magasin, et B n'a rien.
  const A = "3560070976478";
  const B = "20087090";
  const C = "3596710352104";
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: [A, B, C],
    lecture: {
      ok: true,
      observations: [
        obs(A, "2026-08-10", 2990, 1),
        obs(C, "2026-08-05", 3190, 2),
        obs(C, "2026-07-02", 2890, 3),
      ],
      tronque: false,
      ignores: 0,
    },
  });

  assert.equal(r.etat, "releves", "N > 1 ne produit AUCUN état d'erreur ni d'ambiguïté");
  // Les trois observations sortent — A et C, pas « la meilleure ».
  assert.deepEqual(
    r.observations.map((o) => o.gtin),
    [A, C, C],
  );
  assert.equal(r.observations.length, 3);

  // ⚠️ AUCUNE AGRÉGATION : ni moyenne, ni minimum, ni « produit retenu ».
  const r2 = r as unknown as Record<string, unknown>;
  for (const interdit of ["moyenne", "prixMoyen", "meilleur", "retenu", "gtinRetenu", "prixMin"]) {
    assert.equal(r2[interdit], undefined, `aucun champ « ${interdit} » ne doit exister`);
  }
  // Et B, sans relevé, ne fabrique aucune ligne vide.
  assert.ok(!r.observations.some((o) => o.gtin === B), "B n'a rien : B n'apparaît pas");
});

await test("C4.4-06 — AUCUN GTIN n'a de prix dans ce magasin → aucun_releve, et il est DÉFINITIF", () => {
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["a", "b", "c"],
    lecture: { ok: true, observations: [], tronque: false, ignores: 0 },
  });
  assert.equal(r.etat, "aucun_releve");
  assert.equal(r.tronque, false);
  assert.equal(r.ignores, 0);
});

await test("C4.4-13 — 0 relevé + réponse TRONQUÉE → indetermine, jamais aucun_releve", () => {
  // ⚠️ LA LEÇON DE C3 ET DE C4.1, APPLIQUÉE ICI. « aucun » et « on ne sait pas »
  // ne se confondent jamais : un élève qui lit « aucun prix » sur une réponse
  // tronquée range l'article dans sa tête comme introuvable.
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["a"],
    lecture: { ok: true, observations: [], tronque: true, ignores: 0 },
  });
  assert.equal(r.etat, "indetermine");
  assert.notEqual(r.etat, "aucun_releve");
  assert.notEqual(r.etat, "indisponible", "le service a RÉPONDU : ce n'est pas une panne");
  assert.equal(r.tronque, true, "la cause du doute reste lisible");
  assert.equal(r.raison, null, "aucune raison de panne : il n'y a pas eu de panne");
});

await test("C4.4-13b — 0 relevé + lignes ÉCARTÉES → indetermine", () => {
  // Toutes les lignes reçues étaient des remises, des devises étrangères ou
  // des lignes sans date. Elles auraient PU être des relevés valides.
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["a"],
    lecture: { ok: true, observations: [], tronque: false, ignores: 3 },
  });
  assert.equal(r.etat, "indetermine");
  assert.equal(r.ignores, 3);
});

await test("C4.4-13c — 0 relevé, AUCUN doute → aucun_releve, et c'est un FAIT", () => {
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["a"],
    lecture: { ok: true, observations: [], tronque: false, ignores: 0 },
  });
  assert.equal(r.etat, "aucun_releve");
  assert.notEqual(r.etat, "indetermine", "sans doute, on n'invente pas de doute non plus");
});

await test("C4.4-13d — la frontière est EXACTEMENT (tronque || ignores > 0)", () => {
  // ⚠️ LES QUATRE COMBINAISONS, ÉNUMÉRÉES. Un test qui n'en couvrirait que
  // deux laisserait passer un `&&` mis à la place d'un `||`.
  const cas: ReadonlyArray<readonly [boolean, number, string]> = [
    [false, 0, "aucun_releve"],
    [true, 0, "indetermine"],
    [false, 1, "indetermine"],
    [true, 1, "indetermine"],
  ];
  for (const [tronque, ignores, attendu] of cas) {
    const r = etatPrixObserves({
      opLocationId: MAGASIN,
      gtins: ["a"],
      lecture: { ok: true, observations: [], tronque, ignores },
    });
    assert.equal(r.etat, attendu, `tronque=${tronque} ignores=${ignores}`);
  }
});

await test("C4.4-13e — indetermine ne devient JAMAIS aucun_releve, ni indisponible", () => {
  // Le même doute, vu depuis les deux états voisins : aucun des deux ne doit
  // pouvoir l'absorber.
  const douteux = [
    { ok: true, observations: [] as ObservationPrix[], tronque: true, ignores: 0 },
    { ok: true, observations: [] as ObservationPrix[], tronque: false, ignores: 1 },
    { ok: true, observations: [] as ObservationPrix[], tronque: true, ignores: 9 },
  ];
  for (const lecture of douteux) {
    const r = etatPrixObserves({ opLocationId: MAGASIN, gtins: ["a"], lecture });
    assert.equal(r.etat, "indetermine");
    assert.notEqual(r.etat, "aucun_releve");
    assert.notEqual(r.etat, "indisponible");
    assert.equal(r.raison, null);
  }
  // Et réciproquement : une VRAIE panne ne devient jamais `indetermine`.
  for (const raison of ["rate_limited", "unavailable"] as const) {
    const r = etatPrixObserves({
      opLocationId: MAGASIN,
      gtins: ["a"],
      lecture: { ok: false, raison, observations: [], tronque: false, ignores: 0 },
    });
    assert.equal(r.etat, "indisponible");
    assert.notEqual(r.etat, "indetermine");
    assert.equal(r.raison, raison);
  }
});

await test("C4.4-13f — `releves` CONSERVE tronque et ignores", () => {
  // Trois relevés issus d'une réponse tronquée restent une liste INCOMPLÈTE.
  const r = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["a"],
    lecture: {
      ok: true,
      observations: [obs("a", "2026-08-01")],
      tronque: true,
      ignores: 4,
    },
  });
  assert.equal(r.etat, "releves");
  assert.equal(r.tronque, true, "« voici trois prix » n'est pas « voici LES trois prix »");
  assert.equal(r.ignores, 4);
});

await test("C4.4-08 — ordre TOTAL : observeLe DESC, createdLe DESC, priceId DESC", () => {
  // Deux lots concaténés rendent une liste localement triée mais globalement
  // fausse. Le tri est donc refait, et il est TOTAL.
  const melange = [
    obs("a", "2026-01-01", 100, 5, "2026-01-02T08:00:00.000000Z"),
    obs("b", "2026-08-10", 200, 1, "2026-08-11T08:00:00.000000Z"),
    obs("c", "2026-03-03", 300, 9, "2026-03-04T08:00:00.000000Z"),
    obs("d", "2026-08-10", 250, 2, "2026-08-12T08:00:00.000000Z"),
  ];
  const trie = trierObservations(melange);
  assert.deepEqual(
    trie.map((o) => o.observeLe),
    ["2026-08-10", "2026-08-10", "2026-03-03", "2026-01-01"],
  );
  // À date d'observation égale, la saisie la PLUS RÉCENTE d'abord : d avant b.
  assert.deepEqual(trie.slice(0, 2).map((o) => o.gtin), ["d", "b"]);
  // L'entrée n'est pas mutée.
  assert.equal(melange[0]!.observeLe, "2026-01-01");
});

await test("C4.4-08b — même observeLe, `created` différents : c'est created qui tranche", () => {
  // ⚠️ LE CAS DEMANDÉ. Trois relevés du MÊME jour d'observation, saisis à des
  // instants différents, avec des `priceId` qui contredisent l'ordre des
  // saisies — pour qu'un tri qui ignorerait `createdLe` se voie tout de suite.
  //
  // ⚠️ LES `priceId` CONTREDISENT L'ORDRE DES SAISIES, ET C'EST TOUT L'INTÉRÊT
  // DE LA FIXTURE. Avec `priceId` aligné sur `created`, un tri qui IGNORE
  // `createdLe` rendrait le même résultat et le test resterait vert pour une
  // mauvaise raison — c'est exactement ce qu'il faisait avant correction.
  // Ici, sans le critère `createdLe`, l'ordre retomberait sur priceId DESC,
  // c'est-à-dire ["x", "z", "y"] : l'inverse exact du résultat attendu.
  const memeJour = [
    obs("x", "2026-08-01", 100, 9, "2026-08-01T09:00:00.000000Z"),
    obs("y", "2026-08-01", 200, 1, "2026-08-03T09:00:00.000000Z"),
    obs("z", "2026-08-01", 300, 5, "2026-08-02T09:00:00.000000Z"),
  ];
  assert.deepEqual(
    trierObservations(memeJour).map((o) => o.gtin),
    ["y", "z", "x"],
    "createdLe décroissant — et surtout PAS priceId décroissant, qui donnerait x,z,y",
  );
});

await test("C4.4-08c — même observeLe ET même created : priceId DÉCROISSANT tranche", () => {
  const identiques = [
    obs("p", "2026-08-01", 100, 3, "2026-08-02T09:00:00.000000Z"),
    obs("q", "2026-08-01", 100, 7, "2026-08-02T09:00:00.000000Z"),
    obs("r", "2026-08-01", 100, 5, "2026-08-02T09:00:00.000000Z"),
  ];
  assert.deepEqual(
    trierObservations(identiques).map((o) => o.priceId),
    [7, 5, 3],
  );
  // ⚠️ ORDRE TOTAL : deux exécutions sur des entrées permutées donnent le MÊME
  // résultat. C'est la propriété qu'on veut, pas seulement « ça a l'air trié ».
  const permute = [identiques[2]!, identiques[0]!, identiques[1]!];
  assert.deepEqual(
    trierObservations(permute).map((o) => o.priceId),
    trierObservations(identiques).map((o) => o.priceId),
  );
});

await test("C4.4-08d — la fraction de seconde omise n'inverse PAS l'ordre", () => {
  // ⚠️ LE PIÈGE QUI JUSTIFIE `cleInstantIso`. `datetime.isoformat()` OMET la
  // partie fractionnaire quand les microsecondes valent zéro. En comparaison
  // BRUTE de chaînes, « …52Z » passe pour plus grand que « …52.276771Z »
  // parce que 'Z' (0x5A) > '.' (0x2E) — l'ordre s'inverse en silence.
  const brut = ["2026-08-01T20:01:52Z", "2026-08-01T20:01:52.276771Z"];
  assert.ok(brut[0]! > brut[1]!, "la comparaison BRUTE est bien piégeuse");
  assert.ok(
    cleInstantIso(brut[0]!)! < cleInstantIso(brut[1]!)!,
    "la clé canonisée rétablit l'ordre réel",
  );

  const cas = [
    obs("tard", "2026-08-01", 100, 1, "2026-08-01T20:01:52.276771Z"),
    obs("tot", "2026-08-01", 100, 2, "2026-08-01T20:01:52Z"),
  ];
  assert.deepEqual(
    trierObservations(cas).map((o) => o.gtin),
    ["tard", "tot"],
    "52,276771 s est POSTÉRIEUR à 52,000000 s",
  );
});

await test("C4.4-08e — `cleInstantIso` : UTC seulement, et rien d'approximatif", () => {
  assert.equal(cleInstantIso("2026-08-01T20:01:52Z"), "2026-08-01T20:01:52.000000000");
  assert.equal(cleInstantIso("2026-08-01T20:01:52.5Z"), "2026-08-01T20:01:52.500000000");
  assert.equal(cleInstantIso("2026-08-01T20:01:52.276771Z"), "2026-08-01T20:01:52.276771000");
  // `+00:00` désigne le même instant que `Z`.
  assert.equal(cleInstantIso("2026-08-01T20:01:52+00:00"), cleInstantIso("2026-08-01T20:01:52Z"));
  // Tout décalage non nul demanderait une arithmétique de fuseau : REFUS.
  for (const mauvais of [
    "2026-08-01T20:01:52+02:00",
    "2026-08-01T20:01:52-05:00",
    "2026-08-01 20:01:52Z",
    "2026-08-01T20:01:52",
    "01/08/2026",
    "",
    null,
    undefined,
    1754078512,
  ]) {
    assert.equal(cleInstantIso(mauvais), null, `${String(mauvais)} doit être refusé`);
  }
  // ⚠️ AUCUN `Date`, AUCUN FLOTTANT dans le module — la comparaison reste
  // textuelle, donc exacte au microseconde près.
  assert.ok(!/new Date\(|getTime\(|Date\.parse/.test(sansCommentaires(PUR)));
});

await test("C4.4-08f — `created` illisible : la ligne est REFUSÉE et COMPTÉE", () => {
  // `created` est garanti par le schéma amont. Une valeur que nous ne savons
  // pas ordonner signale une DÉRIVE de la source — elle doit se voir.
  for (const mauvais of [undefined, null, "", "hier", "2026-08-01T20:01:52+02:00"]) {
    const r = normaliserObservation(prixBrut({ created: mauvais }), MAGASIN);
    assert.equal(r.ok, false, `created=${String(mauvais)}`);
    assert.equal(r.ok === false ? r.refus : null, "created_illisible");
  }
  assert.equal(normaliserObservation(prixBrut(), MAGASIN).ok, true);
});

// ════════════════════════════════════════════════════════════════════════════
// C. CE QUI NE PEUT PAS DEVENIR UNE OBSERVATION
// ════════════════════════════════════════════════════════════════════════════

await test("C4.4-11 — un prix CATEGORY est REFUSÉ, même s'il porte un code-barres", () => {
  const refus = normaliserObservation(prixBrut({ type: "CATEGORY", category_tag: "en:oats" }), MAGASIN);
  assert.equal(refus.ok, false);
  assert.equal(refus.ok === false ? refus.refus : null, "type_non_produit");
});

await test("C4.4-09 — un prix REMISÉ est refusé comme prix normal", () => {
  const refus = normaliserObservation(
    prixBrut({ price_is_discounted: true, price_without_discount: "3.990" }),
    MAGASIN,
  );
  assert.equal(refus.ok, false);
  assert.equal(refus.ok === false ? refus.refus : null, "remise");

  // ⚠️ ET LE FILTRE AMONT NE SUFFIT PAS. La requête demande déjà
  // `price_is_discounted=false` ; ce refus est la SECONDE serrure, pour le jour
  // où l'amont changera de comportement sans nous prévenir.
  assert.match(ADAPTATEUR, /price_is_discounted/, "le filtre amont doit exister");
  assert.match(PUR, /price_is_discounted/, "et le refus défensif aussi");
});

await test("C4.4-10 — une devise autre qu'EUR est refusée", () => {
  for (const devise of ["USD", "CHF", "GBP", "", null, 42]) {
    const refus = normaliserObservation(prixBrut({ currency: devise }), MAGASIN);
    assert.equal(refus.ok, false, `${String(devise)} doit être refusée`);
  }
  assert.equal(normaliserObservation(prixBrut(), MAGASIN).ok, true, "EUR passe");
});

await test("C4.4-S6 — une ligne SANS date ne devient jamais une observation", () => {
  // ⚠️ LA DATE N'EST PAS DÉCORATIVE. Un prix observé sans date est un prix
  // qu'on ne peut pas situer — et l'afficher reviendrait à laisser croire
  // qu'il vaut aujourd'hui. Open Prices tolère `date: null` (mesuré sur des
  // relevés importés) : c'est donc un cas réel, pas théorique.
  for (const date of [null, "", undefined, 20260801]) {
    const refus = normaliserObservation(prixBrut({ date }), MAGASIN);
    assert.equal(refus.ok, false, `date=${String(date)} doit être refusée`);
    assert.equal(refus.ok === false ? refus.refus : null, "date_absente");
  }
});

await test("C4.4-M — le montant est un ENTIER de millièmes, sans perte de la 3e décimale", () => {
  // ⚠️ `price` est un Decimal(10,3) — TROIS décimales. `round(price × 100)`
  // perdrait la troisième en silence. On garde des millièmes entiers.
  assert.equal(montantMilliDepuis("2.990"), 2990);
  assert.equal(montantMilliDepuis("0.999"), 999);
  assert.equal(montantMilliDepuis("12"), 12000);
  assert.equal(montantMilliDepuis("1.5"), 1500);
  assert.equal(montantMilliDepuis(2.99), 2990);
  assert.equal(montantMilliDepuis(0), 0);
  // Tout le reste est refusé plutôt qu'arrondi au jugé.
  for (const mauvais of ["", "abc", "-1.00", "1.2345", null, undefined, NaN, Infinity, {}]) {
    assert.equal(montantMilliDepuis(mauvais), null, `${String(mauvais)} doit être refusé`);
  }
  // Et jamais de flottant dans le résultat.
  const ok = normaliserObservation(prixBrut({ price: "2.995" }), MAGASIN);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok === true ? ok.observation.montantMilli : null, 2995);
  assert.ok(Number.isInteger(ok.ok === true ? ok.observation.montantMilli : NaN));
});

await test("C4.4-P — `price_per` est conservé TEL QUEL, ses trois cas distingués", () => {
  // ⚠️ TROIS CAS, PAS DEUX. `null` = le prix du conditionnement entier ;
  // `KILOGRAM` = un prix au kilo ; `UNIT` = un prix à la pièce. Les confondre
  // multiplierait ou diviserait par le poids du paquet. C4.4 ne tranche pas —
  // c'est C4.5 — mais il TRANSMET l'information sans la perdre.
  for (const valeur of [null, "UNIT", "KILOGRAM"]) {
    const r = normaliserObservation(prixBrut({ price_per: valeur }), MAGASIN);
    assert.equal(r.ok, true);
    assert.equal(r.ok === true ? r.observation.pricePer : "?", valeur);
  }
  // Une valeur inconnue ne devient pas `null` en silence : elle est refusée.
  const inconnu = normaliserObservation(prixBrut({ price_per: "LITRE" }), MAGASIN);
  assert.equal(inconnu.ok, false);
});

await test("C4.4-G — un relevé d'un AUTRE magasin empoisonne la réponse entière", () => {
  // Même doctrine que `codes_hors_lot` en C4.1 : un seul élément hors filtre
  // prouve que le filtre a sauté. On jette tout plutôt que d'en garder la
  // moitié crédible.
  assert.equal(
    verifierMagasinDesObservations({ opLocationId: MAGASIN, items: [prixBrut(), prixBrut()] }),
    null,
  );
  assert.equal(
    verifierMagasinDesObservations({
      opLocationId: MAGASIN,
      items: [prixBrut(), prixBrut({ location_id: 999 })],
    }),
    "magasin_hors_lot",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// D. LA REQUÊTE OPEN PRICES
// ════════════════════════════════════════════════════════════════════════════

await test("C4.4-Q — la requête porte les six filtres, et le magasin", () => {
  const url = new URL(urlObservations({ codes: ["3017620422003", "20087090"], opLocationId: MAGASIN, page: 2 }));
  assert.equal(url.origin + url.pathname, "https://prices.openfoodfacts.org/api/v1/prices");
  const p = url.searchParams;
  assert.equal(p.get("product_code__in"), "3017620422003,20087090");
  assert.equal(p.get("location_id"), String(MAGASIN));
  assert.equal(p.get("type"), "PRODUCT");
  assert.equal(p.get("currency"), "EUR");
  assert.equal(p.get("price_is_discounted"), "false");
  assert.equal(p.get("order_by"), "-date");
  assert.equal(p.get("size"), String(OPEN_PRICES_OBSERVATIONS_SIZE));
  assert.equal(p.get("page"), "2");
  assert.ok(OPEN_PRICES_OBSERVATIONS_SIZE <= 100, "`size` ne dépasse jamais le max amont");
});

await test("C4.4-L — les codes sont découpés en lots sûrs (piège des 98 caractères)", () => {
  // ⚠️ MESURÉ : au-delà d'environ 98 caractères, `product_code__in` n'est pas
  // rejeté, il est IGNORÉ — et l'API rend la table entière. Sous la règle
  // N-GTIN, un aliment bien curé atteint cette borne d'autant plus vite.
  const codes = Array.from({ length: 20 }, (_, i) => String(3017620420000 + i));
  const appels: string[] = [];
  const transport = async (url: string) => {
    appels.push(url);
    return reponse(enveloppe([]));
  };
  return lireObservationsPrix({ gtins: codes, opLocationId: MAGASIN, transport }).then(() => {
    assert.ok(appels.length > 1, "vingt codes ne tiennent pas dans un seul lot");
    for (const url of appels) {
      const valeur = new URL(url).searchParams.get("product_code__in") ?? "";
      assert.ok(valeur.length <= 97, `lot trop long : ${valeur.length} caractères`);
      assert.ok(valeur.split(",").length <= 7, "au plus 7 codes par lot");
    }
  });
});

await test("C4.4-12 — la pagination est suivie, et bornée à trois pages", async () => {
  const pagesVues: string[] = [];
  const transport = async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page"));
    pagesVues.push(String(page));
    // Dix pages disponibles en amont : on ne doit en lire que trois.
    return reponse(enveloppe([prixBrut({ id: 1000 + page, date: `2026-0${page}-01` })], page, 10, 10));
  };
  const lecture = await lireObservationsPrix({
    gtins: ["3017620422003"],
    opLocationId: MAGASIN,
    transport,
  });
  assert.equal(MAX_OBSERVATIONS_PAGES, 3);
  assert.deepEqual(pagesVues, ["1", "2", "3"]);
  assert.equal(lecture.observations.length, 3);
  assert.equal(lecture.tronque, true, "il restait des pages : la troncature se DIT");
  assert.equal(lecture.ok, true, "tronqué n'est pas en panne");
});

await test("C4.4-12b — une seule page disponible : ni page 2, ni troncature", async () => {
  const pagesVues: number[] = [];
  const transport = async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page"));
    pagesVues.push(page);
    return reponse(enveloppe([prixBrut()], 1, 1, 1));
  };
  const lecture = await lireObservationsPrix({
    gtins: ["3017620422003"],
    opLocationId: MAGASIN,
    transport,
  });
  assert.deepEqual(pagesVues, [1]);
  assert.equal(lecture.tronque, false);
  assert.equal(lecture.observations.length, 1);
});

await test("C4.4-14 — 429 Open Prices → indisponible, JAMAIS « aucun relevé »", async () => {
  const transport = async () => reponse({ detail: "throttled" }, 429);
  const lecture = await lireObservationsPrix({
    gtins: ["3017620422003"],
    opLocationId: MAGASIN,
    transport,
  });
  assert.equal(lecture.ok, false);
  assert.equal(lecture.raison, "rate_limited");

  const r = etatPrixObserves({ opLocationId: MAGASIN, gtins: ["3017620422003"], lecture });
  assert.equal(r.etat, "indisponible");
  assert.notEqual(r.etat, "aucun_releve");
});

await test("C4.4-15 — 503 Open Prices → indisponible, et le motif est distinct", async () => {
  const transport = async () => reponse("<html>gateway</html>", 503);
  const lecture = await lireObservationsPrix({
    gtins: ["3017620422003"],
    opLocationId: MAGASIN,
    transport,
  });
  assert.equal(lecture.ok, false);
  assert.equal(lecture.raison, "unavailable");
  assert.equal(
    etatPrixObserves({ opLocationId: MAGASIN, gtins: ["a"], lecture }).etat,
    "indisponible",
  );
});

await test("C4.4-15b — réseau coupé, JSON illisible, enveloppe absurde → indisponible", async () => {
  const cas: readonly (() => Promise<Response>)[] = [
    async () => {
      throw new Error("network");
    },
    async () =>
      ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }) as unknown as Response,
    async () => reponse({ pas: "une enveloppe" }),
  ];
  for (const transport of cas) {
    const lecture = await lireObservationsPrix({
      gtins: ["3017620422003"],
      opLocationId: MAGASIN,
      transport,
    });
    assert.equal(lecture.ok, false, "aucune de ces réponses ne vaut « aucun prix »");
  }
});

await test("C4.4-Gb — un lot empoisonné (autre magasin / code hors lot) est rejeté ENTIER", async () => {
  const transport = async () =>
    reponse(enveloppe([prixBrut(), prixBrut({ location_id: 999, id: 2 })]));
  const lecture = await lireObservationsPrix({
    gtins: ["3017620422003"],
    opLocationId: MAGASIN,
    transport,
  });
  assert.equal(lecture.ok, false, "une réponse à moitié fausse est plus dangereuse qu'une absence");
  assert.deepEqual(lecture.observations, []);
});

await test("C4.4-I — les lignes écartées sont COMPTÉES, jamais effacées en silence", async () => {
  const transport = async () =>
    reponse(
      enveloppe([
        prixBrut({ id: 1 }),
        prixBrut({ id: 2, date: null }),
        prixBrut({ id: 3, currency: "USD" }),
        prixBrut({ id: 4, type: "CATEGORY" }),
        prixBrut({ id: 5, price_is_discounted: true }),
      ]),
    );
  const lecture = await lireObservationsPrix({
    gtins: ["3017620422003"],
    opLocationId: MAGASIN,
    transport,
  });
  assert.equal(lecture.ok, true);
  assert.equal(lecture.observations.length, 1);
  assert.equal(lecture.ignores, 4, "quatre lignes écartées, et le compteur le dit");

  // Et ce compteur bascule l'état vers `indetermine` quand il ne reste rien :
  // quatre lignes écartées auraient pu être quatre relevés valides.
  const rienDeValide = etatPrixObserves({
    opLocationId: MAGASIN,
    gtins: ["3017620422003"],
    lecture: { ok: true, observations: [], tronque: false, ignores: 4 },
  });
  assert.equal(rienDeValide.etat, "indetermine");
  assert.notEqual(rienDeValide.etat, "aucun_releve");
});

// ════════════════════════════════════════════════════════════════════════════
// E. PÉRIMÈTRE — C4.4 NE FAIT QUE LIRE
// ════════════════════════════════════════════════════════════════════════════

await test("PERIMETRE-C4.4 — aucune écriture, aucun budget, aucun conditionnement", () => {
  for (const motif of [
    /\.insert\(/,
    /\.update\(/,
    /\.upsert\(/,
    /\.delete\(/,
    /\.rpc\(/,
    /food_price_estimates/,
    /price_cents/,
    /budget/i,
    /product_quantity/,
    /conditionnement|packaging/i,
    // ⚠️ `/stock/i` SANS FRONTIÈRE DE MOT, À DESSEIN : un champ nommé
    // `enStock` ou `inStock` échapperait à `\bstock\b`, et c'est exactement
    // la forme qu'aurait la régression — un booléen déduit d'une date récente.
    /stock/i,
    /disponibilit/i,
    /meilleur|repr[ée]sentatif|moyenne/i,
  ]) {
    LOT.forEach((source, i) => {
      assert.ok(
        !motif.test(sansCommentaires(source)),
        `${NOMS[i]} ne doit pas porter ${motif}`,
      );
    });
  }
  // Et C4.4 n'a introduit AUCUNE migration.
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(
    migrations[migrations.length - 1],
    "20260918090000_c4_2_magasins.sql",
    "C4.4 n'ajoute aucune migration",
  );
});

await test("PERIMETRE-C4.4b — le budget C3 et l'aperçu C4.1 ne sont pas touchés", () => {
  // C4.4 est un module NEUF. Il ne touche pas au budget de C3…
  for (const source of LOT) {
    assert.ok(!/budget-courses/.test(source), "aucun lien vers le budget C3");
    assert.ok(!/calculerBudgetListe|indexerPrix/.test(source), "aucun calcul de panier");
  }

  // …et il n'emprunte AUCUNE fonction de l'aperçu de curation C4.1.
  //
  // ⚠️ L'IMPORT DE `apercu.ts` EST TOLÉRÉ, MAIS POUR DEUX CONSTANTES SEULEMENT.
  // `OPEN_PRICES_BASE_URL` et `OPEN_PRICES_API_VERSION` sont des faits sur
  // Open Prices, pas sur la curation, et la règle A3-OFF1 veut UNE constante
  // par fait. Les recopier ici créerait deux vérités qui divergeraient le jour
  // d'un changement de version. Ce qui est interdit, c'est de réutiliser la
  // LOGIQUE de curation : elle ne filtre ni magasin, ni devise, ni remise.
  for (const fonction of ["lireApercusPrix", "agregerApercus", "apercuAbsent", "ApercuPrix"]) {
    assert.ok(
      !ADAPTATEUR.includes(fonction) && !PUR.includes(fonction) && !BASE.includes(fonction),
      `C4.4 ne doit pas réutiliser ${fonction} — l'aperçu répond à une autre question`,
    );
  }
  const importsApercu = [...ADAPTATEUR.matchAll(/from "@\/lib\/open-prices\/apercu"/g)];
  assert.ok(importsApercu.length <= 1, "un seul point d'emprunt vers apercu.ts");
  const ligneImport = /import \{([^}]*)\} from "@\/lib\/open-prices\/apercu";/.exec(ADAPTATEUR);
  if (ligneImport) {
    const noms = ligneImport[1]!.split(",").map((n) => n.trim()).filter((n) => n !== "").sort();
    assert.deepEqual(
      noms,
      ["OPEN_PRICES_API_VERSION", "OPEN_PRICES_BASE_URL"],
      "seules les deux constantes de service sont empruntées",
    );
  }
});

console.log("\n✅ C4.4 — prix observés, lecture seule : suite verte.");
