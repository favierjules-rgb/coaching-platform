/**
 * Harnais — COURSES C4.3b : LA RECHERCHE MANUELLE PAR VILLE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'un élève qui refuse la géolocalisation a un vrai chemin ; que ce chemin
 * n'invente NI distance, NI code postal, NI géocodeur ; qu'il applique
 * EXACTEMENT les règles commerciales et d'identité de C4.3a sans les réécrire ;
 * et qu'il choisit son magasin par la route de sélection déjà validée, pas par
 * une seconde écriture parallèle.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Transport injecté, fixtures.
 *
 * Lancement : npm run test:magasins-c4-3b
 *             (NODE_OPTIONS="--conditions=react-server")
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
  PAYS_CODE,
  PAYS_NOM_AMONT,
  VILLE_LONGUEUR_MAX,
  VILLE_LONGUEUR_MIN,
  VILLE_PAGES_MAX,
  VILLE_RESULTATS_CIBLE,
  VILLE_TAILLE_PAGE,
  type LieuBrut,
  magasinsParPertinenceVille,
  normaliserLieu,
  normaliserVille,
  retenirCandidats,
  villeValide,
} from "../../lib/nutrition/magasin-proche";
import { chercherMagasinsParVille } from "../../lib/open-prices/locations";

process.env.OPENFOODFACTS_USER_AGENT ??= "SETH-Tests/1.0 (tests@seth.invalid)";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const lireOuVide = (chemin: string) => {
  const url = new URL(chemin, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

const MODULE_PUR = lireOuVide("../../lib/nutrition/magasin-proche.ts");
const ADAPTATEUR = lireOuVide("../../lib/open-prices/locations.ts");
const SCHEMAS = lireOuVide("../../lib/api/schemas/magasins.ts");
const ROUTE_SEARCH = lireOuVide("../../app/api/student/stores/search/route.ts");
const ROUTE_SELECT = lireOuVide("../../app/api/student/stores/select/route.ts");
/*
 * ⚠️ L'INTERFACE DU SÉLECTEUR EST DÉSORMAIS DEUX FICHIERS, ET `UI` EST LEUR
 * SOMME.
 *
 * `ChoixMagasinProche` gardait tout : la ligne repliée, l'écriture du choix, ET
 * les deux recherches avec leurs treize états. La refonte a sorti la RECHERCHE
 * dans `RechercheDeCommerces` — deux modes nommés, un rayon réglable, des
 * suggestions de communes avec anti-rafale, et une carte.
 *
 * Les propriétés que cette suite mesure portent sur l'interface du sélecteur
 * PRISE DANS SON ENSEMBLE : « aucun fournisseur nommé côté client », « aucune
 * persistance de la position », « le champ dit Ville ». Les mesurer sur la
 * paire est donc exact — et plus strict qu'avant pour toutes les assertions
 * d'ABSENCE, qui balaient maintenant deux fois plus de code.
 */
const UI_LIGNE = lireOuVide("../../components/student/ChoixMagasinProche.tsx");
const UI_RECHERCHE = lireOuVide("../../components/student/RechercheDeCommerces.tsx");
const UI = `${UI_LIGNE}\n${UI_RECHERCHE}`;
const ECRAN = lireOuVide("../../app/(student)/nutrition/courses/page.tsx");

const LOT_C4_3B = [MODULE_PUR, ADAPTATEUR, SCHEMAS, ROUTE_SEARCH, UI_LIGNE, UI_RECHERCHE, ECRAN];
const NOMS_LOT = [
  "lib/nutrition/magasin-proche.ts",
  "lib/open-prices/locations.ts",
  "lib/api/schemas/magasins.ts",
  "app/api/student/stores/search/route.ts",
  "components/student/ChoixMagasinProche.tsx",
  "components/student/RechercheDeCommerces.tsx",
  "app/(student)/nutrition/courses/page.tsx",
];

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

/* ── fixtures : la forme RÉELLE d'un item /locations (SANS distance_km) ───── */

function lieuVille(p: { id: number; ville?: string; pays?: string; tag?: string; nom?: string }): LieuBrut {
  return {
    type: "OSM",
    osm_type: "NODE",
    osm_id: 20000 + p.id,
    osm_name: p.nom ?? `Commerce ${p.id}`,
    osm_brand: null,
    osm_tag_key: "shop",
    osm_tag_value: p.tag ?? "supermarket",
    osm_address_postcode: "38000",
    osm_address_city: p.ville ?? "Grenoble",
    osm_address_country: "France",
    osm_address_country_code: p.pays ?? "FR",
    osm_lat: 45.18 + p.id / 10000,
    osm_lon: 5.72 + p.id / 10000,
    id: p.id,
  } as LieuBrut;
}

function page(items: readonly LieuBrut[], numero: number, pages: number, total: number) {
  return { items, page: numero, pages, size: VILLE_TAILLE_PAGE, total };
}

function transportFixe(pagesJson: readonly unknown[], journal?: string[]) {
  let appels = 0;
  return async (url: string): Promise<Response> => {
    journal?.push(url);
    const corps = pagesJson[Math.min(appels, pagesJson.length - 1)];
    appels += 1;
    return new Response(JSON.stringify(corps), { status: 200 });
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   A — LA VALIDATION DE L'ENTRÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-01 — une ville vide, blanche, trop courte ou trop longue est REFUSÉE", () => {
  assert.equal(villeValide(""), false);
  assert.equal(villeValide("   "), false, "une chaîne blanche n'est pas une ville");
  assert.equal(villeValide("\t\n "), false);
  assert.equal(villeValide("a".repeat(VILLE_LONGUEUR_MIN - 1)), false, "trop courte");
  assert.equal(villeValide("a".repeat(VILLE_LONGUEUR_MAX + 1)), false, "trop longue");
  assert.equal(villeValide("a".repeat(VILLE_LONGUEUR_MIN)), true, "la borne basse est acceptée");
  assert.equal(villeValide("a".repeat(VILLE_LONGUEUR_MAX)), true, "la borne haute est acceptée");
  assert.equal(villeValide("Grenoble"), true);
  assert.equal(villeValide("  Saint-Étienne  "), true, "les espaces de bord sont tolérés, pas comptés");
  assert.equal(villeValide(42), false);
  assert.equal(villeValide(null), false);
  assert.ok(VILLE_LONGUEUR_MAX < 200, "une borne haute explicite et petite doit exister");
});

