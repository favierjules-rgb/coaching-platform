/**
 * Harnais — PRIX PAR CATÉGORIE, ESTIMATIONS, ET LES SIX CAUSES D'ABSENCE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS VERROUILLE
 * ────────────────────────────────────────────────────────────────────────────
 * Trois chantiers, et chacun corrige un défaut MESURÉ sur l'API le 08/11/2026 :
 *
 *   C1  `type=PRODUCT` était figé dans l'URL. Les 10 619 relevés `CATEGORY` —
 *       des prix au kilo ou à la pièce, rattachés à une catégorie plutôt qu'à
 *       un code-barres — étaient structurellement hors de portée, alors qu'ils
 *       sont exactement ce qu'il faut à une liste d'aliments génériques ;
 *   C5  l'écran affichait « ce magasin n'a pas encore de prix observés » pour
 *       six situations différentes. Mesuré en base : 127 lignes sur 128 n'ont
 *       AUCUN code-barres — la cause réelle n'était presque jamais le magasin ;
 *   Phase 3  une estimation ne doit jamais se confondre avec un prix exact, ni
 *       sortir d'un échantillon trop maigre. Autour de Toulon, il existe NEUF
 *       relevés de catégorie à moins de 50 km, sur trois lieux atypiques.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU. Le transport est injecté, les réponses sont des
 * fixtures, et la date du jour est injectée partout — la fraîcheur se teste.
 *
 * Lancement : npm run test:prix-categorie-c5
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.OPENFOODFACTS_USER_AGENT ??= "CoachingPlatformTests/0.0 (tests@local)";

const {
  DUPLICATES_PAR_DEFAUT,
  MARGE_ZONE,
  OPEN_PRICES_OBSERVATIONS_SIZE,
  distanceKm,
  lireRelevesCategorie,
  urlReleves,
  urlObservations,
  verifierPorteeDesReleves,
} = await import("../../lib/open-prices/observations");
const { instantCalendaire, normaliserObservationCategorie, MAX_OBSERVATIONS_PAGES } =
  await import("../../lib/nutrition/prix-observes");
const {
  ECHANTILLON_MINIMAL,
  LIEUX_MINIMAL,
  estimerPrixCategorie,
  joursEcoules,
  mediane,
} = await import("../../lib/nutrition/estimation-prix");
const {
  CAUSES_ACTIVES,
  CAUSES_EN_ATTENTE_DE_CATEGORIE,
  CAUSES_TOTALES,
  causePrincipale,
  FRAICHEUR_AFFICHAGE_JOURS,
} = await import("../../lib/nutrition/causes-prix");

type ObservationCategorie = Awaited<
  ReturnType<typeof lireRelevesCategorie>
>["observations"][number];

const AUJOURD_HUI = "2026-11-08";
const MAGASIN = 4877;
const OSM_MAGASIN = { osmType: "NODE" as const, osmId: 9928912836 };
/** Les champs de portée d'un relevé situé DANS le magasin de test. */
const CHEZ_NOUS = {
  location_id: MAGASIN,
  location_osm_id: OSM_MAGASIN.osmId,
  location_osm_type: OSM_MAGASIN.osmType,
  location: { osm_address_city: "Toulon", osm_lat: 43.1201637, osm_lon: 5.9338549 },
};

function enveloppe(items: readonly unknown[], page = 1, pages = 1, total?: number) {
  return { items, page, pages, size: OPEN_PRICES_OBSERVATIONS_SIZE, total: total ?? items.length };
}
function reponse(corps: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corps } as unknown as Response;
}
/** Une ligne CATEGORY brute, de la forme exacte relevée sur l'API. */
function categorieBrute(p: Partial<Record<string, unknown>> = {}) {
  return {
    id: 183455,
    type: "CATEGORY",
    category_tag: "en:carrots",
    price: 2.9,
    price_per: "KILOGRAM",
    price_is_discounted: false,
    currency: "EUR",
    date: "2026-10-30",
    /*
     * ⚠️ LES TROIS CHAMPS DE PORTÉE, TELS QUE L'AMONT LES REND. Relevé sur un
     * item réel : `location_id`, `location_osm_id`, `location_osm_type` au
     * premier niveau, et un objet `location` de 28 champs dont `osm_lat` /
     * `osm_lon`. ⚠️ Les trois derniers valent `null` pour un lieu EN LIGNE.
     */
    location_id: 1734,
    location_osm_id: 12422248342,
    location_osm_type: "NODE",
    location: { osm_address_city: "Montreuil", osm_lat: 48.8585, osm_lon: 2.4432 },
    ...p,
  };
}
function obs(p: Partial<ObservationCategorie> = {}): ObservationCategorie {
  return {
    priceId: 1,
    categoryTag: "en:carrots",
    montantMilli: 2900,
    devise: "EUR",
    pricePer: "KILOGRAM",
    observeLe: "2026-10-30",
    opLocationId: 1734,
    ville: "Montreuil",
    ...p,
  } as ObservationCategorie;
}

/* ══════════════════════════════════════════════════════════════════════════
   1. L'URL — CE QU'ELLE PORTE, ET SURTOUT CE QU'ELLE NE PORTE JAMAIS
   ══════════════════════════════════════════════════════════════════════════ */

await test("CAT-01 — PRODUCT et CATEGORY sont tous deux constructibles", () => {
  const produit = new URL(
    urlReleves({ type: "PRODUCT", codes: ["3259011178919"], portee: { par: "magasin", opLocationId: MAGASIN }, page: 1 }),
  );
  assert.equal(produit.searchParams.get("type"), "PRODUCT");
  assert.equal(produit.searchParams.get("product_code__in"), "3259011178919");
  assert.equal(produit.searchParams.get("category_tag"), null);

  const categorie = new URL(
    urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "magasin", opLocationId: MAGASIN }, page: 1 }),
  );
  assert.equal(categorie.searchParams.get("type"), "CATEGORY");
  assert.equal(categorie.searchParams.get("category_tag"), "en:carrots");
  assert.equal(categorie.searchParams.get("product_code__in"), null);
});

await test("CAT-02 — les filtres toujours posés, dont l'exclusion des doublons", () => {
  const u = new URL(
    urlReleves({ type: "CATEGORY", categoryTag: "en:apples", portee: { par: "magasin", opLocationId: MAGASIN }, page: 2 }),
  );
  assert.equal(u.searchParams.get("currency"), "EUR");
  assert.equal(u.searchParams.get("price_is_discounted"), "false");
  /*
   * ⚠️ MESURÉ : `en:carrots` rend 288 relevés, 285 une fois les doublons
   * écartés — 1 %. Une médiane qui compte deux fois le même ticket de caisse
   * est faussée sans que rien ne le signale.
   *
   * ⚠️ ET SEULEMENT SUR `CATEGORY` : le chemin du prix exact garde son URL
   * d'origine, voir `CAT-04`.
   */
  assert.equal(u.searchParams.get("duplicate_of__isnull"), "true");
  // ⚠️ `order_by`, PAS `ordering` : sans lui, le tri rend les PLUS ANCIENS.
  assert.equal(u.searchParams.get("order_by"), "-date");
  assert.equal(u.searchParams.get("page"), "2");
});

await test("CAT-03 — les quatre portées, et `location_osm_id__in` JAMAIS", () => {
  const parMagasin = new URL(urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "magasin", opLocationId: 4877 }, page: 1 }));
  assert.equal(parMagasin.searchParams.get("location_id"), "4877");

  const parOsm = new URL(urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "identite_osm", osmType: "NODE", osmId: 9928912836 }, page: 1 }));
  assert.equal(parOsm.searchParams.get("location_osm_type"), "NODE");
  assert.equal(parOsm.searchParams.get("location_osm_id"), "9928912836");
  assert.equal(parOsm.searchParams.get("location_id"), null, "l'identité OSM se suffit : aucun pont");

  const groupe = new URL(urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "magasins", opLocationIds: [4877, 621] }, page: 1 }));
  assert.equal(groupe.searchParams.get("location_id__in"), "4877,621");

  const zone = new URL(urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "zone", lat: 43.1214, lon: 5.928, rayonKm: 20 }, page: 1 }));
  assert.equal(zone.searchParams.get("lat"), "43.1214");
  assert.equal(zone.searchParams.get("lon"), "5.928");
  assert.equal(zone.searchParams.get("radius_km"), "20");

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE PARAMÈTRE INTERDIT, ET IL L'EST POUR UNE RAISON MESURÉE
   * ════════════════════════════════════════════════════════════════════════
   *   location_osm_type=NODE                                → 172 764
   *   location_osm_id__in=9928912836,…&location_osm_type=…  → 172 764  ⚠️
   *   location_osm_id=9928912836&location_osm_type=NODE     →       1
   *
   * `location_osm_id__in` est SILENCIEUSEMENT IGNORÉ : l'employer rendrait
   * les prix de tous les lieux de ce type OSM en croyant filtrer un magasin.
   */
  for (const u of [parMagasin, parOsm, groupe, zone]) {
    assert.equal(u.searchParams.get("location_osm_id__in"), null, "paramètre interdit");
  }
  const source = readFileSync(new URL("../../lib/open-prices/observations.ts", import.meta.url), "utf8");
  const codeSeul = source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.ok(!codeSeul.includes("location_osm_id__in"), "le paramètre interdit n'est pas dans le code");
});

await test("CAT-04 — `urlObservations` rend EXACTEMENT l'URL d'avant ce lot", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE CHEMIN DU PRIX EXACT N'A RIEN DEMANDÉ
   * ════════════════════════════════════════════════════════════════════════
   * Ce lot avait posé `duplicate_of__isnull=true` sur TOUTES les requêtes,
   * donc aussi sur ce chemin — éprouvé, scellé, en production. Retirer des
   * lignes change l'ensemble où C4.4 cherche son MINIMUM : le résultat serait
   * peut-être meilleur, ce n'est pas la question. Il n'a pas été mesuré, et le
   * lot ne portait pas sur ce chemin.
   *
   * ⚠️ LA CHAÎNE EST COMPARÉE OCTET POUR OCTET, ordre des paramètres compris.
   * Un test qui ne comparerait que l'ensemble des clés laisserait passer un
   * réarrangement — anodin ici, mais c'est la comparaison faible qui avait
   * laissé passer le filtre en trop.
   */
  const ATTENDU =
    "https://prices.openfoodfacts.org/api/v1/prices" +
    "?product_code__in=3017620422003&location_id=4877&type=PRODUCT&currency=EUR" +
    "&price_is_discounted=false&order_by=-date&size=100&page=1";
  assert.equal(
    urlObservations({ codes: ["3017620422003"], opLocationId: MAGASIN, page: 1 }),
    ATTENDU,
    "l'URL historique, au caractère près",
  );

  // ⚠️ L'ABSENCE DU FILTRE EST EXIGÉE EXPLICITEMENT, pas déduite de l'égalité.
  const produit = new URL(urlObservations({ codes: ["3017620422003"], opLocationId: MAGASIN, page: 1 }));
  assert.equal(produit.searchParams.get("duplicate_of__isnull"), null, "PRODUCT : aucun filtre nouveau");

  // ⚠️ ET SA PRÉSENCE EST EXIGÉE SUR `CATEGORY`, où une médiane le réclame.
  const categorie = new URL(
    urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "magasin", opLocationId: MAGASIN }, page: 1 }),
  );
  assert.equal(categorie.searchParams.get("duplicate_of__isnull"), "true", "CATEGORY : doublons écartés");

  // La règle est écrite, et surchargeable par décision explicite.
  assert.equal(DUPLICATES_PAR_DEFAUT.PRODUCT, false);
  assert.equal(DUPLICATES_PAR_DEFAUT.CATEGORY, true);
  const forceSurProduit = new URL(
    urlReleves({
      type: "PRODUCT",
      codes: ["3017620422003"],
      portee: { par: "magasin", opLocationId: MAGASIN },
      page: 1,
      duplicatesExclus: true,
    }),
  );
  assert.equal(forceSurProduit.searchParams.get("duplicate_of__isnull"), "true", "activable sur décision");
});

await test("CAT-05 — une requête sans sa clé est refusée, pas devinée", () => {
  assert.throws(() => urlReleves({ type: "PRODUCT", codes: [], portee: { par: "magasin", opLocationId: 1 }, page: 1 }));
  assert.throws(() => urlReleves({ type: "CATEGORY", categoryTag: "  ", portee: { par: "magasin", opLocationId: 1 }, page: 1 }));
  assert.throws(() => urlReleves({ type: "CATEGORY", categoryTag: "en:carrots", portee: { par: "magasins", opLocationIds: [] }, page: 1 }));
});

/* ══════════════════════════════════════════════════════════════════════════
   2. LA NORMALISATION D'UNE LIGNE CATEGORY
   ══════════════════════════════════════════════════════════════════════════ */

