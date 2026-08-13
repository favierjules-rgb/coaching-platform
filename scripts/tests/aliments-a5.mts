/**
 * Harnais — ALIMENTS A5 : FAVORIS, RÉCENTS, CLASSEMENT, DÉDOUBLONNAGE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS PROUVE, ET CE QU'IL NE PEUT PAS PROUVER
 * ────────────────────────────────────────────────────────────────────────────
 * Le dépôt n'a ni jsdom ni bibliothèque de test DOM : ses harnais de rendu
 * s'arrêtent à `renderToString`, qui n'exécute aucun effet et ne clique sur
 * rien. Les règles sont donc éprouvées là où elles vivent :
 *
 *   - RÉCENTS : `lib/nutrition/recents.ts`, fonctions pures, appelées ici sur
 *     les cas qui comptent — doublons, ordre, aliments manuels, bornes ;
 *   - CLASSEMENT : `lib/nutrition/recherche-aliments.ts`, joué sur de VRAIS
 *     noms Ciqual copiés de la table importée, pas sur des exemples inventés ;
 *   - DÉDOUBLONNAGE : `dedupliquerProduits`, sur des identités réelles ;
 *   - RENDU : `renderToString`, sur ce qui est visible au premier rendu ;
 *   - le reste — « le composant appelle bien cette règle-là » — par assertions
 *     PRÉCISES sur le source dépouillé de ses commentaires, toujours doublées
 *     d'un contrôle négatif montrant que le dépouillement n'a rien vidé.
 *
 * ⚠️ A5-5 à A5-9 (persistance, RLS, refus d'une cible invalide) ne sont PAS
 * ici : ils portent sur la base, et une assertion TypeScript ne prouve rien
 * d'une policy. Ils sont dans `supabase/tests/aliments_a5_favoris_checklist.sql`,
 * EXÉCUTÉ sur une base locale reconstruite — 30 contrôles, deux élèves du même
 * coach, rôles réellement endossés.
 *
 * Lancement : npm run test:aliments-a5
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { AddFoodSheet, type RaccourcisAlimentsUI } from "../../components/student/AddFoodSheet";
import {
  classerProduits,
  classerResultats,
  dedupliquerProduits,
  estAlimentMoyen,
  estFormeTransformee,
  normaliserPourRecherche,
  rangProduit,
} from "../../lib/nutrition/recherche-aliments";
import {
  FENETRE_RECENTS,
  MAX_RECENTS,
  type LigneRecente,
  cibleDeLaLigne,
  cleRecent,
  ordonnerRecents,
} from "../../lib/nutrition/recents";
import type { AlimentRapide, CatalogFood, ProduitLocal } from "../../lib/supabase/consumed-meals";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_SHEET = lire("../../components/student/AddFoodSheet.tsx");
const CODE_SHEET = sansProse(SOURCE_SHEET);
const CODE_RECENTS = sansProse(lire("../../lib/nutrition/recents.ts"));
const CODE_CONSUMED = sansProse(lire("../../lib/supabase/consumed-meals.ts"));
const CODE_FAVORIS = sansProse(lire("../../lib/supabase/food-favorites.ts"));
const MIGRATION_INDEX = lire("../../supabase/migrations/20260905090000_meal_entries_student_recent_index.sql");
const MIGRATION_FAVORIS = lire("../../supabase/migrations/20260905090100_food_favorites.sql");

/**
 * ⚠️ LE PIÈGE, NEUVIÈME OCCURRENCE DANS CE PROJET — et il a mordu ici.
 *
 * L'assertion « aucun index unique à trois colonnes » a échoué sur la PROSE de
 * la migration, qui écrit exactement cet index pour expliquer pourquoi il
 * serait faux. Le SQL est donc dépouillé de ses commentaires avant toute
 * assertion d'ABSENCE, et un contrôle négatif vérifie que le dépouillement n'a
 * pas vidé le fichier.
 */
function sansCommentairesSql(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, " ");
}
const SQL_FAVORIS = sansCommentairesSql(MIGRATION_FAVORIS);

/* ── Vrais noms Ciqual, copiés de la table importée ─────────────────────── */

function ciqual(...noms: string[]): readonly { id: string; name: string }[] {
  return noms.map((name, i) => ({ id: `c${i}`, name }));
}

const POMMES = ciqual(
  "Pomme, sèche",
  "Pomme, chair et peau, crue",
  "Pomme, chair sans peau, crue (aliment moyen)",
  "Pomme, chair sans peau, rôtie/cuite au four",
  "Pomme, chair sans peau, bouillie/cuite à l'eau",
  "Pomme Gala, chair sans peau, crue",
  "Pomme de terre, appertisée, égouttée",
);

