/**
 * Harnais — COURSES C4.3a : LA DÉCOUVERTE DES MAGASINS PROCHES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Que la position de l'élève TRAVERSE et ne se DÉPOSE nulle part ; que les
 * bornes de la recherche sont les NÔTRES et non celles de l'amont ; que la
 * pagination est bornée alors même que le filtrage se fait chez nous ; qu'un
 * lieu qui n'est pas un commerce alimentaire est écarté sans jamais nommer une
 * enseigne ; et qu'un navigateur ne peut pas faire créer un magasin qu'il aura
 * inventé.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Le transport est injecté et les réponses
 * sont des fixtures — même doctrine qu'en C4.1.
 *
 * Lancement : npm run test:magasins-c4-3a
 *             (NODE_OPTIONS="--conditions=react-server" : le module Open Prices
 *              est marqué `server-only`.)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  MIGRATION_C4_2,
  verifierContratDesMigrations,
  verifierManifesteDesMigrations,
} from "./contrat-migrations.mjs";

import {
  NEARBY_PAGES_MAX,
  NEARBY_RESULTATS_CIBLE,
  NEARBY_TAILLE_PAGE,
  RAYON_KM_DEFAUT,
  RAYON_KM_MAX,
  RAYON_KM_MIN,
  TAG_CLE_COMMERCE,
  VALEURS_COMMERCE_ALIMENTAIRE,
  type LieuBrut,
  bornerRayon,
  estCommerceAlimentaire,
  identifiantExterneValide,
  latitudeValide,
  longitudeValide,
  magasinsCoherents,
  normaliserLieu,
  retenirCandidats,
} from "../../lib/nutrition/magasin-proche";
import { chercherMagasinsProches, lireMagasinCanonique } from "../../lib/open-prices/locations";

/**
 * ⚠️ L'EN-TÊTE EST EXIGÉ PAR LE CONTRAT OFF, ET SON ABSENCE EST UNE ERREUR DE
 * CONFIGURATION, PAS UNE PANNE RÉSEAU. On le pose ici pour que les fixtures
 * mesurent le comportement réseau ; qu'il manque en production reste traité
 * séparément, par la branche `estOffNonConfigure` des routes.
 */