await test("CAT-06 — une ligne CATEGORY bien formée devient une observation", () => {
  const r = normaliserObservationCategorie(categorieBrute());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.observation.categoryTag, "en:carrots");
  assert.equal(r.observation.montantMilli, 2900, "2,90 € → 2900 millièmes, entier");
  assert.equal(r.observation.pricePer, "KILOGRAM");
  assert.equal(r.observation.observeLe, "2026-10-30");
  assert.equal(r.observation.ville, "Montreuil");
});

await test("CAT-07 — un prix de catégorie SANS unité est refusé", () => {
  /*
   * ⚠️ « Les carottes : 2,90 » ne dit pas si c'est le kilo, la botte ou le
   * sachet. Pour un relevé PRODUIT, `price_per` absent est normal — le
   * conditionnement est connu par ailleurs. Ici, il n'y a pas de produit.
   */
  for (const pp of [null, undefined, "", "LITRE"]) {
    const r = normaliserObservationCategorie(categorieBrute({ price_per: pp }));
    assert.equal(r.ok, false, String(pp));
    if (!r.ok) assert.equal(r.refus, "price_per_absent");
  }
});

await test("CAT-08 — type, devise, remise, catégorie, date : chaque refus est nommé", () => {
  const cas = [
    [{ type: "PRODUCT" }, "type_non_categorie"],
    [{ currency: "CHF" }, "devise_non_eur"],
    [{ price_is_discounted: true }, "remise"],
    [{ price_is_discounted: undefined }, "remise"],
    [{ category_tag: "" }, "categorie_absente"],
    [{ date: "" }, "date_absente"],
    [{ price: "deux euros" }, "montant_illisible"],
    [{ id: "183455" }, "identifiant_absent"],
    [{ location_id: null }, "identifiant_absent"],
  ] as const;
  for (const [surcharge, attendu] of cas) {
    const r = normaliserObservationCategorie(categorieBrute(surcharge));
    assert.equal(r.ok, false, JSON.stringify(surcharge));
    if (!r.ok) assert.equal(r.refus, attendu, JSON.stringify(surcharge));
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   3. LA LECTURE — PAGINATION, ABSENCE, PANNE
   ══════════════════════════════════════════════════════════════════════════ */

await test("CAT-09 — lecture CATEGORY par identité OSM, sans aucun pont", async () => {
  const appels: string[] = [];
  const transport = async (url: string) => {
    appels.push(url);
    return reponse(enveloppe([categorieBrute(CHEZ_NOUS)]));
  };
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "identite_osm", ...OSM_MAGASIN },
    transport,
  });
  assert.equal(lecture.ok, true);
  assert.equal(lecture.observations.length, 1);
  const u = new URL(appels[0]!);
  assert.equal(u.searchParams.get("location_osm_id"), "9928912836");
  assert.equal(u.searchParams.get("location_id"), null);
});

await test("CAT-10 — recherche groupée : `location_id__in`, la seule qui marche", async () => {
  const appels: string[] = [];
  const transport = async (url: string) => {
    appels.push(url);
    return reponse(enveloppe([]));
  };
  await lireRelevesCategorie({
    categoryTag: "en:apples",
    portee: { par: "magasins", opLocationIds: [4877, 621] },
    transport,
  });
  assert.equal(new URL(appels[0]!).searchParams.get("location_id__in"), "4877,621");
});

await test("CAT-11 — HTTP 200 avec items vides = ABSENCE, jamais une panne", async () => {
  /*
   * ⚠️ MESURÉ : l'amont répond bien
   * `{"items": [], "page": 1, "pages": 1, "size": 50, "total": 0}`.
   * Le traduire en panne ferait croire à un service cassé là où il répond
   * parfaitement — et inviterait à réessayer sans fin.
   */
  const transport = async () => reponse(enveloppe([], 1, 1, 0));
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:honey",
    portee: { par: "zone", lat: 43.1214, lon: 5.928, rayonKm: 20 },
    transport,
  });
  assert.equal(lecture.ok, true, "absence n'est pas panne");
  assert.equal(lecture.observations.length, 0);
  assert.equal(lecture.tronque, false);
  assert.equal(lecture.raison, undefined);
});

await test("CAT-12 — la pagination s'arrête à `pages` : la page 404 n'est JAMAIS demandée", async () => {
  /*
   * ⚠️ MESURÉ : demander une page au-delà de la dernière rend
   * HTTP 404 `{"detail":"Invalid page."}`, que `!reponse.ok` traduirait en
   * panne — une panne annoncée pour une simple fin de liste.
   */
  const pagesVues: number[] = [];
  const transport = async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page"));
    pagesVues.push(page);
    if (page > 2) return reponse({ detail: "Invalid page." }, 404);
    return reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, id: 1000 + page })], page, 2, 2));
  };
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasin", opLocationId: MAGASIN },
    transport,
  });
  assert.deepEqual(pagesVues, [1, 2], "la page 3 n'a jamais été demandée");
  assert.equal(lecture.ok, true);
  assert.equal(lecture.observations.length, 2);
  assert.equal(lecture.tronque, false);
});

await test("CAT-13 — au-delà de la borne, la troncature se DIT", async () => {
  const transport = async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, id: 2000 + page })], page, 10, 10));
  };
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasin", opLocationId: MAGASIN },
    transport,
  });
  assert.equal(lecture.observations.length, MAX_OBSERVATIONS_PAGES);
  assert.equal(lecture.tronque, true);
  assert.equal(lecture.ok, true, "tronqué n'est pas en panne");
});

await test("CAT-14 — 429 et 500 deviennent des indisponibilités nommées", async () => {
  for (const [statut, attendu] of [[429, "rate_limited"], [500, "unavailable"]] as const) {
    const lecture = await lireRelevesCategorie({
      categoryTag: "en:carrots",
      portee: { par: "magasin", opLocationId: MAGASIN },
      transport: async () => reponse({ detail: "x" }, statut),
    });
    assert.equal(lecture.ok, false, String(statut));
    assert.equal(lecture.raison, attendu);
    assert.equal(lecture.observations.length, 0, "une panne ne rend JAMAIS de prix");
  }
});

await test("CAT-15 — une réponse hors catégorie fait jeter la page entière", async () => {
  // ⚠️ Si `category_tag` avait été ignoré — ce qui arrive à d'autres filtres —
  // l'amont rendrait des centaines de milliers de lignes étrangères.
  const transport = async () =>
    reponse(
      enveloppe([
        categorieBrute(CHEZ_NOUS),
        categorieBrute({ ...CHEZ_NOUS, id: 2, category_tag: "en:apples" }),
      ]),
    );
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasin", opLocationId: MAGASIN },
    transport,
  });
  assert.equal(lecture.ok, false);
  assert.equal(lecture.raison, "unavailable");
  assert.equal(lecture.observations.length, 0, "pas même la ligne crédible");
});

/* ══════════════════════════════════════════════════════════════════════════
   4. L'ESTIMATION — ET SON REFUS, QUI EST LA RÈGLE
   ══════════════════════════════════════════════════════════════════════════ */

await test("EST-01 — la médiane, sur un échantillon suffisant", () => {
  const e = estimerPrixCategorie({
    observations: [2500, 2800, 2900, 3100, 3400].map((m, i) =>
      obs({ priceId: i + 1, montantMilli: m, opLocationId: 1700 + i, ville: `V${i}` }),
    ),
    aujourdHui: AUJOURD_HUI,
    rayonKm: 20,
  });
  assert.equal(e.disponible, true);
  if (!e.disponible) return;
  assert.equal(e.medianeMilli, 2900, "la valeur centrale, pas la moyenne");
  assert.equal(e.pricePer, "KILOGRAM");
  assert.equal(e.devise, "EUR");
  assert.equal(e.relevesUtilises, 5);
  assert.equal(e.observeLePlusRecent, "2026-10-30");
  assert.equal(e.provenance.lieux, 5);
  assert.equal(e.provenance.rayonKm, 20);
  assert.deepEqual(e.provenance.villes, ["V0", "V1", "V2", "V3", "V4"]);
});

await test("EST-02 — effectif pair : moyenne des deux centraux, en entier", () => {
  assert.equal(mediane([1000, 2000]), 1500);
  assert.equal(mediane([1000, 2001]), 1501, "arrondi, jamais de flottant");
  assert.equal(mediane([3, 1, 2]), 2, "la liste est triée avant, pas pendant");
});

await test("EST-03 — LES NEUF RELEVÉS DE TOULON NE PRODUISENT AUCUNE ESTIMATION", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE TEST QUI DIT NON, ET C'EST LE PLUS IMPORTANT DU FICHIER
   * ════════════════════════════════════════════════════════════════════════
   * Relevé le 08/11/2026 : dans un rayon de 50 km autour de Toulon, il existe
   * NEUF prix de catégorie, répartis sur trois lieux — une Biocoop
   * marseillaise à 49 km, un producteur de L'Ayguade, une épicerie des Salins.
   * Par catégorie, cela fait un ou deux relevés.
   *
   * Les afficher comme « le prix autour de toi » serait un chiffre faux
   * habillé en chiffre juste. Le module doit REFUSER.
   */
  const toulon = [
    obs({ priceId: 1, categoryTag: "en:carrots", montantMilli: 2800, observeLe: "2026-09-18", opLocationId: 7314, ville: "Marseille" }),
    obs({ priceId: 2, categoryTag: "en:bananas", montantMilli: 1990, observeLe: "2026-09-18", opLocationId: 7314, ville: "Marseille" }),
  ];
  const e = estimerPrixCategorie({ observations: toulon, aujourdHui: AUJOURD_HUI, rayonKm: 50 });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "echantillon_insuffisant");
  assert.equal(e.relevesExamines, 2);
});