const RIZ = ciqual(
  "Riz, mélange de variétés (blanc, complet, rouge, sauvage, etc.), cru",
  "Riz blanc, cru",
  "Riz complet, cru",
  "Riz cantonais, préemballé",
  "Riz au lait vanille, cannelle ou nature, rayon frais",
);

const POULETS = ciqual(
  "Poulet, viande crue",
  "Poulet, pilon cru",
  "Poulet, filet sans peau cru",
  "Poulet rôti, cuisse, viande et peau",
  "Nuggets de poulet, préemballés",
);

const OEUFS = ciqual(
  "Oeuf, en poudre",
  "Oeuf, blanc (blanc d'oeuf), cru",
  "Oeuf, jaune (jaune d'oeuf), cru",
  "Oeuf cru",
);

const PATES = ciqual(
  "Pâtes sèches, standard, crues",
  "Pâtes fraîches farcies (ex : raviolis, tortellinis), cuites (aliment moyen)",
  "Pâtes sèches, aux oeufs, crues",
);

const BANANES = ciqual(
  "Banane, chair sans peau, crue",
  "Banane plantain, crue",
  "Dessert lacté à la banane, préemballé",
);

/* ── Fabriques ─────────────────────────────────────────────────────────── */

function ligne(sourceType: string, id: string | null, creeLe: string): LigneRecente {
  return {
    sourceType,
    foodId: sourceType === "catalog_food" ? id : null,
    productId: sourceType === "product" ? id : null,
    creeLe,
  };
}

function alimentRapide(id: string, nom: string): AlimentRapide {
  return {
    type: "aliment",
    aliment: {
      id,
      name: nom,
      nutritionUnit: "g",
      proteinPer100: 1,
      carbPer100: 20,
      fatPer100: 0,
      pieceWeightG: null,
    } satisfies CatalogFood,
  };
}

function produitRapide(id: string, nom: string, marque: string | null = null): AlimentRapide {
  return {
    type: "produit",
    produit: {
      id,
      gtin: `301762042200${id.length}`,
      name: nom,
      brand: marque,
      nutritionUnit: "g",
      proteinPer100: 6,
      carbPer100: 57,
      fatPer100: 30,
      imageUrl: null,
      hydratee: true,
    } satisfies ProduitLocal,
  };
}

function produit(id: string, nom: string, marque: string | null, gtin = `g-${id}`) {
  return { id, name: nom, brand: marque, gtin };
}

function raccourcis(partiel: Partial<RaccourcisAlimentsUI> = {}): RaccourcisAlimentsUI {
  return {
    favoris: [],
    recents: [],
    chargement: false,
    estFavori: () => false,
    basculerFavori: () => {},
    ...partiel,
  };
}

function rendreFeuille(props: Record<string, unknown> = {}): string {
  return renderToString(
    createElement(AddFoodSheet, {
      titreRepas: "Petit-déjeuner",
      enCours: false,
      erreur: null,
      onFermer: () => {},
      onAjouterCatalogue: async () => true,
      onAjouterProduit: async () => true,
      onAjouterManuel: async () => true,
      ...props,
    } as never),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A5-1..4 — LES RÉCENTS
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-1. le champ vide affiche les récents quand il y en a", () => {
  const html = rendreFeuille({
    raccourcis: raccourcis({ recents: [alimentRapide("f1", "Banane, chair sans peau, crue")] }),
  });
  assert.ok(html.includes("Récents"), "la section est rendue");
  assert.ok(html.includes("Banane, chair sans peau, crue"));

  // SANS récents, PAS de section vide. Un titre suivi d'un blanc donnerait
  // l'impression d'un écran cassé au premier jour d'utilisation.
  const vide = rendreFeuille({ raccourcis: raccourcis() });
  assert.ok(!vide.includes("Récents"), "aucune section vide");

  // Et sans raccourcis du tout, l'écran reste entier.
  const sansRien = rendreFeuille();
  assert.ok(sansRien.includes("Rechercher un aliment") && sansRien.includes("Scanner un code-barres"));

  // La section n'est rendue QUE si le champ est vide — la condition est lue
  // sur le terme NETTOYÉ : deux espaces ne sont pas une recherche.
  assert.ok(CODE_SHEET.includes("const champVide = terme.trim() === \"\""));
  assert.ok(CODE_SHEET.includes("{champVide && raccourcis"));
});

