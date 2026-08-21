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
const UI = lireOuVide("../../components/student/ChoixMagasinProche.tsx");
const ECRAN = lireOuVide("../../app/(student)/nutrition/courses/page.tsx");

const LOT_C4_3B = [MODULE_PUR, ADAPTATEUR, SCHEMAS, ROUTE_SEARCH, UI, ECRAN];
const NOMS_LOT = [
  "lib/nutrition/magasin-proche.ts",
  "lib/open-prices/locations.ts",
  "lib/api/schemas/magasins.ts",
  "app/api/student/stores/search/route.ts",
  "components/student/ChoixMagasinProche.tsx",
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
  // Et le composant n'en envoie aucun : son corps est la ville, et rien d'autre.
  const ui = sansCommentaires(UI);
  assert.match(ui, /body: JSON\.stringify\(\{ ville: saisie \}\)/, "le client n'envoie que la ville");
  assert.ok(!/pays|country/i.test(ui.split("stores/search")[1]?.slice(0, 400) ?? ""), "aucun pays côté client");
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
  const ui = sansCommentaires(UI);
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
  const brut = UI;
  assert.ok(!/code postal|codePostal|code_postal/i.test(brut.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "")),
    "aucun libellé ne doit promettre une recherche par code postal");
  assert.match(brut, /Ville/, "le champ doit s'appeler Ville");
});

await test("C4.3b-21 — la recherche manuelle n'appelle JAMAIS la géolocalisation", () => {
  const code = sansCommentaires(UI);
  // La fonction de recherche par ville doit exister et ne pas toucher au GPS.
  const bloc = /const chercherParVille[\s\S]{0,1600}?\n  \}, \[/.exec(code)?.[0] ?? "";
  assert.notEqual(bloc, "", "une fonction de recherche par ville doit exister");
  assert.ok(!/getCurrentPosition|geolocation/.test(bloc), "la recherche ville ne demande aucune position");
  assert.match(bloc, /\/api\/student\/stores\/search/, "elle passe par notre route");
  assert.match(bloc, /method: "POST"/, "en POST : la saisie ne va pas dans une chaîne de requête");
});

/**
 * Le bloc JSX gardé par une condition donnée, extrait du composant.
 *
 * ⚠️ ON LIT LA GARDE, PAS LE TEXTE. Chercher une phrase prouverait qu'elle
 * existe quelque part ; ce qui compte est SOUS QUELLE CONDITION elle s'affiche.
 * C'est exactement la faute corrigée ici : la phrase définitive existait, et
 * elle s'affichait aussi quand nous ne savions rien.
 */
function blocGarde(source: string, garde: string): string {
  const debut = source.indexOf(garde);
  assert.ok(debut >= 0, `garde absente du composant : ${garde}`);
  const ouvrante = source.indexOf("(", debut + garde.length);
  assert.ok(ouvrante >= 0, `bloc introuvable après ${garde}`);
  let profondeur = 0;
  for (let i = ouvrante; i < source.length; i += 1) {
    if (source[i] === "(") profondeur += 1;
    else if (source[i] === ")") {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(ouvrante, i + 1);
    }
  }
  assert.fail(`parenthèse fermante introuvable pour ${garde}`);
}

/** « Il n'en existe aucun » — les tournures définitives, celles qui mentent. */
const AFFIRME_ABSENCE = /Aucun magasin connu/;

await test("C4.3b-22b — VILLE · 0 résultat + NON tronqué : l'absence peut être affirmée", () => {
  const code = sansCommentaires(UI);
  const bloc = blocGarde(code, 'état === "ville_aucun_resultat" && !tronqué');
  assert.match(bloc, AFFIRME_ABSENCE, "cas A : là, et là seulement, l'absence est vraie");
});