await test("EST-04 — aucun relevé du tout : une raison à part", () => {
  const e = estimerPrixCategorie({ observations: [], aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "aucun_releve");
  assert.equal(e.relevesExamines, 0);
});

await test("EST-05 — des relevés, mais tous trop anciens", () => {
  const vieux = Array.from({ length: 8 }, (_, i) =>
    obs({ priceId: i + 1, observeLe: "2024-01-15", opLocationId: 1700 + i }),
  );
  const e = estimerPrixCategorie({ observations: vieux, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "releves_trop_anciens", "ce n'est PAS « échantillon insuffisant »");
  assert.equal(e.relevesExamines, 8);
});

await test("EST-06 — des unités incompatibles ne se moyennent pas", () => {
  /*
   * ⚠️ « 2,90 €/kg » et « 1,20 €/pièce » répondent à deux questions. Les
   * additionner produirait un nombre qui n'existe pas. Et le refus est NOMMÉ
   * autrement que « pas assez » : attendre dix relevés de plus n'y ferait rien.
   */
  const melange = [
    ...Array.from({ length: 4 }, (_, i) => obs({ priceId: i + 1, pricePer: "KILOGRAM", opLocationId: 1700 + i })),
    ...Array.from({ length: 4 }, (_, i) => obs({ priceId: 100 + i, pricePer: "UNIT", montantMilli: 1200, opLocationId: 1800 + i })),
  ];
  const e = estimerPrixCategorie({ observations: melange, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "unites_incompatibles");
});

await test("EST-07 — l'unité majoritaire l'emporte, et elle seule entre dans la médiane", () => {
  const melange = [
    ...[2500, 2800, 2900, 3100, 3400].map((m, i) => obs({ priceId: i + 1, pricePer: "KILOGRAM", montantMilli: m, opLocationId: 1700 + i })),
    obs({ priceId: 99, pricePer: "UNIT", montantMilli: 90000, opLocationId: 1999 }),
  ];
  const e = estimerPrixCategorie({ observations: melange, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, true);
  if (!e.disponible) return;
  assert.equal(e.pricePer, "KILOGRAM");
  assert.equal(e.relevesUtilises, 5, "le relevé à la pièce n'est pas compté");
  assert.equal(e.medianeMilli, 2900, "et il ne déplace pas la médiane");
});

await test("EST-08 — les doublons sont écartés, même si l'amont en laisse passer", () => {
  const avecDoublons = [
    ...[2500, 2800, 2900, 3100, 3400].map((m, i) => obs({ priceId: i + 1, montantMilli: m, opLocationId: 1700 + i })),
    obs({ priceId: 1, montantMilli: 2500, opLocationId: 1700 }),
    obs({ priceId: 2, montantMilli: 2800, opLocationId: 1701 }),
  ];
  const e = estimerPrixCategorie({ observations: avecDoublons, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, true);
  if (!e.disponible) return;
  assert.equal(e.relevesUtilises, 5, "sept lignes, cinq relevés distincts");
  assert.equal(e.medianeMilli, 2900, "les doublons ne pondèrent rien");
});

await test("EST-09 — une date illisible ou future n'est pas une date fraîche", () => {
  /*
   * ⚠️ ET CE N'EST PAS NON PLUS UNE DATE ANCIENNE. Ce test exigeait
   * `releves_trop_anciens` ; il consacrait ainsi le défaut que `DATE-03`
   * corrige. Une chaîne qui n'est pas une date et un relevé daté de 2099 sont
   * tous deux FAUX, pas vieux.
   */
  const douteux = Array.from({ length: 6 }, (_, i) =>
    obs({ priceId: i + 1, observeLe: i < 3 ? "pas une date" : "2099-01-01", opLocationId: 1700 + i }),
  );
  const e = estimerPrixCategorie({ observations: douteux, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "dates_illisibles");
  assert.equal(e.datesIllisibles, 6, "les trois illisibles ET les trois futures");
});

await test("EST-10 — le seuil est franc, et il est documenté", () => {
  assert.equal(ECHANTILLON_MINIMAL, 5);
  const quatre = Array.from({ length: 4 }, (_, i) => obs({ priceId: i + 1, opLocationId: 1700 + i }));
  assert.equal(estimerPrixCategorie({ observations: quatre, aujourdHui: AUJOURD_HUI }).disponible, false);
  const cinq = [...quatre, obs({ priceId: 5, opLocationId: 1705 })];
  assert.equal(estimerPrixCategorie({ observations: cinq, aujourdHui: AUJOURD_HUI }).disponible, true);
});

await test("EST-11 — `joursEcoules` compte en UTC, sans dérive de fuseau", () => {
  assert.equal(joursEcoules("2026-11-07", "2026-11-08"), 1);
  assert.equal(joursEcoules("2026-01-09", "2026-11-08"), 303);
  assert.equal(joursEcoules("2026-11-08", "2026-11-08"), 0);
  assert.equal(joursEcoules("pas une date", "2026-11-08"), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   5. LES SIX CAUSES — ET LEUR ORDRE, QUI EST LA CORRECTION
   ══════════════════════════════════════════════════════════════════════════ */

type Budget = Parameters<typeof causePrincipale>[0]["budget"];

function budgetFactice(p: {
  readonly lignesTotal: number;
  readonly lignesResolues: number;
  readonly details?: readonly string[];
  readonly datesRetenues?: readonly string[];
}): Budget {
  const resolutions = (p.datesRetenues ?? []).map((d, i) => ({
    ligneId: `r${i}`,
    statut: "resolue" as const,
    coutRetenuMilli: 1000,
    scenarioRetenu: { observeLe: d } as never,
    alternatives: [],
  }));
  return {
    statut: "indetermine",
    totalConnuMilli: 0,
    lignesTotal: p.lignesTotal,
    lignesResolues: p.lignesResolues,
    lignesNonResolues: p.lignesTotal - p.lignesResolues,
    raisonsNonResolues: (p.details ?? []).map((d, i) => ({
      ligneId: `l${i}`,
      statut: "sans_prix" as const,
      details: [d],
    })),
    debordement: false,
    resolutions: resolutions as never,
  } as Budget;
}

await test("C5-01 — configuration manquante : ni l'élève ni le magasin n'y sont pour rien", () => {
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: budgetFactice({ lignesTotal: 10, lignesResolues: 0, details: ["aucun_releve"] }),
    raisonIndisponible: "non_configure",
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "configuration_manquante");
});

await test("C5-02 — panne de l'amont, distincte d'une absence", () => {
  for (const raison of ["rate_limited", "unavailable"] as const) {
    const c = causePrincipale({
      couvertureMagasin: "magasin_ponte",
      budget: budgetFactice({ lignesTotal: 10, lignesResolues: 0, details: ["aucun_releve"] }),
      raisonIndisponible: raison,
      aujourdHui: AUJOURD_HUI,
    });
    assert.equal(c, "api_indisponible", raison);
  }
});

await test("C5-03 — AUCUN PRODUIT RELIÉ PASSE AVANT LA CAUSE « MAGASIN »", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA CORRECTION PRINCIPALE DE C5
   * ════════════════════════════════════════════════════════════════════════
   * Mesuré en base le 08/11/2026 : 898 produits, AUCUN relié à un aliment du
   * catalogue ; 127 lignes de plan sur 128 sans le moindre code-barres.
   *
   * L'écran disait pourtant « ce magasin n'a pas encore de prix observés » —
   * et l'élève changeait de magasin pour rien. Le magasin n'avait rien refusé :
   * on ne lui avait rien demandé.
   */
  const c = causePrincipale({
    couvertureMagasin: "magasin_sans_couverture_prix",
    budget: budgetFactice({
      lignesTotal: 128,
      lignesResolues: 0,
      details: Array.from({ length: 127 }, () => "aucun_produit_relie"),
    }),
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "aucun_produit_correspondant");
  assert.notEqual(c, "aucun_prix_dans_le_magasin");
});

await test("C5-04 — quand le magasin EST en cause, il est nommé", () => {
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: budgetFactice({
      lignesTotal: 5,
      lignesResolues: 0,
      details: ["aucun_releve", "aucun_releve", "aucun_releve"],
    }),
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "aucun_prix_dans_le_magasin");
});

await test("C5-05 — rien dans la zone passe avant « rien dans ce magasin »", () => {
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: budgetFactice({ lignesTotal: 5, lignesResolues: 0, details: ["aucun_releve"] }),
    estimation: { disponible: false, raison: "aucun_releve", relevesExamines: 0, datesIllisibles: 0, lieuxExamines: 0 },
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "aucun_releve_dans_la_zone", "changer de magasin n'y changerait rien");
});

await test("C5-06 — des prix retenus mais tous périmés", () => {
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: budgetFactice({ lignesTotal: 2, lignesResolues: 2, datesRetenues: ["2023-01-01", "2023-06-01"] }),
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "donnees_trop_anciennes");
});

await test("C5-07 — un seul prix récent suffit à n'avoir RIEN à expliquer", () => {
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: budgetFactice({ lignesTotal: 2, lignesResolues: 2, datesRetenues: ["2023-01-01", "2026-10-30"] }),
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, null, "le budget dit lui-même sa couverture partielle");
});

await test("C5-08 — la fenêtre d'affichage est plus large que celle des estimations", () => {
  /*
   * ⚠️ CE N'EST PAS UNE INCOHÉRENCE. Un prix exact est montré AVEC sa date :
   * l'élève juge lui-même. Une médiane cache ses dates derrière un nombre
   * unique, elle doit donc être plus stricte.
   */
  assert.ok(FRAICHEUR_AFFICHAGE_JOURS > 365, "l'exact tolère plus que l'estimation");
});

await test("C5-09 — liste vide ou budget absent : aucune cause inventée", () => {
  assert.equal(causePrincipale({ couvertureMagasin: "aucun_magasin", budget: null, aujourdHui: AUJOURD_HUI }), null);
  assert.equal(
    causePrincipale({
      couvertureMagasin: "aucun_magasin",
      budget: budgetFactice({ lignesTotal: 0, lignesResolues: 0 }),
      aujourdHui: AUJOURD_HUI,
    }),
    null,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   6. LA SÉPARATION STRICTE ENTRE PRIX EXACT ET ESTIMATION
   ══════════════════════════════════════════════════════════════════════════ */

await test("SEP-01 — une estimation ne peut PAS entrer dans un budget observé", () => {
  /*
   * ⚠️ LA SÉPARATION EST TENUE PAR LES TYPES, PAS PAR LA DISCIPLINE.
   * `estimerPrixCategorie` ne rend ni `Scenario`, ni `ResolutionLigne`, ni
   * montant nu : son résultat porte toujours son échantillon, sa date et sa
   * provenance. On ne peut pas l'additionner par distraction.
   */
  const e = estimerPrixCategorie({
    observations: [2500, 2800, 2900, 3100, 3400].map((m, i) => obs({ priceId: i + 1, montantMilli: m, opLocationId: 1700 + i })),
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(e.disponible, true);
  if (!e.disponible) return;
  for (const champ of ["coutTotalMilli", "coutRetenuMilli", "totalConnuMilli", "gtin", "scenarioRetenu"]) {
    assert.ok(!(champ in e), `une estimation ne porte pas ${champ}`);
  }
  // Et elle porte TOUJOURS de quoi se présenter comme une estimation.
  for (const champ of ["relevesUtilises", "observeLePlusRecent", "provenance", "pricePer"]) {
    assert.ok(champ in e, `une estimation porte ${champ}`);
  }
});

await test("SEP-02 — les deux lectures ne partagent aucun type de retour", () => {
  const estimation = readFileSync(new URL("../../lib/nutrition/estimation-prix.ts", import.meta.url), "utf8");
  /*
   * ⚠️ LA LECTURE SE FAIT SUR LE CODE SEUL. Les commentaires du module citent
   * `ObservationPrix` — c'est même là qu'ils expliquent pourquoi il ne faut pas
   * l'utiliser. Un contrôle qui tomberait sur cette prose interdirait
   * d'expliquer la règle qu'il protège.
   */
  const codeSeul = estimation.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.ok(!codeSeul.includes("ObservationPrix"), "l'estimation ignore les prix exacts");
  assert.ok(codeSeul.includes("ObservationCategorie"));
  assert.ok(!codeSeul.includes("Date.now"), "aucune horloge dans une fonction pure");
  assert.ok(!codeSeul.includes("new Date()"), "aucune horloge dans une fonction pure");
});


/* ══════════════════════════════════════════════════════════════════════════
   7. LA DIVERSITÉ DES LIEUX — CINQ PRIX D'UN SEUL RAYON NE SONT PAS UNE MÉDIANE
   ══════════════════════════════════════════════════════════════════════════ */

await test("EST-12 — ZÉRO relevé : une absence, pas une insuffisance", () => {
  const e = estimerPrixCategorie({ observations: [], aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "aucun_releve");
  assert.equal(e.relevesExamines, 0);
  assert.equal(e.lieuxExamines, 0);
});

await test("EST-13 — CINQ relevés d'UN SEUL lieu sont REFUSÉS", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE DÉFAUT QUE CE TEST VERROUILLE
   * ════════════════════════════════════════════════════════════════════════
   * Le seuil d'échantillon seul laissait passer cinq prix d'un même rayon, et
   * les présentait comme une médiane régionale. C'est le prix de CE magasin —
   * utile à qui y fait ses courses, trompeur pour tous les autres.
   */
  const unSeulRayon = [2500, 2800, 2900, 3100, 3400].map((m, i) =>
    obs({ priceId: i + 1, montantMilli: m, opLocationId: 4877, ville: "Toulon" }),
  );
  const e = estimerPrixCategorie({ observations: unSeulRayon, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false, "cinq relevés, un seul magasin : refus");
  if (e.disponible) return;
  assert.equal(e.raison, "lieux_insuffisants");
  assert.equal(e.relevesExamines, 5, "les relevés sont bien là…");
  assert.equal(e.lieuxExamines, 1, "…mais ils viennent tous du même endroit");
  // ⚠️ ET CE N'EST PAS « PAS ASSEZ DE RELEVÉS » : attendre des prix du même
  // rayon n'y changerait rien. Le refus doit se distinguer.
  assert.notEqual(e.raison, "echantillon_insuffisant");
});

await test("EST-14 — CINQ relevés de lieux DISTINCTS sont acceptés", () => {
  const disperses = [2500, 2800, 2900, 3100, 3400].map((m, i) =>
    obs({ priceId: i + 1, montantMilli: m, opLocationId: 1700 + i, ville: `V${i}` }),
  );
  const e = estimerPrixCategorie({ observations: disperses, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, true);
  if (!e.disponible) return;
  assert.equal(e.medianeMilli, 2900);
  assert.equal(e.relevesUtilises, 5);
  assert.equal(e.lieuxContributeurs, 5, "les deux nombres sont rendus séparément");
  assert.equal(e.provenance.lieux, 5);
});

await test("EST-15 — le seuil de lieux est franc, et distinct de celui des relevés", () => {
  assert.equal(LIEUX_MINIMAL, 3);
  assert.notEqual(LIEUX_MINIMAL, ECHANTILLON_MINIMAL, "deux seuils, deux questions");
  // Six relevés sur deux lieux : assez de relevés, pas assez d'endroits.
  const deuxLieux = Array.from({ length: 6 }, (_, i) =>
    obs({ priceId: i + 1, opLocationId: i < 3 ? 100 : 200 }),
  );
  const refus = estimerPrixCategorie({ observations: deuxLieux, aujourdHui: AUJOURD_HUI });
  assert.equal(refus.disponible, false);
  if (!refus.disponible) assert.equal(refus.raison, "lieux_insuffisants");
  // Les mêmes six relevés sur trois lieux passent.
  const troisLieux = Array.from({ length: 6 }, (_, i) =>
    obs({ priceId: i + 1, opLocationId: 100 + (i % 3) }),
  );
  assert.equal(estimerPrixCategorie({ observations: troisLieux, aujourdHui: AUJOURD_HUI }).disponible, true);
});

await test("EST-16 — l'ordre des refus : d'abord le nombre, ensuite la concentration", () => {
  /*
   * ⚠️ ON NE REPROCHE PAS LA CONCENTRATION À UN ÉCHANTILLON QUI EST D'ABORD
   * TROP PETIT. Trois relevés d'un seul lieu manquent des deux ; le refus le
   * plus élémentaire est le bon.
   */
  const trois = Array.from({ length: 3 }, (_, i) => obs({ priceId: i + 1, opLocationId: 4877 }));
  const e = estimerPrixCategorie({ observations: trois, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (!e.disponible) assert.equal(e.raison, "echantillon_insuffisant");
});

await test("EST-17 — AUCUN relevé en euros parmi six en couronnes : refus nommé", () => {
  const enCouronnes = Array.from({ length: 6 }, (_, i) =>
    obs({ priceId: i + 1, opLocationId: 100 + i, devise: "KZT" as never }),
  );
  const e = estimerPrixCategorie({ observations: enCouronnes, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  /*
   * ⚠️ ET LE REFUS EST NOMMÉ, PAS DÉGUISÉ EN ABSENCE. La devise était filtrée
   * dans la déduplication : six relevés disparaissaient en silence et le
   * module annonçait « aucun relevé ». Il en avait écarté six.
   */
  assert.equal(e.raison, "devises_melangees");
  assert.equal(e.relevesExamines, 6, "ils ont bien été examinés");
});

/* ══════════════════════════════════════════════════════════════════════════
   8. L'ARBITRAGE DES CAUSES — CHAQUE REFUS A SA CAUSE, AUCUNE FUSION
   ══════════════════════════════════════════════════════════════════════════ */

const BUDGET_VIDE = budgetFactice({ lignesTotal: 5, lignesResolues: 0, details: ["aucun_releve"] });

await test("C5-10 — SEPT refus d'estimation donnent CINQ causes finales", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA CORRECTION DE L'ARBITRAGE
   * ════════════════════════════════════════════════════════════════════════
   * Les quatre refus retombaient TOUS sur « aucun relevé dans ta région » —
   * une phrase fausse dans trois cas sur quatre. Il existe des relevés quand
   * ils sont trop peu nombreux, trop concentrés ou incomparables.
   */
  const attendu = [
    ["aucun_releve", "aucun_releve_dans_la_zone"],
    ["echantillon_insuffisant", "releves_trop_peu_nombreux"],
    ["lieux_insuffisants", "releves_de_lieux_trop_concentres"],
    ["unites_incompatibles", "releves_incompatibles"],
    ["devises_melangees", "releves_incompatibles"],
    ["dates_illisibles", "releves_incompatibles"],
    ["releves_trop_anciens", "donnees_trop_anciennes"],
  ] as const;
  const vues = new Set<string>();
  for (const [raison, cause] of attendu) {
    const c = causePrincipale({
      couvertureMagasin: "magasin_ponte",
      budget: BUDGET_VIDE,
      estimation: { disponible: false, raison, relevesExamines: 4, datesIllisibles: 0, lieuxExamines: 1 },
      aujourdHui: AUJOURD_HUI,
    });
    assert.equal(c, cause, raison);
    vues.add(c!);
  }
  assert.equal(
    vues.size,
    5,
    "sept refus → cinq causes : unités, devises et dates illisibles partagent « inexploitables »",
  );
  // ⚠️ ET AUCUN DE CES CINQ N'EST « aucun relevé » SAUF LE PREMIER.
  assert.equal([...vues].filter((v) => v === "aucun_releve_dans_la_zone").length, 1);
});

await test("C5-11 — `couvertureMagasin` est RÉELLEMENT lu avant de conclure", () => {
  /*
   * ⚠️ IL ÉTAIT REÇU ET IGNORÉ. La fonction pouvait conclure « ce magasin n'a
   * pas de prix » pour un magasin qu'Open Prices ne connaît même pas — mesuré :
   * 7 des 8 magasins de la base rendent 404 sur `/locations/osm/…`.
   */
  const inconnu = causePrincipale({
    couvertureMagasin: "magasin_sans_couverture_prix",
    budget: BUDGET_VIDE,
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(inconnu, "magasin_sans_correspondance");

  const connu = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: BUDGET_VIDE,
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(connu, "aucun_prix_dans_le_magasin");
  assert.notEqual(inconnu, connu, "deux situations, deux causes");

  const aucun = causePrincipale({
    couvertureMagasin: "aucun_magasin",
    budget: BUDGET_VIDE,
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(aucun, "aucun_magasin_choisi");
});

await test("C5-12 — sans catégorie associée, aucune estimation n'est même tentée", () => {
  /*
   * ⚠️ LE CATALOGUE EST BÂTI SUR CIQUAL, QUI NE PORTE AUCUN TAG OPEN FOOD
   * FACTS. Tant que cette correspondance n'existe pas — et elle n'est PAS
   * inventée ici —, aucune requête CATEGORY ne peut être émise, et la cause le
   * dit au lieu d'accuser le magasin.
   */
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: BUDGET_VIDE,
    categorieAssociee: false,
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "aucune_categorie_associee");
  assert.notEqual(c, "aucun_prix_dans_le_magasin");
});

await test("C5-13 — PRIORITÉS : chaque combinaison rend la cause la plus bloquante", () => {
  /*
   * ⚠️ UNE CAUSE QUI BLOQUE TOUT PASSE AVANT UNE CAUSE QUI NE BLOQUE QU'UNE
   * PARTIE. Chaque ligne ci-dessous cumule plusieurs problèmes ; la cause
   * attendue est celle sur laquelle il est possible d'agir en premier.
   */
  const cas = [
    {
      quoi: "configuration + panne + magasin inconnu + estimation vide",
      args: {
        couvertureMagasin: "magasin_sans_couverture_prix" as const,
        budget: BUDGET_VIDE,
        raisonIndisponible: "non_configure" as const,
        estimation: { disponible: false as const, raison: "aucun_releve" as const, relevesExamines: 0, datesIllisibles: 0, lieuxExamines: 0 },
        categorieAssociee: false,
      },
      attendu: "configuration_manquante",
    },
    {
      quoi: "panne + magasin inconnu + sans catégorie",
      args: {
        couvertureMagasin: "magasin_sans_couverture_prix" as const,
        budget: BUDGET_VIDE,
        raisonIndisponible: "unavailable" as const,
        categorieAssociee: false,
      },
      attendu: "api_indisponible",
    },
    {
      quoi: "aucun produit relié + magasin inconnu + sans catégorie",
      args: {
        couvertureMagasin: "magasin_sans_couverture_prix" as const,
        budget: budgetFactice({ lignesTotal: 10, lignesResolues: 0, details: Array.from({ length: 10 }, () => "aucun_produit_relie") }),
        categorieAssociee: false,
      },
      attendu: "aucun_produit_correspondant",
    },
    {
      quoi: "budget PARTIEL avec des prix récents : plus rien à expliquer",
      args: {
        couvertureMagasin: "magasin_ponte" as const,
        budget: budgetFactice({ lignesTotal: 10, lignesResolues: 4, details: ["aucun_releve"], datesRetenues: ["2026-10-30"] }),
        estimation: { disponible: false as const, raison: "aucun_releve" as const, relevesExamines: 0, datesIllisibles: 0, lieuxExamines: 0 },
      },
      attendu: null,
    },
    {
      quoi: "budget partiel MAIS tous les prix retenus périmés",
      args: {
        couvertureMagasin: "magasin_ponte" as const,
        budget: budgetFactice({ lignesTotal: 10, lignesResolues: 2, details: ["aucun_releve"], datesRetenues: ["2022-01-01", "2022-06-01"] }),
      },
      attendu: "donnees_trop_anciennes",
    },
    {
      quoi: "magasin inconnu + estimation trop concentrée",
      args: {
        couvertureMagasin: "magasin_sans_couverture_prix" as const,
        budget: BUDGET_VIDE,
        estimation: { disponible: false as const, raison: "lieux_insuffisants" as const, relevesExamines: 5, datesIllisibles: 0, lieuxExamines: 1 },
      },
      attendu: "releves_de_lieux_trop_concentres",
    },
    {
      quoi: "magasin inconnu, aucune estimation tentée",
      args: { couvertureMagasin: "magasin_sans_couverture_prix" as const, budget: BUDGET_VIDE },
      attendu: "magasin_sans_correspondance",
    },
  ];
  for (const { quoi, args, attendu } of cas) {
    assert.equal(causePrincipale({ ...args, aujourdHui: AUJOURD_HUI }), attendu, quoi);
  }
});

await test("C5-14 — une estimation DISPONIBLE n'empêche pas de dire l'absence de prix exact", () => {
  /*
   * ⚠️ LA SÉPARATION, VUE DEPUIS L'ARBITRAGE. Une médiane régionale réussie ne
   * remplit PAS le budget exact : la cause reste « ce magasin n'a pas de
   * prix », et l'estimation s'affiche à côté, étiquetée comme telle.
   */
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: BUDGET_VIDE,
    estimation: {
      disponible: true,
      medianeMilli: 2900,
      pricePer: "KILOGRAM",
      devise: "EUR",
      relevesUtilises: 5,
      datesIllisibles: 0,
      lieuxContributeurs: 5,
      observeLePlusRecent: "2026-10-30",
      observeLePlusAncien: "2026-01-02",
      provenance: { lieux: 5, villes: [], rayonKm: 20 },
    },
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "aucun_prix_dans_le_magasin", "l'estimation ne comble pas le prix exact");
});

/* ══════════════════════════════════════════════════════════════════════════
   9. LA ROUTE N'ÉMET AUCUNE REQUÊTE CATEGORY — ET C'EST VOULU
   ══════════════════════════════════════════════════════════════════════════ */

await test("ROUTE-01 — aucune requête CATEGORY n'est émise sans correspondance validée", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ CE QUI EST OPÉRATIONNEL, ET CE QUI EST PRÉPARATOIRE
   * ════════════════════════════════════════════════════════════════════════
   * Le client sait lire les relevés par catégorie ; le module sait en tirer une
   * médiane. MAIS la route n'en émet AUCUNE, et ce n'est pas un oubli : il
   * faudrait un `category_tag` par aliment, et `food_catalog` est bâti sur
   * CIQUAL, qui n'en porte aucun.
   *
   * Fabriquer cette correspondance ici — « carotte » → `en:carrots` — serait
   * inventer une donnée. Tant qu'elle n'est pas établie et validée ailleurs,
   * la chaîne reste débranchée, et ce test l'exige.
   */
  const route = readFileSync(
    new URL("../../app/api/student/shopping-list/observed-prices/route.ts", import.meta.url),
    "utf8",
  );
  const codeSeul = route.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const interdit of ["lireRelevesCategorie", "estimerPrixCategorie", "category_tag", "categoryTag"]) {
    assert.ok(!codeSeul.includes(interdit), `la route ne doit pas appeler ${interdit}`);
  }
  // ⚠️ ET AUCUNE CORRESPONDANCE CIQUAL → CATÉGORIE N'EXISTE NULLE PART.
  const catalogue = readFileSync(new URL("../../lib/nutrition/estimation-prix.ts", import.meta.url), "utf8");
  for (const invente of ["en:carrots", "en:apples", "en:eggs"]) {
    assert.ok(!catalogue.includes(invente), `aucun tag en dur : ${invente}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   10. LA GARDE DE PORTÉE — UN FILTRE IGNORÉ NE SE VOIT PAS

   ⚠️ LES CHAMPS VÉRIFIÉS SONT CEUX QUE L'AMONT REND RÉELLEMENT, relevés sur un
   item le 08/11/2026 : `location_id` (toujours présent), `location_osm_id` et
   `location_osm_type` (⚠️ `null` pour un lieu EN LIGNE — 144 recensés), et un
   objet `location` de 28 champs dont `osm_lat` / `osm_lon` (⚠️ `null` aussi).
   ══════════════════════════════════════════════════════════════════════════ */

await test("PORT-01 — portée `magasin` : un relevé d'un AUTRE magasin fait tout jeter", async () => {
  const transport = async () =>
    reponse(enveloppe([categorieBrute(CHEZ_NOUS), categorieBrute({ ...CHEZ_NOUS, id: 2, location_id: 621 })]));
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasin", opLocationId: MAGASIN },
    transport,
  });
  assert.equal(lecture.ok, false, "un seul intrus condamne la page");
  assert.equal(lecture.raison, "unavailable");
  assert.equal(lecture.observations.length, 0, "pas même la ligne légitime");
});

await test("PORT-02 — portée `magasins` : hors de la liste demandée, tout est jeté", async () => {
  const dansLaListe = async () =>
    reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, location_id: 621 }), categorieBrute({ ...CHEZ_NOUS, id: 2 })]));
  const bonne = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasins", opLocationIds: [MAGASIN, 621] },
    transport: dansLaListe,
  });
  assert.equal(bonne.ok, true, "les deux appartiennent bien à la liste");
  assert.equal(bonne.observations.length, 2);

  const horsListe = async () =>
    reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, id: 3, location_id: 9999 })]));
  const mauvaise = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasins", opLocationIds: [MAGASIN, 621] },
    transport: horsListe,
  });
  assert.equal(mauvaise.ok, false);
  assert.equal(mauvaise.observations.length, 0);
});

await test("PORT-03 — portée `identite_osm` : une AUTRE identité OSM est rejetée", async () => {
  // Même `location_id`, autre identité OSM : l'incohérence doit se voir.
  const autreOsm = async () =>
    reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, location_osm_id: 7743505189 })]));
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "identite_osm", ...OSM_MAGASIN },
    transport: autreOsm,
  });
  assert.equal(lecture.ok, false);
  assert.equal(lecture.observations.length, 0);

  // ⚠️ ET LE TYPE COMPTE AUTANT QUE LE NUMÉRO : `NODE/42` et `WAY/42` sont
  // deux lieux différents.
  const autreType = async () =>
    reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, location_osm_type: "WAY" })]));
  const parType = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "identite_osm", ...OSM_MAGASIN },
    transport: autreType,
  });
  assert.equal(parType.ok, false, "même numéro, autre type OSM : rejeté");
});

await test("PORT-04 — un lieu EN LIGNE n'a pas d'identité OSM : INDÉMONTRABLE, donc rejeté", async () => {
  /*
   * ⚠️ CE N'EST PAS UN CAS THÉORIQUE. Open Prices recense 144 lieux
   * `type: "ONLINE"`, et leurs prix portent bien `location_osm_id: null`,
   * `location_osm_type: null`, `location.osm_lat: null`.
   *
   * Ne pas pouvoir vérifier n'est pas une raison de faire confiance.
   */
  const enLigne = {
    location_id: 1268,
    location_osm_id: null,
    location_osm_type: null,
    location: { type: "ONLINE", osm_lat: null, osm_lon: null, website_url: "https://lafourche.fr" },
  };
  const parOsm = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "identite_osm", ...OSM_MAGASIN },
    transport: async () => reponse(enveloppe([categorieBrute(enLigne)])),
  });
  assert.equal(parOsm.ok, false, "identité absente : on ne peut rien prouver");

  const parZone = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", lat: 43.1214, lon: 5.928, rayonKm: 20 },
    transport: async () => reponse(enveloppe([categorieBrute(enLigne)])),
  });
  assert.equal(parZone.ok, false, "coordonnées absentes : on ne peut rien prouver");

  // ⚠️ MAIS PAR `location_id`, IL EST PARFAITEMENT VÉRIFIABLE. La portée
  // décide de ce qu'il faut prouver, pas la nature du lieu.
  const parMagasin = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasin", opLocationId: 1268 },
    transport: async () => reponse(enveloppe([categorieBrute(enLigne)])),
  });
  assert.equal(parMagasin.ok, true, "le `location_id`, lui, est toujours rendu");
});

await test("PORT-05 — portée `zone` : au-delà du rayon, tout est jeté", async () => {
  const TOULON = { lat: 43.1214, lon: 5.928 };
  // Marseille est à ~49 km de Toulon : hors d'un rayon de 20 km.
  const marseille = { ...CHEZ_NOUS, location: { osm_address_city: "Marseille", osm_lat: 43.2965, osm_lon: 5.3698 } };
  const loin = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", ...TOULON, rayonKm: 20 },
    transport: async () => reponse(enveloppe([categorieBrute(marseille)])),
  });
  assert.equal(loin.ok, false, "49 km pour un rayon de 20 : rejeté");

  // Le même relevé, avec un rayon qui le contient : accepté.
  const large = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", ...TOULON, rayonKm: 60 },
    transport: async () => reponse(enveloppe([categorieBrute(marseille)])),
  });
  assert.equal(large.ok, true);
  assert.equal(large.observations.length, 1);
});

await test("PORT-06 — la distance et sa marge sont mesurées, pas devinées", () => {
  /*
   * ⚠️ MESURÉ SUR L'AMONT : une requête à 20 km autour de Toulon rend 93
   * relevés s'échelonnant de 0,49 à 19,53 km en haversine. Aucun ne dépasse le
   * rayon demandé : l'amont et nous sommes d'accord. La marge n'absorbe qu'une
   * différence de projection — elle ne doit pas excuser un filtre qui saute.
   */
  const toulon = { lat: 43.1214, lon: 5.928 };
  const marseille = { lat: 43.2965, lon: 5.3698 };
  const d = distanceKm(toulon, marseille);
  assert.ok(d > 44 && d < 50, `Toulon–Marseille ≈ 46 km, obtenu ${d.toFixed(1)}`);
  assert.equal(distanceKm(toulon, toulon), 0);
  assert.ok(MARGE_ZONE > 1 && MARGE_ZONE <= 1.1, "une marge étroite, pas une échappatoire");
});

await test("PORT-07 — la garde est une fonction pure, vérifiable cas par cas", () => {
  const dedans = [categorieBrute(CHEZ_NOUS)];
  assert.equal(verifierPorteeDesReleves({ portee: { par: "magasin", opLocationId: MAGASIN }, items: dedans }), null);
  assert.equal(
    verifierPorteeDesReleves({ portee: { par: "magasin", opLocationId: 621 }, items: dedans }),
    "magasin_hors_portee",
  );
  assert.equal(
    verifierPorteeDesReleves({ portee: { par: "identite_osm", osmType: "WAY", osmId: 1 }, items: dedans }),
    "identite_osm_hors_portee",
  );
  assert.equal(
    verifierPorteeDesReleves({
      portee: { par: "zone", lat: 0, lon: 0, rayonKm: 1 },
      items: dedans,
    }),
    "zone_hors_portee",
  );
  assert.equal(
    verifierPorteeDesReleves({ portee: { par: "magasin", opLocationId: MAGASIN }, items: [null] }),
    "portee_indemontrable",
  );
  // Une page vide ne viole aucune portée.
  assert.equal(verifierPorteeDesReleves({ portee: { par: "magasin", opLocationId: MAGASIN }, items: [] }), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   11. LA DEVISE — COMPORTEMENT EXPLICITE SUR UN LOT MIXTE
   ══════════════════════════════════════════════════════════════════════════ */

await test("EST-18 — lot MIXTE euros + couronnes : les euros sont gardés, jamais mélangés", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE COMPORTEMENT EST UN CHOIX, ET IL EST ÉCRIT
   * ════════════════════════════════════════════════════════════════════════
   * Deux réponses étaient défendables : rejeter le lot, ou ne garder que les
   * euros. Retenue : **conservation exclusive des euros**, cohérente avec le
   * `currency=EUR` de la requête — jeter des relevés justes parce que d'autres
   * sont mal libellés perdrait une information vraie.
   *
   * ⚠️ CE QUI N'EST JAMAIS FAIT : mélanger. Les couronnes ne sont ni
   * converties, ni pondérées, ni comptées dans `relevesUtilises`.
   */
  const mixte = [
    ...[2500, 2800, 2900, 3100, 3400].map((m, i) =>
      obs({ priceId: i + 1, montantMilli: m, opLocationId: 1700 + i }),
    ),
    ...[139500, 106900].map((m, i) =>
      obs({ priceId: 90 + i, montantMilli: m, opLocationId: 2189, devise: "KZT" as never }),
    ),
  ];
  const e = estimerPrixCategorie({ observations: mixte, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, true, "cinq euros de cinq lieux suffisent");
  if (!e.disponible) return;
  assert.equal(e.devise, "EUR");
  assert.equal(e.relevesUtilises, 5, "les deux couronnes ne sont pas comptées");
  assert.equal(e.lieuxContributeurs, 5, "ni leur lieu");
  assert.equal(e.medianeMilli, 2900, "et elles ne déplacent pas la médiane");
  // ⚠️ LA PREUVE PAR L'ABSURDE : si elles avaient été comptées, la médiane
  // aurait grimpé à 3 100.
  assert.notEqual(e.medianeMilli, 3100);
});

await test("EST-19 — lot mixte dont les euros sont TROP PEU : le refus porte sur le nombre", () => {
  // ⚠️ ET PAS SUR LA DEVISE : trois euros restent trois euros. Le diagnostic
  // doit désigner ce qui manque vraiment.
  const mixte = [
    ...[2500, 2800, 2900].map((m, i) => obs({ priceId: i + 1, montantMilli: m, opLocationId: 1700 + i })),
    ...Array.from({ length: 5 }, (_, i) => obs({ priceId: 90 + i, opLocationId: 2189, devise: "KZT" as never })),
  ];
  const e = estimerPrixCategorie({ observations: mixte, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "echantillon_insuffisant");
  assert.equal(e.relevesExamines, 3, "seuls les euros sont examinés");
});

/* ══════════════════════════════════════════════════════════════════════════
   12. CE QUI EST ACTIF, ET CE QUI ATTEND LE RACCORDEMENT
   ══════════════════════════════════════════════════════════════════════════ */

await test("ACTIF-01 — sept causes sur douze sont atteignables aujourd'hui", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ NE PAS ANNONCER OPÉRATIONNEL CE QUI NE L'EST PAS
   * ════════════════════════════════════════════════════════════════════════
   * L'écran ne transmet ni `estimation` ni `categorieAssociee`, parce que la
   * lecture par catégorie n'est pas raccordée. Cinq causes sont donc écrites,
   * testées, et INATTEIGNABLES.
   */
  const toutes = [...CAUSES_ACTIVES, ...CAUSES_EN_ATTENTE_DE_CATEGORIE];
  assert.equal(CAUSES_ACTIVES.length, 7);
  assert.equal(CAUSES_EN_ATTENTE_DE_CATEGORIE.length, 5);
  assert.equal(new Set(toutes).size, 12, "douze causes, aucune en double");
  assert.equal(CAUSES_TOTALES, 12, "et la partition couvre tout — le compilateur l'exige");

  // ⚠️ ET L'ÉCRAN NE TRANSMET RIEN QUI PUISSE ATTEINDRE LES QUATRE AUTRES.
  const ecran = readFileSync(
    new URL("../../components/student/ListeDeCoursesPersistante.tsx", import.meta.url),
    "utf8",
  );
  const codeSeul = ecran.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const appel = codeSeul.slice(codeSeul.indexOf("causePrincipale({"));
  for (const argument of ["estimation:", "categorieAssociee:"]) {
    assert.ok(!appel.includes(argument), `l'écran ne transmet pas ${argument}`);
  }
});

await test("ACTIF-02 — chacune des sept causes actives est réellement productible", () => {
  // ⚠️ L'INVERSE DU TEST PRÉCÉDENT : ce qui est annoncé actif doit sortir.
  const avecArguments: Record<string, Parameters<typeof causePrincipale>[0]> = {
    configuration_manquante: { couvertureMagasin: "magasin_ponte", budget: BUDGET_VIDE, raisonIndisponible: "non_configure", aujourdHui: AUJOURD_HUI },
    api_indisponible: { couvertureMagasin: "magasin_ponte", budget: BUDGET_VIDE, raisonIndisponible: "unavailable", aujourdHui: AUJOURD_HUI },
    aucun_produit_correspondant: {
      couvertureMagasin: "magasin_ponte",
      budget: budgetFactice({ lignesTotal: 3, lignesResolues: 0, details: ["aucun_produit_relie"] }),
      aujourdHui: AUJOURD_HUI,
    },
    donnees_trop_anciennes: {
      couvertureMagasin: "magasin_ponte",
      budget: budgetFactice({ lignesTotal: 1, lignesResolues: 1, datesRetenues: ["2022-01-01"] }),
      aujourdHui: AUJOURD_HUI,
    },
    aucun_magasin_choisi: { couvertureMagasin: "aucun_magasin", budget: BUDGET_VIDE, aujourdHui: AUJOURD_HUI },
    magasin_sans_correspondance: { couvertureMagasin: "magasin_sans_couverture_prix", budget: BUDGET_VIDE, aujourdHui: AUJOURD_HUI },
    aucun_prix_dans_le_magasin: { couvertureMagasin: "magasin_ponte", budget: BUDGET_VIDE, aujourdHui: AUJOURD_HUI },
  };
  for (const cause of CAUSES_ACTIVES) {
    const args = avecArguments[cause];
    assert.ok(args !== undefined, `aucun cas pour ${cause}`);
    assert.equal(causePrincipale(args!), cause, cause);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   13. LES COMPOSANTS RÉELS — CINQ PROPRIÉTÉS, LUES DANS LE CODE
   ══════════════════════════════════════════════════════════════════════════ */

const BLOC = readFileSync(
  new URL("../../components/student/BlocMinimumObserve.tsx", import.meta.url),
  "utf8",
);
const HOOK = readFileSync(new URL("../../hooks/useBudgetObserve.ts", import.meta.url), "utf8");
const sansProse = (code: string) =>
  code.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");

await test("UI-01 — les douze causes ont chacune un libellé, et l'oubli ne compile pas", () => {
  const code = sansProse(BLOC);
  for (const cause of [...CAUSES_ACTIVES, ...CAUSES_EN_ATTENTE_DE_CATEGORIE]) {
    assert.ok(code.includes(`case "${cause}"`), `aucun libellé pour ${cause}`);
  }
  /*
   * ⚠️ `React.ReactNode` ACCEPTE `undefined` : un `switch` incomplet
   * compilerait en silence et rendrait un cadre vide. Le `never` est le seul
   * garde-fou réel.
   */
  assert.match(code, /const jamais: never = cause;/, "l'exhaustivité est imposée au compilateur");
});

await test("UI-02 — une indisponibilité technique ne devient JAMAIS un faux « aucun prix »", () => {
  /*
   * ⚠️ DEUX CHEMINS MÈNENT À UNE PANNE, ET AUCUN NE PASSE PAR LE MAGASIN :
   *   · `ok === false` — la requête elle-même a échoué ;
   *   · `raisonIndisponible` — la lecture amont a échoué, nommément.
   * Les deux sont jugés AVANT toute phrase sur le magasin.
   */
  const code = sansProse(BLOC);
  const iPanne = code.indexOf("if (!ok)");
  const iCause = code.indexOf("if (cause !== null");
  const iMagasin = code.indexOf('couvertureMagasin === "magasin_sans_couverture_prix"');
  assert.ok(iPanne > 0 && iCause > iPanne, "la panne est jugée avant la cause");
  assert.ok(iCause < iMagasin, "la cause est jugée avant le magasin");

  // Et côté arbitrage, panne et configuration passent avant tout le reste.
  for (const raison of ["unavailable", "rate_limited", "non_configure"] as const) {
    const c = causePrincipale({
      couvertureMagasin: "magasin_sans_couverture_prix",
      budget: budgetFactice({ lignesTotal: 9, lignesResolues: 0, details: ["aucun_releve"] }),
      raisonIndisponible: raison,
      aujourdHui: AUJOURD_HUI,
    });
    assert.notEqual(c, "aucun_prix_dans_le_magasin", raison);
    assert.notEqual(c, "magasin_sans_correspondance", raison);
  }
});

await test("UI-03 — `raisonIndisponible` est extraite, validée, et remise à zéro partout", () => {
  const code = sansProse(HOOK);
  // Extraite : trois valeurs nommées, et rien d'autre n'est accepté.
  for (const raison of ["rate_limited", "unavailable", "non_configure"]) {
    assert.ok(code.includes(`"${raison}"`), `la raison ${raison} doit être reconnue`);
  }
  assert.match(code, /:\s*null,?\s*\)/, "toute autre valeur retombe sur `null`");
  /*
   * ⚠️ REMISE À ZÉRO SUR LES QUATRE SORTIES, sinon une raison survivrait à la
   * requête suivante : l'élève lirait « installation incomplète » sur une
   * lecture qui s'est parfaitement déroulée.
   */
  assert.equal(
    (code.match(/setRaison\(/g) ?? []).length,
    4,
    "liste absente, échec HTTP, exception, et la lecture réussie",
  );
  // La réussite la REMPLACE (elle n'appelle pas `setRaison(null)` en dur) ;
  // les trois autres sorties la remettent explicitement à `null`.
  assert.equal((code.match(/setRaison\(null\)/g) ?? []).length, 3);
});

await test("UI-04 — un budget PARTIEL reste visible, avec son montant", () => {
  /*
   * ⚠️ LA COUVERTURE PARTIELLE N'EST PAS UNE ABSENCE. `causePrincipale` rend
   * `null` dès qu'un prix récent a été retenu : l'écran affiche alors le
   * montant connu, sous un libellé qui dit qu'il est partiel.
   */
  const partiel = budgetFactice({
    lignesTotal: 10,
    lignesResolues: 4,
    details: ["aucun_releve"],
    datesRetenues: ["2026-10-30"],
  });
  assert.equal(
    causePrincipale({ couvertureMagasin: "magasin_ponte", budget: partiel, aujourdHui: AUJOURD_HUI }),
    null,
    "aucune cause d'absence ne masque un budget partiel",
  );
  const code = sansProse(BLOC);
  assert.match(code, /"Minimum observé" : "Minimum observé connu"/, "deux libellés, selon le statut");
  assert.match(code, /formaterMontantMilli\(budget\.totalConnuMilli\)/);
  // ⚠️ ET L'ÉCART N'EST MONTRÉ QUE SI LA COUVERTURE EST COMPLÈTE.
  assert.match(code, /comparaison\?\.disponible === true/);
});

await test("UI-05 — aucune estimation ne peut s'ajouter au budget exact", () => {
  /*
   * ⚠️ LA SÉPARATION EST STRUCTURELLE, PAS DISCIPLINAIRE. Le bloc n'importe ni
   * le type `Estimation`, ni le module qui le produit : il ne peut donc pas
   * additionner ce qu'il ne connaît pas.
   */
  const code = sansProse(BLOC);
  for (const mot of ["estimation-prix", "Estimation", "medianeMilli", "relevesUtilises"]) {
    assert.ok(!code.includes(mot), `le bloc observé ne connaît pas ${mot}`);
  }
  // Et le total exact ne somme QUE des lignes résolues — doctrine de C4.6.
  const pur = sansProse(
    readFileSync(new URL("../../lib/nutrition/budget-observe.ts", import.meta.url), "utf8"),
  );
  assert.ok(!pur.includes("estimation-prix"), "le budget exact ignore le module d'estimation");
  assert.ok(!pur.includes("ObservationCategorie"), "et le type des relevés par catégorie");
});

/* ══════════════════════════════════════════════════════════════════════════
   14. LA FRONTIÈRE DU RAYON, AU MÈTRE PRÈS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un point situé EXACTEMENT à `km` au nord du centre.
 *
 * ⚠️ PLEIN NORD, ET C'EST CE QUI REND LE TEST EXACT. Le long d'un méridien, la
 * haversine se réduit à `R × Δlatitude` : la distance construite est donc celle
 * que la fonction mesurera, sans erreur d'arrondi à débattre.
 */
function versLeNord(centre: { lat: number; lon: number }, km: number) {
  const R = 6371.0088;
  return { lat: centre.lat + (km / R) * (180 / Math.PI), lon: centre.lon };
}

const CENTRE = { lat: 43.1214, lon: 5.928 };
const RAYON = 10;

await test("ZONE-01 — la construction du point de test est fidèle au mètre près", () => {
  for (const km of [1, 10, 10.05, 10.1, 25]) {
    const d = distanceKm(CENTRE, versLeNord(CENTRE, km));
    assert.ok(Math.abs(d - km) < 0.001, `${km} km attendu, ${d.toFixed(5)} mesuré`);
  }
});

function porteeZone(km: number) {
  const point = versLeNord(CENTRE, km);
  return verifierPorteeDesReleves({
    portee: { par: "zone", ...CENTRE, rayonKm: RAYON },
    items: [categorieBrute({ location: { osm_lat: point.lat, osm_lon: point.lon } })],
  });
}

await test("ZONE-02 — À L'INTÉRIEUR du rayon : accepté", () => {
  for (const km of [0, 1, 5, 9.5, 9.99]) {
    assert.equal(porteeZone(km), null, `${km} km pour un rayon de ${RAYON}`);
  }
});

await test("ZONE-03 — EXACTEMENT à la limite : accepté", () => {
  /*
   * ⚠️ LA LIMITE EST INCLUSIVE (`d > rayon × marge` rejette, donc `d = rayon`
   * passe). Un relevé situé pile sur le cercle demandé est DANS la zone
   * demandée : l'exclure serait répondre à une question qu'on n'a pas posée.
   */
  assert.equal(porteeZone(RAYON), null, "10,000 km pour un rayon de 10 : accepté");
});

await test("ZONE-04 — JUSTE AU-DELÀ de la tolérance : rejeté", () => {
  /*
   * ⚠️ LA TOLÉRANCE EST DE 0,5 %, SOIT 50 MÈTRES SUR 10 KM. Au-delà, le relevé
   * est refusé — et le rejet condamne la page entière.
   *
   * ⚠️ ET CETTE TOLÉRANCE EST MESURÉE, PAS CONCÉDÉE. L'amont calcule une
   * distance géodésique supérieure de 0,03 % à 0,10 % à notre haversine
   * (mesuré sur les lieux 167 et 363 depuis Toulon). Une vérification stricte
   * rejetterait donc des relevés parfaitement légitimes.
   */
  assert.equal(MARGE_ZONE, 1.005, "0,5 % : cinq fois le pire écart mesuré");
  const limiteToleree = RAYON * MARGE_ZONE; // 10,05 km
  assert.equal(porteeZone(limiteToleree - 0.001), null, "juste en deçà de la tolérance : accepté");
  assert.equal(porteeZone(limiteToleree + 0.001), "zone_hors_portee", "juste au-delà : rejeté");
  // Et de loin, évidemment.
  for (const km of [10.2, 15, 50]) {
    assert.equal(porteeZone(km), "zone_hors_portee", `${km} km`);
  }
});

await test("ZONE-05 — l'écart RÉELLEMENT mesuré sur l'amont tient dans la tolérance", () => {
  /*
   * ⚠️ LE TEST QUI JUSTIFIE LA MARGE. Si l'amont et nous divergions davantage
   * un jour, c'est ici que cela se verrait — et la marge devrait être
   * remesurée, pas élargie au jugé.
   */
  const ecartMaximalMesure = 0.00102; // lieu 167 : +0,102 %
  assert.ok(
    1 + ecartMaximalMesure < MARGE_ZONE,
    "la marge doit couvrir l'écart mesuré, avec de la réserve",
  );
  assert.ok(MARGE_ZONE < 1.01, "et rester en deçà du pour-cent : au-delà, ce n'est plus un arrondi");
});

await test("ZONE-06 — des coordonnées INVALIDES rendent la portée indémontrable", () => {
  /*
   * ⚠️ HORS BORNES N'EST PAS LOINTAIN : c'est faux. Une latitude de 200° ne
   * décrit aucun endroit ; la passer à la haversine rendrait un nombre, et ce
   * nombre n'aurait aucun sens. On refuse de conclure plutôt que de conclure
   * sur du bruit.
   */
  const cas: readonly (readonly [string, unknown, unknown])[] = [
    ["latitude > 90", 91, 5.928],
    ["latitude < -90", -90.5, 5.928],
    ["longitude > 180", 43.12, 181],
    ["longitude < -180", 43.12, -180.1],
    ["latitude absente", null, 5.928],
    ["longitude absente", 43.12, null],
    ["latitude en chaîne", "43.12", 5.928],
    ["longitude en chaîne", 43.12, "5.928"],
    ["NaN", Number.NaN, 5.928],
    ["Infinity", 43.12, Number.POSITIVE_INFINITY],
  ];
  for (const [quoi, osm_lat, osm_lon] of cas) {
    const verdict = verifierPorteeDesReleves({
      portee: { par: "zone", ...CENTRE, rayonKm: RAYON },
      items: [categorieBrute({ location: { osm_lat, osm_lon } })],
    });
    assert.equal(verdict, "portee_indemontrable", quoi);
  }
  // ⚠️ LES BORNES ELLES-MÊMES SONT VALIDES : ±90 et ±180 existent.
  assert.notEqual(
    verifierPorteeDesReleves({
      portee: { par: "zone", lat: 90, lon: 180, rayonKm: 20100 },
      items: [categorieBrute({ location: { osm_lat: -90, osm_lon: -180 } })],
    }),
    "portee_indemontrable",
    "les pôles et l'antiméridien sont des endroits",
  );
});

await test("ZONE-07 — un CENTRE ou un RAYON invalide désarmerait la garde : refusé", () => {
  /*
   * ⚠️ LE PIRE MODE DE PANNE D'UN GARDE-FOU EST DE SE DÉSARMER EN SILENCE. Avec
   * un rayon `NaN`, toute comparaison `d > NaN` est fausse : la garde laisserait
   * TOUT passer en croyant vérifier.
   */
  const dedans = [categorieBrute({ location: { osm_lat: CENTRE.lat, osm_lon: CENTRE.lon } })];
  const invalides = [
    { lat: Number.NaN, lon: 5.928, rayonKm: 10 },
    { lat: 43.12, lon: Number.NaN, rayonKm: 10 },
    { lat: 200, lon: 5.928, rayonKm: 10 },
    { lat: 43.12, lon: 5.928, rayonKm: Number.NaN },
    { lat: 43.12, lon: 5.928, rayonKm: -5 },
  ];
  for (const portee of invalides) {
    assert.equal(
      verifierPorteeDesReleves({ portee: { par: "zone", ...portee }, items: dedans }),
      "portee_indemontrable",
      JSON.stringify(portee),
    );
  }
});

await test("ZONE-08 — bout en bout : la lecture rejette une page hors zone", async () => {
  const horsZone = versLeNord(CENTRE, 50);
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", ...CENTRE, rayonKm: RAYON },
    transport: async () =>
      reponse(
        enveloppe([
          categorieBrute({ location: { osm_lat: CENTRE.lat, osm_lon: CENTRE.lon } }),
          categorieBrute({ id: 2, location: { osm_lat: horsZone.lat, osm_lon: horsZone.lon } }),
        ]),
      ),
  });
  assert.equal(lecture.ok, false, "un seul intrus condamne la page");
  assert.equal(lecture.observations.length, 0, "pas même celui qui était dans la zone");
});

/* ══════════════════════════════════════════════════════════════════════════
   15. UNE PORTÉE INVALIDE EST REFUSÉE MÊME QUAND LA RÉPONSE EST VIDE

   ⚠️ LE DÉFAUT QUE CETTE SECTION VERROUILLE — IL ÉTAIT INVISIBLE
   La validation du centre et du rayon vivait DANS la boucle sur les relevés.
   Sur une réponse `items: []`, le corps de boucle ne s'exécutait jamais : la
   fonction rendait `null` — « tout est en règle » — pour une portée dont le
   rayon valait `NaN`.

   ⚠️ ET MES PROPRES TESTS NE LE VOYAIENT PAS. `ZONE-07` passait une portée
   invalide AVEC un relevé : la boucle s'exécutait, la validation aussi, le test
   était vert. Un test qui ne teste que le cas favorable est un test qui ment.
   ══════════════════════════════════════════════════════════════════════════ */

/** La même question, sur une réponse SANS aucun relevé. */
function porteeVide(portee: Parameters<typeof verifierPorteeDesReleves>[0]["portee"]) {
  return verifierPorteeDesReleves({ portee, items: [] });
}

await test("ZONE-09 — centre invalide + réponse VIDE : indémontrable", () => {
  /*
   * ⚠️ LA VALIDITÉ D'UNE PORTÉE NE DÉPEND PAS DES RELEVÉS REÇUS. Un centre à
   * 200° de latitude est absurde qu'il revienne zéro ou mille relevés : la
   * question se tranche sur les paramètres seuls.
   */
  const centresInvalides = [
    ["latitude > 90", { lat: 91, lon: 5.928 }],
    ["latitude < -90", { lat: -90.5, lon: 5.928 }],
    ["longitude > 180", { lat: 43.12, lon: 181 }],
    ["longitude < -180", { lat: 43.12, lon: -180.1 }],
    ["latitude NaN", { lat: Number.NaN, lon: 5.928 }],
    ["longitude NaN", { lat: 43.12, lon: Number.NaN }],
    ["latitude Infinity", { lat: Number.POSITIVE_INFINITY, lon: 5.928 }],
    ["longitude -Infinity", { lat: 43.12, lon: Number.NEGATIVE_INFINITY }],
  ] as const;
  for (const [quoi, centre] of centresInvalides) {
    assert.equal(
      porteeVide({ par: "zone", ...centre, rayonKm: 10 }),
      "portee_indemontrable",
      `${quoi}, réponse vide`,
    );
  }
});

await test("ZONE-10 — rayon NaN + réponse VIDE : indémontrable", () => {
  /*
   * ⚠️ LE CAS LE PLUS DANGEREUX. Avec un rayon `NaN`, la comparaison
   * `d > NaN` est TOUJOURS fausse : la garde laisserait passer n'importe quel
   * relevé, où qu'il soit. Et sur une réponse vide, elle ne s'exécutait même
   * pas. Deux silences qui s'additionnent.
   */
  assert.equal(
    porteeVide({ par: "zone", lat: 43.1214, lon: 5.928, rayonKm: Number.NaN }),
    "portee_indemontrable",
  );
});

await test("ZONE-11 — rayon Infinity + réponse VIDE : indémontrable", () => {
  // ⚠️ `d > Infinity` est faux pour toute distance finie : un rayon infini
  // n'est pas « le monde entier », c'est une garde désarmée.
  for (const rayonKm of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(
      porteeVide({ par: "zone", lat: 43.1214, lon: 5.928, rayonKm }),
      "portee_indemontrable",
      String(rayonKm),
    );
  }
});

await test("ZONE-12 — rayon négatif ou NUL + réponse VIDE : indémontrable", () => {
  // ⚠️ STRICTEMENT POSITIF. Un rayon de zéro ne décrit aucune zone : ce n'est
  // pas « le point exact », c'est une demande qui n'a pas de réponse.
  for (const rayonKm of [-5, -0.001, 0]) {
    assert.equal(
      porteeVide({ par: "zone", lat: 43.1214, lon: 5.928, rayonKm }),
      "portee_indemontrable",
      String(rayonKm),
    );
  }
});

await test("ZONE-13 — portée VALIDE + réponse vide : acceptée", () => {
  /*
   * ⚠️ LE CONTRE-TEST, SANS LEQUEL LES QUATRE PRÉCÉDENTS NE PROUVENT RIEN. Une
   * garde qui refuse tout est aussi inutile qu'une garde qui accepte tout :
   * une absence de relevés sur une portée saine reste une ABSENCE, pas une
   * incohérence.
   */
  assert.equal(porteeVide({ par: "zone", lat: 43.1214, lon: 5.928, rayonKm: 10 }), null);
  // Et les bornes extrêmes sont des portées valides.
  assert.equal(porteeVide({ par: "zone", lat: 90, lon: 180, rayonKm: 0.001 }), null);
  assert.equal(porteeVide({ par: "zone", lat: -90, lon: -180, rayonKm: 20100 }), null);
  // Les trois autres portées ne sont pas concernées : rien à valider en amont.
  assert.equal(porteeVide({ par: "magasin", opLocationId: MAGASIN }), null);
  assert.equal(porteeVide({ par: "magasins", opLocationIds: [MAGASIN, 621] }), null);
  assert.equal(porteeVide({ par: "identite_osm", ...OSM_MAGASIN }), null);
});

await test("ZONE-14 — bout en bout : une portée invalide ne rend JAMAIS « ok » sur une page vide", async () => {
  /*
   * ⚠️ C'EST LE CHEMIN RÉEL, ET LE SEUL QUI COMPTE EN PRODUCTION. Sans ce
   * test, la correction serait prouvée sur la fonction pure et pas sur le
   * lecteur qui l'appelle.
   *
   * ⚠️ ET LA DISTINCTION EST SUBTILE : une page vide sur une portée SAINE doit
   * rendre `ok: true` avec zéro relevé — une absence. La même page vide sur une
   * portée invalide doit rendre `ok: false` — on ne sait pas de quoi elle est
   * l'absence.
   */
  const pageVide = async () => reponse(enveloppe([], 1, 1, 0));

  const invalide = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", lat: 43.1214, lon: 5.928, rayonKm: Number.NaN },
    transport: pageVide,
  });
  assert.equal(invalide.ok, false, "portée invalide : la page vide ne prouve rien");
  /*
   * ⚠️ `portee_invalide`, PAS `unavailable`. Un appel mal formé de notre côté
   * n'est pas une panne de l'amont : l'annoncer comme telle enverrait chercher
   * un incident chez quelqu'un d'autre.
   */
  assert.equal(invalide.raison, "portee_invalide");
  assert.equal(invalide.observations.length, 0);

  const saine = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", lat: 43.1214, lon: 5.928, rayonKm: 10 },
    transport: pageVide,
  });
  assert.equal(saine.ok, true, "portée saine : une page vide est une absence");
  assert.equal(saine.observations.length, 0);
  assert.equal(saine.raison, undefined);
});

await test("ZONE-15 — la validation de la portée précède la boucle, dans le code", () => {
  /*
   * ⚠️ UN TEST STRUCTUREL, PARCE QUE LE DÉFAUT ÉTAIT STRUCTUREL. Reglisser la
   * validation dans la boucle redonnerait des tests verts sur tous les cas
   * ci-dessus SAUF ceux à réponse vide — et c'est exactement ainsi que le
   * défaut était passé la première fois.
   */
  const source = readFileSync(
    new URL("../../lib/open-prices/observations.ts", import.meta.url),
    "utf8",
  );
  /*
   * ⚠️ LA SIGNATURE S'ÉTEND SUR PLUSIEURS LIGNES ET SON OBJET DE PARAMÈTRES SE
   * FERME EN COLONNE ZÉRO. Chercher le premier `\n}` tombait donc sur elle, et
   * le bloc extrait ne contenait que l'en-tête — le test passait alors pour de
   * mauvaises raisons. On délimite depuis la boucle, qui est dans le corps.
   */
  const debut = source.indexOf("export function verifierPorteeDesReleves");
  const iLoop = source.indexOf("for (const brut of params.items)", debut);
  assert.ok(debut > 0 && iLoop > debut, "la fonction et sa boucle doivent exister");
  const fonction = source.slice(debut, source.indexOf("\n}\n", iLoop));
  const iValidation = fonction.indexOf("verifierLaPorteeElleMeme(portee)");
  const iBoucle = fonction.indexOf("for (const brut of params.items)");
  assert.ok(iValidation > 0, "la portée doit être validée par une étape nommée");
  assert.ok(iBoucle > 0, "la boucle doit exister dans le bloc extrait");
  assert.ok(iValidation < iBoucle, "la validation de la portée PRÉCÈDE la boucle");
  // Et le rayon est exigé strictement positif.
  assert.match(source, /rayon <= 0/, "un rayon nul ne décrit aucune zone");
});


/* ══════════════════════════════════════════════════════════════════════════
   16. AUCUNE REQUÊTE N'EST ÉMISE AVEC UNE PORTÉE INVALIDE
   ══════════════════════════════════════════════════════════════════════════ */

await test("RES-01 — le transport n'est JAMAIS appelé avec un centre ou un rayon invalide", async () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA PORTÉE ÉTAIT VALIDÉE APRÈS LA RÉPONSE
   * ════════════════════════════════════════════════════════════════════════
   * Une requête au rayon `NaN` partait donc réellement — `radius_km=NaN` dans
   * l'URL — avant d'être jugée. On envoyait une question absurde à un service
   * bénévole, puis on lisait sa réponse.
   *
   * ⚠️ CE TEST COMPTE LES APPELS, il ne lit pas le résultat. C'est la seule
   * façon de prouver qu'aucune requête n'est partie : un code qui appellerait
   * puis jetterait la réponse rendrait exactement le même verdict.
   */
  const invalides = [
    ["rayon NaN", { lat: 43.1214, lon: 5.928, rayonKm: Number.NaN }],
    ["rayon Infinity", { lat: 43.1214, lon: 5.928, rayonKm: Number.POSITIVE_INFINITY }],
    ["rayon nul", { lat: 43.1214, lon: 5.928, rayonKm: 0 }],
    ["rayon négatif", { lat: 43.1214, lon: 5.928, rayonKm: -5 }],
    ["latitude hors bornes", { lat: 91, lon: 5.928, rayonKm: 10 }],
    ["longitude hors bornes", { lat: 43.1214, lon: 181, rayonKm: 10 }],
    ["latitude NaN", { lat: Number.NaN, lon: 5.928, rayonKm: 10 }],
  ] as const;

  for (const [quoi, zone] of invalides) {
    let appels = 0;
    const lecture = await lireRelevesCategorie({
      categoryTag: "en:carrots",
      portee: { par: "zone", ...zone },
      transport: async () => {
        appels += 1;
        return reponse(enveloppe([]));
      },
    });
    assert.equal(appels, 0, `${quoi} : aucune requête ne doit partir`);
    assert.equal(lecture.ok, false, quoi);
    assert.equal(lecture.raison, "portee_invalide", `${quoi} : ce n'est pas une panne réseau`);
    assert.equal(lecture.observations.length, 0, quoi);
  }
});

await test("RES-02 — une portée VALIDE appelle bien le transport", () => {
  /*
   * ⚠️ LE CONTRE-TEST. Sans lui, un code qui refuserait TOUTE portée passerait
   * `RES-01` haut la main.
   */
  let appels = 0;
  return lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "zone", lat: 43.1214, lon: 5.928, rayonKm: 10 },
    transport: async () => {
      appels += 1;
      return reponse(enveloppe([], 1, 1, 0));
    },
  }).then((lecture) => {
    assert.equal(appels, 1, "une portée saine part bien sur le réseau");
    assert.equal(lecture.ok, true, "et une page vide reste une absence");
  });
});

await test("RES-03 — une portée invalide ne se confond pas avec une panne de l'amont", async () => {
  // Trois raisons, trois situations : seule la première est de notre fait.
  const portee = { par: "zone" as const, lat: 43.1214, lon: 5.928, rayonKm: 10 };
  const malFormee = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { ...portee, rayonKm: Number.NaN },
    transport: async () => reponse(enveloppe([])),
  });
  const surchargee = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee,
    transport: async () => reponse({ detail: "throttled" }, 429),
  });
  const enPanne = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee,
    transport: async () => reponse({ detail: "boom" }, 500),
  });
  assert.equal(malFormee.raison, "portee_invalide");
  assert.equal(surchargee.raison, "rate_limited");
  assert.equal(enPanne.raison, "unavailable");
  assert.equal(new Set([malFormee.raison, surchargee.raison, enPanne.raison]).size, 3);
});

/* ══════════════════════════════════════════════════════════════════════════
   17. LE `category_tag` EST EXIGÉ, PAS SEULEMENT COMPARÉ S'IL EXISTE
   ══════════════════════════════════════════════════════════════════════════ */

await test("TAG-01 — champ absent, null, numérique ou vide : la page entière échoue", async () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA GARDE ÉTAIT OUVERTE
   * ════════════════════════════════════════════════════════════════════════
   * Elle n'accusait une ligne que si son `category_tag` était une CHAÎNE
   * différente. Un champ absent, `null` ou numérique passait donc — puis la
   * normalisation le refusait, et la lecture rendait `ok: true` avec ZÉRO
   * observation.
   *
   * ⚠️ UNE RÉPONSE INCOHÉRENTE DEVENAIT UNE ABSENCE. C'est le pire des deux
   * mondes : on affirmait « il n'y a pas de prix ici » sur une réponse qu'on
   * n'avait pas comprise.
   */
  const cas = [
    ["absent", {}],
    ["null", { category_tag: null }],
    ["numérique", { category_tag: 42 }],
    ["chaîne vide", { category_tag: "" }],
    ["espaces seuls", { category_tag: "   " }],
    ["tableau", { category_tag: ["en:carrots"] }],
    ["tag différent", { category_tag: "en:apples" }],
  ] as const;
  for (const [quoi, surcharge] of cas) {
    const brut = { ...categorieBrute(CHEZ_NOUS), ...surcharge };
    if (quoi === "absent") delete (brut as Record<string, unknown>)["category_tag"];
    const lecture = await lireRelevesCategorie({
      categoryTag: "en:carrots",
      portee: { par: "magasin", opLocationId: MAGASIN },
      transport: async () => reponse(enveloppe([brut])),
    });
    assert.equal(lecture.ok, false, `${quoi} : la page doit échouer`);
    assert.equal(lecture.raison, "unavailable", quoi);
    // ⚠️ ET SURTOUT PAS « ok avec zéro observation ».
    assert.notEqual(lecture.ok, true, quoi);
  }
});

await test("TAG-02 — une seule ligne fautive condamne les lignes saines", async () => {
  const lecture = await lireRelevesCategorie({
    categoryTag: "en:carrots",
    portee: { par: "magasin", opLocationId: MAGASIN },
    transport: async () =>
      reponse(enveloppe([categorieBrute(CHEZ_NOUS), { ...categorieBrute(CHEZ_NOUS), id: 2, category_tag: null }])),
  });
  assert.equal(lecture.ok, false);
  assert.equal(lecture.observations.length, 0, "pas même la ligne correcte");
});

await test("TAG-03 — le tag est comparé après le MÊME `trim` des deux côtés", async () => {
  // ⚠️ LA DEMANDE EST `trim`ée AVANT D'ÊTRE ENVOYÉE : la réponse doit l'être
  // aussi, sinon un espace de part et d'autre ferait échouer une page valide.
  const lecture = await lireRelevesCategorie({
    categoryTag: "  en:carrots  ",
    portee: { par: "magasin", opLocationId: MAGASIN },
    transport: async () => reponse(enveloppe([categorieBrute({ ...CHEZ_NOUS, category_tag: " en:carrots " })])),
  });
  assert.equal(lecture.ok, true);
  assert.equal(lecture.observations.length, 1);
});

/* ══════════════════════════════════════════════════════════════════════════
   18. LES DATES CALENDAIRES IMPOSSIBLES
   ══════════════════════════════════════════════════════════════════════════ */

await test("DATE-01 — une date au bon FORMAT mais impossible est refusée", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE FORMAT NE PROUVE PAS LA DATE
   * ════════════════════════════════════════════════════════════════════════
   * `2026-02-31` passe l'expression régulière, et `Date.UTC` n'échoue pas : il
   * REPORTE silencieusement au 3 mars. La fonction rendait donc un nombre de
   * jours parfaitement plausible pour une date qui n'existe pas.
   */
  for (const impossible of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29"]) {
    assert.equal(instantCalendaire(impossible), null, impossible);
    assert.equal(joursEcoules(impossible, AUJOURD_HUI), null, impossible);
    assert.equal(joursEcoules(AUJOURD_HUI, impossible), null, impossible);
  }
});