await test("C4.3b-02 — le pays est une CONSTANTE PRODUIT France, jamais un choix du client", async () => {
  // ⚠️ CE CONTRÔLE A CHANGÉ DE NATURE, ET C'EST LE POINT.
  //
  // Il vérifiait auparavant qu'un code ISO alpha-2 quelconque était accepté —
  // `BE` compris. C'était un FAUX SUPPORT : rien dans ce lot ne sait traduire
  // `BE` en ce que la source attend. Mesuré le 18/08/2026 : les commerces
  // belges portent `osm_address_country = "België / Belgique / Belgien"`.
  // « Belgium » n'y trouve rien. Une table ISO → nom serait une invention.
  //
  // C4.3b est donc une recherche manuelle FRANCE, et elle le dit.
  assert.equal(PAYS_CODE, "FR", "le code vérifié au retour");
  assert.equal(PAYS_NOM_AMONT, "France", "le nom envoyé à l'amont");

  // C — un corps qui porte un pays est REFUSÉ, pas ignoré en silence.
  const { magasinsParVilleBodySchema } = await import("../../lib/api/schemas/magasins");
  assert.equal(magasinsParVilleBodySchema.safeParse({ ville: "Grenoble" }).success, true);
  for (const avecPays of [
    { ville: "Grenoble", pays: "FR" },
    { ville: "Grenoble", pays: "BE" },
    { ville: "Grenoble", pays: "fr" },
    { ville: "Grenoble", countryCode: "FR" },
    { ville: "Grenoble", country: "France" },
    { ville: "Grenoble", osm_address_country__like: "Belgique" },
  ]) {
    assert.equal(
      magasinsParVilleBodySchema.safeParse(avecPays).success,
      false,
      `le corps accepte ${JSON.stringify(avecPays)} : le multi-pays serait prétendu`,
    );
  }

  // B + F — la route ne lit aucun pays, et n'en compose aucun depuis le corps.
  const route = sansCommentaires(ROUTE_SEARCH);
  for (const lu of ["pays", "country", "countryCode", "osm_address_country"]) {
    assert.ok(
      !new RegExp(`(parsed\\.data|body)\\.${lu}\\b`).test(route),
      `la route lit ${lu} dans le corps`,
    );
  }
  /*
   * Et le composant n'envoie aucun pays. Son corps a DEUX formes depuis
   * l'ajout de l'étape de géocodage, et aucune ne porte de pays :
   *   · `{ codeInsee }` — la commune CHOISIE dans les suggestions, le chemin
   *     normal, qui supprime l'ambiguïté des homonymes ;
   *   · `{ ville }`     — le repli, quand l'annuaire des communes est muet.
   */
  const ui = sansCommentaires(UI);
  assert.match(ui, /\{ codeInsee: commune\.code \}/, "le chemin normal : un code INSEE");
  assert.match(ui, /\{ ville: villeLibre\.trim\(\) \}/, "le repli : la ville seule");
  assert.ok(!/pays|country/i.test(ui.split("stores/search")[1]?.slice(0, 400) ?? ""), "aucun pays côté client");
  // ⚠️ ET LE SCHÉMA REFUSE UN CORPS VIDE : une recherche sans objet ferait
  // partir une requête Overpass pour rien.
  assert.equal(magasinsParVilleBodySchema.safeParse({}).success, false);
  assert.equal(magasinsParVilleBodySchema.safeParse({ codeInsee: "83137" }).success, true);
  assert.equal(magasinsParVilleBodySchema.safeParse({ codeInsee: "83" }).success, false);
});

await test("C4.3b-03 — aucun caractère joker ne traverse", () => {
  // L'amont fait un `icontains` : un `%` ou un `_` envoyé tel quel n'est pas
  // un joker SQL ici, mais rien ne justifie de laisser passer ces caractères,
  // et une future implémentation amont pourrait les interpréter.
  const code = sansCommentaires(MODULE_PUR);
  assert.match(code, /function normaliserVille/, "la normalisation doit exister");
  assert.equal(normaliserVille("  GRENOBLE  "), "grenoble");
  assert.equal(normaliserVille("Saint-Étienne"), "saint-etienne", "accents retirés pour la comparaison");
  assert.equal(normaliserVille("Bourg-lès-Valence"), "bourg-les-valence");
  assert.equal(normaliserVille("La   Roche"), "la roche", "espaces multiples réduits");
});

await test("C4.3b-03b — le corps est STRICT : le client ne dicte ni page, ni taille, ni tri", async () => {
  const { magasinsParVilleBodySchema } = await import("../../lib/api/schemas/magasins");
  assert.equal(magasinsParVilleBodySchema.safeParse({ ville: "Grenoble" }).success, true);
  assert.equal(magasinsParVilleBodySchema.safeParse({ ville: "Grenoble" }).success, true);

  // ⚠️ LE CŒUR DU CONTRÔLE. Chacune de ces clés donnerait au navigateur la
  // main sur le coût de l'appel chez un service bénévole.
  for (const pilote of [
    { ville: "Grenoble", size: 100 },
    { ville: "Grenoble", page: 5 },
    { ville: "Grenoble", pageSize: 100 },
    { ville: "Grenoble", ordering: "-price_count" },
    { ville: "Grenoble", price_count__gte: 1 },
    { ville: "Grenoble", osm_name__like: "carrefour" },
    { ville: "Grenoble", codePostal: "38000" },
  ]) {
    assert.equal(
      magasinsParVilleBodySchema.safeParse(pilote).success,
      false,
      `le corps accepte « ${Object.keys(pilote).filter((k) => k !== "ville").join(", ")} »`,
    );
  }
  for (const mauvais of [{}, { ville: "" }, { ville: "a" }, { ville: "a".repeat(200) }, { ville: 42 }, { ville: "Grenoble", pays: "FRA" }]) {
    assert.equal(magasinsParVilleBodySchema.safeParse(mauvais).success, false, JSON.stringify(mauvais));
  }

  // Et la route ne lit AUCUNE de ces clés dans le corps, même si elle arrivait.
  const code = sansCommentaires(ROUTE_SEARCH);
  for (const dicte of ["size", "page", "pageSize", "ordering", "priceCount"]) {
    assert.ok(
      !new RegExp(`(parsed\\.data|body)\\.${dicte}\\b`).test(code),
      `la route lit ${dicte} dans le corps`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   B — CE QUI PART VERS L'AMONT
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-04 — quatre paramètres partent, dont le pays, et rien du client", () => {
  const journal: string[] = [];
  return chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: transportFixe([page([], 1, 1, 0)], journal) },
  ).then(() => {
    const url = new URL(journal[0]);
    // A — les quatre, nommés.
    assert.equal(url.searchParams.get("osm_address_city__like"), "Grenoble");
    assert.equal(url.searchParams.get("osm_address_country__like"), "France");
    assert.equal(url.searchParams.get("size"), String(VILLE_TAILLE_PAGE));
    assert.equal(url.searchParams.get("page"), "1");
    // ⚠️ LA LISTE EXHAUSTIVE. Un paramètre de plus serait un canal par lequel
    // le navigateur piloterait Open Prices à travers SETH.
    assert.deepEqual(
      [...url.searchParams.keys()].sort(),
      ["osm_address_city__like", "osm_address_country__like", "page", "size"],
      "la requête sortante ne doit transporter que le contrat mesuré",
    );
    // B — aucun code ISO ne part : le filtre amont porte sur le NOM.
    assert.ok(!/country_code/.test(journal[0]), "aucun code pays ne part vers l'amont");
    assert.match(url.pathname, /\/api\/v1\/locations$/, "l'endpoint de recherche, pas /nearby");
  });
});

await test("C4.3b-04b — le nom du pays vient du serveur, jamais de la saisie", () => {
  // F — la preuve par l'injection : quoi que l'élève tape, le paramètre pays
  // reste `France`. Sans cela, une saisie bien choisie déplacerait la
  // recherche dans un pays que ce lot ne sait pas honorer.
  const journal: string[] = [];
  return chercherMagasinsParVille(
    { ville: "Grenoble&osm_address_country__like=Belgique" },
    { transport: transportFixe([page([], 1, 1, 0)], journal) },
  ).then(() => {
    const url = new URL(journal[0]);
    assert.deepEqual(
      url.searchParams.getAll("osm_address_country__like"),
      ["France"],
      "un seul pays, et c'est le nôtre",
    );
    // ⚠️ « Belgique » APPARAÎT BIEN DANS L'URL — ÉCHAPPÉ, dans la valeur de la
    // ville. C'est justement la preuve : `%26` et `%3D` ne sont ni un
    // séparateur ni un signe égal, donc la chaîne ne peut pas se refermer pour
    // ouvrir un second paramètre. Chercher l'absence du mot serait un contrôle
    // faux ; ce qu'on vérifie, c'est qu'il ne s'est pas ÉVADÉ de sa valeur.
    assert.ok(
      !/[?&]osm_address_country__like=Belgique/.test(journal[0]),
      "la saisie ne doit pas devenir un paramètre",
    );
    assert.match(journal[0], /Grenoble%26osm_address_country__like%3DBelgique/, "elle reste échappée");
    assert.equal(
      url.searchParams.get("osm_address_city__like"),
      "Grenoble&osm_address_country__like=Belgique",
      "la saisie reste une VALEUR, échappée, jamais une clé",
    );
  });
});