process.env.OPENFOODFACTS_USER_AGENT ??= "SETH-Tests/1.0 (tests@seth.invalid)";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const lireOuVide = (chemin: string) => {
  const url = new URL(chemin, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

const MODULE_PUR = lireOuVide("../../lib/nutrition/magasin-proche.ts");
const ADAPTATEUR = lireOuVide("../../lib/open-prices/locations.ts");
const SCHEMAS = lireOuVide("../../lib/api/schemas/magasins.ts");
const BASE = lireOuVide("../../lib/supabase/magasins.ts");
const ROUTE_NEARBY = lireOuVide("../../app/api/student/stores/nearby/route.ts");
const ROUTE_SELECT = lireOuVide("../../app/api/student/stores/select/route.ts");
const UI = lireOuVide("../../components/student/ChoixMagasinProche.tsx");
const ECRAN_COURSES = lireOuVide("../../app/(student)/nutrition/courses/page.tsx");

const LOT_C4_3A = [MODULE_PUR, ADAPTATEUR, SCHEMAS, BASE, ROUTE_NEARBY, ROUTE_SELECT, UI, ECRAN_COURSES];
const NOMS_LOT = [
  "lib/nutrition/magasin-proche.ts",
  "lib/open-prices/locations.ts",
  "lib/api/schemas/magasins.ts",
  "lib/supabase/magasins.ts",
  "app/api/student/stores/nearby/route.ts",
  "app/api/student/stores/select/route.ts",
  "components/student/ChoixMagasinProche.tsx",
  "app/(student)/nutrition/courses/page.tsx",
];

/** On assertionne du CODE, jamais de la prose : ce dépôt documente ses refus. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
function sansProseAffichee(source: string): string {
  return sansCommentaires(source)
    .replace(/>[^<>{}]+</g, "><")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/`[^`]*`/g, "``");
}

/* ── fixtures : la forme RÉELLE d'un item /nearby, mesurée le 17/08/2026 ──── */

function lieu(p: Partial<LieuBrut> & { id: number }): LieuBrut {
  return {
    type: "OSM",
    osm_type: "NODE",
    osm_id: 1000 + p.id,
    osm_name: `Commerce ${p.id}`,
    osm_brand: null,
    osm_tag_key: "shop",
    osm_tag_value: "supermarket",
    osm_address_postcode: "38000",
    osm_address_city: "Grenoble",
    osm_address_country_code: "FR",
    osm_lat: 45.18 + p.id / 10000,
    osm_lon: 5.72 + p.id / 10000,
    distance_km: p.id / 10,
    ...p,
  } as LieuBrut;
}

function page(items: readonly LieuBrut[], numero: number, pages: number, total: number) {
  return { items, page: numero, pages, size: NEARBY_TAILLE_PAGE, total };
}

function transportFixe(pagesJson: readonly unknown[], journal?: string[]) {
  let appels = 0;
  return async (url: string): Promise<Response> => {
    journal?.push(url);
    const corps = pagesJson[Math.min(appels, pagesJson.length - 1)];
    appels += 1;
    return new Response(JSON.stringify(corps), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   A — NOS BORNES SONT LES NÔTRES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-01 — latitude et longitude : seuls des nombres finis dans les bornes", () => {
  for (const bonne of [0, 45.188529, -89.999, 90, -90]) assert.equal(latitudeValide(bonne), true, `${bonne}`);
  for (const mauvaise of [90.0001, -90.0001, 200, NaN, Infinity, -Infinity]) {
    assert.equal(latitudeValide(mauvaise), false, `${mauvaise} doit être refusée`);
  }
  for (const bonne of [0, 5.7245, 180, -180]) assert.equal(longitudeValide(bonne), true, `${bonne}`);
  for (const mauvaise of [180.0001, -180.0001, 1000, NaN, Infinity]) {
    assert.equal(longitudeValide(mauvaise), false, `${mauvaise} doit être refusée`);
  }
});

await test("C4.3a-02 — le rayon a un MAXIMUM, et il est le nôtre", () => {
  // ⚠️ L'AMONT N'EN A AUCUN. Mesuré sur son code : `min_value=0`, pas de
  // `max_value`, et aucun clamp dans la vue. `radius_km=20000` y balaierait la
  // Terre entière chez un service bénévole. La borne DOIT venir de chez nous.
  assert.ok(RAYON_KM_MAX > 0 && Number.isFinite(RAYON_KM_MAX), "un maximum fini doit exister");
  assert.ok(RAYON_KM_MIN > 0, "un rayon nul n'a pas de sens produit");
  assert.ok(RAYON_KM_MIN <= RAYON_KM_DEFAUT && RAYON_KM_DEFAUT <= RAYON_KM_MAX);
  assert.equal(bornerRayon(undefined), RAYON_KM_DEFAUT);
  assert.equal(bornerRayon(RAYON_KM_MAX + 1000), null, "au-delà du maximum : refus, pas écrêtage");
  assert.equal(bornerRayon(0), null);
  assert.equal(bornerRayon(-5), null);
  assert.equal(bornerRayon(NaN), null);
  assert.equal(bornerRayon(RAYON_KM_MAX), RAYON_KM_MAX);
});

await test("C4.3a-02b — un identifiant externe non représentable est REFUSÉ, jamais arrondi", () => {
  // ⚠️ C4.2 A POSÉ `bigint` POUR NE PAS RÉTRÉCIR L'IDENTITÉ AMONT. Or
  // JavaScript n'est exact que jusqu'à 2⁵³−1 : au-delà, `JSON.parse` ARRONDIT
  // en silence, et `Number.isInteger` dit oui. On écrirait alors dans le
  // référentiel partagé un identifiant proche du bon — donc invisible.
  assert.equal(identifiantExterneValide(1), true);
  assert.equal(identifiantExterneValide(Number.MAX_SAFE_INTEGER), true, "la borne exacte est acceptée");
  assert.equal(
    identifiantExterneValide(Number.MAX_SAFE_INTEGER + 1),
    false,
    "au-delà de 2⁵³−1 : refus, jamais un arrondi",
  );
  for (const mauvais of [0, -1, 1.5, Number.NaN, Infinity, -Infinity, "3", null, undefined]) {
    assert.equal(identifiantExterneValide(mauvais), false, `${String(mauvais)} doit être refusé`);
  }

  // Et la règle vaut pour LES DEUX identifiants, jusque dans la normalisation.
  assert.equal(normaliserLieu(lieu({ id: 1, osm_id: Number.MAX_SAFE_INTEGER + 1 })), null, "osmId non sûr");
  const trop = { ...lieu({ id: 1 }), id: Number.MAX_SAFE_INTEGER + 1 } as LieuBrut;
  assert.equal(normaliserLieu(trop), null, "opLocationId non sûr");
  assert.ok(normaliserLieu({ ...lieu({ id: 1 }), id: Number.MAX_SAFE_INTEGER } as LieuBrut));

  // Le schéma de la route applique la MÊME règle.
  assert.equal(SCHEMAS.includes("safe()"), true, "le schéma de sélection doit exiger un entier sûr");
});

await test("C4.3a-02c — le schéma /select refuse un identifiant non sûr", async () => {
  const { choixMagasinBodySchema } = await import("../../lib/api/schemas/magasins");
  assert.equal(choixMagasinBodySchema.safeParse({ opLocationId: Number.MAX_SAFE_INTEGER }).success, true);
  assert.equal(
    choixMagasinBodySchema.safeParse({ opLocationId: Number.MAX_SAFE_INTEGER + 1 }).success,
    false,
    "un identifiant déjà arrondi par JSON.parse doit être refusé",
  );
  for (const mauvais of [1.5, Number.NaN, Infinity, 0, -3]) {
    assert.equal(choixMagasinBodySchema.safeParse({ opLocationId: mauvais }).success, false, `${mauvais}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   B — LE FILTRAGE DES LIEUX
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-03 — un commerce alimentaire est conservé", () => {
  for (const valeur of ["supermarket", "convenience", "greengrocer", "butcher", "bakery"]) {
    assert.equal(
      estCommerceAlimentaire({ osm_tag_key: "shop", osm_tag_value: valeur }),
      true,
      `shop=${valeur} doit être retenu`,
    );
  }
  assert.equal(TAG_CLE_COMMERCE, "shop");
});

await test("C4.3a-04 — restaurant, bar, pharmacie, librairie, musée, PONT : écartés", () => {
  // ⚠️ CES CAS SONT RÉELS, PAS IMAGINÉS. Mesurés le 17/08/2026 sur
  // `/nearby?lat=45.188529&lon=5.724524&radius_km=5&size=100` : parmi 100
  // lieux rendus autour de Grenoble, l'amont a renvoyé 6 librairies, 4
  // fast-foods, 3 pharmacies, 2 restaurants, un bar, un musée, un office
  // d'association — et un PONT (`man_made=bridge`).
  const rejets: ReadonlyArray<readonly [string, string]> = [
    ["amenity", "fast_food"],
    ["amenity", "restaurant"],
    ["amenity", "bar"],
    ["amenity", "pharmacy"],
    ["shop", "books"],
    ["shop", "toys"],
    ["shop", "sports"],
    ["shop", "clothes"],
    ["shop", "stationery"],
    ["tourism", "museum"],
    ["man_made", "bridge"],
    ["office", "association"],
  ];
  for (const [cle, valeur] of rejets) {
    assert.equal(
      estCommerceAlimentaire({ osm_tag_key: cle, osm_tag_value: valeur }),
      false,
      `${cle}=${valeur} ne doit PAS être proposé comme magasin`,
    );
  }
});

await test("C4.3a-05 — l'ambiguïté est un REFUS, jamais un pari", () => {
  // Un faux négatif coûte un magasin manquant ; un faux positif fait envoyer
  // quelqu'un acheter son riz dans une librairie. Le choix est fait une fois.
  for (const ambigu of [
    { osm_tag_key: null, osm_tag_value: "supermarket" },
    { osm_tag_key: "shop", osm_tag_value: null },
    { osm_tag_key: "", osm_tag_value: "" },
    { osm_tag_key: "shop", osm_tag_value: "yes" },
    {},
  ]) {
    assert.equal(estCommerceAlimentaire(ambigu), false, `${JSON.stringify(ambigu)} doit être écarté`);
  }
});

await test("C4.3a-06 — le filtre ne connaît AUCUNE enseigne", () => {
  // ⚠️ LA GARANTIE LA PLUS FACILE À PERDRE. Une liste de marques françaises
  // marcherait le premier jour, exclurait tous les commerces indépendants, et
  // deviendrait un référentiel commercial maison à maintenir.
  const code = sansProseAffichee(MODULE_PUR);
  for (const enseigne of [
    "auchan", "carrefour", "leclerc", "intermarche", "lidl", "aldi", "casino",
    "monoprix", "franprix", "biocoop", "picard", "super u", "cora", "match",
  ]) {
    assert.ok(!new RegExp(enseigne, "i").test(code), `le filtre nomme « ${enseigne} »`);
  }
  // Et il ne se replie pas sur le nom ni la marque du lieu.
  assert.ok(
    !/osm_name|osm_brand/.test(sansCommentaires(MODULE_PUR).split("estCommerceAlimentaire")[1] ?? ""),
    "le filtre ne doit regarder ni le nom ni l'enseigne",
  );
  // Le vocabulaire retenu vient de la taxonomie OSM, et il est explicite.
  assert.ok(VALEURS_COMMERCE_ALIMENTAIRE.size >= 8, "l'ensemble retenu doit être explicite");
  assert.ok(!VALEURS_COMMERCE_ALIMENTAIRE.has("books"));
  assert.ok(VALEURS_COMMERCE_ALIMENTAIRE.has("supermarket"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C — NORMALISATION, DÉDUPLICATION, TRI
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-07 — le DTO est MINIMAL et ne recopie pas l'amont", () => {
  const dto = normaliserLieu(lieu({ id: 3 }));
  assert.ok(dto, "un lieu conforme doit se normaliser");
  assert.deepEqual(
    Object.keys(dto!).sort(),
    [
      "brand", "city", "countryCode", "distanceKm", "lat", "lon",
      "name", "opLocationId", "osmId", "osmType", "postcode",
    ],
    "le DTO doit rester exactement celui du contrat",
  );
  // Les champs amont sans usage produit ne traversent pas.
  for (const inutile of ["osm_version", "proof_count", "user_count", "source", "website_url"]) {
    assert.ok(!(inutile in (dto as object)), `${inutile} n'a rien à faire dans le DTO`);
  }
});

await test("C4.3a-08 — un lieu inexploitable est écarté, jamais rendu à moitié", () => {
  assert.equal(normaliserLieu(lieu({ id: 1, osm_name: null })), null, "sans nom : inchoisissable");
  assert.equal(normaliserLieu(lieu({ id: 1, osm_lat: null })), null, "sans coordonnées");
  assert.equal(normaliserLieu(lieu({ id: 1, osm_type: "PLACE" })), null, "osm_type hors contrat");
  assert.equal(normaliserLieu(lieu({ id: 1, osm_tag_value: "books" })), null, "hors périmètre");
  assert.equal(normaliserLieu({ ...lieu({ id: 1 }), id: undefined } as unknown as LieuBrut), null);
});

const retenus = (page: readonly LieuBrut[], deja: readonly LieuBrut[] = []) =>
  magasinsCoherents(retenirCandidats(page, retenirCandidats(deja, [])));

await test("C4.3a-09 — A · même identité deux fois : une seule occurrence, tri par distance", () => {
  const brut = [
    lieu({ id: 5, distance_km: 2.5 }),
    lieu({ id: 2, distance_km: 0.4 }),
    lieu({ id: 5, distance_km: 2.5 }), // exactement le même magasin
    lieu({ id: 9, distance_km: 1.1 }),
  ];
  const liste = retenus(brut);
  assert.deepEqual(liste.map((m) => m.opLocationId), [2, 9, 5], "tri par distance croissante");
  assert.equal(liste.length, 3, "le doublon exact disparaît");
});

await test("C4.3a-09b — B · deux op_location_id pour LE MÊME objet OSM : aucun des deux proposé", () => {
  // ⚠️ LE DÉFAUT CORRIGÉ ICI. C4.2 pose DEUX unicités ; dédupliquer sur la
  // seule première laissait passer ces deux variantes. L'élève choisissait la
  // première, puis changeait d'avis pour la seconde — et la sélection échouait
  // sur un conflit d'identité, à propos d'un magasin que NOUS lui avions montré.
  const a = lieu({ id: 42, osm_type: "WAY", osm_id: 999, distance_km: 0.2 });
  const b = { ...lieu({ id: 77, osm_type: "WAY", osm_id: 999, distance_km: 0.3 }) };
  const liste = retenus([a, b, lieu({ id: 3, distance_km: 1 })]);
  assert.deepEqual(
    liste.map((m) => m.opLocationId),
    [3],
    "les DEUX variantes ambiguës sortent — on ne tranche pas à la place de l'élève",
  );
});

await test("C4.3a-09c — C · un op_location_id portant DEUX identités OSM : non proposé", () => {
  const a = { ...lieu({ id: 42, osm_type: "WAY", osm_id: 999, distance_km: 0.2 }) };
  const b = { ...lieu({ id: 42, osm_type: "NODE", osm_id: 111, distance_km: 0.3 }) };
  const liste = retenus([a, b, lieu({ id: 3, distance_km: 1 })]);
  assert.deepEqual(liste.map((m) => m.opLocationId), [3], "le cas symétrique est traité pareil");
});

await test("C4.3a-09d — D · une collision révélée à la page 2 RETIRE le retenu de la page 1", () => {
  // ⚠️ C'EST POUR CE CAS QUE L'ACCUMULATEUR GARDE LES CANDIDATS ET NON LE
  // RÉSULTAT. Ne filtrer que la nouveauté laisserait affiché le magasin de la
  // page 1, dont on vient d'apprendre que l'identité est ambiguë.
  const page1 = [lieu({ id: 42, osm_type: "WAY", osm_id: 999, distance_km: 0.2 })];
  const page2 = [lieu({ id: 77, osm_type: "WAY", osm_id: 999, distance_km: 0.3 })];

  assert.deepEqual(retenus(page1).map((m) => m.opLocationId), [42], "seul, il est légitime");
  const apres = magasinsCoherents(retenirCandidats(page2, retenirCandidats(page1, [])));
  assert.deepEqual(apres, [], "la collision retire AUSSI celui de la page précédente");
});

await test("C4.3a-09e — E · deux commerces de MÊME ENSEIGNE restent deux magasins", () => {
  // La déduplication ne regarde NI le nom NI l'enseigne — jamais.
  const nord = {
    ...lieu({ id: 10, osm_type: "WAY", osm_id: 501, distance_km: 0.5 }),
    osm_name: "Enseigne Nord",
    osm_brand: "Enseigne",
  };
  const sud = {
    ...lieu({ id: 11, osm_type: "NODE", osm_id: 502, distance_km: 0.9 }),
    osm_name: "Enseigne Sud",
    osm_brand: "Enseigne",
  };
  const liste = retenus([nord, sud]);
  assert.deepEqual(liste.map((m) => m.opLocationId), [10, 11], "deux identités, deux magasins");
  assert.equal(liste[0].brand, "Enseigne");
  assert.equal(liste[1].brand, "Enseigne");
});

await test("C4.3a-09f — l'accumulation entre pages ne perd rien et ne duplique rien", () => {
  const page1 = [lieu({ id: 5, distance_km: 2.5 }), lieu({ id: 2, distance_km: 0.4 })];
  const page2 = [lieu({ id: 2, distance_km: 0.4 }), lieu({ id: 7, distance_km: 3 })];
  const liste = magasinsCoherents(retenirCandidats(page2, retenirCandidats(page1, [])));
  assert.deepEqual(liste.map((m) => m.opLocationId), [2, 5, 7], "un magasin revu ne double pas");
});

/* ══════════════════════════════════════════════════════════════════════════
   D — LA PAGINATION EST BORNÉE, MALGRÉ LE FILTRAGE CHEZ NOUS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-10 — plusieurs pages sont lues quand le filtrage vide la première", async () => {
  // ⚠️ LE PIÈGE. `LocationFilter` est court-circuité sur `/nearby` : on ne peut
  // PAS demander à l'amont de ne rendre que des commerces. Une page de 100
  // peut donc ne donner que trois magasins utilisables. S'arrêter là
  // afficherait « 3 magasins près de vous » alors qu'il y en a trente.
  const journal: string[] = [];
  const p1 = page([lieu({ id: 1, osm_tag_value: "books" }), lieu({ id: 2, osm_tag_key: "amenity", osm_tag_value: "bar" })], 1, 3, 250);
  const p2 = page([lieu({ id: 3 }), lieu({ id: 4 })], 2, 3, 250);
  const p3 = page([lieu({ id: 5 })], 3, 3, 250);
  const r = await chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: transportFixe([p1, p2, p3], journal) },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.magasins.map((m) => m.opLocationId), [3, 4, 5]);
  assert.equal(journal.length, 3, "les trois pages doivent avoir été lues");
});

await test("C4.3a-11 — la pagination est BORNÉE : jamais plus de NEARBY_PAGES_MAX appels", () => {
  const journal: string[] = [];
  // L'amont annonce 99 pages et ne rend que des lieux écartés : sans borne, la
  // boucle irait jusqu'au bout du service.
  const vide = page([lieu({ id: 1, osm_tag_value: "books" })], 1, 99, 9900);
  return chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: transportFixe([vide], journal) },
  ).then((r) => {
    assert.equal(journal.length, NEARBY_PAGES_MAX, `${journal.length} appels au lieu de ${NEARBY_PAGES_MAX}`);
    assert.equal(r.magasins.length, 0);
    assert.equal(r.ok, true, "aucun résultat n'est un SUCCÈS, pas une panne");
    assert.equal(r.tronque, true, "l'écran doit pouvoir dire que la recherche a été écourtée");
  });
});

await test("C4.3a-12 — on s'arrête dès la cible atteinte, sans lire la page suivante", () => {
  const journal: string[] = [];
  const pleine = page(
    Array.from({ length: NEARBY_RESULTATS_CIBLE + 5 }, (_, i) => lieu({ id: i + 1, distance_km: i / 10 })),
    1,
    9,
    900,
  );
  return chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: transportFixe([pleine], journal) },
  ).then((r) => {
    assert.equal(journal.length, 1, "une seule page suffit");
    assert.equal(r.magasins.length, NEARBY_RESULTATS_CIBLE, "la liste rendue est plafonnée");
  });
});

await test("C4.3a-12b — `tronque` dit « tout n'a pas été rendu », et les cinq cas le prouvent", async () => {
  // ⚠️ LA DÉFINITION A ÉTÉ CORRIGÉE. La première ne regardait que les pages non
  // lues : elle ratait le cas le plus fréquent — une page qui donne 25 magasins
  // valides alors que l'écran n'en montre que 20. Cinq disparaissaient sans que
  // rien ne le dise.
  const magasinsValides = (n: number) =>
    Array.from({ length: n }, (_, i) => lieu({ id: i + 1, distance_km: i / 100 }));
  const chercher = (corps: unknown) =>
    chercherMagasinsProches({ lat: 45.18, lon: 5.72, rayonKm: 5 }, { transport: transportFixe([corps]) });

  // A. 25 valides sur la DERNIÈRE page → 20 rendus, et il en manque cinq.
  const a = await chercher(page(magasinsValides(25), 1, 1, 25));
  assert.equal(a.magasins.length, NEARBY_RESULTATS_CIBLE);
  assert.equal(a.tronque, true, "A — le slice a coupé cinq magasins");

  // B. exactement 20 sur la dernière page → rien ne manque.
  const b = await chercher(page(magasinsValides(NEARBY_RESULTATS_CIBLE), 1, 1, 20));
  assert.equal(b.magasins.length, NEARBY_RESULTATS_CIBLE);
  assert.equal(b.tronque, false, "B — tout a été rendu");

  // C. 20 atteints, mais l'amont annonce encore une page.
  const c = await chercher(page(magasinsValides(NEARBY_RESULTATS_CIBLE), 1, 2, 120));
  assert.equal(c.tronque, true, "C — une page reste à lire");

  // D. moins de 20, plafond de pages atteint, et il reste des pages.
  const d = await chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: transportFixe([page(magasinsValides(2), 1, 99, 9900)]) },
  );
  assert.ok(d.magasins.length < NEARBY_RESULTATS_CIBLE);
  assert.equal(d.pagesLues, NEARBY_PAGES_MAX);
  assert.equal(d.tronque, true, "D — la borne a écourté la recherche");

  // E. moins de 20 et fin RÉELLE de l'amont.
  const e = await chercher(page(magasinsValides(3), 1, 1, 3));
  assert.equal(e.magasins.length, 3);
  assert.equal(e.tronque, false, "E — il n'y avait que trois magasins");
});

await test("C4.3a-13 — la taille de page est la NÔTRE, jamais celle du client", () => {
  const journal: string[] = [];
  return chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: transportFixe([page([], 1, 1, 0)], journal) },
  ).then(() => {
    const url = new URL(journal[0]);
    assert.equal(url.searchParams.get("size"), String(NEARBY_TAILLE_PAGE));
    assert.ok(NEARBY_TAILLE_PAGE <= 100, "l'amont plafonne silencieusement à 100 : ne pas demander plus");
    assert.equal(url.searchParams.get("lat"), "45.18");
    assert.equal(url.searchParams.get("lon"), "5.72");
    assert.equal(url.searchParams.get("radius_km"), "5");
    // Aucun paramètre parasite : ni clé, ni jeton, ni champ libre.
    assert.deepEqual(
      [...url.searchParams.keys()].sort(),
      ["lat", "lon", "page", "radius_km", "size"],
      "la requête sortante ne doit transporter que le contrat mesuré",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E — LES PANNES DE L'AMONT
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-14 — 5xx amont : panne déclarée, jamais « aucun magasin »", async () => {
  const r = await chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: async () => new Response("bang", { status: 503 }) },
  );
  assert.equal(r.ok, false, "une panne doit se voir");
  assert.equal(r.magasins.length, 0);
});

await test("C4.3a-15 — JSON illisible : panne, pas une liste vide", async () => {
  const r = await chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    { transport: async () => new Response("<html>maintenance</html>", { status: 200 }) },
  );
  assert.equal(r.ok, false);
  assert.equal(r.magasins.length, 0);
});

await test("C4.3a-16 — timeout : un signal d'annulation est armé, et la panne est propre", async () => {
  const r = await chercherMagasinsProches(
    { lat: 45.18, lon: 5.72, rayonKm: 5 },
    {
      timeoutMs: 5,
      transport: (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.magasins.length, 0);
  // Et le code arme réellement une annulation — pas seulement un `try`.
  const code = sansCommentaires(ADAPTATEUR);
  assert.match(code, /AbortController/, "un timeout doit ANNULER l'appel, pas seulement l'attendre");
  assert.match(code, /signal/, "le signal doit être passé au transport");
});

/* ══════════════════════════════════════════════════════════════════════════
   F — LA SÉLECTION : LE NAVIGATEUR NE DÉCRIT PAS LE MAGASIN
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-17 — le corps de sélection ne transporte QU'UN identifiant", async () => {
  const { choixMagasinBodySchema } = await import("../../lib/api/schemas/magasins");
  assert.equal(choixMagasinBodySchema.safeParse({ opLocationId: 3 }).success, true);
  // ⚠️ LE CŒUR DU LOT. Un corps qui décrit le magasin serait cru sur parole.
  const falsifie = {
    opLocationId: 3,
    name: "Mon faux magasin",
    brand: "Fausse enseigne",
    lat: 0,
    lon: 0,
  };
  assert.equal(
    choixMagasinBodySchema.safeParse(falsifie).success,
    false,
    "un corps décrivant le magasin doit être REFUSÉ (.strict)",
  );
  for (const mauvais of [{}, { opLocationId: 0 }, { opLocationId: -1 }, { opLocationId: 1.5 }, { opLocationId: "3" }]) {
    assert.equal(choixMagasinBodySchema.safeParse(mauvais).success, false, JSON.stringify(mauvais));
  }
});

await test("C4.3a-18 — le magasin est RELU chez l'amont au moment du choix", async () => {
  const journal: string[] = [];
  const canonique = {
    ...lieu({ id: 3 }),
    id: 3,
    osm_name: "Nom canonique",
    osm_brand: "Enseigne canonique",
  };
  const issue = await lireMagasinCanonique(3, {
    transport: async (url) => {
      journal.push(url);
      return new Response(JSON.stringify(canonique), { status: 200 });
    },
  });
  assert.equal(issue.statut, "trouve");
  assert.equal(issue.statut === "trouve" ? issue.magasin.name : null, "Nom canonique");
  assert.equal(issue.statut === "trouve" ? issue.magasin.brand : null, "Enseigne canonique");
  assert.equal(journal.length, 1);
  assert.match(journal[0], /\/api\/v1\/locations\/3$/, "la relecture se fait par IDENTIFIANT");
});

await test("C4.3a-18b — absence et panne amont sont DEUX issues différentes", async () => {
  // ⚠️ LE DÉFAUT CORRIGÉ ICI. Une première version rendait `null` pour tout —
  // 404, 429, 500, timeout, corps illisible — et la route répondait
  // « Magasin introuvable ». Un élève dont l'appel avait expiré cherchait donc
  // ailleurs un magasin qui existait bel et bien.
  const avec = (reponse: () => Promise<Response>) => lireMagasinCanonique(3, { transport: reponse });

  assert.deepEqual(await avec(async () => new Response("", { status: 404 })), { statut: "absent" });

  for (const [code, nom] of [[429, "trop de requêtes"], [500, "panne serveur"], [503, "maintenance"]] as const) {
    const issue = await avec(async () => new Response("", { status: code }));
    assert.equal(issue.statut, "indisponible", `${code} (${nom}) n'est PAS une absence`);
    assert.equal(issue.statut === "indisponible" ? issue.cause : null, "http");
  }

  const illisible = await avec(async () => new Response("<html>maintenance</html>", { status: 200 }));
  assert.equal(illisible.statut, "indisponible");
  assert.equal(illisible.statut === "indisponible" ? illisible.cause : null, "corps_illisible");

  const expire = await lireMagasinCanonique(3, {
    timeoutMs: 5,
    transport: (_url, init) =>
      new Promise((_r, rejeter) => init?.signal?.addEventListener("abort", () => rejeter(new Error("abort")))),
  });
  assert.equal(expire.statut, "indisponible");
  assert.equal(expire.statut === "indisponible" ? expire.cause : null, "reseau");

  // Une fiche PRÉSENTE mais qui n'est pas un commerce alimentaire : ni absente,
  // ni une panne — non sélectionnable, et c'est une troisième chose.
  const librairie = await avec(
    async () => new Response(JSON.stringify({ ...lieu({ id: 3 }), id: 3, osm_tag_value: "books" }), { status: 200 }),
  );
  assert.equal(librairie.statut, "non_exploitable");
});

await test("C4.3a-18c — la route traduit chaque issue en un code HTTP distinct", () => {
  const code = sansCommentaires(ROUTE_SELECT);
  // ⚠️ ON VÉRIFIE L'AIGUILLAGE, PAS SEULEMENT LA PRÉSENCE DES NOMBRES : chaque
  // statut doit précéder le code qu'il commande.
  for (const [statut, http] of [
    ["absent", "404"],
    ["non_exploitable", "404"],
    ["indisponible", "503"],
  ] as const) {
    const bloc = new RegExp(`issue\\.statut === "${statut}"[\\s\\S]{0,400}status:\\s*${http}`);
    assert.match(code, bloc, `l'issue « ${statut} » doit répondre ${http}`);
  }
  // Et « indisponible » ne doit JAMAIS retomber sur un 404.
  const blocIndispo = /issue\.statut === "indisponible"[\s\S]{0,400}?\}/.exec(code)?.[0] ?? "";
  assert.ok(!/status:\s*404/.test(blocIndispo), "une panne amont ne doit pas se dire « introuvable »");
});

await test("C4.3a-19 — la route de sélection n'écrit AUCUNE donnée venue du corps", () => {
  const code = sansCommentaires(ROUTE_SELECT);
  // Le corps est réduit à l'identifiant, et c'est la relecture qui alimente
  // l'écriture. Toute autre clé lue du corps serait une porte ouverte.
  for (const champ of ["body.name", "body.brand", "body.lat", "body.lon", "body.osmId", "body.city"]) {
    assert.ok(!code.includes(champ), `la route lit ${champ} dans le corps : le client deviendrait la source`);
  }
  assert.match(code, /lireMagasinCanonique/, "la route doit relire le magasin chez l'amont");
  assert.match(code, /createSupabaseAdminClient/, "l'écriture du catalogue passe par le rôle serveur");
});

/* ══════════════════════════════════════════════════════════════════════════
   F bis — L'ÉCRITURE DU CATALOGUE, SUR UNE BASE SIMULÉE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Une base en mémoire, réduite à ce que `upserterMagasin` utilise.
 *
 * ⚠️ ELLE NE REMPLACE PAS LA CHECKLIST POSTGRESQL. Elle prouve la LOGIQUE de
 * l'upsert — combien de lignes, laquelle est réutilisée, quand on refuse — pas
 * le comportement des contraintes, qui se joue dans un vrai moteur et que la
 * checklist C4.2 éprouve déjà.
 */
function baseSimulee(
  lignes: Array<Record<string, unknown>> = [],
  concurrence?: {
    /** L'erreur que le PREMIER insert doit rendre — la course simulée. */
    readonly erreurInsert: { readonly code: string; readonly message: string };
    /** Ce que le concurrent a écrit pendant ce temps, révélé à la relecture. */
    readonly ecritesParLeConcurrent?: Array<Record<string, unknown>>;
  },
) {
  const journal = { insertions: 0, misesAJour: 0, lectures: 0 };
  const table = lignes;
  let insertDejaRefuse = false;
  const client = {
    from() {
      const filtres: Array<[string, unknown]> = [];
      let mode: "select" | "update" | "insert" = "select";
      let charge: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(colonne: string, valeur: unknown) {
          filtres.push([colonne, valeur]);
          return builder;
        },
        update(valeurs: Record<string, unknown>) {
          mode = "update";
          charge = valeurs;
          return builder;
        },
        insert(valeurs: Record<string, unknown>) {
          mode = "insert";
          charge = valeurs;
          return builder;
        },
        async maybeSingle() {
          if (mode === "insert") {
            if (concurrence && !insertDejaRefuse) {
              insertDejaRefuse = true;
              // Le concurrent a gagné la course : ses lignes apparaissent.
              for (const l of concurrence.ecritesParLeConcurrent ?? []) table.push(l);
              return { data: null, error: concurrence.erreurInsert };
            }
            journal.insertions += 1;
            const ligne = { id: `store-${table.length + 1}`, ...charge };
            table.push(ligne);
            return { data: ligne, error: null };
          }
          journal.lectures += 1;
          const trouvee = table.find((l) => filtres.every(([c, v]) => l[c] === v)) ?? null;
          return { data: trouvee, error: null };
        },
        then(resolve: (v: { data: null; error: null }) => void) {
          // Le chemin `update` ne passe pas par `maybeSingle` : il est attendu.
          if (mode === "update") {
            journal.misesAJour += 1;
            const cible = table.find((l) => filtres.every(([c, v]) => l[c] === v));
            if (cible) Object.assign(cible, charge);
          }
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client, table, journal };
}

await test("C4.3a-19b — le même magasin choisi deux fois ne crée pas de doublon", async () => {
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42 }))!;
  const { client, table, journal } = baseSimulee();

  const premier = await upserterMagasin(client as never, magasin);
  assert.equal(premier.erreur, null);
  assert.ok(premier.storeId, "le premier choix crée la ligne");
  assert.equal(table.length, 1);
  assert.equal(journal.insertions, 1);

  // ⚠️ MÊME IDENTITÉ AMONT ⇒ AUCUNE SECONDE LIGNE. Les deux clés uniques de
  // C4.2 le refuseraient de toute façon, mais l'appelant recevrait alors une
  // violation de contrainte au lieu d'un identifiant — et l'élève, une erreur.
  const second = await upserterMagasin(client as never, { ...magasin, name: "Nom rafraîchi" });
  assert.equal(second.storeId, premier.storeId, "le même magasin doit rendre le même identifiant");
  assert.equal(table.length, 1, "aucun doublon ne doit apparaître");
  assert.equal(journal.insertions, 1, "aucune seconde insertion");
  assert.equal(table[0].name, "Nom rafraîchi", "seul l'affichage se rafraîchit");
  // L'identité, elle, n'a pas bougé.
  assert.equal(table[0].op_location_id, magasin.opLocationId);
  assert.equal(table[0].osm_id, magasin.osmId);
});

await test("C4.3a-19c — une identité amont éclatée sur deux lignes REFUSE d'écrire", async () => {
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42 }))!;
  // Le cas réel : la source a fusionné deux enregistrements. `op_location_id`
  // pointe une ligne, le couple OSM en pointe une autre.
  const { client, table, journal } = baseSimulee([
    { id: "store-A", op_location_id: magasin.opLocationId, osm_type: "WAY", osm_id: 111 },
    { id: "store-B", op_location_id: 999999, osm_type: magasin.osmType, osm_id: magasin.osmId },
  ]);

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, true, "le conflit doit être NOMMÉ, pas absorbé");
  assert.equal(resultat.storeId, null, "aucun magasin n'est choisi dans le doute");
  assert.equal(journal.insertions, 0, "aucune écriture");
  assert.equal(journal.misesAJour, 0);
  assert.equal(table.length, 2, "les deux lignes existantes sont laissées intactes");
});