await test("DATE-02 — les dates réelles, y compris les cas limites, sont acceptées", () => {
  for (const valide of ["2026-11-08", "2026-02-28", "2024-02-29", "2026-01-01", "2026-12-31"]) {
    assert.notEqual(instantCalendaire(valide), null, valide);
  }
  // ⚠️ 2024 EST BISSEXTILE, 2025 NE L'EST PAS : l'aller-retour le sait, une
  // simple borne « jour ≤ 31 » ne l'aurait pas su.
  assert.notEqual(instantCalendaire("2024-02-29"), null);
  assert.equal(instantCalendaire("2025-02-29"), null);
  assert.equal(joursEcoules("2026-11-07", "2026-11-08"), 1);
});

await test("DATE-03 — une date impossible n'est PAS un relevé « trop ancien »", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ CE TEST ENTÉRINAIT L'AMBIGUÏTÉ QU'IL AURAIT DÛ INTERDIRE
   * ════════════════════════════════════════════════════════════════════════
   * Il exigeait `releves_trop_anciens` pour six dates `2026-02-31`, et passait
   * au vert en consacrant le défaut : l'écran disait « vos relevés datent de
   * plus d'un an », ce qui invite à ATTENDRE de nouveaux relevés. Or il n'y a
   * rien à attendre — la donnée est corrompue, et seul un correctif en amont y
   * changera quelque chose.
   *
   * ⚠️ UN TEST QUI DÉCRIT LE COMPORTEMENT OBSERVÉ AU LIEU DU COMPORTEMENT VOULU
   * est pire que pas de test : il transforme un défaut en contrat.
   */
  const impossibles = Array.from({ length: 6 }, (_, i) =>
    obs({ priceId: i + 1, observeLe: "2026-02-31", opLocationId: 100 + i }),
  );
  const e = estimerPrixCategorie({ observations: impossibles, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "dates_illisibles", "une date qui n'existe pas n'est pas une date vieille");
  assert.notEqual(e.raison, "releves_trop_anciens");
  assert.equal(e.datesIllisibles, 6, "et le compte est rendu");
  assert.equal(e.relevesExamines, 6);
});