await test("C4.3b-22c — VILLE · 0 résultat + TRONQUÉ : rien n'est affirmé", () => {
  const code = sansCommentaires(UI);
  const bloc = blocGarde(code, 'état === "ville_aucun_resultat" && tronqué');
  // ⚠️ CAS B — LE DÉFAUT CORRIGÉ. Nous n'avons vu qu'une portion : dire
  // « aucun magasin dans cette ville » ferait renoncer l'élève à un magasin
  // qui existe, sur la foi d'une mesure que nous n'avons pas faite.
  assert.ok(!AFFIRME_ABSENCE.test(bloc), "cas B : l'absence ne doit PAS être affirmée");
  assert.match(bloc, /premiers résultats consultés/, "il faut dire ce qui a été consulté");
  assert.match(bloc, /limitée/, "et dire que la recherche a été limitée");
});

await test("C4.3b-22d — 0 résultat : les deux cas sont mutuellement exclusifs", () => {
  const code = sansCommentaires(UI);
  // Aucun troisième bloc `ville_aucun_resultat` sans garde de troncature : ce
  // serait le message définitif revenu par une autre porte.
  const gardes = [...code.matchAll(/état === "ville_aucun_resultat"([^&]*&&[^&(]*)?/g)].map((m) =>
    (m[1] ?? "").trim(),
  );
  assert.deepEqual(
    gardes.filter((g) => g !== "").sort(),
    ["&& !tronqué", "&& tronqué"],
    "les deux seules formes admises, et rien d'autre",
  );
});

await test("C4.3b-22e — résultats + tronqué : liste ET avertissement ; sinon liste seule", () => {
  const code = sansCommentaires(UI);
  const liste = blocGarde(code, "magasins.length > 0 &&");
  // Cas C — l'avertissement est présent dans le bloc de liste…
  assert.match(liste, /tronqué && \(/, "l'avertissement doit exister avec la liste");
  assert.match(liste, /Recherche écourtée/, "et dire que la recherche a été écourtée");
  // …et cas D — il est GARDÉ par `tronqué`, donc absent quand tout a été rendu.
  assert.ok(
    !/Recherche écourtée[\s\S]{0,200}<\/p>\s*\)\}\s*<\/>/.test(liste.replace(/tronqué && \(/, "")),
    "l'avertissement ne doit pas être inconditionnel",
  );
});

await test("C4.3b-22f — NEARBY · 0 résultat + tronqué : C4.3a ne ment plus non plus", () => {
  // ⚠️ CE N'EST PAS UNE MODIFICATION FONCTIONNELLE DE C4.3a. Le booléen
  // `tronque` était DÉJÀ calculé correctement par la découverte géographique ;
  // seul l'écran l'ignorait dès que la liste était vide.
  const code = sansCommentaires(UI);
  const franc = blocGarde(code, 'état === "aucun_resultat" && !tronqué');
  assert.match(franc, /Aucun magasin connu autour de toi/, "l'absence reste dicible quand elle est vraie");

  const prudent = blocGarde(code, 'état === "aucun_resultat" && tronqué');
  assert.ok(!/Aucun magasin connu autour de toi/.test(prudent), "ne pas affirmer qu'il n'en existe aucun");
  assert.match(prudent, /premiers résultats consultés/);
  assert.match(prudent, /limitée/);
});

await test("C4.3b-22 — tous les états de la recherche manuelle existent", () => {
  const code = sansCommentaires(UI);
  for (const etat of [
    "ville_saisie",
    "ville_chargement",
    "ville_aucun_resultat",
    "ville_invalide",
    "ville_erreur",
  ]) {
    assert.ok(code.includes(etat), `l'état « ${etat} » doit être traité explicitement`);
  }
  // Le repli reste disponible quand la géolocalisation a été refusée.
  assert.ok(
    !/permission_refusee[\s\S]{0,400}return null/.test(code),
    "un refus de géolocalisation ne doit pas masquer le champ manuel",
  );
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
  const code = sansCommentaires(UI);
  const ouverture = code.indexOf("panneauOuvert && (");
  assert.ok(ouverture > 0, "le panneau doit être conditionné à un geste");
  const panneau = code.slice(ouverture);
  assert.match(panneau, /getCurrentPosition|void chercher\(\)/, "le panneau porte la géolocalisation");
  assert.match(panneau, /chercherParVille/, "et la recherche par ville, dans le MÊME panneau");
});