await test("C4.3a-19d — match sur op_location_id SEUL, identité OSM différente : conflit", async () => {
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42, osm_type: "WAY", osm_id: 999 }))!;
  // La ligne locale porte le bon identifiant Open Prices… et un AUTRE objet OSM.
  const { client, table, journal } = baseSimulee([
    { id: "store-A", op_location_id: magasin.opLocationId, osm_type: "WAY", osm_id: 111 },
  ]);

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, true, "un match PARTIEL n'autorise pas la réutilisation");
  assert.equal(resultat.storeId, null);
  assert.equal(journal.insertions, 0, "aucune insertion");
  assert.equal(journal.misesAJour, 0, "aucune mise à jour");
  assert.equal(table[0].osm_id, 111, "l'identité locale n'est PAS réécrite");
});

await test("C4.3a-19e — match sur le couple OSM SEUL, op_location_id différent : conflit", async () => {
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42, osm_type: "WAY", osm_id: 999 }))!;
  // Le cas symétrique : bon objet OSM, autre identifiant Open Prices.
  const { client, table, journal } = baseSimulee([
    { id: "store-A", op_location_id: 777, osm_type: "WAY", osm_id: 999 },
  ]);

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, true, "le cas symétrique est le MÊME problème");
  assert.equal(resultat.storeId, null);
  assert.equal(journal.insertions, 0);
  assert.equal(journal.misesAJour, 0);
  assert.equal(table[0].op_location_id, 777, "l'identité locale n'est PAS réécrite");
});

