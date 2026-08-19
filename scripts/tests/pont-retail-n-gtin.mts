/**
 * Harnais — LE CONTRAT DE CARDINALITÉ : 1 ALIMENT GÉNÉRIQUE → N GTIN RÉELS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * Décision produit du 18/08/2026 : un aliment du `food_catalog` PEUT et DOIT
 * pouvoir porter PLUSIEURS références commerciales réelles — le paquet
 * Carrefour, le paquet Lidl, le paquet Auchan, la marque nationale.
 *
 * L'audit préalable a établi un fait rassurant et un fait gênant.
 *
 *   RASSURANT — ni le schéma, ni la base, ni les routes, ni l'écran n'ont
 *   JAMAIS supposé N = 1. `food_products_food_id_idx` est partiel et non
 *   unique, `lireProduitsRapproches` rend un tableau, `matchBodySchema`
 *   accepte un lot, `etatRapprochement` fait un `some`. Rien à corriger.
 *
 *   GÊNANT — rien ne l'INTERDISAIT non plus. Une hypothèse « N > 1 ⇒ plusieurs
 *   candidats ⇒ aucun prix » avait déjà été écrite une fois, dans le cadrage
 *   C4.4. Elle n'a pas été codée ; elle aurait pu l'être.
 *
 * Ce harnais transforme donc une propriété ACCIDENTELLE en propriété DÉFENDUE.
 * Il ne mesure presque aucun comportement nouveau : il empêche l'ancien de
 * revenir.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Logique pure et lecture de sources.
 *
 * Lancement : npm run test:pont-retail-n-gtin
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  estRapproche,
  etatRapprochement,
  type LigneRevue,
  type ProduitRapproche,
} from "../../lib/nutrition/pont-retail";
import { MATCH_GTINS_MAX, matchBodySchema } from "../../lib/api/schemas/food-bridge";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const MODULE_PUR = lire("../../lib/nutrition/pont-retail.ts");
const BASE = lire("../../lib/supabase/pont-retail.ts");
const SCHEMAS = lire("../../lib/api/schemas/food-bridge.ts");
const ROUTE_MATCH = lire("../../app/api/admin/food-bridge/match/route.ts");
const ROUTE_CANDIDATS = lire("../../app/api/admin/food-bridge/candidates/route.ts");
const ROUTE_REVIEW = lire("../../app/api/admin/food-bridge/review/route.ts");
const UI = lire("../../components/admin/PontRetailAdmin.tsx");
const MIGRATION_PRODUITS = lire("../../supabase/migrations/20260903090000_food_products.sql");
const MIGRATION_C4_1 = lire("../../supabase/migrations/20260917090000_c4_1_pont_retail.sql");

const LOT = [MODULE_PUR, BASE, SCHEMAS, ROUTE_MATCH, ROUTE_CANDIDATS, ROUTE_REVIEW, UI];
const NOMS = [
  "lib/nutrition/pont-retail.ts",
  "lib/supabase/pont-retail.ts",
  "lib/api/schemas/food-bridge.ts",
  "app/api/admin/food-bridge/match/route.ts",
  "app/api/admin/food-bridge/candidates/route.ts",
  "app/api/admin/food-bridge/review/route.ts",
  "components/admin/PontRetailAdmin.tsx",
];

/**
 * ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE — et cette leçon a été payée cinq fois
 * pendant C4.1b. Le contrat de cardinalité ÉCRIT en toutes lettres les mots
 * qu'il interdit (« produit représentatif », « ambiguïté ») pour dire qu'ils
 * n'ont pas leur place. Balayer les commentaires ferait rougir un test parce
 * que la documentation est bonne.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
/** Retire aussi la prose affichée d'un JSX (`>…<`) et les littéraux de chaîne. */
function sansProseAffichee(source: string): string {
  return sansCommentaires(source)
    .replace(/>[^<>{}]+</g, "><")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/`[^`]*`/g, "``");
}
/** Retire les commentaires SQL `--` et les littéraux entre apostrophes. */
function sqlNu(source: string): string {
  return source.replace(/--.*$/gm, " ").replace(/'[^']*'/g, "''");
}

// ════════════════════════════════════════════════════════════════════════════
// A. 0, 1 ET N SONT TROIS ÉTATS VALIDES  (règles A et E)
// ════════════════════════════════════════════════════════════════════════════

const ALIMENT = "aliment-flocons-avoine";
const produit = (gtin: string, foodId: string | null = ALIMENT): ProduitRapproche => ({
  gtin,
  foodId,
  matchStatus: foodId === null ? "unmatched" : "manual",
});

await test("N-GTIN-01 — 0 produit relié = pas de pont, et ce n'est PAS une erreur", () => {
  // Aucun produit, aucune revue : l'aliment n'est pas traité, il n'est pas en
  // faute. `unreviewed` est un état nommé, pas un code d'erreur.
  assert.equal(etatRapprochement(ALIMENT, [], null), "unreviewed");

  // Et avec une décision de curation, c'est cette décision qui parle.
  const revue: LigneRevue = { catalogFoodId: ALIMENT, status: "needs_review" };
  assert.equal(etatRapprochement(ALIMENT, [], revue), "needs_review");

  // ⚠️ AUCUN ÉTAT « ERREUR » N'EXISTE DANS LE TYPE. Le vérifier ici fige le
  // fait que l'absence de pont ne peut pas devenir une anomalie affichée.
  const union = /export type EtatRapprochement =([\s\S]*?);/.exec(MODULE_PUR);
  assert.ok(union, "l'union EtatRapprochement doit rester lisible");
  assert.ok(
    !/erreur|error|invalid|ambigu/i.test(union![1]),
    "aucun état d'erreur ni d'ambiguïté ne doit entrer dans EtatRapprochement",
  );
});

await test("N-GTIN-02 — 1 produit relié suffit à couvrir l'aliment", () => {
  assert.equal(etatRapprochement(ALIMENT, [produit("3017620422003")], null), "matched");
});

await test("N-GTIN-03 — N produits reliés sont ACCEPTÉS, et c'est le cas nominal", () => {
  // Quatre enseignes réelles pour un même aliment générique.
  const quatre = [
    produit("3560070976478"), // Carrefour
    produit("20087090"), // Lidl
    produit("3596710352104"), // Auchan
    produit("3175681840607"), // marque nationale
  ];
  assert.equal(etatRapprochement(ALIMENT, quatre, null), "matched");
  assert.equal(quatre.filter(estRapproche).length, 4);

  // Le corps de requête accepte le lot, sans plancher à 1 ni plafond à 1.
  const corps = matchBodySchema.safeParse({
    catalogFoodId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    gtins: quatre.map((p) => p.gtin),
  });
  assert.equal(corps.success, true, "un lot de quatre codes doit être accepté");
});

await test("N-GTIN-04 — N produits ne déclenchent AUCUN état ambigu, ni bloquant", () => {
  const cinq = ["1", "2", "3", "4", "5"].map((n) => produit(`301762042200${n}`));
  // Le même verdict qu'avec un seul : la cardinalité ne change pas l'état.
  assert.equal(etatRapprochement(ALIMENT, cinq, null), "matched");
  assert.equal(
    etatRapprochement(ALIMENT, cinq, null),
    etatRapprochement(ALIMENT, [cinq[0]!], null),
    "cinq produits et un produit donnent le MÊME état",
  );

  // ⚠️ Et une vieille note de revue ne ressuscite pas devant N produits.
  const revue: LigneRevue = { catalogFoodId: ALIMENT, status: "needs_review" };
  assert.equal(etatRapprochement(ALIMENT, cinq, revue), "matched");

  // Aucun vocabulaire d'ambiguïté ou de blocage sur le nombre, nulle part dans
  // le code du lot (commentaires et prose affichée retirés).
  const interdits: readonly RegExp[] = [
    /plusieurs_candidats/i,
    /trop de produits/i,
    /ambigu/i,
    /tropDeProduits/,
    /candidatsMultiples/i,
  ];
  LOT.forEach((source, i) => {
    const nu = sansProseAffichee(source);
    for (const motif of interdits) {
      assert.ok(!motif.test(nu), `${NOMS[i]} ne doit pas porter ${motif}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. AUCUN « PRODUIT REPRÉSENTATIF »  (règles C et D)