await test("C4.3b-04c — le pays borne la requête AVANT la pagination, pas après", () => {
  // ⚠️ LE DÉFAUT QUE CE CONTRÔLE INTERDIT DE REVENIR.
  //
  // Filtrer le pays uniquement chez nous laisse l'amont paginer sur le monde
  // entier. Ici, les trois pages consultées sont pleines de résultats
  // étrangers ; le magasin français est en page 4, hors de notre borne. Si le
  // filtre pays ne part pas à la source, l'écran conclut « aucun magasin »
  // alors qu'il en existe un.
  const journal: string[] = [];
  return chercherMagasinsParVille(
    { ville: "Valence" },
    {
      transport: transportFixe(
        [
          page([lieuVille({ id: 11, ville: "Valencia", pays: "ES" })], 1, 4, 4),
          page([lieuVille({ id: 12, ville: "Valencia", pays: "ES" })], 2, 4, 4),
          page([lieuVille({ id: 13, ville: "Valencia", pays: "ES" })], 3, 4, 4),
        ],
        journal,
      ),
    },
  ).then(() => {
    for (const url of journal) {
      assert.ok(
        new URL(url).searchParams.get("osm_address_country__like") === PAYS_NOM_AMONT,
        `une page part sans borne de pays : ${url}`,
      );
    }
  });
});

await test("C4.3b-05 — le pays est RECONFIRMÉ localement : défense en profondeur", () => {
  // D — l'amont a été borné sur le NOM du pays ; nous vérifions le CODE ISO au
  // retour. Les deux ne portent pas sur la même donnée, donc ce n'est pas un
  // doublon : si la source rend malgré tout un commerce hors de France — nom
  // de pays mal renseigné, graphie inattendue — il ne passe pas ici.
  const journal: string[] = [];
  const melange = [
    lieuVille({ id: 1, ville: "Valence", pays: "FR" }),
    lieuVille({ id: 2, ville: "Valencia", pays: "ES" }),
    lieuVille({ id: 3, ville: "Valence", pays: "FR" }),
  ];
  return chercherMagasinsParVille(
    { ville: "Valence" },
    { transport: transportFixe([page(melange, 1, 1, 3)], journal) },
  ).then((r) => {
    // E — le résultat français est conservé.
    assert.deepEqual(r.magasins.map((m) => m.opLocationId), [1, 3], "l'étranger est écarté chez nous");
    assert.ok(r.magasins.every((m) => m.countryCode === PAYS_CODE));
    // Et la borne amont était bien présente sur cette même requête.
    assert.equal(
      new URL(journal[0]).searchParams.get("osm_address_country__like"),
      PAYS_NOM_AMONT,
    );
  });
});

await test("C4.3b-05b — un pays absent ou vide au retour est écarté, pas supposé français", () => {
  const sansPays = { ...lieuVille({ id: 7, ville: "Valence", pays: "FR" }) } as Record<string, unknown>;
  delete sansPays.osm_address_country_code;
  return chercherMagasinsParVille(
    { ville: "Valence" },
    {
      transport: transportFixe([
        page([sansPays as LieuBrut, lieuVille({ id: 8, ville: "Valence", pays: "FR" })], 1, 1, 2),
      ]),
    },
  ).then((r) => {
    assert.deepEqual(
      r.magasins.map((m) => m.opLocationId),
      [8],
      "un code pays manquant n'est pas un code pays français",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C — LES RÈGLES DE C4.3a, RÉUTILISÉES ET NON RÉÉCRITES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-06 — même filtre commercial qu'en C4.3a : restaurant et librairie écartés", async () => {
  const r = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    {
      transport: transportFixe([
        page(
          [
            lieuVille({ id: 1, tag: "supermarket" }),
            lieuVille({ id: 2, tag: "books" }),
            { ...lieuVille({ id: 3 }), osm_tag_key: "amenity", osm_tag_value: "restaurant" } as LieuBrut,
            lieuVille({ id: 4, tag: "bakery" }),
          ],
          1,
          1,
          4,
        ),
      ]),
    },
  );
  assert.deepEqual(r.magasins.map((m) => m.opLocationId), [1, 4]);
});

await test("C4.3b-07 — la doctrine du filtre n'est PAS réécrite : une seule source", () => {
  // ⚠️ AUCUNE SECONDE LISTE DE VALEURS COMMERCIALES. Deux listes divergeraient
  // au premier ajout, et l'élève verrait un magasin en géoloc mais pas en
  // recherche manuelle — ou l'inverse.
  const code = sansCommentaires(MODULE_PUR);
  assert.equal(
    (code.match(/VALEURS_COMMERCE_ALIMENTAIRE\s*:/g) ?? []).length,
    1,
    "une seule déclaration de l'ensemble des commerces alimentaires",
  );
  assert.equal(
    (code.match(/function estCommerceAlimentaire/g) ?? []).length,
    1,
    "une seule fonction de filtrage commercial",
  );
  assert.equal(
    (code.match(/function normaliserLieu/g) ?? []).length,
    1,
    "une seule normalisation de lieu",
  );
  assert.equal(
    (code.match(/function retenirCandidats/g) ?? []).length,
    1,
    "une seule accumulation de candidats",
  );
});

await test("C4.3b-08 — aucune enseigne n'entre dans le filtrage manuel non plus", () => {
  const code = sansProseAffichee(MODULE_PUR + ADAPTATEUR + ROUTE_SEARCH);
  for (const enseigne of [
    "auchan", "carrefour", "leclerc", "intermarche", "lidl", "aldi",
    "casino", "monoprix", "franprix", "biocoop", "picard", "cora",
  ]) {
    assert.ok(!new RegExp(enseigne, "i").test(code), `le lot nomme « ${enseigne} »`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   D — L'IDENTITÉ, EXACTEMENT COMME EN C4.3a
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-09 — doublon exact fusionné, ambiguïtés retirées, y compris entre pages", async () => {
  // A. le même magasin deux fois.
  const a = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: transportFixe([page([lieuVille({ id: 5 }), lieuVille({ id: 5 })], 1, 1, 2)]) },
  );
  assert.equal(a.magasins.length, 1, "le doublon exact disparaît");

  // B. deux op_location_id pour le MÊME objet OSM → aucun des deux.
  const b = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    {
      transport: transportFixe([
        page(
          [
            { ...lieuVille({ id: 42 }), osm_type: "WAY", osm_id: 999 } as LieuBrut,
            { ...lieuVille({ id: 77 }), osm_type: "WAY", osm_id: 999 } as LieuBrut,
            lieuVille({ id: 3 }),
          ],
          1,
          1,
          3,
        ),
      ]),
    },
  );
  assert.deepEqual(b.magasins.map((m) => m.opLocationId), [3], "les deux variantes ambiguës sortent");

  // C. un op_location_id portant deux identités OSM → écarté.
  const c = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    {
      transport: transportFixe([
        page(
          [
            { ...lieuVille({ id: 42 }), osm_type: "WAY", osm_id: 111 } as LieuBrut,
            { ...lieuVille({ id: 42 }), osm_type: "NODE", osm_id: 222 } as LieuBrut,
            lieuVille({ id: 3 }),
          ],
          1,
          1,
          3,
        ),
      ]),
    },
  );
  assert.deepEqual(c.magasins.map((m) => m.opLocationId), [3]);

  // D. la collision révélée à la PAGE 2 retire aussi le retenu de la page 1.
  const p1 = page([{ ...lieuVille({ id: 42 }), osm_type: "WAY", osm_id: 999 } as LieuBrut], 1, 2, 2);
  const p2 = page([{ ...lieuVille({ id: 77 }), osm_type: "WAY", osm_id: 999 } as LieuBrut], 2, 2, 2);
  const d = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: transportFixe([p1, p2]) },
  );
  assert.deepEqual(d.magasins, [], "la page 2 retire le magasin retenu à la page 1");
});