const UNICITE = { code: "23505", message: 'duplicate key value violates unique constraint' };

await test("C4.3a-19f — course perdue puis relecture EXACTE : succès idempotent", async () => {
  // ⚠️ LA COURSE EST RÉELLE. Deux élèves choisissent le même magasin à la même
  // seconde : les deux lisent « aucune ligne », les deux insèrent, le second se
  // heurte à une contrainte de C4.2. À cet instant le magasin canonique EXISTE
  // et il est CORRECT — répondre « enregistrement impossible » serait faux.
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42, osm_type: "WAY", osm_id: 999 }))!;
  const { client, journal } = baseSimulee([], {
    erreurInsert: UNICITE,
    ecritesParLeConcurrent: [
      { id: "store-concurrent", op_location_id: 42, osm_type: "WAY", osm_id: 999 },
    ],
  });

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, false);
  assert.equal(resultat.erreur, null, "une course perdue n'est pas une erreur");
  assert.equal(resultat.storeId, "store-concurrent", "on adopte la ligne du concurrent");
  assert.equal(journal.insertions, 0, "aucune seconde insertion");
  // ⚠️ UN SEUL RATTRAPAGE : deux lectures avant, deux après, jamais plus.
  assert.equal(journal.lectures, 4, `${journal.lectures} lectures : le rattrapage doit être unique`);
});