// ════════════════════════════════════════════════════════════════════════════

await test("N-GTIN-05 — aucune élection d'un produit parmi N", () => {
  const interdits: readonly RegExp[] = [
    /repr[ée]sentatif/i,
    /representative/i,
    /produitPrincipal/i,
    /gtinPrincipal/i,
    /produitElu/i,
    /meilleurProduit/i,
    /produitCanonique/i,
  ];
  LOT.forEach((source, i) => {
    const nu = sansProseAffichee(source);
    for (const motif of interdits) {
      assert.ok(!motif.test(nu), `${NOMS[i]} ne doit pas élire de produit (${motif})`);
    }
  });

  // ⚠️ ET AUCUNE TRONCATURE SILENCIEUSE : pas de `[0]` ni de `limit(1)` sur les
  // produits reliés. Prendre le premier serait élire sans le dire.
  const lecture = /export async function lireProduitsRapproches[\s\S]*?\n}\n/.exec(BASE);
  assert.ok(lecture, "lireProduitsRapproches doit rester identifiable");
  assert.ok(
    !/\.limit\(|\.maybeSingle\(|\.single\(/.test(lecture![0]),
    "la lecture des produits reliés ne doit ni borner ni singulariser",
  );

  // Le tri non plus : aucun classement ne doit suggérer un « premier » produit.
  assert.ok(
    !/\.order\(/.test(lecture![0]),
    "aucun ordre imposé — un ordre laisse croire à une préférence",
  );
});

await test("N-GTIN-06 — C4.1 ne choisit ni magasin, ni prix, ni conditionnement", () => {
  // Ces trois notions ont chacune leur lot. Aucune ne doit apparaître dans le
  // chemin d'écriture du pont.
  const ecriture = sansProseAffichee(ROUTE_MATCH) + sansProseAffichee(BASE);
  for (const motif of [
    /location_id/i,
    /magasin/i,
    /price|prix|cents/i,
    /conditionnement|packaging|quantity_per/i,
  ]) {
    assert.ok(!motif.test(ecriture), `le chemin d'écriture du pont ne doit pas parler de ${motif}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// C. LE SCHÉMA N'A PAS BOUGÉ, ET NE DOIT PAS BOUGER
// ════════════════════════════════════════════════════════════════════════════

await test("N-GTIN-07 — aucun index unique ne porte sur food_id, dans AUCUNE migration", () => {
  const dossier = new URL("../../supabase/migrations/", import.meta.url);
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith(".sql"));
  assert.ok(fichiers.length > 0, "les migrations doivent être lisibles");

  for (const fichier of fichiers) {
    const sql = sqlNu(readFileSync(new URL(fichier, dossier), "utf8"));
    assert.ok(
      !/unique[\s\S]{0,120}\(\s*food_id\s*\)/i.test(sql),
      `${fichier} : un index unique sur food_id ramènerait N à 1`,
    );
    // Et pas davantage une contrainte nommée qui ferait la même chose.
    assert.ok(
      !/constraint\s+\w*food_id\w*\s+unique/i.test(sql),
      `${fichier} : aucune contrainte unique nommée sur food_id`,
    );
  }
});

await test("N-GTIN-08 — food_products.gtin reste unique GLOBALEMENT", () => {
  // ⚠️ L'AUTRE MOITIÉ DU CONTRAT, ET ELLE NE SE RELÂCHE PAS. Un aliment porte N
  // produits ; un code-barres ne désigne qu'UNE ligne. Sans cette unicité,
  // rapprocher deux fois le même code créerait deux lignes divergentes du même
  // produit réel.
  assert.match(
    MIGRATION_PRODUITS,
    /create unique index if not exists food_products_gtin_unique/i,
    "l'unicité totale du gtin est le pendant du N",
  );
  const bloc = /create unique index if not exists food_products_gtin_unique[\s\S]{0,200}?;/i.exec(
    MIGRATION_PRODUITS,
  );
  assert.ok(bloc, "l'index gtin doit rester lisible");
  assert.ok(
    !/\bwhere\b/i.test(sqlNu(bloc![0])),
    "l'index gtin doit rester TOTAL — un index partiel laisserait passer des doublons",
  );

  // L'index de rapprochement, lui, reste partiel ET non unique.
  assert.match(
    MIGRATION_PRODUITS,
    /create index if not exists food_products_food_id_idx[\s\S]{0,160}where food_id is not null/i,
    "food_id garde un index partiel NON unique",
  );
});

await test("N-GTIN-09 — aucune table de liaison, aucune notion de stock ni de magasin", () => {
  // Règle G : le stock n'est jamais inféré, donc il n'est jamais stocké.
  const tables = [...MIGRATION_C4_1.matchAll(/create table if not exists public\.(\w+)/gi)].map(
    (m) => m[1],
  );
  assert.deepEqual(tables, ["food_catalog_retail_review"], "C4.1 ne crée QUE la table de revue");

  for (const motif of [/store_product/i, /product_store/i, /disponibilit/i, /\bstock\b/i]) {
    assert.ok(
      !motif.test(sqlNu(MIGRATION_C4_1)),
      `la migration C4.1 ne doit pas porter ${motif}`,
    );
    LOT.forEach((source, i) => {
      assert.ok(!motif.test(sansProseAffichee(source)), `${NOMS[i]} ne doit pas porter ${motif}`);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// D. LES LIENS S'ADDITIONNENT — ILS NE SE REMPLACENT PAS
// ════════════════════════════════════════════════════════════════════════════

await test("N-GTIN-10 — un second rapprochement AJOUTE, il n'écrase pas le premier", () => {
  const fn = /export async function rapprocherProduits[\s\S]*?\n}\n/.exec(BASE);
  assert.ok(fn, "rapprocherProduits doit rester identifiable");
  const corps = fn![0];

  // L'`update` est borné aux codes NOMMÉS. C'est ce `.in(...)` qui rend
  // l'opération additive : les produits déjà reliés ne sont pas touchés.
  assert.match(corps, /\.in\(\s*["']gtin["']/, "l'update doit être borné aux gtins du lot");

  // ⚠️ ET SURTOUT : AUCUN DÉTACHEMENT PRÉALABLE. Un `food_id: null` ou un
  // `.neq("gtin", …)` avant l'update transformerait « ajouter Lidl » en
  // « remplacer Carrefour par Lidl », silencieusement.
  assert.ok(!/\.neq\(/.test(corps), "aucun update par complément — ce serait un remplacement");
  assert.ok(!/\.delete\(/.test(corps), "aucun effacement préalable");
  assert.ok(
    !/food_id:\s*null/.test(corps),
    "rapprocher ne doit jamais poser food_id à null : ce serait détacher",
  );
  // Et la route ne détache pas non plus avant d'écrire.
  const post = /export async function POST[\s\S]*?\n}\n/.exec(ROUTE_MATCH);
  assert.ok(post, "le POST de match doit rester identifiable");
  assert.ok(
    !/detacherProduit/.test(post![0]),
    "le POST ne doit pas détacher avant de rapprocher",
  );
});

await test("N-GTIN-11 — MATCH_GTINS_MAX borne un APPEL, jamais un aliment", () => {
  assert.equal(MATCH_GTINS_MAX, 10);

  // Le plafond porte bien sur le tableau du corps de requête…
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const codes = Array.from({ length: MATCH_GTINS_MAX }, (_, i) =>
    String(3017620422003 + i).padStart(13, "0"),
  );
  assert.equal(matchBodySchema.safeParse({ catalogFoodId: uuid, gtins: codes }).success, true);
  assert.equal(
    matchBodySchema.safeParse({ catalogFoodId: uuid, gtins: [...codes, "3017620422099"] }).success,
    false,
    "onze codes dans UN appel sont refusés",
  );

  // …et la documentation dit explicitement que ce n'est pas une borne par
  // aliment. Sans cette phrase, quelqu'un lira « dix produits maximum ».
  assert.match(
    SCHEMAS,
    /PLAFOND PAR APPEL, PAS PAR ALIMENT/,
    "le plafond doit être documenté comme un plafond d'appel",
  );

  // ⚠️ ET AUCUN COMPTAGE DES PRODUITS DÉJÀ RELIÉS NE VIENT LE BORNER. Une
  // vérification « cet aliment a déjà N produits, on refuse » serait la limite
  // par aliment que le contrat interdit.
  const post = /export async function POST[\s\S]*?\n}\n/.exec(ROUTE_MATCH);
  assert.ok(
    !/produitsLies|lireProduitsRapproches/.test(post![0]),
    "le POST ne compte pas les produits déjà reliés pour décider d'accepter",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// E. CE QUE LE N NE DOIT PAS AFFAIBLIR
// ════════════════════════════════════════════════════════════════════════════

await test("N-GTIN-12 — l'appariement reste HUMAIN, et vérifié contre la recherche", () => {
  // Le garde-fou de C4.1 : un code-barres posté qui ne figure pas parmi les
  // candidats structurés de CET aliment est refusé, et le lot entier avec lui.
  assert.match(ROUTE_MATCH, /CANDIDAT_HORS_RECHERCHE/, "le refus hors-recherche doit subsister");
  assert.match(
    ROUTE_MATCH,
    /const refuses = gtins\.filter\(\(g\) => !parGtin\.has\(g\)\)/,
    "chaque code du lot est vérifié individuellement",
  );
  assert.match(
    sansCommentaires(ROUTE_MATCH),
    /if \(refuses\.length > 0\)[\s\S]{0,400}status: 422/,
    "un seul code hors recherche refuse le lot entier",
  );

  // ⚠️ ET LA DÉCISION RESTE NON PROBABILISTE. Ouvrir le N ne doit pas faire
  // apparaître un score qui classerait les produits entre eux.
  assert.match(BASE, /match_status: "manual"/, "le rapprochement reste déclaré manuel");
  assert.match(BASE, /match_score: null/, "aucun score n'est écrit");
  // ⚠️ TOUTES les affectations, pas seulement la première : une seconde
  // écriture posant `match_score: 1` ailleurs dans le fichier passerait sous
  // un simple `assert.match`.
  const scores = [...sansCommentaires(BASE).matchAll(/match_score:\s*([^,\n}]+)/g)].map((m) =>
    m[1]!.trim(),
  );
  assert.ok(scores.length > 0, "match_score doit être écrit explicitement");
  assert.deepEqual(
    [...new Set(scores)],
    ["null"],
    "match_score ne doit jamais recevoir autre chose que null",
  );
});

await test("N-GTIN-13 — le contrat de cardinalité est écrit, et ses huit règles sont là", () => {
  // ⚠️ CE TEST LIT LA PROSE À DESSEIN — c'est le seul du fichier. Le contrat
  // n'est pas exécutable : il ne survit que s'il est relu.
  assert.match(
    MODULE_PUR,
    /LE CONTRAT DE CARDINALITÉ : UN ALIMENT GÉNÉRIQUE → N RÉFÉRENCES RÉELLES/,
    "le contrat doit être nommé",
  );
  for (const lettre of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    assert.match(
      MODULE_PUR,
      new RegExp(`\\n \\*   ${lettre}\\. `),
      `la règle ${lettre} doit figurer dans le contrat`,
    );
  }
  // Les trois affirmations qu'on ne veut pas voir disparaître en silence.
  assert.match(MODULE_PUR, /N'EST PAS UNE AMBIGUÏTÉ C4\.1/);
  assert.match(MODULE_PUR, /IL N'EXISTE PAS DE « PRODUIT REPRÉSENTATIF »/);
  assert.match(MODULE_PUR, /ON NE FORCE JAMAIS N = 1 POUR AMÉLIORER UNE MÉTRIQUE/);
});

await test("N-GTIN-14 — la couverture se mesure « au moins un », jamais « exactement un »", () => {
  // Cinq produits reliés : UN aliment couvert, pas cinq, et surtout pas zéro.
  const cinq = ["a", "b", "c", "d", "e"].map((s) => produit(`301762042200${s.charCodeAt(0)}`));
  assert.equal(etatRapprochement(ALIMENT, cinq, null), "matched");

  // La métrique EST ce `some`. Un test d'égalité sur le nombre de produits
  // ferait basculer un bon aliment du côté « non couvert ».
  const fn = /export function etatRapprochement[\s\S]*?\n}\n/.exec(MODULE_PUR);
  assert.ok(fn, "etatRapprochement doit rester identifiable");
  assert.match(fn![0], /produits\.some\(/, "la couverture se lit avec un some");
  assert.ok(
    !/produits\.length\s*(===|==|<|>|<=|>=|!==)/.test(fn![0]),
    "aucune comparaison sur le NOMBRE de produits ne doit décider de l'état",
  );
  assert.ok(
    !/\.filter\([\s\S]{0,80}\)\.length\s*(===|==)\s*1/.test(sansCommentaires(MODULE_PUR)),
    "aucune égalité à 1 ne doit servir de critère de couverture",
  );

  // Et l'écran ne dit pas non plus « terminé » au premier produit.
  assert.match(
    UI,
    /d&apos;autres\s*\n?\s*enseignes peuvent être ajoutées/,
    "l'écran doit dire qu'un pont de plus est possible",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// F. PÉRIMÈTRE — CE LOT N'A RIEN CONSTRUIT
// ════════════════════════════════════════════════════════════════════════════

await test("PERIMETRE-N — aucune table, aucun cache, aucun scoring, aucune préférence", () => {
  for (const motif of [
    /preferenceMarque|brandPreference/i,
    /scoreProduit|productScore/i,
    /comparaisonMagasins|multiStore/i,
    /cachePrix|priceCache/i,
  ]) {
    LOT.forEach((source, i) => {
      assert.ok(!motif.test(sansProseAffichee(source)), `${NOMS[i]} ne doit pas porter ${motif}`);
    });
  }
  // Et le lot n'a introduit AUCUNE migration.
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // ⚠️ C4.3c A DEPUIS AJOUTÉ UNE MIGRATION, ET CE CONTRÔLE NE SE RELÂCHE PAS
  // POUR AUTANT. Ce qu'il prouve n'a jamais été « le dossier n'a pas bougé » —
  // il bougera à chaque lot — mais « le lot N-GTIN n'y a rien déposé ». La dernière
  // migration connue est donc nommée, ET une seconde assertion interdit
  // SÉPARÉMENT toute migration portant le sujet de le lot N-GTIN : c'est celle-là qui
  // porte l'intention, et elle ne dépend d'aucun lot futur.
  assert.equal(
    migrations[migrations.length - 1],
    "20260919090000_c4_3c_magasins_osm.sql",
    "la dernière migration connue est celle de C4.3c",
  );
  // ⚠️ ET C'EST UNE ÉGALITÉ, PAS UN ENSEMBLE VIDE. Le sujet du lot N-GTIN est
  // le pont retail — dont C4.1 a légitimement posé la migration. Exiger « aucune
  // migration portant ce sujet » effacerait C4.1 ; exiger « EXACTEMENT celle de
  // C4.1 » prouve la même chose en plus fort : une SECONDE migration pont-retail,
  // qu'un lot N-GTIN aurait glissée pour « juste ajouter une colonne », rougit ici.
  assert.deepEqual(
    migrations.filter((f) => /_c4_1|pont_retail|gtin|barcode|code_barre/i.test(f)),
    ["20260917090000_c4_1_pont_retail.sql"],
    "le lot N-GTIN n'ajoute aucune migration : celle de C4.1 est la seule du sujet",
  );
});

console.log("\n✅ Contrat de cardinalité 1 aliment → N GTIN : suite verte.");