/* ══════════════════════════════════════════════════════════════════════════
   E — LA PAGINATION, BORNÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-10 — première page vidée par le filtre, magasin trouvé en page 2", async () => {
  const journal: string[] = [];
  const p1 = page([lieuVille({ id: 1, tag: "books" }), lieuVille({ id: 2, tag: "toys" })], 1, 2, 3);
  const p2 = page([lieuVille({ id: 3 })], 2, 2, 3);
  const r = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: transportFixe([p1, p2], journal) },
  );
  assert.equal(journal.length, 2, "la deuxième page doit être lue");
  assert.deepEqual(r.magasins.map((m) => m.opLocationId), [3]);
});

await test("C4.3b-11 — jamais plus de VILLE_PAGES_MAX appels, et tronque le dit", async () => {
  const journal: string[] = [];
  const vide = page([lieuVille({ id: 1, tag: "books" })], 1, 99, 9900);
  const r = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: transportFixe([vide], journal) },
  );
  assert.equal(journal.length, VILLE_PAGES_MAX, `${journal.length} appels au lieu de ${VILLE_PAGES_MAX}`);
  assert.equal(r.magasins.length, 0);
  assert.equal(r.ok, true, "aucun résultat est un SUCCÈS, pas une panne");
  assert.equal(r.tronque, true, "la recherche a été écourtée, l'écran doit pouvoir le dire");
});

await test("C4.3b-12 — `tronque` : les cinq cas, comme en C4.3a", async () => {
  const beaucoup = (n: number) => Array.from({ length: n }, (_, i) => lieuVille({ id: i + 1 }));
  const ch = (corps: unknown) =>
    chercherMagasinsParVille({ ville: "Grenoble" }, { transport: transportFixe([corps]) });

  const a = await ch(page(beaucoup(VILLE_RESULTATS_CIBLE + 5), 1, 1, VILLE_RESULTATS_CIBLE + 5));
  assert.equal(a.magasins.length, VILLE_RESULTATS_CIBLE);
  assert.equal(a.tronque, true, "A — le plafond a coupé");

  const b = await ch(page(beaucoup(VILLE_RESULTATS_CIBLE), 1, 1, VILLE_RESULTATS_CIBLE));
  assert.equal(b.tronque, false, "B — tout a été rendu");

  const c = await ch(page(beaucoup(VILLE_RESULTATS_CIBLE), 1, 2, 200));
  assert.equal(c.tronque, true, "C — une page reste à lire");

  const e = await ch(page(beaucoup(3), 1, 1, 3));
  assert.equal(e.magasins.length, 3);
  assert.equal(e.tronque, false, "E — il n'y avait que trois magasins");
});

await test("C4.3b-12b — zéro résultat ET tronqué : l'état existe vraiment", async () => {
  // ⚠️ CE CAS N'EST PAS THÉORIQUE, ET C'EST POUR ÇA QU'IL A SA PREUVE.
  //
  // Trois pages consultées, aucun commerce exploitable dedans (un pont, une
  // librairie, un restaurant), et la source annonce encore des pages. Le
  // moteur rend donc légitimement `{ magasins: [], tronque: true }` : nous ne
  // savons PAS qu'il n'existe aucun magasin — nous savons seulement qu'il n'y
  // en avait aucun dans la portion consultée. L'écran doit dire cela, et non
  // l'absence.
  const inexploitable = (id: number) =>
    ({ ...lieuVille({ id }), osm_tag_key: "amenity", osm_tag_value: "restaurant" }) as LieuBrut;

  const r = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    {
      transport: transportFixe([
        page([inexploitable(1)], 1, 40, 40),
        page([inexploitable(2)], 2, 40, 40),
        page([inexploitable(3)], 3, 40, 40),
      ]),
    },
  );
  assert.equal(r.ok, true, "ce n'est pas une panne : la source a répondu");
  assert.equal(r.magasins.length, 0);
  assert.equal(r.tronque, true, "des pages restent : nous n'avons pas tout vu");
});

/* ══════════════════════════════════════════════════════════════════════════
   F — LES PANNES AMONT
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-13 — 429, 5xx, JSON illisible, timeout : panne, jamais « aucun magasin »", async () => {
  for (const code of [429, 500, 503]) {
    const r = await chercherMagasinsParVille(
      { ville: "Grenoble" },
      { transport: async () => new Response("", { status: code }) },
    );
    assert.equal(r.ok, false, `${code} doit être une panne`);
    assert.equal(r.magasins.length, 0);
  }
  const illisible = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: async () => new Response("<html>maintenance</html>", { status: 200 }) },
  );
  assert.equal(illisible.ok, false);

  const expire = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    {
      timeoutMs: 5,
      transport: (_u, init) =>
        new Promise((_r, rejeter) => init?.signal?.addEventListener("abort", () => rejeter(new Error("abort")))),
    },
  );
  assert.equal(expire.ok, false);
});

await test("C4.3b-14 — une ville inconnue rend une liste VIDE et un succès", async () => {
  // Mesuré sur l'amont : `{"items":[],"page":1,"pages":1,"size":10,"total":0}`,
  // en 200. « Je ne connais pas cette ville » n'est pas une erreur.
  const r = await chercherMagasinsParVille(
    { ville: "Villeinexistante" },
    { transport: transportFixe([page([], 1, 1, 0)]) },
  );
  assert.equal(r.ok, true);
  assert.equal(r.magasins.length, 0);
  assert.equal(r.tronque, false);
});

/* ══════════════════════════════════════════════════════════════════════════
   G — LE TRI ET LE DTO
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-15 — AUCUNE distance n'est inventée", () => {
  // ⚠️ UNE RECHERCHE PAR VILLE N'A PAS DE POINT DE DÉPART. Fabriquer une
  // distance — depuis le centre de la ville, depuis le premier résultat —
  // afficherait un nombre que rien ne fonde, et l'élève le croirait.
  const dto = normaliserLieu(lieuVille({ id: 1 }));
  assert.ok(dto, "un lieu sans distance_km doit rester exploitable");
  assert.equal(dto!.distanceKm, null, "la distance est ABSENTE, pas nulle ni zéro");
  // Et l'amont ne rend effectivement pas ce champ sur /locations.
  assert.ok(!("distance_km" in lieuVille({ id: 1 })), "la fixture reflète la réponse réelle");
});

await test("C4.3b-15b — la recherche par ville ne rend AUCUNE distance, bout en bout", async () => {
  // ⚠️ LE CONTRÔLE SUR LA SORTIE, PAS SEULEMENT SUR LA NORMALISATION. Une
  // distance fabriquée quelque part entre l'appel et le DTO — depuis le centre
  // de la ville, depuis un point arbitraire — passerait inaperçue si l'on ne
  // regardait que `normaliserLieu` isolément.
  const r = await chercherMagasinsParVille(
    { ville: "Grenoble" },
    { transport: transportFixe([page([lieuVille({ id: 1 }), lieuVille({ id: 2 })], 1, 1, 2)]) },
  );
  assert.equal(r.magasins.length, 2);
  for (const m of r.magasins) {
    assert.equal(m.distanceKm, null, `le magasin ${m.opLocationId} porte une distance inventée`);
  }
  // Et le code de la recherche ville ne nomme jamais `distance_km`.
  const bloc = sansCommentaires(ADAPTATEUR).split("chercherMagasinsParVille")[1] ?? "";
  assert.ok(!/distance/i.test(bloc), "la recherche par ville ne doit pas toucher à la distance");
});

await test("C4.3b-16 — tri : correspondance EXACTE de ville d'abord, puis ordre stable", () => {
  // ⚠️ L'AMONT FAIT UN `icontains` : chercher « Valence » ramène aussi
  // « Bourg-lès-Valence » — mesuré le 18/08/2026 (6 résultats, dont 2). On ne
  // les JETTE pas : ce sont de vrais commerces, et l'élève cherche peut-être
  // celui-là. On les range après, sans fabriquer de score de pertinence.
  const candidats = retenirCandidats(
    [
      lieuVille({ id: 3, ville: "Bourg-lès-Valence", nom: "Alpha" }),
      lieuVille({ id: 1, ville: "Valence", nom: "Zêta" }),
      lieuVille({ id: 2, ville: "Valence", nom: "Alpha" }),
    ],
    [],
  );
  const tries = magasinsParPertinenceVille(candidats, "valence");
  assert.deepEqual(
    tries.map((m) => m.opLocationId),
    [2, 1, 3],
    "exacte d'abord (triée par nom), approchante ensuite",
  );
  // Le tri est DÉTERMINISTE : deux exécutions, le même ordre.
  assert.deepEqual(
    magasinsParPertinenceVille(candidats, "valence").map((m) => m.opLocationId),
    tries.map((m) => m.opLocationId),
  );
});

await test("C4.3b-17 — le DTO reste celui de C4.3a, postcode compris, sans price_count", () => {
  const dto = normaliserLieu(lieuVille({ id: 1 }))!;
  assert.deepEqual(
    Object.keys(dto).sort(),
    [
      "brand", "city", "countryCode", "distanceKm", "lat", "lon",
      "name", "opLocationId", "osmId", "osmType", "postcode",
    ],
    "un seul DTO pour les deux chemins",
  );
  assert.equal(dto.postcode, "38000", "le code postal est AFFICHABLE, même s'il n'est pas cherchable");
  for (const interdit of ["priceCount", "price_count", "userCount", "proofCount"]) {
    assert.ok(!(interdit in (dto as object)), `${interdit} n'a aucune justification produit ici`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   H — LA SÉLECTION N'EST PAS RÉÉCRITE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-18 — un résultat manuel se choisit par la route /select de C4.3a", () => {
  /*
   * ⚠️ MESURÉ SUR LA LIGNE REPLIÉE SEULE, ET C'EST PLUS FORT. L'écriture est
   * restée dans `ChoixMagasinProche` : la recherche PROPOSE, elle n'écrit pas.
   * Balayer la paire laisserait passer un second appel à `/select` depuis
   * l'écran de recherche ; mesurer le seul fichier qui a le droit d'écrire
   * interdit ce second chemin.
   */
  const ui = sansCommentaires(UI_LIGNE);
  assert.ok(
    !/\/api\/student\/stores\/select/.test(sansCommentaires(UI_RECHERCHE)),
    "la recherche n'écrit rien : chercher n'est pas choisir",
  );
  assert.equal(
    (ui.match(/\/api\/student\/stores\/select/g) ?? []).length,
    1,
    "une seule route de sélection, appelée depuis un seul endroit",
  );
  // ⚠️ LE CORPS RESTE MINIMAL — C'EST UNE IDENTITÉ OSM DEPUIS C4.3c, ET C'EST
  // PLUS STRICT QU'AVANT : `opLocationId` n'est plus accepté du tout.
  assert.match(
    ui,
    /body: JSON\.stringify\(\{ osmType: magasin\.osmType, osmId: magasin\.osmId \}\)/,
    "le corps reste une désignation, jamais une description",
  );
  assert.ok(!/opLocationId/.test(ui), "l'écran ne manipule aucun identifiant Open Prices");
  // ⚠️ ON ISOLE LE CORPS DE `/select`, ON NE BALAIE PAS LE FICHIER. Le corps de
  // `/nearby` porte légitimement `lat` et `lon` : c'est la POSITION DE L'ÉLÈVE,
  // pas une description de magasin. Un balayage global accuserait la
  // géolocalisation d'être une falsification — et pousserait, pour obtenir du
  // vert, à casser la recherche.
  const appelSelect = /\/api\/student\/stores\/select[\s\S]{0,400}?\}\);/.exec(ui)?.[0] ?? "";
  assert.ok(appelSelect.length > 0, "l'appel de sélection doit être trouvable");
  for (const decrit of ["name:", "brand:", "lat:", "lon:", "city:", "postcode:", "Wikidata"]) {
    assert.ok(
      !appelSelect.includes(decrit),
      `l'écran ne doit pas décrire le magasin qu'il choisit : ${decrit}`,
    );
  }
  // ⚠️ AUCUNE SECONDE ÉCRITURE. Ni upsert, ni insert, ni table nommée.
  for (const ecriture of ["upserterMagasin", "enregistrerMagasinChoisi", "student_selected_store", "stores"]) {
    assert.ok(
      !new RegExp(`\\b${ecriture}\\b`).test(sansCommentaires(ROUTE_SEARCH)),
      `la route de recherche touche ${ecriture} : chercher n'est pas choisir`,
    );
  }

  /**
   * ⚠️ ET LE LOT COMPTE SES PROPRES ROUTES — LACUNE RÉELLE, FERMÉE ICI.
   *
   * Les contrôles ci-dessus lisent le composant et la route de recherche. Ils
   * ne voient donc PAS une seconde route de sélection posée AILLEURS : un
   * `stores/search/select-ville/route.ts` recopié depuis `/select` passait
   * intégralement au vert. Seul le garde-fou de C4.2 l'attrapait — c'est-à-dire
   * un autre lot, par ricochet, pour une faute qui est celle de C4.3b.
   *
   * La liste est NOMMÉE, chaque entrée porte son lot, et chaque dossier ne
   * contient que son handler : dupliquer la sélection devient impossible sans
   * faire rougir le lot qui l'aurait dupliquée.
   */
  const ROUTES_MAGASIN: ReadonlyArray<readonly [string, string]> = [
    ["communes", "COURSES — annuaire des communes, l'étape de géocodage"],
    ["nearby", "C4.3a — découverte géographique"],
    ["search", "C4.3b — recherche manuelle par ville"],
    ["select", "C4.3a — sélection, ET ELLE EST LA SEULE"],
  ];
  const dossierRoutes = new URL("../../app/api/student/stores/", import.meta.url);
  const routes = readdirSync(dossierRoutes).sort();
  assert.deepEqual(
    routes,
    ROUTES_MAGASIN.map(([r]) => r).sort(),
    `route de magasin non déclarée : ${routes.join(", ")}`,
  );
  for (const [route] of ROUTES_MAGASIN) {
    assert.deepEqual(
      readdirSync(new URL(`${route}/`, dossierRoutes)).sort(),
      ["route.ts"],
      `${route}/ doit ne contenir que son handler`,
    );
  }
});