await test("C4.3a-19g — course perdue puis relecture PARTIELLE : conflit", async () => {
  // Le rattrapage n'est PAS une porte dérobée : il applique la même règle
  // d'identité que le chemin nominal.
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42, osm_type: "WAY", osm_id: 999 }))!;
  const { client, journal } = baseSimulee([], {
    erreurInsert: UNICITE,
    ecritesParLeConcurrent: [
      { id: "store-partiel", op_location_id: 42, osm_type: "WAY", osm_id: 111 },
    ],
  });

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, true, "un match partiel reste un conflit APRÈS le rattrapage");
  assert.equal(resultat.storeId, null);
  assert.equal(journal.insertions, 0);
});

await test("C4.3a-19h — course perdue puis DEUX lignes différentes : conflit", async () => {
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42, osm_type: "WAY", osm_id: 999 }))!;
  const { client, journal } = baseSimulee([], {
    erreurInsert: UNICITE,
    ecritesParLeConcurrent: [
      { id: "store-A", op_location_id: 42, osm_type: "WAY", osm_id: 111 },
      { id: "store-B", op_location_id: 777, osm_type: "WAY", osm_id: 999 },
    ],
  });

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, true);
  assert.equal(resultat.storeId, null);
  assert.equal(journal.insertions, 0);
});

