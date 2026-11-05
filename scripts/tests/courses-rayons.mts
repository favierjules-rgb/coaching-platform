/**
 * Harnais — COURSES : LES RAYONS ET LES UNITÉS DE LA LISTE (phase 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Que les sept rayons demandés existent, que la classification vient bien de
 * l'ANSES et non d'une devinette sur les noms, que la table de passage couvre
 * TOUS les sous-groupes du catalogue, que les aliments surgelés sont reconnus
 * sur leur état officiel, et qu'un aliment inconnu tombe visiblement dans
 * « Divers » au lieu d'être rangé au hasard.
 *
 * Et, côté unités : qu'additionner ne convertit JAMAIS, et que deux unités
 * différentes font deux lignes.
 *
 * ⚠️ LE JEU DE L'ANSES EST LU DIRECTEMENT, pas recopié. Les attentes de ce
 * fichier sont comparées à `data/ciqual/2025/aliments.jsonl` — la source dont
 * sort la migration d'import. Un harnais qui réécrirait la classification
 * mesurerait sa propre copie.
 *
 * ⚠️ AUCUNE MIGRATION DANS CE LOT. `R-01` le vérifie : les rayons se déduisent
 * de `food_catalog.source_ref`, qui existe depuis A3.
 *
 * Lancement : npm run test:courses-rayons
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agregerListeDeCourses,
  cleDeLigne,
  formatQuantite,
  libelleDUnite,
  type ItemPourAgregation,
} from "../../lib/nutrition/liste-de-courses";
import {
  RAYONS,
  RAYON_PAR_SSGRP,
  grouperParRayon,
  libelleDuRayon,
  rayonDeLigne,
  rayonDuCodeCiqual,
  type RayonId,
} from "../../lib/nutrition/rayons";
import {
  SSGRP_PAR_CODE_CIQUAL,
  SURGELES_CIQUAL,
} from "../../lib/nutrition/rayons-ciqual.generated";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_RAYONS = sansProse(lire("../../lib/nutrition/rayons.ts"));
const CODE_AGREGATION = sansProse(lire("../../lib/nutrition/liste-de-courses.ts"));
const CODE_PERSISTANTE = sansProse(lire("../../lib/nutrition/liste-persistante.ts"));
const CODE_ECRAN = sansProse(lire("../../components/student/ListeDeCoursesPersistante.tsx"));

/** Le jeu normalisé de l'Anses, tel qu'il est dans le dépôt. */
interface AlimentAnses {
  readonly alim_code: string;
  readonly name: string;
  readonly grp_code: string;
  readonly grp_nom: string;
  readonly ssgrp_code: string;
  readonly ssgrp_nom: string;
}
const ANSES: readonly AlimentAnses[] = lire("../../data/ciqual/2025/aliments.jsonl")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as AlimentAnses);

const PAR_CODE = new Map(ANSES.map((a) => [a.alim_code, a] as const));

/** Le code Ciqual d'un aliment nommé — pour écrire des cas lisibles. */
function code(nomExact: string): string {
  const trouve = ANSES.filter((a) => a.name === nomExact);
  assert.equal(trouve.length, 1, `« ${nomExact} » doit désigner UN aliment de l'Anses`);
  return trouve[0]!.alim_code;
}