await test("C4.3b-19 — la route de recherche n'écrit RIEN et n'a aucun client admin", () => {
  const code = sansCommentaires(ROUTE_SEARCH);
  for (const ecriture of [".insert(", ".upsert(", ".update(", ".delete(", "createSupabaseAdminClient"]) {
    assert.ok(!code.includes(ecriture), `la recherche fait ${ecriture}`);
  }
  assert.match(code, /createSupabaseServerClient/, "elle doit exiger une session");
  assert.match(code, /auth\.getUser\(\)/);
  assert.match(code, /status:\s*401/);
  assert.match(code, /consumeRateLimit/, "elle doit être limitée en débit");
});

/* ══════════════════════════════════════════════════════════════════════════
   I — C4.3b-PERIMETRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-PERIMETRE — aucun géocodeur, aucun fournisseur tiers ajouté", () => {
  // ⚠️ ON GARDE LES LITTÉRAUX ICI, ET C'EST TOUT L'INTÉRÊT. Une URL de
  // géocodeur vit forcément DANS une chaîne : la dépouiller reviendrait à
  // chercher exactement là où le problème ne peut pas être.
  const coupables: string[] = [];
  for (const [i, source] of LOT_C4_3B.entries()) {
    const code = sansCommentaires(source);
    for (const fournisseur of [
      "nominatim", "openstreetmap.org", "google", "maps.googleapis", "mapbox",
      "here.com", "geocod", "opencage", "photon", "algolia", "places",
    ]) {
      if (new RegExp(fournisseur, "i").test(code)) coupables.push(`${NOMS_LOT[i]} : ${fournisseur}`);
    }
  }
  assert.deepEqual(coupables, [], `un fournisseur externe a été introduit : ${coupables.join(" | ")}`);
});

await test("C4.3b-PERIMETRE — la ville saisie n'est PERSISTÉE nulle part", () => {
  for (const [i, source] of LOT_C4_3B.entries()) {
    const code = sansCommentaires(source);
    for (const stockage of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
      assert.ok(!code.includes(stockage), `${NOMS_LOT[i]} utilise ${stockage}`);
    }
    for (const colonne of ["last_city", "search_city", "derniere_ville", "ville_recherchee", "city_history"]) {
      assert.ok(!new RegExp(colonne, "i").test(code), `${NOMS_LOT[i]} nomme ${colonne}`);
    }
  }
  // Et aucune migration du dépôt ne porte une telle colonne.
  const dossier = new URL("../../supabase/migrations/", import.meta.url);
  for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(fichier, dossier), "utf8").replace(/--.*$/gm, " ");
    for (const colonne of ["last_city", "search_city", "derniere_ville", "city_history"]) {
      assert.ok(!new RegExp(colonne, "i").test(sql), `${fichier} porte ${colonne}`);
    }
  }
});

await test("C4.3b-PERIMETRE — aucune migration, aucune table, aucun débordement C4.4", () => {
  verifierContratDesMigrations(assert);
  verifierManifesteDesMigrations(assert);
  assert.equal(MIGRATION_C4_2, "20260918090000_c4_2_magasins.sql", "la dernière migration reste celle de C4.2");

  const sansNomDeService = (s: string) =>
    s.replace(/prices\.openfoodfacts\.org/gi, "«s»").replace(/open[-_]prices/gi, "«s»").replace(/OPEN_PRICES/g, "«S»");
  const coupables: string[] = [];
  for (const [i, source] of LOT_C4_3B.entries()) {
    const code = sansNomDeService(sansProseAffichee(source));
    for (const [mot, lot] of [
      ["price_cents", "C4.4"], ["priceCents", "C4.4"], ["price", "C4.4"], ["prix", "C4.4"],
      ["currency", "C4.4"], ["discount", "C4.4"], ["promo", "C4.4"],
      ["stock", "aucun lot"], ["availab", "aucun lot"], ["inventor", "aucun lot"],
      ["ceil(", "C4.5"], ["compare", "C4.7"],
      ["create table", "aucune migration"],
    ] as const) {
      if (new RegExp(mot.replace("(", "\\("), "i").test(code)) coupables.push(`${NOMS_LOT[i]} : ${mot} (→ ${lot})`);
    }
  }
  assert.deepEqual(coupables, [], `C4.3b a débordé : ${coupables.join(" | ")}`);
});

await test("C4.3b-PERIMETRE — C4.3a est intact dans ses invariants essentiels", () => {
  // ⚠️ CE LOT TOUCHE DES FICHIERS DE C4.3a. Ce contrôle vérifie que ce qui a
  // été validé au commit précédent tient toujours, invariant par invariant.
  const pur = sansCommentaires(MODULE_PUR);
  assert.match(pur, /RAYON_KM_MAX = 25/, "la borne de rayon de C4.3a");
  assert.match(pur, /NEARBY_PAGES_MAX = 3/, "la borne de pagination de C4.3a");
  assert.match(pur, /Number\.isSafeInteger\(valeur\) && valeur > 0/, "les identifiants sûrs");
  assert.match(pur, /TAG_CLE_COMMERCE = "shop"/, "la clé de tag commerciale");

  const adaptateur = sansCommentaires(ADAPTATEUR);
  assert.match(adaptateur, /^import "server-only";/m, "l'adaptateur reste server-only");
  assert.match(adaptateur, /AbortController/, "le timeout de C4.3a");
  assert.match(adaptateur, /statut: "indisponible"/, "les issues discriminées de C4.3a");

  const select = sansCommentaires(ROUTE_SELECT);
  // ⚠️ C4.3c A CHANGÉ L'AMONT DE LA RELECTURE, PAS SON PRINCIPE. Le serveur
  // relit toujours la fiche canonique avant d'écrire ; il la relit chez
  // OpenStreetMap au lieu d'Open Prices. L'invariant de C4.3a est donc suivi,
  // pas abandonné — et il est RESSERRÉ : le corps ne porte plus d'identifiant
  // amont du tout.
  assert.match(select, /lireElementCanonique/, "la relecture canonique au choix");
  assert.ok(!/parsed\.data\.opLocationId/.test(select), "aucun identifiant amont venu du client");
  assert.match(select, /createSupabaseAdminClient/, "l'écriture serveur du catalogue");

  // budget-courses.ts scellé, comme dans les deux lots précédents.
  assert.equal(
    createHash("sha256").update(lire("../../lib/nutrition/budget-courses.ts")).digest("hex").slice(0, 16),
    "becd06ded213d14a",
    "budget-courses.ts a été modifié",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   J — L'INTERFACE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.3b-20 — le champ manuel dit « Ville », jamais « code postal »", () => {
  // ⚠️ L'AMONT N'EXPOSE AUCUN FILTRE POSTAL — vérifié dans `LocationFilter` le
  // 18/08/2026. Écrire « Ville ou code postal » promettrait une recherche que
  // rien ne peut honorer, et l'élève conclurait que l'application est cassée.
  /*
   * ⚠️ CE CONTRÔLE DISTINGUE MAINTENANT DEUX CHOSES QU'IL CONFONDAIT, ET LA
   * DISTINCTION ÉTAIT DÉJÀ DANS SON PROPRE COMMENTAIRE : « le code postal
   * reste AFFICHÉ dans les résultats, il n'est simplement pas cherchable. »
   *
   * Les suggestions de communes affichent désormais le code postal — c'est ce
   * qui permet de distinguer deux Saint-Martin. Ce qui reste interdit, c'est de
   * PROMETTRE une recherche par code postal : ni dans le libellé du champ, ni
   * dans son indication de saisie, ni dans le corps envoyé au serveur.
   */
  const code = sansCommentaires(UI);

  // A — le libellé du champ dit « Commune » ou « Ville », jamais « code postal ».
  const libelle = /<label htmlFor="commerce-ville"[\s\S]{0,300}?<\/label>/.exec(code)?.[0] ?? "";
  assert.notEqual(libelle, "", "le champ doit porter un libellé");
  assert.ok(!/code postal/i.test(libelle), "le libellé ne promet pas le code postal");
  assert.match(code, /Commune|Ville/, "le champ s'appelle Commune (ou Ville)");

  // B — l'indication de saisie ne propose que des noms de commune.
  const indication = /placeholder="([^"]*)"/.exec(code)?.[1] ?? "";
  assert.ok(!/\d{5}/.test(indication), `l'exemple de saisie ne doit pas montrer un code postal : ${indication}`);

  // C — et aucun code postal ne part dans un corps de recherche. Le serveur
  // résout la commune par son code INSEE ou par son nom, jamais par un postal.
  for (const corps of [/\{ codeInsee: commune\.code \}/, /\{ ville: villeLibre\.trim\(\) \}/]) {
    assert.match(code, corps, "les deux seules formes de corps admises");
  }
  assert.ok(!/codePostal:/.test(code.split("stores/search")[1]?.slice(0, 400) ?? ""),
    "aucun code postal dans le corps de recherche");

  // D — le schéma d'entrée le refuse aussi, et c'est la barrière qui compte.
  assert.ok(!/codePostal|code_postal/.test(sansCommentaires(SCHEMAS)),
    "le schéma n'accepte aucun champ postal");
});