await test("C4.3a-19i — toute AUTRE erreur d'insertion remonte telle quelle", async () => {
  // ⚠️ AUCUN RETRY MAGIQUE. Une colonne manquante, un privilège refusé, une
  // panne : rien de tout cela ne se répare en relisant.
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42 }))!;
  const { client, journal } = baseSimulee([], {
    erreurInsert: { code: "42501", message: "permission denied for table stores" },
  });

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.conflitIdentite, false);
  assert.match(resultat.erreur ?? "", /permission denied/);
  assert.equal(resultat.storeId, null);
  assert.equal(journal.lectures, 2, "aucune relecture : le rattrapage ne vise QUE 23505");
});

await test("C4.3a-19j — le rattrapage est BORNÉ : jamais de boucle", async () => {
  const { upserterMagasin } = await import("../../lib/supabase/magasins");
  const magasin = normaliserLieu(lieu({ id: 42 }))!;
  // La violation d'unicité se produit, mais la relecture ne trouve toujours
  // rien : la base se contredit. On remonte l'erreur, on ne réessaie pas.
  const { client, journal } = baseSimulee([], { erreurInsert: UNICITE });

  const resultat = await upserterMagasin(client as never, magasin);
  assert.equal(resultat.storeId, null);
  assert.match(resultat.erreur ?? "", /duplicate key/);
  assert.equal(journal.insertions, 0, "aucune seconde insertion");
  assert.equal(journal.lectures, 4, "exactement deux lectures avant, deux après");

  // Et le code ne contient aucune boucle de reprise.
  const source = sansCommentaires(BASE);
  assert.ok(!/while\s*\(/.test(source), "aucune boucle d'attente");
  assert.ok(!/for\s*\(/.test(source), "aucune boucle de reprise");
  // ⚠️ LE LITTÉRAL N'APPARAÎT QU'UNE FOIS : sa DÉFINITION. Toute comparaison
  // passe par la constante nommée — un `error.code !== "23505"` disséminé
  // rendrait invisible, le jour où il faudrait le changer, qu'il y en a deux.
  assert.equal(
    (source.match(/"23505"/g) ?? []).length,
    1,
    "le code d'erreur ne doit être écrit qu'à un seul endroit : sa constante",
  );
  assert.match(source, /VIOLATION_UNICITE/, "les comparaisons passent par la constante nommée");
});

/* ══════════════════════════════════════════════════════════════════════════
   F ter — L'ENREGISTREMENT DU CHOIX, SOUS LES PRIVILÈGES RÉELS DE C4.2
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un client qui APPLIQUE les privilèges de colonnes de C4.2.
 *
 * ⚠️ CE N'EST PAS UNE IMITATION DE COMPLAISANCE. Les trois règles ci-dessous
 * sont celles que `supabase/tests/courses_c4_3a_selection_checklist.sql` a
 * MESURÉES sur un vrai PostgreSQL, sous le rôle `authenticated` :
 *
 *   · `update` ne peut nommer que `store_id` ;
 *   · `insert` ne peut nommer que `student_id` et `store_id` ;
 *   · un `upsert` PostgREST engendre `DO UPDATE SET col = EXCLUDED.col` pour
 *     CHAQUE colonne du corps (lu dans `QueryBuilder.hs`), donc `student_id` —
 *     et PostgreSQL refuse à la PLANIFICATION, même sans conflit.
 *
 * Toute infraction rend `42501`, exactement comme le moteur. Le harnais ne
 * cherche donc pas le mot « upsert » dans le code : il exerce l'appel contre
 * le contrat de privilège, et l'appel échoue s'il est mal formé.
 */
function basePrivilegiee(
  lignes: Array<Record<string, unknown>> = [],
  options: { readonly unicite?: boolean; readonly semerAvantRattrapage?: Record<string, unknown> } = {},
) {
  const REFUS = { code: "42501", message: "permission denied for table student_selected_store" };
  const COLONNES_UPDATE = new Set(["store_id"]);
  const COLONNES_INSERT = new Set(["student_id", "store_id"]);
  const journal = { updates: 0, inserts: 0, refusPrivilege: 0 };
  const table = lignes;
  let uniciteDejaJouee = false;

  const client = {
    from() {
      const filtres: Array<[string, unknown]> = [];
      let mode: "update" | "insert" | "upsert" | null = null;
      let charge: Record<string, unknown> = {};
      const executer = () => {
        if (mode === "upsert") {
          // PostgREST : toutes les colonnes du corps passent par le DO UPDATE.
          const horsPrivilege = Object.keys(charge).filter((c) => !COLONNES_UPDATE.has(c));
          if (horsPrivilege.length > 0) {
            journal.refusPrivilege += 1;
            return { data: null, error: REFUS };
          }
        }
        if (mode === "update") {
          const horsPrivilege = Object.keys(charge).filter((c) => !COLONNES_UPDATE.has(c));
          if (horsPrivilege.length > 0) {
            journal.refusPrivilege += 1;
            return { data: null, error: REFUS };
          }
          journal.updates += 1;
          const touchees = table.filter((l) => filtres.every(([c, v]) => l[c] === v));
          for (const ligne of touchees) {
            Object.assign(ligne, charge);
            // Le trigger `set_updated_at` de C4.2, rejoué : la date est écrite
            // par la BASE, quoi que l'appelant ait fourni.
            ligne.updated_at = `maj-${journal.updates}`;
          }
          return { data: touchees.map((l) => ({ student_id: l.student_id })), error: null };
        }
        if (mode === "insert") {
          const horsPrivilege = Object.keys(charge).filter((c) => !COLONNES_INSERT.has(c));
          if (horsPrivilege.length > 0) {
            journal.refusPrivilege += 1;
            return { data: null, error: REFUS };
          }
          if (options.unicite && !uniciteDejaJouee) {
            uniciteDejaJouee = true;
            if (options.semerAvantRattrapage) table.push(options.semerAvantRattrapage);
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          }
          journal.inserts += 1;
          table.push({ ...charge, updated_at: "insert" });
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      const builder = {
        update(v: Record<string, unknown>) {
          mode = "update";
          charge = v;
          return builder;
        },
        insert(v: Record<string, unknown>) {
          mode = "insert";
          charge = v;
          return builder;
        },
        upsert(v: Record<string, unknown>) {
          mode = "upsert";
          charge = v;
          return builder;
        },
        eq(c: string, v: unknown) {
          filtres.push([c, v]);
          return builder;
        },
        select() {
          return builder;
        },
        then(resolve: (r: unknown) => void) {
          resolve(executer());
        },
      };
      return builder;
    },
  };
  return { client, table, journal };
}

const ELEVE = "eleve-1";

await test("C4.3a-26 — A · aucune ligne : le magasin A est enregistré", async () => {
  const { enregistrerMagasinChoisi } = await import("../../lib/supabase/magasins");
  const { client, table, journal } = basePrivilegiee();
  const r = await enregistrerMagasinChoisi(client as never, ELEVE, "store-A");
  assert.equal(r.ok, true, r.erreur ?? "");
  assert.equal(journal.refusPrivilege, 0, "aucun ordre ne doit heurter un privilège");
  assert.equal(journal.inserts, 1);
  assert.equal(table.length, 1);
  assert.equal(table[0].store_id, "store-A");
});

await test("C4.3a-27 — B et C · changement A → B : update(store_id) seul, une seule ligne", async () => {
  const { enregistrerMagasinChoisi } = await import("../../lib/supabase/magasins");
  const { client, table, journal } = basePrivilegiee([
    { student_id: ELEVE, store_id: "store-A", updated_at: "initial" },
  ]);
  const r = await enregistrerMagasinChoisi(client as never, ELEVE, "store-B");
  assert.equal(r.ok, true, r.erreur ?? "");
  assert.equal(journal.refusPrivilege, 0, "c'est ICI que l'ancien upsert échouait");
  assert.equal(journal.inserts, 0, "aucune insertion : la ligne existait");
  assert.equal(journal.updates, 1, "un seul ordre");
  assert.equal(table.length, 1, "une seule ligne pour cet élève");
  assert.equal(table[0].store_id, "store-B");
});

await test("C4.3a-28 — D · updated_at est renouvelée par la BASE, jamais nommée", async () => {
  const { enregistrerMagasinChoisi } = await import("../../lib/supabase/magasins");
  const { client, table } = basePrivilegiee([
    { student_id: ELEVE, store_id: "store-A", updated_at: "initial" },
  ]);
  await enregistrerMagasinChoisi(client as never, ELEVE, "store-B");
  assert.notEqual(table[0].updated_at, "initial", "la date doit avoir été renouvelée");
  // ⚠️ ET LE CODE NE LA NOMME PAS. Si elle figurait dans la charge, le client
  // privilégié l'aurait refusée — c'est le journal des refus qui le dit.
  assert.ok(!/updated_at/.test(sansCommentaires(BASE).split("enregistrerMagasinChoisi")[1] ?? ""),
    "l'enregistrement ne doit jamais nommer updated_at");
});

await test("C4.3a-29 — E · course perdue : 23505 puis UN update de rattrapage", async () => {
  const { enregistrerMagasinChoisi } = await import("../../lib/supabase/magasins");
  const { client, table, journal } = basePrivilegiee([], {
    unicite: true,
    semerAvantRattrapage: { student_id: ELEVE, store_id: "store-concurrent", updated_at: "concurrent" },
  });
  const r = await enregistrerMagasinChoisi(client as never, ELEVE, "store-B");
  assert.equal(r.ok, true, "une course perdue n'est pas une erreur");
  assert.equal(journal.updates, 2, "un update initial, puis UN SEUL rattrapage");
  assert.equal(journal.inserts, 0);
  assert.equal(table.length, 1, "aucun doublon");
  assert.equal(table[0].store_id, "store-B");
});

await test("C4.3a-30 — F et G · toute autre erreur, et un rattrapage qui échoue", async () => {
  const { enregistrerMagasinChoisi } = await import("../../lib/supabase/magasins");

  // F. Une erreur autre que 23505 : aucun rattrapage.
  const priveDInsert = basePrivilegiee();
  const brut = priveDInsert.client.from;
  priveDInsert.client.from = () => {
    const b = brut() as unknown as Record<string, unknown>;
    const insertOrigine = b.insert as (v: unknown) => unknown;
    b.insert = (v: unknown) => {
      insertOrigine(v);
      return {
        then: (r: (x: unknown) => void) =>
          r({ data: null, error: { code: "23503", message: "foreign key violation" } }),
      };
    };
    return b as never;
  };
  const f = await enregistrerMagasinChoisi(priveDInsert.client as never, ELEVE, "store-inconnu");
  assert.equal(f.ok, false);
  assert.match(f.erreur ?? "", /foreign key/);
  assert.equal(priveDInsert.journal.updates, 1, "un seul update : aucun rattrapage sur 23503");

  // G. 23505, mais le rattrapage ne trouve toujours rien : on s'arrête.
  const sansLigne = basePrivilegiee([], { unicite: true });
  const g = await enregistrerMagasinChoisi(sansLigne.client as never, ELEVE, "store-B");
  assert.equal(g.ok, false, "la base se contredit : on remonte l'erreur d'origine");
  assert.match(g.erreur ?? "", /duplicate key/);
  assert.equal(sansLigne.journal.updates, 2, "exactement deux updates, jamais un troisième");
});

await test("C4.3a-31 — H · student_id n'est JAMAIS modifié, et aucune boucle n'existe", async () => {
  const source = sansCommentaires(BASE);
  const bloc = source.split("enregistrerMagasinChoisi")[1] ?? "";
  assert.ok(!/while\s*\(/.test(bloc) && !/for\s*\(/.test(bloc), "aucune boucle de reprise");
  // Le seul endroit où `student_id` apparaît en écriture est l'INSERT, où il
  // est légitime — jamais dans une charge d'`update`.
  assert.ok(
    !/update\([^)]*student_id/.test(source),
    "aucun update ne doit nommer student_id : C4.2 ne l'accorde pas",
  );
});

await test("C4.3a-32 — la checklist SQL du chemin de sélection existe et couvre le contrat", () => {
  const checklist = lireOuVide("../../supabase/tests/courses_c4_3a_selection_checklist.sql");
  assert.notEqual(checklist, "", "la preuve moteur doit exister : les mocks ne suffisent pas ici");
  for (const scenario of [
    "42501",
    "excluded.student_id",
    "update(store_id) seul",
    "ÉTAPE 1",
    "ÉTAPE 2",
    "updated_at",
    "INSERT de authenticated",
  ]) {
    assert.ok(checklist.includes(scenario), `la checklist ne couvre pas « ${scenario} »`);
  }
  assert.match(checklist, /rollback/i, "elle doit se terminer par un ROLLBACK");
});

/* ══════════════════════════════════════════════════════════════════════════
   G — C4.3a-PERIMETRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-PERIMETRE — la position de l'ÉLÈVE ne se dépose nulle part", () => {
  // ⚠️ CE CONTRÔLE DISTINGUE LE MAGASIN DE LA PERSONNE, et c'est tout son
  // intérêt : `stores.lat` / `stores.lon` sont LÉGITIMES — ce sont les
  // coordonnées d'un commerce, c'est-à-dire d'un lieu public. Interdire
  // naïvement le mot « lat » ferait rougir C4.2, qui est committé et correct.
  const POSITIONS_UTILISATEUR = [
    "student_lat", "student_lon", "user_lat", "user_lon",
    "current_lat", "current_lon", "location_lat", "location_lon",
    "studentLat", "studentLon", "userLat", "userLon",
  ];
  // 1. Aucune migration du dépôt ne porte une telle colonne.
  const dossier = new URL("../../supabase/migrations/", import.meta.url);
  for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(fichier, dossier), "utf8").replace(/--.*$/gm, " ");
    for (const mot of POSITIONS_UTILISATEUR) {
      assert.ok(!new RegExp(`\\b${mot}\\b`, "i").test(sql), `${fichier} porte ${mot}`);
    }
  }
  // 2. Aucun fichier du lot ne persiste la position reçue.
  for (const [i, source] of LOT_C4_3A.entries()) {
    const code = sansCommentaires(source);
    for (const mot of POSITIONS_UTILISATEUR) {
      assert.ok(!new RegExp(`\\b${mot}\\b`).test(code), `${NOMS_LOT[i]} nomme ${mot}`);
    }
    for (const stockage of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
      assert.ok(!code.includes(stockage), `${NOMS_LOT[i]} utilise ${stockage}`);
    }
  }
  // 3. Et la position ne part JAMAIS vers notre serveur par l'URL — un GET
  //    laisserait lat/lon dans les journaux, l'historique et le `Referer`.
  const ui = sansCommentaires(UI);
  assert.ok(!/\?lat=|&lat=|`\/api[^`]*lat/.test(ui), "la position ne doit pas voyager en chaîne de requête");
  assert.match(ui, /method:\s*["']POST["']/, "la recherche doit être un POST vers notre route");
});

await test("C4.3a-PERIMETRE — aucun appel Open Prices depuis le client", () => {
  const ui = sansCommentaires(UI);
  assert.ok(!/openfoodfacts\.org/.test(ui), "le composant ne doit pas connaître l'URL de l'amont");
  assert.ok(!/nearby\?|radius_km/.test(ui), "le composant ne construit aucune requête amont");
  assert.match(ADAPTATEUR, /^import "server-only";/m, "l'adaptateur doit être server-only");
  // Et le composant client ne l'importe pas.
  assert.ok(!ui.includes("open-prices"), "un composant client ne peut pas importer la couche serveur");
});

await test("C4.3a-PERIMETRE — ni prix, ni disponibilité, ni conditionnement, ni comparaison", () => {
  const INTERDITS: ReadonlyArray<readonly [string, string]> = [
    ["price", "C4.4"], ["prix", "C4.4"], ["cents", "C4.4"], ["milli", "C4.4"],
    ["currency", "C4.4"], ["discount", "C4.4"], ["promo", "C4.4"],
    ["stock", "aucun lot : la donnée n'existe pas"],
    ["availab", "aucun lot : la donnée n'existe pas"],
    ["disponib", "aucun lot : la donnée n'existe pas"],
    ["inventor", "aucun lot : la donnée n'existe pas"],
    ["ceil(", "C4.5"], ["compare", "C4.7"],
    ["osm_address_city__like", "C4.3b"],
  ];
  /**
   * ⚠️ ON RETIRE D'ABORD LE NOM DU SERVICE. « Open Prices » contient le mot
   * `price` sans être un montant : `OPEN_PRICES_BASE_URL`, `lib/open-prices/…`,
   * `prices.openfoodfacts.org`. Sans ce dépouillement, ce contrôle accuserait
   * l'adaptateur de faire des prix parce qu'il nomme la source — un rouge pour
   * une raison fausse, et le réflexe suivant serait de retirer le mot de la
   * liste, donc de perdre la garantie réelle.
   */
  const sansNomDeService = (source: string) =>
    source
      .replace(/prices\.openfoodfacts\.org/gi, "«source»")
      .replace(/open[-_]prices/gi, "«source»")
      .replace(/OPEN_PRICES/g, "«SOURCE»");

  const coupables: string[] = [];
  for (const [i, source] of LOT_C4_3A.entries()) {
    const code = sansNomDeService(sansProseAffichee(source));
    for (const [mot, lot] of INTERDITS) {
      if (new RegExp(mot.replace("(", "\\("), "i").test(code)) coupables.push(`${NOMS_LOT[i]} : ${mot} (→ ${lot})`);
    }
  }
  assert.deepEqual(coupables, [], `C4.3a a débordé : ${coupables.join(" | ")}`);
});

await test("C4.3a-PERIMETRE — budget-courses.ts et le lot C4.2 sont intacts", () => {
  const sceau = (chemin: string) =>
    createHash("sha256").update(lire(chemin)).digest("hex").slice(0, 16);
  assert.equal(sceau("../../lib/nutrition/budget-courses.ts"), "becd06ded213d14a", "budget-courses.ts modifié");
  assert.equal(
    sceau("../../supabase/migrations/20260918090000_c4_2_magasins.sql"),
    "8d91ff3b04b7f88f",
    "la migration C4.2 est FIGÉE : toute correction serait une NOUVELLE migration",
  );
});

await test("C4.3a-PERIMETRE — AUCUNE migration nouvelle : C4.2 suffit", () => {
  // C4.3a n'ajoute ni table, ni colonne, ni contrainte : `stores` et
  // `student_selected_store` portent déjà tout ce dont la découverte a besoin.
  verifierContratDesMigrations(assert);
  verifierManifesteDesMigrations(assert);
  assert.equal(MIGRATION_C4_2, "20260918090000_c4_2_magasins.sql");
});

/* ══════════════════════════════════════════════════════════════════════════
   H — LES ROUTES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-20 — la recherche n'écrit RIEN : chercher n'est pas choisir", () => {
  const code = sansCommentaires(ROUTE_NEARBY);
  for (const ecriture of [".insert(", ".upsert(", ".update(", ".delete(", "createSupabaseAdminClient"]) {
    assert.ok(!code.includes(ecriture), `la route de recherche fait ${ecriture} : une recherche ne persiste rien`);
  }
});

await test("C4.3a-21 — les deux routes exigent une session élève", () => {
  for (const [nom, code] of [
    ["nearby", sansCommentaires(ROUTE_NEARBY)],
    ["select", sansCommentaires(ROUTE_SELECT)],
  ] as const) {
    assert.match(code, /createSupabaseServerClient/, `${nom} doit ouvrir un client serveur authentifié`);
    assert.match(code, /auth\.getUser\(\)/, `${nom} doit exiger un utilisateur`);
    assert.match(code, /status:\s*401/, `${nom} doit répondre 401 sans session`);
    assert.match(code, /students/, `${nom} doit dériver l'élève de la session, jamais du corps`);
    assert.ok(!/body\.studentId|body\.student_id/.test(code), `${nom} lit l'élève dans le corps`);
    assert.match(code, /consumeRateLimit/, `${nom} doit être limitée en débit`);
  }
});

await test("C4.3a-22 — la route de recherche valide TOUT côté serveur", () => {
  const code = sansCommentaires(ROUTE_NEARBY);
  assert.match(code, /magasinsProchesBodySchema/, "l'entrée doit passer par le schéma strict");
  assert.match(code, /status:\s*400/, "une entrée invalide doit être refusée");
  // Ni la taille de page ni le nombre de pages ne peuvent venir du client.
  for (const dicte of ["size", "page", "pageSize", "pages"]) {
    assert.ok(
      !new RegExp(`body\\.${dicte}\\b`).test(code),
      `le client dicte ${dicte} : la pagination doit rester la nôtre`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   I — L'INTERFACE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3a-24 — l'écran Courses MONTE réellement le composant", () => {
  // ⚠️ CE TEST EXISTE PARCE QU'UN COMPOSANT ORPHELIN EST UN LOT NON LIVRÉ.
  // Tout le reste peut être vert — routes, filtrage, sécurité — sans qu'aucun
  // élève ne puisse jamais choisir un magasin. Il rougit dès que le composant
  // est décroché de l'écran.
  assert.notEqual(ECRAN_COURSES, "", "l'écran Courses doit exister");
  const code = sansCommentaires(ECRAN_COURSES);
  assert.match(
    code,
    /import \{ ChoixMagasinProche \} from "@\/components\/student\/ChoixMagasinProche"/,
    "l'écran doit importer le composant",
  );
  assert.match(code, /<ChoixMagasinProche\b/, "l'écran doit RENDRE le composant, pas seulement l'importer");
  assert.match(code, /studentId=\{/, "le composant doit recevoir l'identité de l'élève");

  // ⚠️ ET IL EST MONTÉ DANS LA PAGE, PAS DANS `ListeDeCoursesParcours` : ce
  // dernier est sous UX-24, qui lui interdit littéralement le mot « magasin ».
  const parcours = lire("../../components/student/ListeDeCoursesParcours.tsx");
  for (const mot of ["magasin", "store", "ChoixMagasinProche"]) {
    assert.ok(!new RegExp(mot, "i").test(parcours), `ListeDeCoursesParcours nomme « ${mot} » : UX-24 rougirait`);
  }
});

await test("C4.3a-25 — le magasin actuel est lu par le MÉCANISME du lot, sans duplication", () => {
  const code = sansCommentaires(UI);
  assert.match(code, /lireMagasinChoisi/, "le composant doit réutiliser la lecture de C4.3a");
  assert.match(code, /createSupabaseBrowserClient/, "sous la RLS de l'élève, comme les autres écrans");
  // Aucune requête maison : pas de `.from("student_selected_store")` recopié.
  assert.ok(
    !/\.from\(/.test(code),
    "le composant ne doit pas refaire la requête à la main : la logique vit dans lib/supabase/magasins",
  );
  // Et cette lecture ne demande AUCUNE permission.
  const bloc = /useEffect\([\s\S]{0,600}?\}, \[studentId\]\);/.exec(code)?.[0] ?? "";
  assert.ok(bloc !== "", "la lecture doit se faire dans un effet dépendant de studentId");
  assert.ok(!/getCurrentPosition/.test(bloc), "aucune géolocalisation au montage");
});

await test("C4.3a-23 — la permission n'est demandée qu'au geste, et tous les états existent", () => {
  const code = sansCommentaires(UI);
  assert.match(code, /navigator\.geolocation/, "la géolocalisation navigateur doit être utilisée");
  // Elle n'est PAS demandée au montage — même doctrine que le scanner A4.
  // ⚠️ `[\s\S]` plutôt que le drapeau `s` : la cible TypeScript du dépôt est
  // antérieure à ES2018, et `tsc` refuse ce drapeau. La classe explicite dit
  // exactement la même chose et compile partout.
  assert.ok(
    !/useEffect\([^)]*\)[\s\S]{0,80}getCurrentPosition/.test(code),
    "la permission ne doit pas être demandée au chargement de l'écran",
  );
  for (const etat of [
    "inactif", "demande_permission", "chargement", "permission_refusee",
    "indisponible", "expire", "aucun_resultat", "erreur", "succes",
  ]) {
    assert.ok(code.includes(etat), `l'état « ${etat} » doit être traité explicitement`);
  }
  // ⚠️ LE REPLI MANUEL N'EST PAS ENCORE ÉCRIT : l'écran le DIT, il ne le fait pas.
  assert.ok(!/code postal|codePostal|osm_address_city/i.test(sansCommentaires(UI)), "C4.3b n'est pas commencé");
});