await test("A5-2. le récent le plus récent vient en premier", () => {
  const rangé = ordonnerRecents(
    [
      ligne("catalog_food", "vieux", "2026-08-01T08:00:00Z"),
      ligne("catalog_food", "recent", "2026-08-13T20:00:00Z"),
      ligne("catalog_food", "milieu", "2026-08-10T12:00:00Z"),
    ],
    10,
  );
  assert.deepEqual(
    rangé.map((r) => r.cible.id),
    ["recent", "milieu", "vieux"],
  );

  // ⚠️ L'ORDRE EST RECALCULÉ ICI, il n'est pas seulement hérité de la requête.
  // Un tableau donné dans le désordre — requête modifiée, test mal écrit — ne
  // doit pas produire un écran faux en silence.
  const désordre = ordonnerRecents(
    [
      ligne("catalog_food", "a", "2026-08-01T08:00:00Z"),
      ligne("catalog_food", "b", "2026-08-13T20:00:00Z"),
    ],
    10,
  );
  assert.equal(désordre[0]?.cible.id, "b");
});

await test("A5-3. les récents sont dédupliqués par IDENTITÉ", () => {
  const rangé = ordonnerRecents(
    [
      ligne("catalog_food", "banane", "2026-08-13T20:00:00Z"),
      ligne("catalog_food", "banane", "2026-08-12T08:00:00Z"),
      ligne("catalog_food", "banane", "2026-08-11T08:00:00Z"),
      ligne("product", "nutella", "2026-08-13T09:00:00Z"),
    ],
    10,
  );
  assert.equal(rangé.length, 2, "un aliment mangé trois fois n'apparaît qu'une");
  assert.deepEqual(rangé.map((r) => cleRecent(r.cible)), ["aliment:banane", "produit:nutella"]);
  // Et c'est bien le DERNIER ajout qui décide de sa place.
  assert.equal(rangé[0]?.dernierAjout, "2026-08-13T20:00:00Z");

  // ⚠️ UN ALIMENT ET UN PRODUIT DE MÊME IDENTIFIANT NE SE CONFONDENT PAS : ce
  // sont deux tables, et deux `uuid` peuvent coïncider dans un jeu de test.
  const homonymes = ordonnerRecents(
    [ligne("catalog_food", "x", "2026-08-13T10:00:00Z"), ligne("product", "x", "2026-08-13T11:00:00Z")],
    10,
  );
  assert.equal(homonymes.length, 2);
});