await test("C4.3b-21 — la recherche manuelle n'appelle JAMAIS la géolocalisation", () => {
  /*
   * ⚠️ LA FONCTION A CHANGÉ DE NOM ET DE FICHIER — `chercherParVille` dans
   * `ChoixMagasinProche` est devenue `chercherCommune` dans
   * `RechercheDeCommerces`. La PROPRIÉTÉ, elle, est inchangée : le chemin
   * manuel ne doit toucher à aucune position, sinon un refus de
   * géolocalisation fermerait aussi ce chemin-là.
   */
  const code = sansCommentaires(UI_RECHERCHE);
  const bloc = /const chercherCommune = useCallback\([\s\S]{0,2400}?\n    \}, *\n?/.exec(code)?.[0] ?? "";
  assert.notEqual(bloc, "", "une fonction de recherche par commune doit exister");
  assert.ok(!/getCurrentPosition|geolocation/.test(bloc), "la recherche ville ne demande aucune position");
  assert.match(bloc, /\/api\/student\/stores\/search/, "elle passe par notre route");
  assert.match(bloc, /method: "POST"/, "en POST : la saisie ne va pas dans une chaîne de requête");
  // ⚠️ ET ELLE N'A AUCUN POINT DE DÉPART : en fabriquer un afficherait des
  // distances que rien ne fonde.
  assert.match(bloc, /setDepart\(null\)/, "aucune position inventée en mode ville");
});