function item(p: Partial<ItemPourAgregation>): ItemPourAgregation {
  return {
    identityType: "catalog_food",
    identityId: "f1",
    quantity: 100,
    unit: "g",
    displayName: "Riz",
    codeCiqual: null,
    colorKey: null,
    plannedOn: "2026-08-17",
    mealId: "m1",
    plannedMealId: "pm1",
    choiceSlotId: "s1",
    ...p,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   R-01 → R-05 — D'OÙ VIENT LA CLASSIFICATION
   ══════════════════════════════════════════════════════════════════════════ */

test("R-01 — AUCUNE MIGRATION, AUCUNE COLONNE NOUVELLE pour les rayons", () => {
  // Le rayon se déduit de `source_ref`, qui existe depuis l'import Ciqual.
  for (const interdit of ["alter table", "create table", "rayon_id", "category_id"]) {
    assert.ok(
      !CODE_RAYONS.toLowerCase().includes(interdit),
      `les rayons ne demandent rien à la base (${interdit})`,
    );
  }
  assert.ok(
    !CODE_RAYONS.includes("supabase") && !CODE_RAYONS.includes("fetch("),
    "module feuille : ni base, ni réseau",
  );
});

test("R-02 — LE RAYON NE SE DEVINE PAS SUR LE NOM", () => {
  /*
   * ⚠️ LE PIÈGE QUE CE CONTRÔLE FERME. Une règle par mots-clés rangerait
   * « lait de coco » en produits laitiers, « beurre de cacahuète » en beurres
   * et « steak de soja » en viandes — et ce sont précisément les aliments
   * fréquents d'un plan de nutrition.
   */
  const laitDeCoco = code("Lait de coco");
  assert.equal(PAR_CODE.get(laitDeCoco)!.grp_code, "10", "l'Anses le classe en ingrédients divers");
  assert.notEqual(
    rayonDuCodeCiqual(laitDeCoco),
    "produits-laitiers",
    "« lait de coco » n'est pas un produit laitier",
  );
  assert.equal(rayonDuCodeCiqual(laitDeCoco), "epicerie");

  // Et le module ne contient aucune liste de mots-clés de noms d'aliments.
  for (const motif of ["includes(\"lait", "includes(\"beurre", "toLowerCase()", "name."]) {
    assert.ok(!CODE_RAYONS.includes(motif), `aucune règle sur le libellé (${motif})`);
  }
});

test("R-03 — LA TABLE DE PASSAGE COUVRE TOUS LES SOUS-GROUPES DU CATALOGUE", () => {
  /*
   * ⚠️ SI L'ANSES PUBLIE UN SOUS-GROUPE DE PLUS, CE TEST ROUGIT. Sans lui, les
   * aliments de ce sous-groupe fileraient silencieusement dans « Divers » et
   * personne ne saurait qu'il y a un choix à faire.
   */
  const presents = new Set(Object.values(SSGRP_PAR_CODE_CIQUAL));
  const manquants = [...presents].filter((ss) => !RAYON_PAR_SSGRP.has(ss)).sort();
  assert.deepEqual(manquants, [], "sous-groupes de l'Anses sans rayon décidé");

  // Et aucune entrée morte : une ligne de la table qui ne correspond à rien
  // laisse croire qu'un choix a été fait pour des aliments qui n'existent pas.
  const orphelines = [...RAYON_PAR_SSGRP.keys()].filter((ss) => !presents.has(ss)).sort();
  assert.deepEqual(orphelines, [], "entrées de la table sans aliment correspondant");
});

test("R-04 — LE FICHIER GÉNÉRÉ EST FIDÈLE AU JEU DE L'ANSES", () => {
  assert.equal(
    Object.keys(SSGRP_PAR_CODE_CIQUAL).length,
    ANSES.length,
    "un sous-groupe par aliment importé, ni plus ni moins",
  );
  for (const aliment of ANSES) {
    assert.equal(
      SSGRP_PAR_CODE_CIQUAL[aliment.alim_code],
      aliment.ssgrp_code,
      `sous-groupe divergent pour ${aliment.alim_code}`,
    );
  }
});

test("R-05 — LE FICHIER GÉNÉRÉ NE CONTIENT AUCUN RAYON", () => {
  // Le choix se relit dans `RAYON_PAR_SSGRP`, pas dans un fichier généré.
  const genere = lire("../../lib/nutrition/rayons-ciqual.generated.ts");
  for (const rayon of RAYONS) {
    assert.ok(!genere.includes(`"${rayon.id}"`), `le fichier généré ignore les rayons (${rayon.id})`);
  }
  assert.ok(genere.includes("NE PAS MODIFIER À LA MAIN"));
  assert.ok(genere.includes("10.57745/RDMHWY"), "la provenance Anses est inscrite");
  assert.ok(genere.includes("Etalab"), "la licence est inscrite");
});

/* ══════════════════════════════════════════════════════════════════════════
   R-06 → R-12 — LES SEPT RAYONS DEMANDÉS
   ══════════════════════════════════════════════════════════════════════════ */

test("R-06 — LES SEPT RAYONS DE L'ÉNONCÉ, DANS L'ORDRE", () => {
  assert.deepEqual(
    RAYONS.map((r) => r.libelle),
    [
      "Fruits et légumes",
      "Viandes, poissons et œufs",
      "Féculents et céréales",
      "Produits laitiers",
      "Épicerie",
      "Surgelés",
      "Divers",
    ],
  );
  assert.equal(RAYONS.length, 7, "sept rayons, pas un huitième inventé");
  assert.equal(RAYONS.at(-1)!.id, "divers", "« Divers » ferme la liste");
});

test("R-07 — DES ALIMENTS RÉELS TOMBENT DANS LE BON RAYON", () => {
  const attendu: readonly [string, RayonId][] = [
    ["Carotte, crue", "fruits-legumes"],
    ["Pomme, chair et peau, crue", "fruits-legumes"],
    ["Boeuf, steak haché 5% MG cru", "viandes-poissons-oeufs"],
    ["Oeuf cru", "viandes-poissons-oeufs"],
    ["Saumon, élevage, cru", "viandes-poissons-oeufs"],
    ["Riz basmati, cuit, sans sel ajouté", "feculents-cereales"],
    ["Flocons d'avoine", "feculents-cereales"],
    ["Lentille, sèche (aliment moyen)", "feculents-cereales"],
    ["Fromage blanc, nature, 0% MG", "produits-laitiers"],
    ["Beurre à 80% MG minimum, doux", "produits-laitiers"],
    ["Miel", "epicerie"],
    ["Huile d'olive vierge extra", "epicerie"],
  ];
  for (const [nom, rayon] of attendu) {
    assert.equal(rayonDuCodeCiqual(code(nom)), rayon, `« ${nom} » → ${libelleDuRayon(rayon)}`);
  }
});

test("R-08 — « SURGELÉS » PASSE DEVANT LE SOUS-GROUPE", () => {
  /*
   * L'Anses classe la framboise surgelée dans « fruits ». On ne l'achète pas
   * au rayon fruits : la mention vient du NOM OFFICIEL, où « surgelée » est un
   * état de préparation normalisé.
   */
  const framboise = code("Framboise, surgelée, crue");
  assert.equal(PAR_CODE.get(framboise)!.ssgrp_nom, "fruits");
  assert.equal(rayonDuCodeCiqual(framboise), "surgeles");

  // La framboise FRAÎCHE, elle, reste aux fruits et légumes.
  assert.equal(rayonDuCodeCiqual(code("Framboise, crue")), "fruits-legumes");
});

test("R-09 — LA MENTION « SURGELÉ » EST RECONNUE MALGRÉ L'ACCENT FINAL", () => {
  /*
   * ⚠️ LE PIÈGE MESURÉ. Le générateur bornait la mention par `\b`, qui est
   * ASCII : après le « é » de « surgelé, cru », il n'y a aucune frontière de
   * mot, et 26 aliments sur 71 passaient à travers. Ce contrôle compte les
   * deux formes, celle qui finit par « é » comprise.
   */
  const dansLeJeu = ANSES.filter((a) => /(?<!\p{L})surgel[eé]{1,2}s?(?!\p{L})/iu.test(a.name));
  assert.equal(SURGELES_CIQUAL.size, dansLeJeu.length, "aucun aliment surgelé oublié");
  assert.ok(dansLeJeu.length >= 70, `l'Anses en nomme ${dansLeJeu.length} : le compte a chuté`);

  const finissantParE = dansLeJeu.filter((a) => /surgel[eé]{1,2}s?[^\p{L}]*$/iu.test(a.name));
  assert.ok(finissantParE.length > 0, "il existe bien des noms où la mention est en dernier");
  for (const aliment of finissantParE) {
    assert.ok(
      SURGELES_CIQUAL.has(aliment.alim_code),
      `« ${aliment.name} » doit être reconnu surgelé`,
    );
  }
});

test("R-10 — LES GLACES SONT SURGELÉES PAR NATURE, SANS MENTION DANS LE NOM", () => {
  for (const ss of ["0801", "0802", "0803"]) {
    assert.equal(RAYON_PAR_SSGRP.get(ss), "surgeles");
  }
  const glace = ANSES.find((a) => a.ssgrp_code === "0801")!;
  assert.ok(!SURGELES_CIQUAL.has(glace.alim_code), "son nom ne dit pas « surgelé »");
  assert.equal(rayonDuCodeCiqual(glace.alim_code), "surgeles", "et pourtant elle l'est");
});

test("R-11 — CE QUI N'EST PAS CONNU VA DANS « DIVERS », VISIBLEMENT", () => {
  assert.equal(rayonDuCodeCiqual(null), "divers", "pas de code → pas de rayon deviné");
  assert.equal(rayonDuCodeCiqual(undefined), "divers");
  assert.equal(rayonDuCodeCiqual(""), "divers");
  assert.equal(rayonDuCodeCiqual("99999"), "divers", "un code hors catalogue");
  assert.equal(
    rayonDeLigne({ identityType: "product", codeCiqual: null }),
    "divers",
    "un produit commercial non rapproché",
  );
});

test("R-12 — LES PLATS COMPOSÉS ET LES ALIMENTS INFANTILES VONT DÉLIBÉRÉMENT DANS « DIVERS »", () => {
  // L'Anses classe par nature d'aliment, pas par rayon : une soupe peut être
  // en brique, au frais ou surgelée. « Épicerie » par défaut enverrait l'élève
  // au mauvais endroit avec l'aplomb d'une information sûre.
  for (const ss of ["0101", "0102", "0103", "0104", "0105", "0106", "1101", "1102", "1103", "1104"]) {
    assert.equal(RAYON_PAR_SSGRP.get(ss), "divers", `sous-groupe ${ss}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   R-13 → R-17 — LE GROUPEMENT N'AGRÈGE RIEN
   ══════════════════════════════════════════════════════════════════════════ */

const l = (rayon: RayonId, nom: string) => ({ rayon, nom });

test("R-13 — LES RAYONS SONT DES INTERTITRES : AUCUNE LIGNE PERDUE NI FUSIONNÉE", () => {
  const lignes = [
    l("epicerie", "Miel"),
    l("fruits-legumes", "Carotte"),
    l("epicerie", "Huile"),
    l("divers", "Éponges"),
    l("fruits-legumes", "Pomme"),
  ];
  const groupes = grouperParRayon(lignes);
  assert.equal(
    groupes.reduce((n, g) => n + g.lignes.length, 0),
    lignes.length,
    "autant de lignes en sortie qu'en entrée",
  );
  assert.deepEqual(
    groupes.flatMap((g) => g.lignes.map((x) => x.nom)).sort(),
    lignes.map((x) => x.nom).sort(),
  );
});

test("R-14 — L'ORDRE DES RAYONS EST CELUI DE `RAYONS`, PAS CELUI D'ARRIVÉE", () => {
  const groupes = grouperParRayon([
    l("divers", "a"),
    l("surgeles", "b"),
    l("fruits-legumes", "c"),
    l("produits-laitiers", "d"),
  ]);
  assert.deepEqual(
    groupes.map((g) => g.rayon),
    ["fruits-legumes", "produits-laitiers", "surgeles", "divers"],
  );
});

test("R-15 — UN RAYON VIDE N'APPARAÎT PAS", () => {
  const groupes = grouperParRayon([l("epicerie", "Miel")]);
  assert.equal(groupes.length, 1, "un seul intertitre, pas sept");
  assert.equal(groupes[0]!.libelle, "Épicerie");
  assert.deepEqual(grouperParRayon([]), [], "aucune liste, aucun intertitre");
});

test("R-16 — L'ORDRE À L'INTÉRIEUR D'UN RAYON EST CELUI D'ENTRÉE", () => {
  // Le tri alphabétique a déjà eu lieu en amont ; le refaire ici le rendrait
  // dépendant de deux endroits.
  const groupes = grouperParRayon([
    l("epicerie", "Zeste"),
    l("epicerie", "Ail"),
    l("epicerie", "Miel"),
  ]);
  assert.deepEqual(
    groupes[0]!.lignes.map((x) => x.nom),
    ["Zeste", "Ail", "Miel"],
  );
});

test("R-17 — LE RAYON EST RÉSOLU UNE FOIS, À L'HYDRATATION", () => {
  // L'écran lit un rayon déjà porté par la ligne ; il ne le recalcule pas.
  assert.ok(CODE_PERSISTANTE.includes("rayonDuCodeCiqual(duPlan?.codeCiqual ?? null)"));
  assert.ok(CODE_ECRAN.includes("grouperParRayon(etat.lignes)"));
  assert.ok(
    !CODE_ECRAN.includes("rayonDuCodeCiqual") && !CODE_ECRAN.includes("rayonDeLigne"),
    "l'écran ne résout aucun rayon lui-même",
  );
  // Un article MANUEL n'a pas d'identité, donc pas de rayon connu.
  assert.ok(CODE_PERSISTANTE.includes('rayon: "divers"'));
});

/* ══════════════════════════════════════════════════════════════════════════
   R-18 → R-25 — LES QUANTITÉS ET LES UNITÉS
   ══════════════════════════════════════════════════════════════════════════ */

test("R-18 — L'EXEMPLE DE L'ÉNONCÉ : 100 + 150 + 120 = 370 g", () => {
  const lignes = agregerListeDeCourses([
    item({ identityId: "riz", displayName: "Riz", quantity: 100 }),
    item({ identityId: "riz", displayName: "Riz", quantity: 150 }),
    item({ identityId: "riz", displayName: "Riz", quantity: 120 }),
  ]);
  assert.equal(lignes.length, 1, "un seul riz");
  assert.equal(lignes[0]!.quantite, 370);
  assert.equal(formatQuantite(lignes[0]!.quantite, lignes[0]!.unit), `370 g`);
  assert.equal(lignes[0]!.sources.length, 3, "les trois repas d'origine restent traçables");
});

test("R-19 — DEUX UNITÉS, DEUX LIGNES — ET AUCUNE CONVERSION", () => {
  /*
   * ⚠️ 100 g de miel et 100 ml de miel ne sont pas la même chose, et la
   * densité qui les relierait n'est stockée nulle part. Deux lignes côte à
   * côte, c'est moins joli qu'un total unique, et c'est vrai.
   */
  const lignes = agregerListeDeCourses([
    item({ identityId: "miel", displayName: "Miel", quantity: 100, unit: "g" }),
    item({ identityId: "miel", displayName: "Miel", quantity: 100, unit: "ml" }),
  ]);
  assert.equal(lignes.length, 2);
  assert.deepEqual(
    lignes.map((x) => x.cle).sort(),
    [cleDeLigne("catalog_food", "miel", "g"), cleDeLigne("catalog_food", "miel", "ml")].sort(),
  );
  for (const ligne of lignes) assert.equal(ligne.quantite, 100, "aucune somme entre unités");
});

test("R-20 — NI g → kg, NI ml → L : 1 500 g RESTENT 1 500 g", () => {
  /*
   * ⚠️ LE SÉPARATEUR DE MILLIERS N'EST PAS CODÉ EN DUR. `toLocaleString("fr-FR")`
   * rend une espace fine insécable (U+202F) sur les ICU récentes et une espace
   * insécable (U+00A0) sur les anciennes : écrire l'une des deux ferait rougir
   * ce test sur une mise à jour de Node, pour une raison qui n'a rien à voir
   * avec la conversion d'unités qu'il mesure. C'est la VALEUR qui est
   * contrôlée, et l'unité qui la suit.
   */
  const mille500 = (1500).toLocaleString("fr-FR");
  assert.equal(formatQuantite(1500, "g"), `${mille500} g`);
  assert.equal(formatQuantite(1500, "ml"), `${mille500} ml`);
  assert.ok(mille500.includes("500"), "1 500, et pas 1,5");
  /*
   * ⚠️ LA PREUVE EST DANS LA SORTIE, PAS DANS UNE RECHERCHE DE « / 1000 ».
   * `formatQuantite` arrondit bien à trois décimales en kg (donc divise par
   * 1000 pour arrondir) : chercher cette chaîne ferait rougir le test sur un
   * calcul qui ne convertit rien. On mesure donc ce qui est AFFICHÉ.
   */
  assert.ok(!formatQuantite(1500, "g").includes("kg"), "1 500 g ne devient pas des kg");
  assert.ok(!formatQuantite(1500, "g").includes("1,5"), "ni 1,5 de quoi que ce soit");
  assert.ok(!formatQuantite(1500, "ml").includes("L"), "1 500 ml ne devient pas des litres");
  assert.ok(!formatQuantite(1500, "ml").includes("1,5"));
  // Et dans l'autre sens : un kg reste un kg, il ne se déplie pas en grammes.
  assert.equal(formatQuantite(2, "kg"), `2\u00a0kg`);

  // Aucune table de facteurs d'unité nulle part : une conversion suppose un
  // facteur, et il n'en existe aucun dans le projet.
  for (const facteur of ["FACTEUR", "facteurDUnite", "enGrammes", "versGrammes"]) {
    assert.ok(!CODE_AGREGATION.includes(facteur), `aucun facteur de conversion (${facteur})`);
  }
});

test("R-21 — LES CINQ UNITÉS DE L'ÉNONCÉ S'ÉCRIVENT CORRECTEMENT", () => {
  assert.equal(formatQuantite(370, "g"), `370 g`);
  assert.equal(formatQuantite(1.5, "kg"), `1,5 kg`);
  assert.equal(formatQuantite(250, "ml"), `250 ml`);
  assert.equal(formatQuantite(1.5, "l"), `1,5 L`);
  assert.equal(formatQuantite(2, "piece"), `2 pièces`);
  assert.equal(formatQuantite(1, "piece"), `1 pièce`);
});

test("R-22 — EN kg ET EN L, ARRONDIR À L'ENTIER DIRAIT « 0 kg » POUR 400 g", () => {
  assert.equal(formatQuantite(0.4, "kg"), `0,4 kg`);
  assert.equal(formatQuantite(0.25, "l"), `0,25 L`);
  // En g, les quantités arrivent entières et restent entières.
  assert.equal(formatQuantite(329.99999, "g"), `330 g`);
});

test("R-23 — « L » MAJUSCULE, PARCE QUE « l » SE CONFOND AVEC UN 1", () => {
  assert.equal(libelleDUnite("l", 2), "L");
  assert.equal(libelleDUnite("L", 2), "L");
  assert.equal(libelleDUnite("ml", 2), "ml", "le millilitre garde sa minuscule");
});

test("R-24 — UNE UNITÉ INCONNUE EST ÉCRITE TELLE QUELLE, PAS TRADUITE", () => {
  // Inventer un libellé pour une unité qu'on ne connaît pas afficherait une
  // quantité que l'élève n'a pas validée.
  assert.equal(libelleDUnite("sachet", 3), "sachet");
  assert.equal(formatQuantite(3, "sachet"), `3 sachet`);
});

test("R-25 — LE RAYON NE CHANGE RIEN À LA CLÉ D'AGRÉGATION", () => {
  /*
   * ⚠️ DEUX ALIMENTS DU MÊME RAYON RESTENT DEUX LIGNES. Le rayon est un
   * intertitre : s'il entrait dans la clé, « Carotte » et « Pomme » se
   * sommeraient parce qu'ils sont tous deux au rayon fruits et légumes.
   */
  const carotte = code("Carotte, crue");
  const pomme = code("Pomme, chair et peau, crue");
  assert.equal(rayonDuCodeCiqual(carotte), rayonDuCodeCiqual(pomme), "même rayon");
  const lignes = agregerListeDeCourses([
    item({ identityId: "c", displayName: "Carotte", quantity: 200, codeCiqual: carotte }),
    item({ identityId: "p", displayName: "Pomme", quantity: 150, codeCiqual: pomme }),
  ]);
  assert.equal(lignes.length, 2, "deux aliments, deux lignes");
  assert.deepEqual(lignes.map((x) => x.quantite), [200, 150]);
  assert.ok(!CODE_AGREGATION.includes("rayon"), "la clé d'agrégation ignore le rayon");
});

test("R-26 — LE CODE CIQUAL REMONTE JUSQU'À LA LIGNE AGRÉGÉE", () => {
  const miel = code("Miel");
  const lignes = agregerListeDeCourses([
    item({ identityId: "miel", displayName: "Miel", quantity: 20, codeCiqual: null }),
    item({ identityId: "miel", displayName: "Miel", quantity: 30, codeCiqual: miel }),
  ]);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0]!.quantite, 50);
  assert.equal(
    lignes[0]!.codeCiqual,
    miel,
    "une source qui porte le code complète celle qui ne l'avait pas",
  );
  assert.equal(rayonDuCodeCiqual(lignes[0]!.codeCiqual), "epicerie");
});