await test("A5-4. les récents sont bornés, et les entrées manuelles exclues", () => {
  const beaucoup = Array.from({ length: 40 }, (_, i) =>
    ligne("catalog_food", `f${i}`, `2026-08-13T${String(i % 24).padStart(2, "0")}:00:00Z`),
  );
  assert.equal(ordonnerRecents(beaucoup, MAX_RECENTS).length, MAX_RECENTS);
  assert.ok(MAX_RECENTS >= 8 && MAX_RECENTS <= 12, "entre 8 et 12, comme demandé");
  assert.equal(ordonnerRecents(beaucoup, 0).length, 0);

  // ⚠️ LES ALIMENTS SAISIS À LA MAIN N'ONT PAS D'IDENTITÉ STABLE. Deux
  // « Sandwich maison » saisis à deux semaines d'écart sont deux textes libres,
  // pas deux occurrences du même aliment.
  assert.equal(cibleDeLaLigne(ligne("free", null, "2026-08-13T10:00:00Z")), null);
  assert.equal(cibleDeLaLigne(ligne("recipe", "r1", "2026-08-13T10:00:00Z")), null);
  assert.equal(ordonnerRecents([ligne("free", null, "2026-08-13T10:00:00Z")], 10).length, 0);

  // Un pointeur manquant sur une source qui en exige un est écarté, pas
  // affiché comme un raccourci qui ne mène nulle part.
  assert.equal(cibleDeLaLigne(ligne("catalog_food", null, "2026-08-13T10:00:00Z")), null);

  // Le filtre est posé EN BASE, pas seulement côté client.
  assert.ok(CODE_CONSUMED.includes('.in("source_type", ["catalog_food", "product"])'));
  assert.ok(CODE_CONSUMED.includes(`.limit(FENETRE_RECENTS)`));
  assert.equal(FENETRE_RECENTS, 200);
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-5..9 — LES FAVORIS (le contrat de base est en SQL, exécuté)
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-5 · A5-6 · A5-7 · A5-8 · A5-9. la migration porte le contrat, et la checklist l'exécute", () => {
  // Ces cinq contrôles sont EXÉCUTÉS sur une base réelle par
  // supabase/tests/aliments_a5_favoris_checklist.sql. Ici, on vérifie que la
  // migration déclare bien ce que la checklist éprouve — pas l'inverse.
  assert.ok(MIGRATION_FAVORIS.includes("create table if not exists public.food_favorites"));
  assert.ok(MIGRATION_FAVORIS.includes("catalog_food_id uuid references public.food_catalog (id) on delete cascade"));
  assert.ok(MIGRATION_FAVORIS.includes("product_id      uuid references public.food_products (id) on delete cascade"));

  // A5-8 : exactement une cible, écrite par comptage, et `= 1` (pas `<= 1`).
  assert.ok(/constraint food_favorites_cible_unique check \([\s\S]*?= 1\s*\)/.test(MIGRATION_FAVORIS));

  // A5-8b : DEUX index PARTIELS. Un index à trois colonnes laisserait passer
  // les doublons, puisque NULL n'est jamais égal à NULL.
  assert.ok(SQL_FAVORIS.includes("where catalog_food_id is not null"));
  assert.ok(SQL_FAVORIS.includes("where product_id is not null"));
  assert.ok(
    !/unique index[^;]*\(student_id, catalog_food_id, product_id\)/.test(SQL_FAVORIS),
    "aucun index unique à trois colonnes",
  );
  // CONTRÔLE NÉGATIF DU DÉPOUILLEMENT : la prose PARLE de cet index — c'est ce
  // qui avait rendu l'assertion ci-dessus rouge avant qu'elle ne dépouille.
  assert.ok(
    /unique index[^;]*\(student_id, catalog_food_id, product_id\)/.test(MIGRATION_FAVORIS),
    "la prose explique bien pourquoi cet index serait faux",
  );
  assert.ok(SQL_FAVORIS.includes("create table if not exists public.food_favorites"));
  assert.ok(SQL_FAVORIS.length > 800, "le dépouillement n'a pas vidé le SQL");

  // A5-7 : RLS élève stricte, et AUCUNE policy coach.
  assert.ok(SQL_FAVORIS.includes("using      (student_id = public.current_student_id())"));
  assert.ok(SQL_FAVORIS.includes("with check (student_id = public.current_student_id())"));
  assert.ok(!/create policy[^;]*coach/i.test(SQL_FAVORIS), "aucune policy coach");

  // A5-9 : delete accordé, update REFUSÉ — le privilège, pas la policy.
  assert.ok(SQL_FAVORIS.includes("grant select, insert, delete on table public.food_favorites to authenticated"));
  assert.ok(!/grant[^;]*update[^;]*food_favorites[^;]*authenticated/.test(SQL_FAVORIS));
  assert.ok(SQL_FAVORIS.includes("revoke all on table public.food_favorites from authenticated"));

  // Et la checklist SQL existe, avec ses cinq numéros.
  const checklist = lire("../../supabase/tests/aliments_a5_favoris_checklist.sql");
  for (const numéro of ["A5-5", "A5-6", "A5-7", "A5-8", "A5-9"]) {
    assert.ok(checklist.includes(numéro), `${numéro} est éprouvé en SQL`);
  }
  assert.ok(checklist.includes("⚠️ NE JAMAIS exécuter sur la Production"));
});

await test("A5-9. le client retire un favori par sa CIBLE, et un doublon n'est pas une erreur", () => {
  assert.ok(CODE_FAVORIS.includes('const colonne = cible.type === "aliment" ? "catalog_food_id" : "product_id"'));
  // ⚠️ 23505 EST UN SUCCÈS DU POINT DE VUE DE L'ÉLÈVE : l'aliment EST en
  // favori. Deux tapes rapprochées ne doivent pas faire clignoter une erreur.
  assert.ok(CODE_FAVORIS.includes('return (error as { code?: string }).code === "23505"'));
  // Aucun UPDATE côté client non plus : le privilège n'existe pas.
  assert.ok(!CODE_FAVORIS.includes(".update("), "aucun update de favori");
});