/*
 * ⚠️ `blocGarde` A ÉTÉ RETIRÉ, ET C'EST UN PROGRÈS. Il extrayait un bloc JSX
 * sous sa condition pour prouver qu'un texte s'affichait au bon moment — la
 * seule méthode disponible quand la décision vivait au fond d'un composant.
 * Les messages de la recherche viennent maintenant de `messageDeSituation`,
 * une fonction pure : on EXÉCUTE la décision au lieu de relire sa garde, ce qui
 * prouve ce que l'élève lit et non ce qui est écrit dans le fichier.
 */

/** « Il n'en existe aucun » — les tournures définitives, celles qui mentent. */
/*
 * ⚠️ CES CINQ CONTRÔLES ONT CHANGÉ DE MÉTHODE, ET ILS Y GAGNENT.
 *
 * Ils lisaient les GARDES du JSX : `état === "ville_aucun_resultat" && tronqué`.
 * C'était la seule façon de mesurer la propriété quand elle vivait dans treize
 * états mêlés au fond d'un composant. La propriété, elle, n'a pas bougé :
 *
 *     quand la recherche a été ÉCOURTÉE, l'absence ne doit pas être affirmée.
 *
 * Elle vit maintenant dans `messageDeSituation` — une fonction PURE. On ne lit
 * donc plus une garde, on EXÉCUTE la décision. Une garde qu'on relit prouve
 * qu'un texte est écrit sous une condition ; une fonction qu'on appelle prouve
 * ce que l'élève LIT. C'est plus fort, et c'est moins fragile : renommer une
 * variable ne fera plus rougir ces tests.
 */
const AFFIRME_ABSENCE = /Aucun commerce cartographié/;

await test("C4.3b-22b — VILLE · 0 résultat + NON tronqué : l'absence peut être affirmée", async () => {
  const { messageDeSituation } = await import("../../lib/nutrition/recherche-commerces");
  const message = messageDeSituation("aucun_resultat", { mode: "ville", tronque: false });
  assert.ok(message !== null, "une absence constatée doit se dire");
  assert.match(message!.texte, AFFIRME_ABSENCE, "cas A : là, et là seulement, l'absence est vraie");
  // ⚠️ ET ELLE N'EST PAS UNE ERREUR. Une base collaborative incomplète n'est
  // pas une panne de la plateforme, et l'afficher en rouge le laisserait croire.
  assert.equal(message!.role, "status");
  assert.match(message!.texte, /collaborative/i, "l'élève sait POURQUOI c'est vide");
});