await test("DATE-05 — estimation directe sur une date `2026-02-31`", () => {
  // ⚠️ LE CAS NOMMÉ DANS L'AUDIT, pris tel quel, sur la fonction d'estimation.
  const e = estimerPrixCategorie({
    observations: [obs({ priceId: 1, observeLe: "2026-02-31" })],
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "dates_illisibles");
  assert.equal(e.datesIllisibles, 1);
});

await test("DATE-06 — CINQ relevés bien datés mais tous anciens : comportement inchangé", () => {
  /*
   * ⚠️ LA CORRECTION NE DOIT RIEN CHANGER POUR LES DATES VALIDES. Cinq relevés
   * de 2022, de cinq lieux distincts, passeraient tous les autres seuils :
   * seule la fenêtre de fraîcheur les arrête, et le refus doit rester
   * `releves_trop_anciens` — celui-là est vrai, et on peut attendre.
   */
  const vieux = [2500, 2800, 2900, 3100, 3400].map((m, i) =>
    obs({ priceId: i + 1, montantMilli: m, observeLe: "2022-06-15", opLocationId: 1700 + i }),
  );
  const e = estimerPrixCategorie({ observations: vieux, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "releves_trop_anciens");
  assert.equal(e.datesIllisibles, 0, "aucune date corrompue ici");
  assert.equal(e.relevesExamines, 5);
  assert.equal(e.lieuxExamines, 5);
});

await test("DATE-07 — mélange de dates invalides et de dates fraîches : les valides survivent", () => {
  /*
   * ⚠️ LE TEST QUI EMPÊCHE LA SUR-CORRECTION. Écarter une date corrompue ne
   * doit pas emporter les relevés sains qui l'accompagnaient : cinq dates
   * fraîches de cinq lieux donnent une médiane, quoi qu'il arrive à côté.
   */
  const melange = [
    ...[2500, 2800, 2900, 3100, 3400].map((m, i) =>
      obs({ priceId: i + 1, montantMilli: m, observeLe: "2026-10-30", opLocationId: 1700 + i }),
    ),
    obs({ priceId: 90, montantMilli: 99000, observeLe: "2026-02-31", opLocationId: 1800 }),
    obs({ priceId: 91, montantMilli: 99000, observeLe: "2026-13-01", opLocationId: 1801 }),
    obs({ priceId: 92, montantMilli: 99000, observeLe: "2099-01-01", opLocationId: 1802 }),
  ];
  const e = estimerPrixCategorie({ observations: melange, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, true, "cinq relevés sains suffisent");
  if (!e.disponible) return;
  assert.equal(e.relevesUtilises, 5, "les trois dates fautives ne sont pas comptées");
  assert.equal(e.lieuxContributeurs, 5);
  assert.equal(e.medianeMilli, 2900, "et elles ne déplacent pas la médiane");
  /*
   * ⚠️ ET LA MÉDIANE RÉUSSIE DIT QUAND MÊME CE QU'ELLE A JETÉ. Si le compte
   * n'existait que sur les refus, la corruption resterait invisible tant
   * qu'elle ne bloquerait rien — découverte le jour où elle deviendrait
   * majoritaire, c'est-à-dire bien trop tard.
   */
  assert.equal(e.datesIllisibles, 3, "deux dates impossibles et une date future");
  // ⚠️ UNE DATE FUTURE EST RANGÉE AVEC LES ILLISIBLES : un relevé de 2099
  // n'est pas vieux, il est faux.
  assert.notEqual(e.medianeMilli, 99000);
});

await test("DATE-08 — vieux ET corrompus mêlés : l'ancienneté est annoncée, l'anomalie est comptée", () => {
  /*
   * ⚠️ QUAND LES DEUX CAUSES COEXISTENT, ON ANNONCE CELLE SUR LAQUELLE ON PEUT
   * AGIR. « Trop anciens » est vrai et invite à patienter utilement ; le compte
   * des dates illisibles part quand même, pour que la corruption ne disparaisse
   * pas en silence derrière une cause plus bavarde.
   */
  const melange = [
    ...Array.from({ length: 3 }, (_, i) =>
      obs({ priceId: i + 1, observeLe: "2022-06-15", opLocationId: 1700 + i }),
    ),
    ...Array.from({ length: 2 }, (_, i) =>
      obs({ priceId: 90 + i, observeLe: "2026-02-31", opLocationId: 1800 + i }),
    ),
  ];
  const e = estimerPrixCategorie({ observations: melange, aujourdHui: AUJOURD_HUI });
  assert.equal(e.disponible, false);
  if (e.disponible) return;
  assert.equal(e.raison, "releves_trop_anciens", "la cause actionnable l'emporte");
  assert.equal(e.datesIllisibles, 2, "mais l'anomalie est rendue, pas tue");
});

await test("DATE-09 — le refus `dates_illisibles` est traité dans le mapping des causes", () => {
  // ⚠️ `satisfies Record<RaisonSansEstimation, CausePrixAbsent>` l'impose au
  // compilateur ; ce test vérifie la valeur choisie, pas l'exhaustivité.
  const c = causePrincipale({
    couvertureMagasin: "magasin_ponte",
    budget: BUDGET_VIDE,
    estimation: { disponible: false, raison: "dates_illisibles", relevesExamines: 6, datesIllisibles: 6, lieuxExamines: 6 },
    aujourdHui: AUJOURD_HUI,
  });
  assert.equal(c, "releves_incompatibles", "inexploitable, pas ancien");
  assert.notEqual(c, "donnees_trop_anciennes");
});

await test("DATE-04 — une ligne CATEGORY à date impossible est refusée à la normalisation", () => {
  /*
   * ⚠️ LE PREMIER REMPART EST LÀ, et c'est le meilleur endroit : la date
   * impossible n'entre même pas dans le lot d'observations. Sans lui, elle
   * aurait voyagé jusqu'à la médiane avec une fraîcheur inventée.
   */
  for (const impossible of ["2026-02-31", "2026-13-01", "2026-00-10"]) {
    const r = normaliserObservationCategorie(categorieBrute({ date: impossible }));
    assert.equal(r.ok, false, impossible);
    if (!r.ok) assert.equal(r.refus, "date_absente", impossible);
  }
  // Et une date réelle passe toujours.
  assert.equal(normaliserObservationCategorie(categorieBrute({ date: "2026-10-30" })).ok, true);
});