await test("A5-10. les favoris sont affichés AVANT les récents", () => {
  const html = rendreFeuille({
    raccourcis: raccourcis({
      favoris: [alimentRapide("f1", "Aliment favori")],
      recents: [alimentRapide("f2", "Aliment récent")],
    }),
  });
  const posFavoris = html.indexOf("Favoris");
  const posRecents = html.indexOf("Récents");
  assert.ok(posFavoris > 0 && posRecents > 0, "les deux sections sont rendues");
  assert.ok(posFavoris < posRecents, "les favoris passent avant les récents");
  assert.ok(html.indexOf("Aliment favori") < html.indexOf("Aliment récent"));

  // Et les deux passent AVANT le scanner et la saisie manuelle : ce sont des
  // raccourcis, ils n'ont d'intérêt qu'en tête.
  assert.ok(posFavoris < html.indexOf("Scanner un code-barres"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-11..16 — LE CLASSEMENT, SUR DE VRAIS NOMS CIQUAL
   ══════════════════════════════════════════════════════════════════════════ */

const premier = (items: readonly { id: string; name: string }[], terme: string) =>
  classerResultats(items, terme, 20)[0]?.name ?? "";

await test("A5-11. « banane » met la banane simple en premier", () => {
  assert.equal(premier(BANANES, "banane"), "Banane, chair sans peau, crue");
  // Le dessert à la banane n'est pas une banane : il est classé, mais dernier.
  const rangé = classerResultats(BANANES, "banane", 20);
  assert.equal(rangé.at(-1)?.name, "Dessert lacté à la banane, préemballé");
});

await test("A5-12. « pomme » — la pomme crue passe devant la pomme SÈCHE", () => {
  // MESURÉ AVANT A5 : « Pomme, sèche » sortait première, parce qu'à rang et
  // tête égaux c'était le nom le plus COURT qui gagnait.
  assert.equal(premier(POMMES, "pomme"), "Pomme, chair sans peau, crue (aliment moyen)");

  const rangé = classerResultats(POMMES, "pomme", 20).map((p) => p.name);
  assert.ok(
    rangé.indexOf("Pomme, chair et peau, crue") < rangé.indexOf("Pomme, sèche"),
    "la forme transformée est rétrogradée",
  );
  // « Pomme de terre » n'est pas une pomme : sa tête fait trois mots.
  assert.ok(rangé.indexOf("Pomme, sèche") < rangé.indexOf("Pomme de terre, appertisée, égouttée"));
});

await test("A5-13. « riz » privilégie un riz simple", () => {
  const rangé = classerResultats(RIZ, "riz", 20).map((r) => r.name);
  // L'entrée GÉNÉRIQUE de Ciqual d'abord — décision validée : ce n'est pas un
  // plat préparé, c'est le riz « sans précision ».
  assert.equal(rangé[0], "Riz, mélange de variétés (blanc, complet, rouge, sauvage, etc.), cru");
  assert.equal(rangé[1], "Riz blanc, cru");
  // Et les plats préparés sont bien derrière les riz simples.
  assert.ok(rangé.indexOf("Riz blanc, cru") < rangé.indexOf("Riz cantonais, préemballé"));
  assert.ok(
    rangé.indexOf("Riz complet, cru") < rangé.indexOf("Riz au lait vanille, cannelle ou nature, rayon frais"),
  );
});

await test("A5-14. « poulet » privilégie la viande simple", () => {
  const rangé = classerResultats(POULETS, "poulet", 20).map((p) => p.name);
  assert.ok(rangé[0].startsWith("Poulet,"), `premier = ${rangé[0]}`);
  assert.ok(
    rangé.indexOf("Poulet, viande crue") < rangé.indexOf("Nuggets de poulet, préemballés"),
    "les plats composés passent après",
  );
});

await test("A5-15. « pates » fonctionne sans accent — et « sèches » n'est PAS rétrogradé", () => {
  assert.equal(normaliserPourRecherche("Pâtes sèches"), "pates seches");
  const rangé = classerResultats(PATES, "pates", 20).map((p) => p.name);
  assert.equal(rangé[0], "Pâtes sèches, standard, crues");

  // ⚠️ LE PIÈGE ÉVITÉ, ET IL EST MESURÉ. Placée avant le comptage des mots de
  // la tête, la règle « (aliment moyen) d'abord » faisait remonter les pâtes
  // farcies ici. Et si la liste des formes transformées regardait la TÊTE, les
  // « Pâtes sèches » seraient rétrogradées — alors que « sèches » y est
  // l'aliment lui-même, pas sa préparation.
  assert.equal(estFormeTransformee("Pâtes sèches, standard, crues"), false);
  assert.equal(estFormeTransformee("Pomme, sèche"), true);
  assert.ok(
    rangé.indexOf("Pâtes sèches, standard, crues") <
      rangé.indexOf("Pâtes fraîches farcies (ex : raviolis, tortellinis), cuites (aliment moyen)"),
  );
});

await test("A5-16. « oeuf » fonctionne malgré la ligature, et la poudre est rétrogradée", () => {
  assert.equal(normaliserPourRecherche("Œuf"), "oeuf");
  assert.equal(normaliserPourRecherche("œuf"), "oeuf");
  const rangé = classerResultats(OEUFS, "oeuf", 20).map((o) => o.name);
  // MESURÉ AVANT A5 : « Oeuf, en poudre » sortait premier.
  assert.notEqual(rangé[0], "Oeuf, en poudre");
  assert.equal(rangé[0], "Oeuf, blanc (blanc d'oeuf), cru");
  assert.equal(estFormeTransformee("Oeuf, en poudre"), true);
});

await test("A5-SUP. le marqueur « (aliment moyen) » est celui de Ciqual, pas une invention", () => {
  assert.equal(estAlimentMoyen("Pomme, chair sans peau, crue (aliment moyen)"), true);
  assert.equal(estAlimentMoyen("Abat, cuit (Aliment Moyen)"), true, "insensible à la casse");
  assert.equal(estAlimentMoyen("Pomme, sèche"), false);
  // Il ne s'applique QU'à rang et tête égaux : sinon il ferait remonter des
  // aliments dont la tête n'a rien à voir avec la recherche.
  const ordre = sansProse(lire("../../lib/nutrition/recherche-aliments.ts"));
  const bloc = ordre.slice(ordre.indexOf("classés.sort"));
  assert.ok(
    bloc.indexOf("motsDeLaTete") < bloc.indexOf("estAlimentMoyen"),
    "les mots de la tête sont comparés AVANT le marqueur",
  );
  assert.ok(bloc.indexOf("estAlimentMoyen") < bloc.indexOf("estFormeTransformee"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-17..20 — PRODUITS : CLASSEMENT ET DÉDOUBLONNAGE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-17. un produit trouvé par son NOM est bien classé", () => {
  const produits = [
    produit("p1", "Skyr nature vanille édition limitée", "Marque A"),
    produit("p2", "Skyr", "Marque B"),
    produit("p3", "Skyr nature", "Marque C"),
    produit("p4", "Yaourt au skyr", "Marque D"),
  ];
  const rangé = classerProduits(produits, "skyr", 10).map((p) => p.name);
  assert.deepEqual(rangé, [
    "Skyr",
    "Skyr nature",
    "Skyr nature vanille édition limitée",
    "Yaourt au skyr",
  ]);
  assert.equal(rangProduit(produits[1], "skyr"), 0, "nom exact");
  assert.equal(rangProduit(produits[2], "skyr"), 1, "nom qui commence par");
  assert.equal(rangProduit(produits[3], "skyr"), 3, "simple occurrence");
});

await test("A5-18. un produit trouvé par sa MARQUE passe devant une simple occurrence", () => {
  const produits = [
    produit("p1", "Crème dessert au chocolat", "Danone"),
    produit("p2", "Biscuit fourré danone-like", "Autre"),
  ];
  // AVANT A5 : les correspondances de marque étaient ajoutées À LA SUITE de
  // toutes les correspondances de nom, y compris les plus faibles.
  assert.equal(rangProduit(produits[0], "danone"), 2, "marque exacte");
  assert.equal(rangProduit(produits[1], "danone"), 3, "occurrence dans le nom");
  const rangé = classerProduits(produits, "danone", 10).map((p) => p.id);
  assert.deepEqual(rangé, ["p1", "p2"]);

  // Un produit sans marque ni occurrence est ÉCARTÉ, pas classé dernier.
  assert.equal(rangProduit(produit("p3", "Pain de mie", null), "danone"), null);
});

await test("A5-19. le même GTIN, local ET externe, n'est affiché qu'une fois", () => {
  // Le produit revient de la recherche externe APRÈS avoir été écrit en cache :
  // il porte donc le MÊME identifiant que sa version locale.
  const local = produit("p1", "Nutella", "Ferrero", "3017620422003");
  const externe = produit("p1", "Nutella", "Ferrero", "3017620422003");
  assert.equal(dedupliquerProduits([local, externe]).length, 1);

  // Et même si un fournisseur rendait deux lignes de même GTIN sous deux
  // identifiants — ce que l'index unique interdit en base, mais qui peut
  // arriver AVANT écriture —, elles ne s'afficheraient qu'une fois.
  const jumeau = produit("p2", "Nutella pot", "Ferrero", "3017620422003");
  assert.equal(dedupliquerProduits([local, jumeau]).length, 1);

  // LE PREMIER VU GAGNE : l'ordre d'arrivée porte du sens (le local d'abord).
  assert.equal(dedupliquerProduits([local, jumeau])[0]?.id, "p1");
});

await test("A5-20. deux GTIN DIFFÉRENTS ne sont JAMAIS fusionnés", () => {
  const petit = produit("p1", "Yaourt nature", "Marque", "3017620422003");
  const grand = produit("p2", "Yaourt nature", "Marque", "5449000000996");
  // Même nom, même marque, deux codes-barres : deux produits, deux fiches,
  // parfois deux compositions. Les confondre ferait consommer les macros de
  // l'un sous l'étiquette de l'autre, définitivement.
  assert.equal(dedupliquerProduits([petit, grand]).length, 2);

  // Aucune comparaison de NOM dans la déduplication : le code ne contient pas
  // de rapprochement flou, et ce contrôle le vérifie sur le source.
  const code = sansProse(lire("../../lib/nutrition/recherche-aliments.ts"));
  const bloc = code.slice(code.indexOf("export function dedupliquerProduits"));
  assert.ok(!bloc.includes(".name"), "la déduplication ne regarde aucun nom");
  assert.ok(bloc.includes("`id:${p.id}`") && bloc.includes("`gtin:${p.gtin}`"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-21..25 — L'AJOUT RAPIDE, ET CE QUI NE DOIT PAS BOUGER
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-21. taper un récent du catalogue passe par le pipeline A3", () => {
  const bloc = CODE_SHEET.slice(
    CODE_SHEET.indexOf("function choisirRapide"),
    CODE_SHEET.indexOf("function ouvrirQuantitéProduit"),
  );
  // Exactement le même geste qu'un résultat de recherche : on pose le choix,
  // l'unité que le catalogue autorise, et la quantité par défaut.
  assert.ok(bloc.includes('setChoix({ type: "aliment", aliment: élément.aliment })'));
  assert.ok(bloc.includes("setUnitéChoix(unitesPourAliment(élément.aliment)[0])"));
  // AUCUNE logique d'ajout nouvelle : pas d'appel direct à une RPC ici.
  assert.ok(!bloc.includes("onAjouterCatalogue"), "l'ajout reste le geste de l'étape quantité");
});

await test("A5-22. taper un récent produit passe par l'HYDRATATION d'A3 si nécessaire", () => {
  const bloc = CODE_SHEET.slice(
    CODE_SHEET.indexOf("function choisirRapide"),
    CODE_SHEET.indexOf("function ouvrirQuantitéProduit"),
  );
  // ⚠️ CE N'EST PAS UN DÉTAIL. Un produit mis en favori après une recherche
  // TEXTE a pu arriver sans son unité réelle : sa fiche dit « g » par défaut.
  // Le consommer tel quel écrirait 250 g là où il y avait 250 ml.
  assert.ok(bloc.includes("void choisirProduit(élément.produit)"));
  // Et `choisirProduit` est bien celui qui décide d'hydrater.
  assert.ok(CODE_SHEET.includes("if (!doitHydrater(produit))"));
  assert.ok(CODE_SHEET.includes("await hydraterProduit(produit.gtin, appeler)"));
});

await test("A5-23. le scanner A4 est intact", () => {
  const html = rendreFeuille({ raccourcis: raccourcis({ recents: [alimentRapide("f1", "Banane")] }) });
  assert.ok(html.includes("Scanner un code-barres"), "le bouton est toujours là");
  assert.ok(CODE_SHEET.includes("<ScannerCodeBarres"));
  assert.ok(CODE_SHEET.includes("key={sessionScan}"));
  assert.ok(CODE_SHEET.includes("lireProduitParGtin("));

  // A5 n'a touché ni le moteur, ni la caméra, ni le GTIN, ni le cycle de vie.
  const scanner = sansProse(lire("../../components/student/ScannerCodeBarres.tsx"));
  assert.ok(scanner.includes("useEffect(() => () => toutArrêter(), [toutArrêter])"));
  assert.ok(scanner.includes("ouvrirCameraArriere("));
  assert.ok(scanner.includes('await import("@/lib/scan/adaptateurs")'));
  for (const fichier of ["moteur.ts", "camera.ts", "gtin.ts", "parcours.ts"]) {
    const code = sansProse(lire(`../../lib/scan/${fichier}`));
    assert.ok(!/favori|recent|récent/i.test(code), `A5 n'a rien écrit dans lib/scan/${fichier}`);
  }
});

await test("A5-24. la saisie manuelle A2 est intacte", () => {
  const html = rendreFeuille({ raccourcis: raccourcis() });
  assert.ok(html.includes("Saisir à la main"));
  assert.ok(CODE_SHEET.includes("lireMacroPour100"));
  assert.ok(CODE_SHEET.includes("onAjouterManuel("));
  // Toujours deux onglets, pas trois : le scan et les raccourcis sont des
  // manières de RETROUVER un aliment, pas des façons d'en ajouter un.
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
});

await test("A5-25. les objectifs du coach ne sont JAMAIS modifiés par A5", () => {
  // Aucun module A5 n'écrit dans les tables de prescription.
  for (const fichier of [
    "../../lib/nutrition/recents.ts",
    "../../lib/nutrition/progression.ts",
    "../../lib/supabase/food-favorites.ts",
  ]) {
    const code = sansProse(lire(fichier));
    for (const interdit of ["nutrition_plan", "nutrition_days", "meals", "daily_calories", "profileKey"]) {
      assert.ok(!code.includes(interdit), `« ${interdit} » dans ${fichier}`);
    }
  }
  // Les deux migrations A5 ne touchent AUCUNE table de prescription.
  for (const migration of [MIGRATION_INDEX, MIGRATION_FAVORIS]) {
    assert.ok(!/alter table public\.(nutrition_plans|nutrition_days|meals)/.test(migration));
    assert.ok(!/drop table/.test(migration));
  }
  // L'index A5 ne touche pas non plus aux colonnes de `meal_entries` : il en
  // AJOUTE un index, il n'en modifie aucune.
  assert.ok(!/alter table public\.meal_entries/.test(MIGRATION_INDEX));
  assert.ok(MIGRATION_INDEX.includes("create index if not exists meal_entries_student_recent_idx"));
});

/* ══════════════════════════════════════════════════════════════════════════
   SUPPLÉMENTS — PERFORMANCE, ÉTAT FAVORI, ET COHÉRENCE DU HARNAIS
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-SUP §12. aucune requête par aliment — les listes sont chargées en bloc", () => {
  // Les sources sont relues avec des `in (…)`, jamais un `eq` par identifiant.
  const bloc = CODE_CONSUMED.slice(CODE_CONSUMED.indexOf("export async function chargerAlimentsRapides"));
  assert.ok(bloc.includes('.in("id", idsAliments)'));
  assert.ok(bloc.includes('.in("id", idsProduits)'));
  assert.ok(!/for \(const .* of cibles\)[\s\S]{0,200}await supabase/.test(bloc), "aucune boucle de requêtes");
  // Et une liste vide ne déclenche AUCUNE requête.
  assert.ok(bloc.includes("if (cibles.length === 0) return []"));
  assert.ok(bloc.includes("idsAliments.length === 0\n      ? Promise.resolve"));

  // La frappe ne recharge NI les favoris NI les récents : ils ne dépendent pas
  // du terme cherché.
  const effetFrappe = CODE_SHEET.slice(
    CODE_SHEET.indexOf("const minuterie = setTimeout"),
    CODE_SHEET.indexOf("}, [terme, chercher]);"),
  );
  assert.ok(!effetFrappe.includes("raccourcis"));
  assert.ok(!effetFrappe.includes("listerFavoris"));
});

await test("A5-SUP §8. l'état favori se voit AUSSI dans les résultats de recherche", () => {
  // L'étoile est branchée sur les deux listes de résultats, avec la bonne
  // cible — un aliment n'est pas un produit.
  assert.ok(CODE_SHEET.includes('raccourcis.estFavori({ type: "aliment", id: aliment.id })'));
  assert.ok(CODE_SHEET.includes('raccourcis.estFavori({ type: "produit", id: produit.id })'));

  // ⚠️ L'ÉTOILE EST UN BOUTON À PART. Un bouton dans un bouton n'est pas du
  // HTML valide, et un tap sur l'étoile ne doit pas ouvrir l'étape quantité.
  const html = rendreFeuille({
    raccourcis: raccourcis({
      favoris: [produitRapide("p1", "Nutella", "Ferrero")],
      estFavori: () => true,
    }),
  });
  assert.ok(html.includes('aria-label="Retirer Nutella des favoris"'));
  assert.ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(html), "aucun bouton imbriqué");

  // Sans favoris chargés, aucune étoile n'est rendue : l'écran ne change pas de
  // forme selon qu'une requête a abouti ou non.
  const sans = rendreFeuille();
  assert.ok(!sans.includes("aux favoris"));
});

await test("A5-SUP. le dépouillement des commentaires n'a rien vidé", () => {
  assert.ok(CODE_SHEET.length > 5000 && CODE_SHEET.includes("export function AddFoodSheet"));
  assert.ok(CODE_RECENTS.includes("export function ordonnerRecents"));
  assert.ok(CODE_FAVORIS.includes("export async function listerFavoris"));
  // Et il a bien retiré quelque chose.
  assert.ok(SOURCE_SHEET.includes("CE QUE CET ÉCRAN N'ENVOIE JAMAIS"));
  assert.ok(!CODE_SHEET.includes("CE QUE CET ÉCRAN N'ENVOIE JAMAIS"));
});