await test("C4.3b-22c — VILLE · 0 résultat + TRONQUÉ : rien n'est affirmé", async () => {
  const { messageDeSituation } = await import("../../lib/nutrition/recherche-commerces");
  const message = messageDeSituation("aucun_resultat", { mode: "ville", tronque: true });
  // ⚠️ CAS B — LE DÉFAUT CORRIGÉ. Nous n'avons vu qu'une portion : dire
  // « aucun commerce dans cette commune » ferait renoncer l'élève à un magasin
  // qui existe, sur la foi d'une mesure que nous n'avons pas faite.
  assert.ok(!AFFIRME_ABSENCE.test(message!.texte), "cas B : l'absence ne doit PAS être affirmée");
  assert.match(message!.texte, /premiers résultats consultés/, "il faut dire ce qui a été consulté");
  assert.match(message!.texte, /écourtée/, "et dire que la recherche a été écourtée");
  assert.match(message!.texte, /peut-être d'autres/, "et ne pas conclure");
});

await test("C4.3b-22d — 0 résultat : les deux cas sont mutuellement exclusifs", async () => {
  const { messageDeSituation } = await import("../../lib/nutrition/recherche-commerces");
  /*
   * ⚠️ IL N'EXISTE PLUS DE « TROISIÈME PORTE » POSSIBLE, et c'est désormais
   * structurel plutôt que surveillé. Le message définitif revenait auparavant
   * par un bloc JSX sans garde de troncature ; maintenant, une seule fonction
   * répond, et son résultat dépend du seul booléen `tronque`.
   */
  for (const mode of ["autour", "ville"] as const) {
    const franc = messageDeSituation("aucun_resultat", { mode, tronque: false })!;
    const prudent = messageDeSituation("aucun_resultat", { mode, tronque: true })!;
    assert.notEqual(franc.texte, prudent.texte, `${mode} : deux situations, deux phrases`);
    assert.ok(AFFIRME_ABSENCE.test(franc.texte), `${mode} : l'absence constatée est dicible`);
    assert.ok(!AFFIRME_ABSENCE.test(prudent.texte), `${mode} : l'absence supposée ne l'est pas`);
  }
});

await test("C4.3b-22e — résultats + tronqué : liste ET avertissement ; sinon liste seule", () => {
  const code = sansCommentaires(UI_RECHERCHE);
  // Cas C — l'avertissement existe à côté de la liste…
  assert.match(code, /\{tronque && \(/, "l'avertissement doit exister avec les résultats");
  assert.match(code, /Recherche écourtée/, "et dire que la recherche a été écourtée");
  // …et cas D — il est GARDÉ par `tronque`, donc absent quand tout a été rendu.
  assert.equal(
    (code.match(/Recherche écourtée/g) ?? []).length,
    1,
    "une seule occurrence : pas de variante inconditionnelle",
  );
  const avantLAvertissement = code.slice(0, code.indexOf("Recherche écourtée"));
  assert.ok(
    avantLAvertissement.lastIndexOf("{tronque && (") > avantLAvertissement.lastIndexOf("</p>"),
    "l'avertissement est bien sous la garde de troncature",
  );
});

await test("C4.3b-22f — NEARBY · 0 résultat + tronqué : C4.3a ne ment plus non plus", async () => {
  // ⚠️ CE N'EST PAS UNE MODIFICATION FONCTIONNELLE DE C4.3a. Le booléen
  // `tronque` était DÉJÀ calculé correctement par la découverte géographique ;
  // seul l'écran l'ignorait dès que la liste était vide.
  const { messageDeSituation } = await import("../../lib/nutrition/recherche-commerces");
  const franc = messageDeSituation("aucun_resultat", { mode: "autour", tronque: false })!;
  assert.match(franc.texte, /autour de toi/, "l'absence reste dicible quand elle est vraie");
  assert.ok(AFFIRME_ABSENCE.test(franc.texte));

  const prudent = messageDeSituation("aucun_resultat", { mode: "autour", tronque: true })!;
  assert.ok(!AFFIRME_ABSENCE.test(prudent.texte), "ne pas affirmer qu'il n'en existe aucun");
  assert.match(prudent.texte, /premiers résultats consultés/);
  assert.match(prudent.texte, /écourtée/);
});

await test("C4.3b-22 — tous les états de la recherche manuelle existent", async () => {
  /*
   * ⚠️ LES CINQ ÉTATS « ville_* » N'EXISTENT PLUS, ET LEUR DISPARITION EST LE
   * CORRECTIF. Ils mêlaient le MODE et la SITUATION dans une union de treize
   * valeurs : chaque ajout obligeait à relire les douze autres, et un chemin
   * d'erreur qui oubliait de poser son état laissait l'écran charger
   * indéfiniment.
   *
   * Ce qu'ils garantissaient est conservé, et séparé en deux questions :
   * le mode (`ModeRecherche`) et la situation (`Situation`).
   */
  const { MODES, SITUATIONS_DE_CHARGEMENT, enChargement, messageDeSituation, situationApres } =
    await import("../../lib/nutrition/recherche-commerces");

  assert.deepEqual(MODES.map((m) => m.id), ["autour", "ville"], "le mode est une question à part");

  // Chaque situation de la recherche par ville a son traitement explicite.
  for (const situation of [
    "chargement_ville",
    "aucun_resultat",
    "erreur",
    "permission_refusee",
    "position_indisponible",
    "position_expiree",
  ] as const) {
    const message = messageDeSituation(situation, { mode: "ville", tronque: false });
    assert.ok(message !== null && message.texte.trim() !== "", `« ${situation} » doit se dire`);
  }

  // ⚠️ ET AUCUNE ISSUE NE LAISSE UN CHARGEMENT EN COURS — l'invariant que les
  // treize états ne permettaient pas d'exprimer.
  for (const issue of [
    { type: "trouves", nombre: 0 },
    { type: "trouves", nombre: 4 },
    { type: "echec" },
    { type: "permission_refusee" },
    { type: "position_indisponible" },
    { type: "position_expiree" },
  ] as const) {
    assert.ok(!enChargement(situationApres(issue)), `${issue.type} ne doit pas rester en chargement`);
  }
  // ⚠️ QUATRE DEPUIS LA CORRECTION : `chargement_commune` a été ajoutée, pour
  // que la résolution d'une saisie en communes ait elle aussi un état qui se
  // termine. Voir `courses-commerces-fiabilite` pour la mesure complète.
  assert.equal(SITUATIONS_DE_CHARGEMENT.size, 4);

  // Le repli reste disponible quand la géolocalisation a été refusée : les deux
  // modes sont des onglets, pas une cascade.
  const code = sansCommentaires(UI_RECHERCHE);
  assert.ok(
    !/permission_refusee[\s\S]{0,400}return null/.test(code),
    "un refus de géolocalisation ne doit pas masquer le champ manuel",
  );
  assert.match(code, /role="tablist"/, "les deux modes sont offerts côte à côte");
});

await test("C4.3b-23 — le composant reste monté, et le repli manuel reste offert", () => {
  // ⚠️ LE PROPRIÉTAIRE A CHANGÉ — voir C4.3a-24. Le sélecteur vit désormais
  // dans la zone PRIX OBSERVÉS et non plus en tête de `courses/page.tsx`.
  const proprietaire = sansCommentaires(
    lireOuVide("../../components/student/ListeDeCoursesPersistante.tsx"),
  );
  assert.match(proprietaire, /<ChoixMagasinProche\b/, "le composant reste monté");
  assert.ok(
    !/<ChoixMagasinProche\b/.test(sansCommentaires(ECRAN)),
    "et il n'est pas monté deux fois",
  );

  // ⚠️ ET LE CHAMP VILLE N'EST PAS DEVENU UN SECOURS. Le panneau se replie,
  // mais quand il est ouvert la saisie manuelle est là D'EMBLÉE, à côté du
  // bouton de géolocalisation : la cacher derrière un échec ferait de la
  // géolocalisation un passage obligé. C'est la doctrine de C4.3b, et le
  // repliement ne la change pas.
  const code = sansCommentaires(UI_LIGNE);
  const ouverture = code.indexOf("panneauOuvert && (");
  assert.ok(ouverture > 0, "le panneau doit être conditionné à un geste");
  const panneau = code.slice(ouverture);
  /*
   * ⚠️ LE PANNEAU MONTE MAINTENANT UN SEUL COMPOSANT, et c'est lui qui porte
   * les DEUX modes — côte à côte, nommés, et choisis par onglet. Le champ ville
   * n'est donc pas devenu un secours : il est à égalité avec la géolocalisation,
   * ce qui est exactement la doctrine de C4.3b, poussée plus loin.
   */
  assert.match(panneau, /<RechercheDeCommerces\b/, "le panneau monte la recherche");
  const recherche = sansCommentaires(UI_RECHERCHE);
  assert.match(recherche, /getCurrentPosition/, "elle porte la géolocalisation");
  assert.match(recherche, /chercherCommune/, "et la recherche par commune, dans le MÊME écran");
  /*
   * ⚠️ LES LIBELLÉS VIVENT DANS LE MODULE, PAS DANS LE JSX. Le composant rend
   * `{m.libelle}` : chercher le texte dans le composant prouverait seulement
   * qu'on l'y a recopié. On lit donc la source de vérité.
   */
  const modules = sansCommentaires(lireOuVide("../../lib/nutrition/recherche-commerces.ts"));
  assert.match(modules, /"Autour de moi"/, "les deux modes sont nommés");
  assert.match(modules, /"Par ville"/);
  assert.match(recherche, /MODES\.map\(/, "et le composant les rend tous, sans en oublier un");
});
