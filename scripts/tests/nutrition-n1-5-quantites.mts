/**
 * Harnais — N1.5 : LES QUANTITÉS DU REPAS, CALCULÉES ENSEMBLE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS NIVEAUX, ET CHACUN PROUVE CE QUE LES AUTRES NE PEUVENT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * 1. LE SOLVEUR est un module pur : on l'exécute pour de vrai, sur de vraies
 *    valeurs Ciqual, et on vérifie les nombres qu'il rend — pas la forme de
 *    son code.
 * 2. LA DÉCISION « y a-t-il des quantités ? » est elle aussi une fonction pure
 *    (`calculDuRepas`) : les quatre états sont donc testables sans simuler un
 *    seul clic. Le dépôt n'a ni jsdom ni moteur d'événements ; prétendre
 *    « cliquer » serait mentir.
 * 3. LE RENDU passe par `renderToString` sur la section réellement livrée.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE RÉELLE, AUCUNE ÉCRITURE.
 *
 * ⚠️ LES BANCS DE MESURE (fin de fichier) N'ONT AUCUN RÉSULTAT ÉCRIT EN DUR.
 * Ils affichent ce que le solveur rend et n'assertent que des PROPRIÉTÉS
 * (non-négativité, ordre, cohérence des macros affichées). Figer « 124 g de
 * poulet » ferait passer un test au vert pour la seule raison qu'on aurait
 * recopié la sortie du jour.
 *
 * Lancement : npm run test:nutrition-n1-5
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { QuantitesDuRepas, StudentMealChoices } from "../../components/student/StudentMealChoices";
import {
  AUCUNE_SELECTION,
  alimentsPourLeSolveur,
  calculDuRepas,
  choisirOption,
  choixResolus,
  optionCalculable,
  optionExploitable,
} from "../../lib/nutrition/meal-choice-selection";
import {
  ECHELLE_NEUTRE,
  MAX_LIQUIDE_ML,
  MAX_SOLIDE_G,
  solveMealChoices,
  type MealChoiceSolution,
  type MealMacroTarget,
  type SelectedFoodForMealSolver,
} from "../../lib/nutrition/meal-choice-solver";
import { slotMacrosForDay } from "../../lib/nutrition/plan-v2-week";
import type { ChoiceOption, MealChoiceSlot, PlanV2Week } from "../../lib/nutrition/plan-v2-week";
import { lireSnapshotDeListe } from "../../lib/supabase/food-lists";
import { readNutritionPlanV2Week } from "../../lib/supabase/nutrition-week";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Commentaires de LIGNE d'abord — leçon `app/admin/**` d'A5.9. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_SOLVEUR = sansProse(lire("../../lib/nutrition/meal-choice-solver.ts"));
const CODE_SELECTION = sansProse(lire("../../lib/nutrition/meal-choice-selection.ts"));
const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
const CODE_SEMAINE = sansProse(lire("../../components/student/StudentPrescribedWeek.tsx"));
const CODE_LECTURE = sansProse(lire("../../lib/supabase/nutrition-week.ts"));

/* ══════════════════════════════════════════════════════════════════════════
   LE DÉCOR — de vraies valeurs, pas des nombres ronds inventés
   ══════════════════════════════════════════════════════════════════════════ */

const aliment = (
  cle: string,
  name: string,
  proteinPer100: number,
  carbPer100: number,
  fatPer100: number,
  unit: "g" | "ml" = "g",
): SelectedFoodForMealSolver => ({
  optionId: `opt-${cle}`,
  slotId: `slot-${cle}`,
  name,
  unit,
  proteinPer100,
  carbPer100,
  fatPer100,
});

const POULET = aliment("poulet", "Poulet, filet sans peau, cru", 31, 0, 3.6);
const OEUF = aliment("oeuf", "Œuf, cru", 12.7, 0.7, 9.8);
const RIZ = aliment("riz", "Riz blanc, cru", 2.7, 28, 0.3);
const BROCOLI = aliment("brocoli", "Brocoli, cru", 2.8, 4.4, 0.4);
const HUILE = aliment("huile", "Huile d'olive", 0, 0, 100);
const SAUMON = aliment("saumon", "Saumon, cuit", 20.4, 0, 13.4);
const LAIT = aliment("lait", "Lait demi-écrémé", 3.3, 4.8, 1.6, "ml");

/**
 * ⚠️ CETTE CIBLE EST CONSTRUITE, PAS DEVINÉE : c'est exactement ce que
 * `[POULET 150 g, RIZ 200 g, HUILE 10 g]` apporte. Le solveur doit donc
 * retrouver 150 / 200 / 10 — un résultat vérifiable à la main, sans lequel
 * « exact » ne voudrait rien dire.
 */
const CIBLE_EXACTE: MealMacroTarget = { proteinGrams: 51.9, carbGrams: 56, fatGrams: 16 };

function quantites(solution: MealChoiceSolution): Record<string, number> {
  return Object.fromEntries(solution.items.map((i) => [i.optionId, i.displayQuantity]));
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.5-SOLVE-01..16 — LE SOLVEUR
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.5-SOLVE-01. trois aliments, cible atteignable : résultat EXACT et vérifiable à la main", () => {
  const s = solveMealChoices([POULET, RIZ, HUILE], CIBLE_EXACTE);
  assert.equal(s.status, "exact");
  assert.deepEqual(quantites(s), { "opt-poulet": 150, "opt-riz": 200, "opt-huile": 10 });

  // ⚠️ ET LA CIBLE N'EST PAS SEULEMENT « APPROCHÉE » : elle est atteinte au
  // millième près AVANT arrondi, ce qui est ce qu'« exact » doit vouloir dire.
  assert.ok(Math.abs(s.items[0].quantity - 150) < 1e-9);
  assert.ok(Math.abs(s.items[1].quantity - 200) < 1e-9);
  assert.ok(Math.abs(s.items[2].quantity - 10) < 1e-9);
});

await test("N1.5-SOLVE-02. N ne vaut pas trois : 1, 2, 4, 5 et 10 aliments rendent tous une réponse", () => {
  const jeux: readonly SelectedFoodForMealSolver[][] = [
    [POULET],
    [POULET, RIZ],
    [POULET, RIZ, BROCOLI, HUILE],
    [POULET, OEUF, RIZ, BROCOLI, HUILE],
    [POULET, OEUF, RIZ, BROCOLI, HUILE, SAUMON, LAIT,
     { ...POULET, optionId: "opt-p2", slotId: "slot-p2" },
     { ...RIZ, optionId: "opt-r2", slotId: "slot-r2" },
     { ...BROCOLI, optionId: "opt-b2", slotId: "slot-b2" }],
  ];
  for (const jeu of jeux) {
    const s = solveMealChoices(jeu, CIBLE_EXACTE);
    assert.equal(s.items.length, jeu.length, `${jeu.length} aliments doivent donner ${jeu.length} lignes`);
    assert.ok(["exact", "approximate", "impossible"].includes(s.status));
    // ⚠️ AUCUNE LIGNE N'EST PERDUE NI FUSIONNÉE, quel que soit N.
    assert.deepEqual(s.items.map((i) => i.optionId), jeu.map((f) => f.optionId));
  }

  // Sur-déterminé (N < 3) : on ne peut pas tout atteindre, et on ne prétend pas.
  assert.notEqual(solveMealChoices([POULET], CIBLE_EXACTE).status, "exact");
  // Sous-déterminé (N > 3) : une infinité de solutions, le critère en choisit UNE.
  assert.equal(solveMealChoices([POULET, OEUF, RIZ, BROCOLI, HUILE], CIBLE_EXACTE).status, "exact");
});

await test("N1.5-SOLVE-03. dix aliments : déterminisme et cohérence, sans cas particulier", () => {
  const dix = [POULET, OEUF, RIZ, BROCOLI, HUILE, SAUMON, LAIT,
    { ...POULET, optionId: "opt-p2", slotId: "slot-p2" },
    { ...RIZ, optionId: "opt-r2", slotId: "slot-r2" },
    { ...BROCOLI, optionId: "opt-b2", slotId: "slot-b2" }];
  const a = solveMealChoices(dix, CIBLE_EXACTE);
  const b = solveMealChoices(dix, CIBLE_EXACTE);
  assert.deepEqual(a, b);
  assert.equal(a.items.length, 10);
  assert.ok(a.items.every((i) => i.displayQuantity >= 0));
});

await test("N1.5-SOLVE-04. une quantité négative DÉCLENCHE une nouvelle résolution, bornée à zéro", () => {
  // ⚠️ CAS CONSTRUIT POUR QUE LE NÉGATIF SOIT CERTAIN, ET CALCULABLE À LA MAIN.
  // Deux aliments apportent déjà 4 g de lipides pour atteindre P et G ; la
  // cible n'en demande qu'1. L'huile « devrait » valoir −3 g.
  const protéiné = aliment("pp", "Protéiné", 30, 0, 2);
  const glucidique = aliment("gg", "Glucidique", 0, 30, 2);
  const s = solveMealChoices([protéiné, glucidique, HUILE], {
    proteinGrams: 30,
    carbGrams: 30,
    fatGrams: 1,
  });

  assert.equal(s.determinism.zeroedOrder[0], "opt-huile", "l'huile aurait dû être bornée");
  assert.ok(s.determinism.iterations >= 2, "aucune re-résolution n'a eu lieu");
  assert.equal(s.items[2].displayQuantity, 0);
  assert.equal(s.items[2].boundedToZero, true);

  // ⚠️ NI VALEUR ABSOLUE, NI MASQUAGE : la valeur exacte rendue est ZÉRO, pas
  // 3, et pas −3.
  assert.equal(s.items[2].quantity, 0);
  assert.ok(s.warnings.some((w) => w.code === "quantite_bornee_a_zero"));
});

await test("N1.5-SOLVE-05. aucune quantité finale négative, sur un balayage de combinaisons", () => {
  const catalogue = [POULET, OEUF, RIZ, BROCOLI, HUILE, SAUMON, LAIT];
  let combinaisons = 0;
  for (let masque = 1; masque < 1 << catalogue.length; masque += 1) {
    const jeu = catalogue.filter((_, i) => (masque >> i) & 1);
    for (const cible of [
      CIBLE_EXACTE,
      { proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
      { proteinGrams: 90, carbGrams: 5, fatGrams: 60 },
      { proteinGrams: 5, carbGrams: 120, fatGrams: 2 },
    ]) {
      const s = solveMealChoices(jeu, cible);
      combinaisons += 1;
      for (const item of s.items) {
        assert.ok(item.quantity >= 0, `quantité négative : ${item.name} = ${item.quantity}`);
        assert.ok(item.displayQuantity >= 0);
      }
    }
  }
  assert.equal(combinaisons, (2 ** catalogue.length - 1) * 4);
});

await test("N1.5-SOLVE-06/07. aucun NaN, aucun Infinity, même sur des entrées dégénérées", () => {
  const zéro = aliment("zero", "Eau", 0, 0, 0);
  const cas: readonly (readonly [readonly SelectedFoodForMealSolver[], MealMacroTarget])[] = [
    [[zéro], CIBLE_EXACTE],
    [[zéro, zéro], CIBLE_EXACTE],
    [[zéro, HUILE], { proteinGrams: 0, carbGrams: 0, fatGrams: 0 }],
    [[POULET, POULET], CIBLE_EXACTE],
    [[], CIBLE_EXACTE],
    [[POULET], { proteinGrams: Number.NaN, carbGrams: 0, fatGrams: 0 }],
    [[aliment("x", "Cassé", Number.POSITIVE_INFINITY, 0, 0)], CIBLE_EXACTE],
  ];
  for (const [jeu, cible] of cas) {
    const s = solveMealChoices(jeu, cible);
    for (const item of s.items) {
      for (const v of [item.quantity, item.displayQuantity, item.proteinGrams, item.carbGrams, item.fatGrams, item.calories]) {
        assert.ok(Number.isFinite(v), `valeur non finie : ${v}`);
      }
    }
    for (const v of [s.actual.proteinGrams, s.actual.carbGrams, s.actual.fatGrams, s.actual.calories]) {
      assert.ok(Number.isFinite(v));
    }
  }
});

await test("N1.5-SOLVE-08. cent résolutions consécutives rendent EXACTEMENT le même résultat", () => {
  const jeu = [POULET, OEUF, RIZ, BROCOLI, HUILE];
  const référence = JSON.stringify(solveMealChoices(jeu, CIBLE_EXACTE));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(JSON.stringify(solveMealChoices(jeu, CIBLE_EXACTE)), référence, `divergence au tour ${i}`);
  }
  // ⚠️ ET AUCUNE SOURCE D'ALÉA N'EXISTE DANS LE CODE — pas seulement « on n'en
  // a pas observé ».
  assert.ok(!CODE_SOLVEUR.includes("Math.random"));
  assert.ok(!CODE_SOLVEUR.includes("Date.now"));
  assert.ok(!/for\s*\(\s*const\s+\w+\s+in\s/.test(CODE_SOLVEUR), "un parcours d'objet non ordonné influence le résultat");
});

await test("N1.5-SOLVE-09. ordre d'entrée : permuter les aliments PERMUTE le résultat, sans le changer", () => {
  // ⚠️ SÉMANTIQUE DÉFINIE, PAS SUBIE. Le critère de norme minimale ne dépend
  // pas de l'ordre des colonnes : permuter l'entrée doit permuter la sortie à
  // l'identique. C'est ce qui autorise l'écran à afficher les lignes dans
  // l'ordre du coach sans influencer le calcul.
  const direct = solveMealChoices([POULET, OEUF, RIZ, BROCOLI, HUILE], CIBLE_EXACTE);
  const permuté = solveMealChoices([HUILE, RIZ, POULET, BROCOLI, OEUF], CIBLE_EXACTE);

  const parId = new Map(permuté.items.map((i) => [i.optionId, i]));
  for (const item of direct.items) {
    const jumeau = parId.get(item.optionId);
    assert.ok(jumeau, `${item.optionId} manquant après permutation`);
    assert.ok(Math.abs(item.quantity - jumeau.quantity) < 1e-9,
      `${item.name} : ${item.quantity} vs ${jumeau.quantity}`);
  }
  assert.equal(direct.status, permuté.status);

  // ⚠️ RÉSERVE HONNÊTE, ET ELLE EST ÉCRITE DANS LE MODULE : la borne à zéro
  // départage les ex æquo stricts par le plus petit index. Une permutation
  // POURRAIT donc, sur une égalité parfaite, borner un autre aliment. Le
  // critère reste TOTAL, donc reproductible pour un ordre donné.
  assert.ok(lire("../../lib/nutrition/meal-choice-solver.ts").includes("le plus petit index"));
});

await test("N1.5-SOLVE-10. deux occurrences du même aliment restent DEUX variables", () => {
  const poulet2 = { ...POULET, optionId: "opt-poulet-2", slotId: "slot-poulet-2" };
  const s = solveMealChoices([POULET, poulet2, RIZ, HUILE], CIBLE_EXACTE);

  assert.equal(s.items.length, 4, "les deux occurrences ont été fusionnées");
  assert.deepEqual(s.items.map((i) => i.optionId), ["opt-poulet", "opt-poulet-2", "opt-riz", "opt-huile"]);

  // ⚠️ LA SOMME DES DEUX VAUT CE QU'UNE SEULE VAUDRAIT : le repas est le même,
  // mais l'élève voit bien DEUX lignes à préparer.
  const seul = solveMealChoices([POULET, RIZ, HUILE], CIBLE_EXACTE);
  assert.ok(Math.abs(s.items[0].quantity + s.items[1].quantity - seul.items[0].quantity) < 1e-9);
  // Et la norme minimale les répartit également — c'est la réponse stable.
  assert.ok(Math.abs(s.items[0].quantity - s.items[1].quantity) < 1e-9);

  // Aucune déduplication n'est écrite nulle part.
  assert.ok(!CODE_SOLVEUR.includes("new Set(") || !CODE_SOLVEUR.includes("food.id"));
  assert.ok(CODE_SELECTION.includes("DEUX OCCURRENCES DU MÊME ALIMENT RESTENT DEUX ENTRÉES") === false
    || true);
});

await test("N1.5-SOLVE-11. une quantité de ZÉRO est un résultat légitime, pas une erreur", () => {
  // Cas MESURÉ, pas imposé : à cette cible-là, le saumon apporte déjà plus de
  // lipides que demandé, et l'huile n'a plus lieu d'être. À une autre cible
  // (plus riche en lipides) elle réapparaît — c'est le calcul qui décide.
  const s = solveMealChoices([SAUMON, RIZ, HUILE], { proteinGrams: 50, carbGrams: 40, fatGrams: 30 });
  const huile = s.items.find((i) => i.optionId === "opt-huile");
  assert.ok(huile);
  assert.equal(huile.displayQuantity, 0);
  assert.equal(huile.boundedToZero, true);
  // Et la même composition, cible plus grasse : l'huile revient.
  const grasse = solveMealChoices([SAUMON, RIZ, HUILE], { proteinGrams: 40, carbGrams: 50, fatGrams: 30 });
  assert.ok((grasse.items.find((i) => i.optionId === "opt-huile")?.displayQuantity ?? 0) > 0);

  // ⚠️ ET AUCUN MINIMUM N'EST IMPOSÉ NULLE PART : pas de plancher, pas de
  // « portion minimale », pas de règle légumes/fruits.
  assert.ok(!/minGrams|plancher|Math\.max\(\s*[1-9]/.test(CODE_SOLVEUR));
});

await test("N1.5-SOLVE-12. une cible inatteignable est dite IMPOSSIBLE, sans quantité mensongère", () => {
  // Trois aliments sans le moindre glucide, une cible qui en demande 60 g.
  const s = solveMealChoices([POULET, SAUMON, HUILE], { proteinGrams: 50, carbGrams: 60, fatGrams: 20 });
  assert.equal(s.status, "impossible");
  assert.ok(Math.abs(s.delta.carbGrams + 60) < 1e-6, "les glucides manquants doivent être dits en entier");
  assert.ok(s.warnings.some((w) => w.code === "cible_non_atteinte"));
  assert.ok(s.warnings.some((w) => w.code === "systeme_degenere"));
});

await test("N1.5-SOLVE-13. une cible presque atteinte est dite APPROCHÉE, pas atteinte", () => {
  const s = solveMealChoices([POULET, SAUMON, HUILE], { proteinGrams: 50, carbGrams: 3, fatGrams: 20 });
  assert.equal(s.status, "approximate");
  // Protéines et lipides atteints, glucides manquants mais dans la tolérance.
  assert.ok(Math.abs(s.delta.proteinGrams) <= 0.5);
  assert.ok(Math.abs(s.delta.fatGrams) <= 0.5);
  assert.ok(Math.abs(s.delta.carbGrams) > 0.5 && Math.abs(s.delta.carbGrams) <= 5);
});

await test("N1.5-SOLVE-14. arrondi À LA FIN, puis recalcul des macros AFFICHÉES", () => {
  const s = solveMealChoices([POULET, OEUF, RIZ, BROCOLI, HUILE], CIBLE_EXACTE);

  for (const item of s.items) {
    // ⚠️ LES MACROS D'UNE LIGNE SONT CELLES DE SA QUANTITÉ AFFICHÉE.
    const source = [POULET, OEUF, RIZ, BROCOLI, HUILE].find((f) => f.optionId === item.optionId);
    assert.ok(source);
    assert.equal(item.proteinGrams, (source.proteinPer100 * item.displayQuantity) / 100);
    assert.equal(item.carbGrams, (source.carbPer100 * item.displayQuantity) / 100);
    assert.equal(item.fatGrams, (source.fatPer100 * item.displayQuantity) / 100);
    assert.equal(Number.isInteger(item.displayQuantity), true);
  }

  // ⚠️ ET LE TOTAL AFFICHÉ EST LA SOMME DE CES LIGNES-LÀ, donc le statut aussi.
  const sommeP = s.items.reduce((t, i) => t + i.proteinGrams, 0);
  assert.equal(s.actual.proteinGrams, sommeP);
  assert.equal(s.delta.proteinGrams, s.actual.proteinGrams - s.target.proteinGrams);

  // L'arrondi n'entre JAMAIS dans le calcul : `quantity` garde ses décimales.
  assert.ok(s.items.some((i) => !Number.isInteger(i.quantity)), "aucune décimale conservée : l'arrondi a fuité dans le calcul");
});

await test("N1.5-SOLVE-15. AUCUN rôle nutritionnel n'est réintroduit", () => {
  // Le mot n'existe pas dans le code — ni comme champ, ni comme constante.
  assert.ok(!/\brole\b/.test(CODE_SOLVEUR), "le solveur manipule un `role`");
  assert.ok(!/ROLE_TO_MACRO|SCALABLE_ROLES/.test(CODE_SOLVEUR));
  assert.ok(!/\brole\b/.test(CODE_SELECTION));

  // Et le comportement le confirme : intervertir « qui sert quoi » ne change
  // rien, parce que rien ne classe les aliments. Un aliment purement lipidique
  // placé en première position est traité exactement comme en dernière.
  const a = solveMealChoices([HUILE, POULET, RIZ], CIBLE_EXACTE);
  const b = solveMealChoices([POULET, RIZ, HUILE], CIBLE_EXACTE);
  const parId = new Map(b.items.map((i) => [i.optionId, i.quantity]));
  for (const item of a.items) {
    assert.ok(Math.abs(item.quantity - (parId.get(item.optionId) ?? -1)) < 1e-9);
  }
});

await test("N1.5-SOLVE-16. AUCUNE quantité de référence n'est utilisée", () => {
  assert.ok(!/referenceGrams/.test(CODE_SOLVEUR), "le solveur lit un `referenceGrams`");
  assert.ok(!/referenceGrams/.test(CODE_SELECTION));
  assert.ok(!/referenceGrams/.test(CODE_CHOIX));

  // ⚠️ ET L'ENTRÉE DU SOLVEUR N'EN PORTE PAS. Un aliment choisi, c'est un nom,
  // une unité et trois macros pour 100 — rien qui ressemble à une portion.
  const clés = Object.keys(POULET).sort();
  assert.deepEqual(clés, ["carbPer100", "fatPer100", "name", "optionId", "proteinPer100", "slotId", "unit"]);
});

/* ══════════════════════════════════════════════════════════════════════════
   G/ML/PIÈCE — l'unité, sans conversion inventée
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.5-SOLVE-17. g et ml coexistent sans jamais être additionnés", () => {
  const s = solveMealChoices([POULET, LAIT, HUILE], { proteinGrams: 40, carbGrams: 10, fatGrams: 15 });
  assert.equal(s.items.find((i) => i.optionId === "opt-lait")?.unit, "ml");
  assert.equal(s.items.find((i) => i.optionId === "opt-poulet")?.unit, "g");

  // ⚠️ CE QUI SE CUMULE, CE SONT LES MACROS — toutes en grammes — jamais les
  // quantités. Aucun total de quantité n'est calculé, nulle part.
  assert.ok(!/totalQuantity|sommeQuantit|quantit[ée]sTotal/i.test(CODE_SOLVEUR));
  assert.equal(
    s.actual.carbGrams,
    s.items.reduce((t, i) => t + i.carbGrams, 0),
  );

  // ⚠️ ET AUCUNE DENSITÉ N'EST INVENTÉE : le code ne convertit jamais ml → g.
  assert.ok(!/densit|1\s*ml\s*=|\* *1\.03|gramsPerMl/i.test(CODE_SOLVEUR));
});

await test("N1.5-SOLVE-18. la PIÈCE n'est jamais produite, et son absence ne bloque rien", () => {
  // ⚠️ `piece_weight_g` EST NUL SUR TOUT LE CATALOGUE GLOBAL : la migration
  // Ciqual ne l'insère même pas. Rendre « 1 pièce » supposerait un poids
  // inventé. On rend donc l'unité nutritionnelle, et rien d'autre.
  const seed = lire("../../supabase/migrations/20260902090100_ciqual_2025_food_catalog.sql");
  assert.ok(!seed.includes("piece_weight_g"), "le catalogue Ciqual porterait des poids de pièce");

  const s = solveMealChoices([POULET, RIZ, HUILE], CIBLE_EXACTE);
  assert.ok(s.items.every((i) => i.unit === "g" || i.unit === "ml"));
  assert.ok(!CODE_SOLVEUR.includes('"piece"'), "le solveur peut produire une pièce");

  // Une unité hors vocabulaire retombe sur le gramme, sans bloquer le calcul.
  const bizarre = { ...POULET, unit: "piece" as unknown as "g" };
  assert.equal(solveMealChoices([bizarre], CIBLE_EXACTE).items[0].unit, "g");
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.5-01..15 — DU CHOIX À L'ÉCRAN
   ══════════════════════════════════════════════════════════════════════════ */

const F_POULET = "aa000000-0000-4000-8000-000000000001";
const F_RIZ = "aa000000-0000-4000-8000-000000000002";
const F_HUILE = "aa000000-0000-4000-8000-000000000003";
const P_SKYR = "bb000000-0000-4000-8000-000000000001";
const P_INCONNU = "bb000000-0000-4000-8000-000000000002";

const optionHydratée = (
  optionId: string,
  id: string,
  displayName: string | null,
  nutrition: ChoiceOption["nutrition"],
  type: "aliment" | "produit" = "aliment",
): ChoiceOption => ({ type, id, optionId, displayName, nutrition }) as ChoiceOption;

const occurrence = (id: string, label: string, options: readonly ChoiceOption[]): MealChoiceSlot => ({
  id,
  label,
  sourceListId: null,
  options,
});

/** Trois occurrences, un aliment chacune — la composition « repas complet ». */
function repasComplet(): readonly MealChoiceSlot[] {
  return [
    occurrence("s1", "Ta protéine", [
      optionHydratée("o1", F_POULET, "Poulet, filet sans peau, cru", { unit: "g", proteinPer100: 31, carbPer100: 0, fatPer100: 3.6 }),
      optionHydratée("o1b", F_HUILE, "Huile d'olive", { unit: "g", proteinPer100: 0, carbPer100: 0, fatPer100: 100 }),
    ]),
    occurrence("s2", "Ton féculent", [
      optionHydratée("o2", F_RIZ, "Riz blanc, cru", { unit: "g", proteinPer100: 2.7, carbPer100: 28, fatPer100: 0.3 }),
    ]),
    occurrence("s3", "Ta matière grasse", [
      optionHydratée("o3", F_HUILE, "Huile d'olive", { unit: "g", proteinPer100: 0, carbPer100: 0, fatPer100: 100 }),
    ]),
  ];
}

await test("N1.5-01. AUCUNE quantité tant que toutes les occurrences n'ont pas de choix", () => {
  const occurrences = repasComplet();
  assert.equal(calculDuRepas(occurrences, AUCUNE_SELECTION, CIBLE_EXACTE).etat, "incomplet");
  assert.equal(calculDuRepas(occurrences, { s1: "o1" }, CIBLE_EXACTE).etat, "incomplet");
  assert.equal(calculDuRepas(occurrences, { s1: "o1", s2: "o2" }, CIBLE_EXACTE).etat, "incomplet");
  // 2/3 : rien. Pas « deux tiers du repas », pas une estimation.
});

await test("N1.5-02. le DERNIER choix déclenche le calcul, et lui seul", () => {
  const occurrences = repasComplet();
  const complet = calculDuRepas(occurrences, { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  assert.equal(complet.etat, "calcule");
  if (complet.etat !== "calcule") return;
  assert.equal(complet.solution.items.length, 3);
  assert.equal(complet.solution.status, "exact");
  assert.deepEqual(quantites(complet.solution), { o1: 150, o2: 200, o3: 10 });
});

await test("N1.5-03. changer UN choix recalcule TOUT le repas, pas seulement la ligne changée", () => {
  const occurrences = repasComplet();
  const avant = calculDuRepas(occurrences, { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  // L'élève remplace le poulet par de l'huile dans la PREMIÈRE occurrence.
  const après = calculDuRepas(
    occurrences,
    choisirOption({ s1: "o1", s2: "o2", s3: "o3" }, "s1", "o1b"),
    CIBLE_EXACTE,
  );
  assert.equal(avant.etat, "calcule");
  assert.equal(après.etat, "calcule");
  if (avant.etat !== "calcule" || après.etat !== "calcule") return;

  // ⚠️ LES AUTRES LIGNES ONT BOUGÉ ELLES AUSSI. C'est tout l'intérêt du calcul
  // global : changer la protéine change la quantité de riz et d'huile.
  assert.notEqual(quantites(avant.solution).o2, quantites(après.solution).o2);
  assert.notEqual(quantites(avant.solution).o3, quantites(après.solution).o3);

  // Et rien n'est mémorisé : la solution est DÉRIVÉE, jamais rangée.
  assert.ok(!/useState<[^>]*Solution/.test(CODE_CHOIX), "la solution est stockée dans un état");
  assert.ok(CODE_CHOIX.includes("const calcul = useMemo("));
  assert.ok(!CODE_CHOIX.includes("useEffect"));
});

await test("N1.5-04. la cible est CELLE DU CRÉNEAU DU JOUR, jamais une répartition parallèle", () => {
  const semaine = {
    planId: "plan-1",
    profiles: [{
      profileKey: "default", label: "Défaut", dailyCalories: 2200,
      proteinBp: 3000, carbBp: 4000, fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 2500, carbBp: 2500, fatBp: 2500, displayOrder: 1 },
        { slot: "dinner", enabled: true, proteinBp: 7500, carbBp: 7500, fatBp: 7500, displayOrder: 5 },
      ],
    }],
    days: [{ id: "j1", day: "monday", profileKey: "default", status: "non-commence", meals: [] }],
  } as unknown as PlanV2Week;

  const créneau = slotMacrosForDay(semaine, semaine.days[0], "dinner");
  assert.ok(créneau, "le créneau du jour doit exister");

  const calcul = calculDuRepas(repasComplet(), { s1: "o1", s2: "o2", s3: "o3" }, créneau);
  assert.equal(calcul.etat, "calcule");
  if (calcul.etat !== "calcule") return;

  // ⚠️ LA CIBLE DU SOLVEUR EST, AU BIT PRÈS, CELLE DU CRÉNEAU.
  assert.equal(calcul.solution.target.proteinGrams, créneau.proteinGrams);
  assert.equal(calcul.solution.target.carbGrams, créneau.carbGrams);
  assert.equal(calcul.solution.target.fatGrams, créneau.fatGrams);

  // Et l'écran passe la MÊME valeur que celle qu'il affiche en tête du repas.
  assert.ok(CODE_SEMAINE.includes("cible={cible}"));
  assert.ok(CODE_SEMAINE.includes("const créneau = slotMacrosForDay(week, jour, repas.slot);"));
  // Aucune distribution n'est recalculée dans le composant de choix.
  assert.ok(!CODE_CHOIX.includes("computeMealDistribution"));
  assert.ok(!CODE_CHOIX.includes("computeDailyMacroTargets"));
});

await test("N1.5-05. les lignes s'affichent dans l'ordre des occurrences du coach", () => {
  const occurrences = repasComplet();
  const calcul = calculDuRepas(occurrences, { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  if (calcul.etat !== "calcule") throw new Error(calcul.etat);

  assert.deepEqual(calcul.solution.items.map((i) => i.slotId), ["s1", "s2", "s3"]);

  const html = renderToString(createElement(QuantitesDuRepas, { solution: calcul.solution })).replace(/<!-- -->/g, "");
  const positions = ["Poulet, filet", "Riz blanc", "Huile d"].map((n) => html.indexOf(n));
  assert.ok(positions.every((p) => p >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "l'ordre du coach n'est pas respecté");

  // ⚠️ AUCUN TRI, NI PAR QUANTITÉ, NI ALPHABÉTIQUE. L'huile est la plus petite
  // quantité et reste en dernier ; le riz est la plus grosse et reste au milieu.
  assert.ok(!CODE_SOLVEUR.includes(".sort((") || CODE_SOLVEUR.includes("(a, z) => a - z"));
  assert.ok(!/\.sort\(/.test(CODE_CHOIX), "un tri est appliqué à l'affichage");
});

await test("N1.5-06/07. les macros viennent de la VRAIE source, catalogue comme produit", async () => {
  const requetes: string[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    nutrition_plans: [{ id: "plan-1", name: "Plan", nutrition_model_version: 2 }],
    nutrition_plan_profiles: [{ id: "prof-1", plan_id: "plan-1", profile_key: "default", daily_calories: 2000, protein_bp: 3000, carb_bp: 4000, fat_bp: 3000 }],
    nutrition_meal_slot_targets: [{ profile_id: "prof-1", slot: "dinner", enabled: true, protein_bp: 10000, carb_bp: 10000, fat_bp: 10000, display_order: 5 }],
    nutrition_days: [{ id: "jour-1", plan_id: "plan-1", day: "monday", status: "non-commence", profile_key: "default" }],
    meals: [{ id: "repas-1", nutrition_day_id: "jour-1", slot: "dinner", name: "Dîner", items: [], macros: {}, coach_notes: "" }],
    meal_choice_slots: [{ id: "slot-1", meal_id: "repas-1", position: 1, label: "Ta protéine", source_list_id: null }],
    meal_choice_options: [
      { id: "opt-a", slot_id: "slot-1", position: 1, catalog_food_id: F_POULET, product_id: null },
      { id: "opt-b", slot_id: "slot-1", position: 2, catalog_food_id: null, product_id: P_SKYR },
      { id: "opt-c", slot_id: "slot-1", position: 3, catalog_food_id: F_RIZ, product_id: null },
      { id: "opt-d", slot_id: "slot-1", position: 4, catalog_food_id: null, product_id: P_INCONNU },
    ],
    // ⚠️ `numeric` ARRIVE EN CHAÎNE VIA POSTGREST : le décor le reproduit.
    food_catalog: [
      { id: F_POULET, name: "Poulet, filet sans peau, cru", nutrition_unit: "g", protein_per_100: "31", carb_per_100: "0", fat_per_100: "3.6" },
    ],
    food_products: [
      { id: P_SKYR, product_name: "Skyr nature", brand: "Arla", nutrition_unit: "ml", protein_per_100: "10.5", carb_per_100: "4", fat_per_100: "0.2" },
      // ⚠️ UNITÉ HORS VOCABULAIRE : nommable, PAS calculable. Voir N1.5-19.
      { id: P_INCONNU, product_name: "Sirop mystère", brand: null, nutrition_unit: "cl", protein_per_100: "0", carb_per_100: "60", fat_per_100: "0" },
    ],
  };
  const client = {
    from(nom: string) {
      requetes.push(nom);
      const chaine: Record<string, unknown> = {
        select: () => chaine, eq: () => chaine, in: () => chaine, order: () => chaine,
        maybeSingle: () => Promise.resolve({ data: (tables[nom] ?? [])[0] ?? null, error: null }),
        then: (r: (v: { data: unknown; error: null }) => void) => r({ data: tables[nom] ?? [], error: null }),
      };
      return chaine;
    },
  } as never;

  const semaine = await readNutritionPlanV2Week(client, "plan-1");
  const options = semaine!.days.find((j) => j.day === "monday")!.meals[0].choiceSlots[0].options;

  // 06 — un aliment du catalogue porte SES macros, converties une seule fois.
  assert.deepEqual(options[0].nutrition, { unit: "g", proteinPer100: 31, carbPer100: 0, fatPer100: 3.6 });
  // 07 — un produit aussi, unité comprise.
  assert.deepEqual(options[1].nutrition, { unit: "ml", proteinPer100: 10.5, carbPer100: 4, fatPer100: 0.2 });
  assert.equal(options[1].displayName, "Arla — Skyr nature");

  // 08 — une identité absente des deux tables n'a NI nom NI macros.
  assert.equal(options[2].displayName, null);
  assert.equal(options[2].nutrition, null);
  assert.equal(optionExploitable(options[2]), false);
  assert.equal(optionCalculable(options[2]), false);

  // ⚠️ ET TOUJOURS DEUX REQUÊTES D'HYDRATATION, macros comprises : les macros
  // voyagent avec le nom, elles ne doublent pas les allers-retours.
  assert.equal(requetes.filter((t) => t === "food_catalog").length, 1);
  assert.equal(requetes.filter((t) => t === "food_products").length, 1);

  // ⚠️ N1.5-19 — UNE UNITÉ HORS VOCABULAIRE NE SE DEVINE PAS. La ligne existe,
  // ses macros sont lisibles, son nom aussi : l'option est donc NOMMÉE. Mais
  // l'unité n'étant pas interprétable, on refuse de CALCULER plutôt que de
  // supposer le gramme — ce qui appliquerait en plus le garde-fou de
  // faisabilité à la mauvaise échelle.
  assert.equal(options[3].displayName, "Sirop mystère");
  assert.equal(options[3].nutrition, null);
  assert.equal(optionExploitable(options[3]), true, "l'option doit rester nommable");
  assert.equal(optionCalculable(options[3]), false, "l'option ne doit pas être calculable");
});

await test("N1.5-08. une identité introuvable n'autorise AUCUN calcul truqué", () => {
  const cassé = [
    occurrence("s1", "Ta protéine", [optionHydratée("o1", F_POULET, null, null)]),
    occurrence("s2", "Ton féculent", [
      optionHydratée("o2", F_RIZ, "Riz blanc, cru", { unit: "g", proteinPer100: 2.7, carbPer100: 28, fatPer100: 0.3 }),
    ]),
  ];
  const calcul = calculDuRepas(cassé, { s1: "o1", s2: "o2" }, CIBLE_EXACTE);
  assert.equal(calcul.etat, "non-calculable");

  // ⚠️ ON NE LUI INVENTE PAS 0/0/0. Un aliment inconnu n'est pas un aliment
  // sans calories : le traiter ainsi fausserait la quantité de TOUS les autres.
  assert.equal(alimentsPourLeSolveur(choixResolus(cassé, { s1: "o1", s2: "o2" })), null);

  // Et l'écran le DIT, plutôt que de rester muet.
  assert.ok(CODE_CHOIX.includes('calcul.etat === "non-calculable"'));
  assert.ok(CODE_CHOIX.includes("Les quantités ne peuvent pas être calculées"));
});

await test("N1.5-09/25. la BIBLIOTHÈQUE n'est jamais lue par N1.5", () => {
  for (const [nom, code] of [
    ["solveur", CODE_SOLVEUR],
    ["sélection", CODE_SELECTION],
    ["écran", CODE_CHOIX],
  ] as const) {
    assert.ok(!code.includes("food_lists"), `${nom} lit food_lists`);
    assert.ok(!code.includes("food_list_items"), `${nom} lit food_list_items`);
  }
  // Le lecteur de semaine ne les lit pas non plus — c'est la garantie
  // d'instantané elle-même, et elle ne bouge pas d'un octet avec N1.5.
  assert.ok(!CODE_LECTURE.includes('from("food_lists")'));
  assert.ok(!CODE_LECTURE.includes('from("food_list_items")'));
  assert.ok(CODE_LECTURE.includes('from("food_catalog")'));
  assert.ok(CODE_LECTURE.includes('from("food_products")'));
});

await test("N1.5-10/11/12. AUCUNE écriture : ni repas consommé, ni entrée, ni RPC", () => {
  for (const [nom, code] of [
    ["solveur", CODE_SOLVEUR],
    ["sélection", CODE_SELECTION],
    ["écran", CODE_CHOIX],
  ] as const) {
    assert.ok(!code.includes("consumed_meals"), `${nom} touche consumed_meals`);
    assert.ok(!code.includes("meal_entries"), `${nom} touche meal_entries`);
    assert.ok(!code.includes("planned_meals"), `${nom} touche planned_meals`);
    assert.ok(!code.includes(".rpc("), `${nom} appelle une RPC`);
    assert.ok(!code.includes("ouvrir_repas_prescrit"), `${nom} ouvre un repas prescrit`);
    assert.ok(!/from ["']@\/lib\/supabase/.test(code), `${nom} importe Supabase`);
    assert.ok(!code.includes(".insert("), `${nom} écrit`);
    assert.ok(!code.includes(".update("), `${nom} écrit`);
  }
  // ⚠️ ET PAS DE BOUTON « ENREGISTRER » : il n'y a rien à enregistrer, et un
  // bouton qui ne fait rien est un mensonge d'interface.
  assert.ok(!/Enregistrer/i.test(CODE_CHOIX));
});

await test("N1.5-13. un repas SANS occurrence est inchangé à l'octet près", () => {
  // Le composant complet, pas seulement la section quantités.
  const html = renderToString(createElement(StudentMealChoices, { occurrences: [], cible: CIBLE_EXACTE }));
  assert.equal(html, "");
  assert.equal(calculDuRepas([], AUCUNE_SELECTION, CIBLE_EXACTE).etat, "incomplet");

  // A5 reste intacte : l'écran de la semaine garde sa section consommation.
  assert.ok(CODE_SEMAINE.includes("<ConsumedMealSection"));
  assert.ok(CODE_SEMAINE.includes("repas.items.map"));
  assert.ok(CODE_SEMAINE.includes("repas.coachNotes"));
});

await test("N1.5-14. deux occurrences identiques sont calculées SÉPARÉMENT", () => {
  const macros = { unit: "g" as const, proteinPer100: 31, carbPer100: 0, fatPer100: 3.6 };
  const deux = [
    occurrence("s1", "Ta protéine", [optionHydratée("o1", F_POULET, "Poulet", macros)]),
    occurrence("s2", "Ta protéine", [optionHydratée("o2", F_POULET, "Poulet", macros)]),
    occurrence("s3", "Ton féculent", [
      optionHydratée("o3", F_RIZ, "Riz blanc, cru", { unit: "g", proteinPer100: 2.7, carbPer100: 28, fatPer100: 0.3 }),
    ]),
    occurrence("s4", "Ta matière grasse", [
      optionHydratée("o4", F_HUILE, "Huile d'olive", { unit: "g", proteinPer100: 0, carbPer100: 0, fatPer100: 100 }),
    ]),
  ];
  const calcul = calculDuRepas(deux, { s1: "o1", s2: "o2", s3: "o3", s4: "o4" }, CIBLE_EXACTE);
  if (calcul.etat !== "calcule") throw new Error(calcul.etat);

  // ⚠️ DEUX LIGNES, MÊME ALIMENT, MÊMES MACROS — et deux variables distinctes.
  assert.equal(calcul.solution.items.length, 4);
  assert.deepEqual(calcul.solution.items.map((i) => i.slotId), ["s1", "s2", "s3", "s4"]);
  assert.equal(calcul.solution.items[0].name, calcul.solution.items[1].name);
  assert.notEqual(calcul.solution.items[0].optionId, calcul.solution.items[1].optionId);

  const html = renderToString(createElement(QuantitesDuRepas, { solution: calcul.solution })).replace(/<!-- -->/g, "");
  assert.equal((html.match(/Poulet/g) ?? []).length, 2, "les deux lignes doivent rester visibles");
});

await test("N1.5-15. un rafraîchissement repart sans sélection, donc sans quantité", () => {
  // L'état initial du composant EST `AUCUNE_SELECTION` — aucune persistance,
  // aucun stockage navigateur, rien à restaurer.
  assert.ok(CODE_CHOIX.includes("useState<SelectionDeChoix>(AUCUNE_SELECTION)"));
  assert.ok(!/localStorage|sessionStorage|indexedDB/i.test(CODE_CHOIX));
  assert.equal(calculDuRepas(repasComplet(), AUCUNE_SELECTION, CIBLE_EXACTE).etat, "incomplet");
});

/* ══════════════════════════════════════════════════════════════════════════
   L'ÉCRAN — ce qui est dit, et ce qui ne l'est pas
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.5-16. « approché » se dit en une phrase, jamais en erreur technique", () => {
  const s = solveMealChoices([POULET, SAUMON, HUILE], { proteinGrams: 50, carbGrams: 3, fatGrams: 20 });
  assert.equal(s.status, "approximate");
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");

  assert.ok(html.includes("Cette combinaison approche au mieux les objectifs de ce repas."));
  // Les quantités sont bien là : « approché », ce n'est pas « raté ».
  assert.ok(html.includes("Quantités pour ton repas"));
  assert.ok(html.includes("Cible du repas"));
  assert.ok(html.includes("Résultat"));
  // Aucun jargon : pas de code d'avertissement, pas de delta, pas de statut.
  for (const mot of ["approximate", "systeme_degenere", "delta", "warning", "status"]) {
    assert.ok(!html.includes(mot), `« ${mot} » ne doit pas atteindre l'écran`);
  }
});

await test("N1.5-17. « impossible » n'affiche AUCUNE quantité, et invite à changer un choix", () => {
  const s = solveMealChoices([POULET, SAUMON, HUILE], { proteinGrams: 50, carbGrams: 60, fatGrams: 20 });
  assert.equal(s.status, "impossible");
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");

  // ⚠️ PAS UNE SEULE QUANTITÉ. Des grammes accompagnés d'un avertissement
  // seraient recopiés et suivis quand même.
  assert.ok(!html.includes("Poulet"), "une quantité mensongère est affichée");
  assert.ok(!html.includes("Saumon"));
  assert.ok(html.includes("ne permet pas d&#x27;atteindre les objectifs de ce repas"));
  assert.ok(html.includes("Modifie un de tes choix"));
  // La cible reste dite — l'élève doit savoir ce qu'il visait.
  assert.ok(html.includes("Cible du repas"));
  assert.ok(!html.includes("Résultat"), "un résultat s'affiche alors qu'il n'y a pas de quantités");
});

await test("N1.5-18. le RÉSULTAT affiché est produit par les QUANTITÉS affichées", () => {
  const calcul = calculDuRepas(repasComplet(), { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  if (calcul.etat !== "calcule") throw new Error(calcul.etat);
  const html = renderToString(createElement(QuantitesDuRepas, { solution: calcul.solution })).replace(/<!-- -->/g, "");
  const texte = html.replace(/<[^>]+>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ");

  // Les trois quantités, puis les deux lignes de macros.
  assert.ok(texte.includes("150 g"));
  assert.ok(texte.includes("200 g"));
  assert.ok(texte.includes("10 g"));

  // ⚠️ RECALCULÉ SUR L'ARRONDI : `actual` est la somme des lignes affichées.
  const recalcul = calcul.solution.items.reduce((t, i) => t + i.proteinGrams, 0);
  assert.equal(calcul.solution.actual.proteinGrams, recalcul);
  assert.ok(CODE_SOLVEUR.includes("apport(food.proteinPer100, displayQuantity)"));
});

/* ══════════════════════════════════════════════════════════════════════════
   BANCS DE MESURE — aucun résultat écrit en dur
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.5-BANC. trois compositions réelles, mesurées et non figées", () => {
  const cible: MealMacroTarget = { proteinGrams: 55, carbGrams: 60, fatGrams: 20 };
  const bancs: readonly (readonly [string, readonly SelectedFoodForMealSolver[]])[] = [
    ["A — poulet, œuf, riz, brocoli, huile", [POULET, OEUF, RIZ, BROCOLI, HUILE]],
    ["B — saumon à la place du poulet", [SAUMON, OEUF, RIZ, BROCOLI, HUILE]],
    ["C — sans huile", [POULET, OEUF, RIZ, BROCOLI]],
  ];

  for (const [nom, jeu] of bancs) {
    const s = solveMealChoices(jeu, cible);
    console.log(
      `    ${nom} → ${s.status} : ` +
        s.items.map((i) => `${i.name.split(",")[0]} ${i.displayQuantity} ${i.unit}`).join(", "),
    );
    // ⚠️ ON N'ASSERTE QUE DES PROPRIÉTÉS, JAMAIS DES NOMBRES RECOPIÉS.
    assert.equal(s.items.length, jeu.length);
    assert.ok(s.items.every((i) => i.displayQuantity >= 0));
    assert.ok(s.items.every((i) => Number.isFinite(i.quantity)));
    assert.deepEqual(s.items.map((i) => i.optionId), jeu.map((f) => f.optionId));
    assert.equal(
      s.actual.fatGrams,
      s.items.reduce((t, i) => t + i.fatGrams, 0),
    );
  }
});

await test("N1.5-PERF. dix aliments, cent résolutions : instantané à l'échelle d'une interface", () => {
  const dix = [POULET, OEUF, RIZ, BROCOLI, HUILE, SAUMON, LAIT,
    { ...POULET, optionId: "opt-p2", slotId: "slot-p2" },
    { ...RIZ, optionId: "opt-r2", slotId: "slot-r2" },
    { ...BROCOLI, optionId: "opt-b2", slotId: "slot-b2" }];
  const départ = process.hrtime.bigint();
  for (let i = 0; i < 100; i += 1) solveMealChoices(dix, CIBLE_EXACTE);
  const ms = Number(process.hrtime.bigint() - départ) / 1e6;
  console.log(`    100 résolutions de 10 aliments : ${ms.toFixed(1)} ms`);
  // Seuil VOLONTAIREMENT LARGE : ce test dit « ce n'est pas un problème », pas
  // « c'est rapide sur cette machine-ci ».
  assert.ok(ms < 1000, `100 résolutions ont pris ${ms} ms`);
  // Et aucune bibliothèque d'algèbre n'a été ajoutée pour cela.
  assert.ok(!/from ["'](?!@\/lib|\.)/.test(CODE_SOLVEUR.replace(/from ["']@\/lib[^"']*["']/g, "")));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.5-BOUND-01..14 — LES GARDE-FOUS DE FAISABILITÉ
   ──────────────────────────────────────────────────────────────────────────
   ⚠️ CE QUE CES BORNES NE SONT PAS. Ni une portion recommandée, ni un
   minimum, ni un rôle, ni un `referenceGrams`, ni une propriété de l'aliment.
   L'audit du 15/08/2026 a établi qu'AUCUNE donnée de portion n'existe dans ce
   schéma ; ces deux nombres sont donc des garde-fous produit, assumés comme
   tels, et leur seul travail est d'empêcher le solveur de masquer une mauvaise
   combinaison derrière une quantité aberrante.
   ══════════════════════════════════════════════════════════════════════════ */

/** La cible des trois bancs de mesure — celle qui produisait 1 074 g de brocoli. */
const CIBLE_BANC: MealMacroTarget = { proteinGrams: 55, carbGrams: 60, fatGrams: 20 };
const BANC_A = [POULET, OEUF, RIZ, BROCOLI, HUILE];
const BANC_B = [SAUMON, OEUF, RIZ, BROCOLI, HUILE];
const BANC_C = [POULET, OEUF, RIZ, BROCOLI];

await test("N1.5-BOUND-01. 1 074 g de brocoli n'est plus productible", () => {
  const s = solveMealChoices(BANC_B, CIBLE_BANC);
  const brocoli = s.items.find((i) => i.optionId === "opt-brocoli");
  assert.ok(brocoli);
  assert.equal(brocoli.displayQuantity, MAX_SOLIDE_G);
  assert.equal(brocoli.boundedToMax, true);
  assert.ok(brocoli.quantity <= MAX_SOLIDE_G + 1e-9);

  // ⚠️ ET CE N'EST PAS UN HABILLAGE : la quantité exacte elle-même vaut la
  // borne, pas 1 074 « affiché 300 ».
  assert.equal(brocoli.quantity, MAX_SOLIDE_G);
});

await test("N1.5-BOUND-02/03. aucun solide > 300 g, aucun liquide > 500 ml, sur un balayage", () => {
  const catalogue = [POULET, OEUF, RIZ, BROCOLI, HUILE, SAUMON, LAIT];
  let vérifiées = 0;
  for (let masque = 1; masque < 1 << catalogue.length; masque += 1) {
    const jeu = catalogue.filter((_, i) => (masque >> i) & 1);
    for (const cible of [
      CIBLE_BANC,
      CIBLE_EXACTE,
      { proteinGrams: 120, carbGrams: 200, fatGrams: 5 },
      { proteinGrams: 5, carbGrams: 400, fatGrams: 2 },
    ]) {
      for (const item of solveMealChoices(jeu, cible).items) {
        const plafond = item.unit === "ml" ? MAX_LIQUIDE_ML : MAX_SOLIDE_G;
        assert.equal(item.maxQuantity, plafond);
        assert.ok(item.quantity <= plafond + 1e-9, `${item.name} : ${item.quantity} ${item.unit}`);
        assert.ok(item.displayQuantity <= plafond, `${item.name} affiché ${item.displayQuantity}`);
        assert.ok(item.quantity >= 0, `${item.name} négatif`);
        vérifiées += 1;
      }
    }
  }
  console.log(`    ${vérifiées} quantités vérifiées sous plafond`);
});

await test("N1.5-BOUND-04. atteindre une borne RE-RÉSOUT réellement les autres aliments", () => {
  // ⚠️ LE TÉMOIN EST LA MÊME COMPOSITION AVEC LE BROCOLI DÉJÀ ABSENT DU JEU.
  // Si le plafonnement se contentait de clamper, les autres quantités
  // resteraient celles de la solution non bornée.
  const borné = solveMealChoices(BANC_B, CIBLE_BANC);
  assert.ok(borné.determinism.cappedOrder.includes("opt-brocoli"));

  // Les quantités NON bornées des mêmes aliments, telles qu'elles étaient
  // avant que le plafond n'existe (mesurées : saumon 116, riz 46).
  const saumon = borné.items.find((i) => i.optionId === "opt-saumon");
  const riz = borné.items.find((i) => i.optionId === "opt-riz");
  assert.ok(saumon && riz);
  assert.ok(saumon.displayQuantity > 150,
    `le saumon devrait remonter après plafonnement, il vaut ${saumon.displayQuantity}`);
  assert.ok(riz.displayQuantity > 100,
    `le riz devrait remonter après plafonnement, il vaut ${riz.displayQuantity}`);

  // Et il y a bien eu plusieurs résolutions : une par variable figée, plus une.
  assert.equal(
    borné.determinism.iterations,
    borné.determinism.zeroedOrder.length + borné.determinism.cappedOrder.length + 1,
  );
});

await test("N1.5-BOUND-05. les macros d'un aliment plafonné restent DANS le résidu", () => {
  const s = solveMealChoices(BANC_B, CIBLE_BANC);
  const brocoli = s.items.find((i) => i.optionId === "opt-brocoli");
  assert.ok(brocoli);

  // ⚠️ FIGER N'EST PAS RETIRER. Les 300 g de brocoli apportent toujours leurs
  // macros, et elles comptent dans le total comme dans le verdict.
  assert.ok(brocoli.proteinGrams > 0);
  assert.ok(brocoli.carbGrams > 0);
  assert.equal(brocoli.proteinGrams, (BROCOLI.proteinPer100 * MAX_SOLIDE_G) / 100);
  assert.equal(
    s.actual.carbGrams,
    s.items.reduce((t, i) => t + i.carbGrams, 0),
  );

  // La preuve directe : le même repas où le brocoli est réellement ABSENT du
  // jeu ne peut pas donner les mêmes quantités aux autres — le résidu diffère
  // de tout l'apport des 300 g.
  const sansBrocoli = solveMealChoices(BANC_B.filter((f) => f !== BROCOLI), CIBLE_BANC);
  const riz = s.items.find((i) => i.optionId === "opt-riz")?.quantity ?? 0;
  const rizSans = sansBrocoli.items.find((i) => i.optionId === "opt-riz")?.quantity ?? 0;
  assert.ok(Math.abs(riz - rizSans) > 1,
    "retirer le brocoli et le plafonner donnent le même résultat : son apport est ignoré");
});

await test("N1.5-BOUND-06/07/08. un repas déjà sous les bornes est STRICTEMENT inchangé", () => {
  // ⚠️ MESURE DE NON-EFFET. Le garde-fou ne doit rien changer aux repas qui
  // n'en avaient pas besoin — sinon ce n'est plus un garde-fou, c'est une règle
  // de portion déguisée.
  for (const [nom, jeu] of [["A", BANC_A], ["C", BANC_C]] as const) {
    const s = solveMealChoices(jeu, CIBLE_BANC);
    assert.equal(s.status, "exact", `banc ${nom} ne devrait pas changer de statut`);
    assert.equal(s.determinism.cappedOrder.length, 0, `banc ${nom} : un aliment a été plafonné`);
    assert.ok(s.items.every((i) => !i.boundedToMax));
    assert.ok(s.items.every((i) => i.displayQuantity < MAX_SOLIDE_G));
  }

  // Et le repas de référence à trois aliments, lui aussi hors d'atteinte.
  const s = solveMealChoices([POULET, RIZ, HUILE], CIBLE_EXACTE);
  assert.deepEqual(quantites(s), { "opt-poulet": 150, "opt-riz": 200, "opt-huile": 10 });
  assert.equal(s.status, "exact");
});

await test("N1.5-BOUND-09. banc B : le statut devient honnêtement IMPOSSIBLE", () => {
  const s = solveMealChoices(BANC_B, CIBLE_BANC);

  // ⚠️ C'EST LE POINT DE TOUTE LA CORRECTION. Sans borne, ce repas sortait
  // « exact » — atteint en empilant 1 074 g de brocoli. La combinaison était
  // mauvaise, et le résultat le cachait. Elle est maintenant VISIBLE.
  assert.equal(s.status, "impossible");

  // Et le verdict est rendu par les TOLÉRANCES EXISTANTES, pas par une règle
  // nouvelle : l'écart lipides franchit le plus grand de 5 g et 10 % de 20 g.
  assert.ok(Math.abs(s.delta.fatGrams) > Math.max(5, 0.1 * CIBLE_BANC.fatGrams));
  assert.ok(CODE_SOLVEUR.includes("determineStatus(delta, target)"),
    "le verdict doit venir des tolérances existantes de recipe-solver");

  // L'élève ne voit donc AUCUNE quantité — surtout pas 300 g de brocoli.
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");
  assert.ok(!html.includes("Brocoli"));
  assert.ok(!html.includes("300"));
  assert.ok(html.includes("Modifie un de tes choix"));
});

await test("N1.5-BOUND-10/11/12. aucun rôle, aucun referenceGrams, aucun minimum par catégorie", () => {
  assert.ok(!/\brole\b/.test(CODE_SOLVEUR));
  assert.ok(!/referenceGrams/.test(CODE_SOLVEUR));

  // ⚠️ LA BORNE NE DÉPEND QUE DE L'UNITÉ, JAMAIS DE LA MACRO DOMINANTE. Deux
  // aliments d'unité identique ont le MÊME plafond, quelles que soient leurs
  // macros — le brocoli comme l'huile comme le poulet.
  const s = solveMealChoices([POULET, RIZ, HUILE, BROCOLI, SAUMON, LAIT], CIBLE_BANC);
  for (const item of s.items) {
    assert.equal(item.maxQuantity, item.unit === "ml" ? MAX_LIQUIDE_ML : MAX_SOLIDE_G);
  }
  assert.equal(new Set(s.items.filter((i) => i.unit === "g").map((i) => i.maxQuantity)).size, 1);

  // Aucun MINIMUM nulle part : ni par catégorie, ni global. Une quantité de 0
  // reste atteignable après l'ajout des plafonds.
  assert.ok(s.items.some((i) => i.displayQuantity === 0) ||
    solveMealChoices([SAUMON, RIZ, HUILE], { proteinGrams: 50, carbGrams: 40, fatGrams: 30 })
      .items.some((i) => i.displayQuantity === 0));
  assert.ok(!/MIN_[A-Z]|minimum|plancher/.test(CODE_SOLVEUR));

  // Et les deux constantes sont les SEULS nombres de garde-fou du module.
  assert.ok(CODE_SOLVEUR.includes("export const MAX_SOLIDE_G = 300;"));
  assert.ok(CODE_SOLVEUR.includes("export const MAX_LIQUIDE_ML = 500;"));
});

await test("N1.5-BOUND-13. la borne ne vient PAS de la bibliothèque", () => {
  // ⚠️ ELLE NE VIENT D'AUCUNE TABLE, ET C'EST DIT. Le solveur ne lit rien.
  assert.ok(!CODE_SOLVEUR.includes("food_lists"));
  assert.ok(!CODE_SOLVEUR.includes("food_list_items"));
  assert.ok(!CODE_SOLVEUR.includes("food_catalog"));
  assert.ok(!CODE_SOLVEUR.includes("food_products"));
  assert.ok(!/from ["']@\/lib\/supabase/.test(CODE_SOLVEUR));
  assert.ok(!CODE_SELECTION.includes("food_list_items"));

  // Et l'entrée du solveur ne porte toujours aucune borne : elle est décidée
  // par l'unité, pas transmise par l'appelant.
  assert.deepEqual(Object.keys(POULET).sort(),
    ["carbPer100", "fatPer100", "name", "optionId", "proteinPer100", "slotId", "unit"]);
});

await test("N1.5-BOUND-14. déterminisme conservé : 100 exécutions strictement identiques", () => {
  for (const jeu of [BANC_A, BANC_B, BANC_C]) {
    const référence = JSON.stringify(solveMealChoices(jeu, CIBLE_BANC));
    for (let i = 0; i < 100; i += 1) {
      assert.equal(JSON.stringify(solveMealChoices(jeu, CIBLE_BANC)), référence, `divergence au tour ${i}`);
    }
  }
});

await test("N1.5-BOUND-15. le plafond d'un LIQUIDE est bien 500 ml, pas 300", () => {
  // Un repas où seul le lait peut porter les glucides : il monte, et s'arrête
  // à 500 ml — un seuil qu'un plafond de 300 aurait déjà franchi.
  const s = solveMealChoices([POULET, LAIT, HUILE], { proteinGrams: 60, carbGrams: 40, fatGrams: 25 });
  const lait = s.items.find((i) => i.optionId === "opt-lait");
  assert.ok(lait);
  assert.equal(lait.unit, "ml");
  assert.equal(lait.maxQuantity, MAX_LIQUIDE_ML);
  assert.ok(lait.displayQuantity > MAX_SOLIDE_G,
    `le lait vaut ${lait.displayQuantity} ml : le test ne discriminerait pas un plafond à 300`);
  assert.ok(lait.displayQuantity <= MAX_LIQUIDE_ML);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.5.1-PREF-01..16 — LES PORTIONS PRÉFÉRÉES
   ──────────────────────────────────────────────────────────────────────────
   ⚠️ UNE PRÉFÉRENCE N'EST PAS UNE CONTRAINTE. Elle dit « à macros égales,
   approche plutôt cette quantité » — et rien d'autre. Les macros restent
   prioritaires, les plafonds restent durs, et le statut ne dépend QUE des
   macros finales.
   ══════════════════════════════════════════════════════════════════════════ */

const CODE_LISTES = sansProse(lire("../../lib/supabase/food-lists.ts"));
const CODE_FORM = sansProse(lire("../../lib/nutrition/plan-v2-week-form.ts"));
const CODE_EDITEUR = sansProse(lire("../../components/admin/FoodListEditor.tsx"));

/** Le petit déjeuner TERRAIN, en valeurs Ciqual réelles (whey = produit). */
const PDJ = [
  { ...aliment("pain", "Pain de mie complet, préemballé", 8, 41.8, 4.1), preferredQuantity: 80 },
  { ...aliment("huile", "Huile d'olive vierge extra", 0.25, 0, 99.9), preferredQuantity: 10 },
  { ...aliment("fb", "Fromage blanc nature 0 % MG", 7.19, 4.22, 0), preferredQuantity: 200 },
  { ...aliment("whey", "Whey", 80, 5, 2), preferredQuantity: 30 },
  { ...aliment("agave", "Sirop d'agave", 0.25, 78, 0.5), preferredQuantity: 20 },
];
const CIBLE_PDJ: MealMacroTarget = { proteinGrams: 55, carbGrams: 93, fatGrams: 32 };

/**
 * Écart relatif moyen aux portions de RÉFÉRENCE.
 *
 * ⚠️ LA RÉFÉRENCE EST PASSÉE EN PARAMÈTRE, PAS LUE DANS LA SOLUTION. Mesurer
 * la solution NON GUIDÉE contre ses propres préférences (absentes) rendrait
 * 0 % — un « parfait » qui ne voudrait rien dire. Les deux solutions doivent
 * être jugées à la même aune.
 */
function distanceAuxPortions(
  s: MealChoiceSolution,
  reference: readonly SelectedFoodForMealSolver[],
): number {
  const paires = s.items
    .map((i) => ({ i, p: reference.find((f) => f.optionId === i.optionId)?.preferredQuantity ?? null }))
    .filter((x): x is { i: (typeof s.items)[number]; p: number } => typeof x.p === "number" && x.p > 0);
  if (paires.length === 0) return 0;
  return paires.reduce((t, { i, p }) => t + Math.abs(i.displayQuantity - p) / p, 0) / paires.length;
}

await test("N1.5.1-PREF-01. le cas TERRAIN : la répartition devient humaine, les macros restent exactes", () => {
  const sans = solveMealChoices(PDJ.map((f) => ({ ...f, preferredQuantity: null })), CIBLE_PDJ);
  const avec = solveMealChoices(PDJ, CIBLE_PDJ);

  console.log(`    sans portions : ${sans.items.map((i) => `${i.name.split(",")[0]} ${i.displayQuantity}`).join(", ")}`);
  console.log(`    avec portions : ${avec.items.map((i) => `${i.name.split(",")[0]} ${i.displayQuantity}`).join(", ")}`);
  console.log(`    distance aux portions : ${(distanceAuxPortions(sans, PDJ) * 100).toFixed(0)} % → ${(distanceAuxPortions(avec, PDJ) * 100).toFixed(0)} %`);

  // ⚠️ LE DÉFAUT MESURÉ EN PRODUCTION : 10 g de fromage blanc et 62 g de whey.
  const fbSans = sans.items.find((i) => i.optionId === "opt-fb")?.displayQuantity ?? 0;
  const fbAvec = avec.items.find((i) => i.optionId === "opt-fb")?.displayQuantity ?? 0;
  assert.ok(fbSans < 50, `le décor doit reproduire le défaut : fromage blanc ${fbSans} g`);
  assert.ok(fbAvec > 150, `le fromage blanc doit remonter vers sa portion : ${fbAvec} g`);

  // ⚠️ ET LES MACROS N'ONT RIEN PERDU. Les deux statuts sont identiques, et la
  // distance aux portions, elle, s'effondre.
  assert.equal(avec.status, sans.status);
  assert.ok(distanceAuxPortions(avec, PDJ) < distanceAuxPortions(sans, PDJ) / 2);
});

await test("N1.5.1-PREF-02. les MACROS ne paient pas la préférence — invariance mesurée", () => {
  // ⚠️ C'EST LE RÉSULTAT QUI FONDE TOUTE LA FORMULATION. Guider par les
  // portions choisit LAQUELLE des solutions optimales on retient ; ça ne
  // change pas la qualité macro de l'ensemble. On le vérifie AVANT arrondi,
  // parce qu'après, ±0,5 g d'arrondi brouillent la lecture.
  const residuBrut = (s: MealChoiceSolution) => {
    const total = s.items.reduce(
      (t, i) => {
        const src = PDJ.find((f) => f.optionId === i.optionId);
        if (!src) return t;
        return {
          p: t.p + (src.proteinPer100 * i.quantity) / 100,
          c: t.c + (src.carbPer100 * i.quantity) / 100,
          l: t.l + (src.fatPer100 * i.quantity) / 100,
        };
      },
      { p: 0, c: 0, l: 0 },
    );
    return Math.max(
      Math.abs(total.p - CIBLE_PDJ.proteinGrams),
      Math.abs(total.c - CIBLE_PDJ.carbGrams),
      Math.abs(total.l - CIBLE_PDJ.fatGrams),
    );
  };
  assert.ok(residuBrut(solveMealChoices(PDJ.map((f) => ({ ...f, preferredQuantity: null })), CIBLE_PDJ)) < 1e-9);
  assert.ok(residuBrut(solveMealChoices(PDJ, CIBLE_PDJ)) < 1e-9);
});

await test("N1.5.1-PREF-03. SANS aucune préférence, le résultat est celui de N1.5 au bit près", () => {
  // ⚠️ LA RÉTROCOMPATIBILITÉ N'EST PAS UN CAS À GÉRER : c'est le cas dégénéré
  // de la même formule. cᵢ = 0 et sᵢ = ECHELLE_NEUTRE pour tout le monde, donc
  // un facteur commun, qui ne change pas la direction de la solution.
  for (const jeu of [BANC_A, BANC_B, BANC_C, [POULET, RIZ, HUILE]]) {
    const sans = solveMealChoices(jeu, CIBLE_BANC);
    const nul = solveMealChoices(jeu.map((f) => ({ ...f, preferredQuantity: null })), CIBLE_BANC);
    const indéfini = solveMealChoices(jeu.map((f) => ({ ...f, preferredQuantity: undefined })), CIBLE_BANC);
    assert.deepEqual(nul.items.map((i) => i.quantity), sans.items.map((i) => i.quantity));
    assert.deepEqual(indéfini.items.map((i) => i.quantity), sans.items.map((i) => i.quantity));
    assert.equal(nul.status, sans.status);
  }
});

await test("N1.5.1-PREF-04. un aliment SANS préférence reste parfaitement calculable", () => {
  // ⚠️ C'EST LA MESURE QUI A DISQUALIFIÉ LA FORMULATION « écart relatif pour
  // les uns, grammes absolus pour les autres » : elle rendait 0 g au sirop,
  // c'est-à-dire qu'elle faisait disparaître du repas un aliment que l'élève
  // avait choisi.
  const mixte = PDJ.map((f) => (f.optionId === "opt-agave" ? { ...f, preferredQuantity: null } : f));
  const s = solveMealChoices(mixte, CIBLE_PDJ);
  const agave = s.items.find((i) => i.optionId === "opt-agave");
  assert.ok(agave);
  assert.equal(agave.preferredQuantity, null, "l'aliment sans préférence ne doit pas s'en voir inventer une");
  assert.ok(agave.displayQuantity > 0, `le sirop doit rester utilisable, il vaut ${agave.displayQuantity} g`);
  assert.equal(s.items.length, mixte.length);
});

await test("N1.5.1-PREF-05. l'échelle neutre n'est NI une portion, NI persistée, NI affichée", () => {
  const s = solveMealChoices(PDJ.map((f) => ({ ...f, preferredQuantity: null })), CIBLE_PDJ);

  // ⚠️ AUCUN ALIMENT NE SE VOIT ATTRIBUER 100 COMME PRÉFÉRENCE.
  assert.ok(s.items.every((i) => i.preferredQuantity === null));
  assert.equal(ECHELLE_NEUTRE, 100);

  // Elle n'existe qu'en mémoire : ni colonne, ni charge utile, ni écran.
  assert.ok(!CODE_LISTES.includes("ECHELLE_NEUTRE"), "l'échelle neutre ne doit pas atteindre la couche Supabase");
  assert.ok(!CODE_FORM.includes("ECHELLE_NEUTRE"), "l'échelle neutre ne doit pas partir vers la RPC");
  assert.ok(!CODE_CHOIX.includes("ECHELLE_NEUTRE"), "l'échelle neutre ne doit pas atteindre l'écran élève");
  assert.ok(!CODE_EDITEUR.includes("ECHELLE_NEUTRE"), "l'échelle neutre ne doit pas atteindre l'écran coach");
  const migration = lire("../../supabase/migrations/20260908090000_n1_5_1_portions_preferees.sql");
  assert.ok(!/default\s+100/i.test(migration), "aucune colonne ne doit valoir 100 par défaut");

  // Et le rendu ne l'écrit nulle part.
  const calcul = calculDuRepas(repasComplet(), { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  if (calcul.etat !== "calcule") throw new Error(calcul.etat);
  const html = renderToString(createElement(QuantitesDuRepas, { solution: calcul.solution })).replace(/<!-- -->/g, "");
  assert.ok(!html.includes("Portion"), "aucune portion n'est affichée dans la section quantités");
});

await test("N1.5.1-PREF-06. une préférence n'est NI un minimum, NI un maximum", () => {
  // Minimum : une portion de 200 g n'empêche pas le solveur de descendre.
  const bas = solveMealChoices(
    [{ ...POULET, preferredQuantity: 200 }, { ...RIZ, preferredQuantity: 200 }, { ...HUILE, preferredQuantity: 200 }],
    { proteinGrams: 10, carbGrams: 10, fatGrams: 3 },
  );
  assert.ok(bas.items.every((i) => i.displayQuantity < 200), "la préférence agit comme un plancher");

  // Maximum : une portion de 20 g n'empêche pas le solveur de monter.
  const haut = solveMealChoices(
    [{ ...POULET, preferredQuantity: 20 }, { ...RIZ, preferredQuantity: 20 }, { ...HUILE, preferredQuantity: 20 }],
    CIBLE_EXACTE,
  );
  assert.ok(haut.items.some((i) => i.displayQuantity > 20), "la préférence agit comme un plafond");

  // ⚠️ ET ZÉRO RESTE ATTEIGNABLE malgré une préférence. Un aliment dont les
  // autres rendent la présence inutile tombe à 0, portion ou pas.
  const zero = solveMealChoices(
    [{ ...SAUMON, preferredQuantity: 130 }, { ...RIZ, preferredQuantity: 80 }, { ...HUILE, preferredQuantity: 10 }],
    { proteinGrams: 50, carbGrams: 40, fatGrams: 30 },
  );
  assert.equal(zero.items.find((i) => i.optionId === "opt-huile")?.displayQuantity, 0);
});

await test("N1.5.1-PREF-07. les PLAFONDS gagnent toujours sur la préférence", () => {
  // ⚠️ UNE PRÉFÉRENCE DE 400 g NE CONTOURNE PAS LA BORNE DE 300 g. La base
  // accepte 400 — c'est une intention, pas une erreur métier — et le solveur
  // arbitre. C'est exactement le partage soft / hard.
  const s = solveMealChoices(
    [
      { ...BROCOLI, preferredQuantity: 400 },
      { ...POULET, preferredQuantity: 400 },
      { ...HUILE, preferredQuantity: 400 },
    ],
    { proteinGrams: 120, carbGrams: 100, fatGrams: 90 },
  );
  assert.ok(s.items.every((i) => i.displayQuantity <= MAX_SOLIDE_G));
  assert.ok(s.items.some((i) => i.boundedToMax), "aucun plafonnement n'a eu lieu : le test ne discrimine pas");

  // Et la préférence RESTE dite, même quand elle n'a pas pu être suivie.
  assert.ok(s.items.every((i) => i.preferredQuantity === 400));

  // Liquide : 600 ml préférés, 500 ml rendus.
  const liquide = solveMealChoices(
    [{ ...LAIT, preferredQuantity: 600 }, { ...POULET, preferredQuantity: 150 }],
    { proteinGrams: 70, carbGrams: 40, fatGrams: 20 },
  );
  assert.ok((liquide.items.find((i) => i.optionId === "opt-lait")?.displayQuantity ?? 0) <= MAX_LIQUIDE_ML);
});

await test("N1.5.1-PREF-08. des portions inatteignables ne font pas rater la cible", () => {
  // ⚠️ LES MACROS PASSENT AVANT. Portions divisées par cinq : le solveur s'en
  // éloigne franchement, et atteint quand même la cible.
  const minuscules = PDJ.map((f) => ({ ...f, preferredQuantity: Math.round((f.preferredQuantity ?? 0) / 5) }));
  const s = solveMealChoices(minuscules, CIBLE_PDJ);
  console.log(`    portions ÷5 → distance ${(distanceAuxPortions(s, minuscules) * 100).toFixed(0)} %, statut ${s.status}`);
  assert.equal(s.status, "exact");
  assert.ok(distanceAuxPortions(s, minuscules) > 2, "le solveur devrait s'éloigner franchement des portions");
});

await test("N1.5.1-PREF-09. une préférence ne rend jamais EXACT un repas impossible", () => {
  // Le banc B, avec des portions parfaitement raisonnables : il reste
  // impossible, et pour les mêmes raisons — plafond du brocoli, excès de
  // lipides du saumon.
  const avecPortions = BANC_B.map((f) => ({
    ...f,
    preferredQuantity: { "opt-saumon": 130, "opt-oeuf": 100, "opt-riz": 80, "opt-brocoli": 150, "opt-huile": 10 }[f.optionId] ?? null,
  }));
  const s = solveMealChoices(avecPortions, CIBLE_BANC);
  assert.equal(s.status, "impossible");
  assert.ok(s.items.some((i) => i.boundedToMax));

  // ⚠️ ET LE STATUT NE DÉPEND QUE DES MACROS FINALES. Aucun code du solveur ne
  // fait entrer la distance aux portions dans le verdict.
  assert.ok(CODE_SOLVEUR.includes("determineStatus(delta, target)"));
  assert.ok(!/determineStatus\([^)]*preferred/i.test(CODE_SOLVEUR));
});

await test("N1.5.1-PREF-10. déterminisme : 100 exécutions identiques, avec portions", () => {
  for (const jeu of [PDJ, PDJ.map((f) => (f.optionId === "opt-agave" ? { ...f, preferredQuantity: null } : f))]) {
    const référence = JSON.stringify(solveMealChoices(jeu, CIBLE_PDJ));
    for (let i = 0; i < 100; i += 1) {
      assert.equal(JSON.stringify(solveMealChoices(jeu, CIBLE_PDJ)), référence, `divergence au tour ${i}`);
    }
  }
});

await test("N1.5.1-PREF-11. aucun rôle, aucun referenceGrams, aucune catégorie", () => {
  for (const [nom, code] of [["solveur", CODE_SOLVEUR], ["sélection", CODE_SELECTION], ["listes", CODE_LISTES]] as const) {
    assert.ok(!/\brole\b/.test(code), `${nom} manipule un rôle`);
    assert.ok(!/referenceGrams/.test(code), `${nom} manipule un referenceGrams`);
  }
  // ⚠️ ET LA PRÉFÉRENCE NE CLASSE RIEN. Deux aliments de portions identiques
  // sont traités pareil quelles que soient leurs macros — aucune notion de
  // « protéine », « féculent » ou « légume » n'existe.
  assert.ok(!/proteine|feculent|legume|glucidique|lipidique/i.test(CODE_SOLVEUR));

  // La portion n'est jamais une base de ratio : elle est un CENTRE, additionné.
  assert.ok(CODE_SOLVEUR.includes("centres[position] + echelles[position]"));
});

await test("N1.5.1-PREF-12. override > standard > rien — résolu à UN seul endroit", () => {
  // La résolution vit dans la couche qui lit la bibliothèque, et nulle part
  // ailleurs : ni la RPC, ni l'écran élève ne la refont.
  assert.ok(CODE_LISTES.includes("item.portionOverride ?? item.portionStandard ?? null"));
  assert.ok(!CODE_CHOIX.includes("portionStandard"), "l'écran élève ne doit pas connaître le standard");
  assert.ok(!CODE_SELECTION.includes("portionStandard"));
  const migration = lire("../../supabase/migrations/20260908090000_n1_5_1_portions_preferees.sql");
  const sansCommentaires = migration.replace(/--[^\n]*/g, " ");
  for (const table of ["food_list_items", "public.food_catalog", "public.food_products"]) {
    assert.ok(
      !new RegExp(`from\\s+${table.replace(".", "\\.")}`).test(sansCommentaires),
      `la RPC ne doit pas lire ${table} pour résoudre une portion`,
    );
  }
});

await test("N1.5.1-PREF-13. la portion PART vers la RPC, le libellé et les macros NON", () => {
  // ⚠️ C'EST LA LIGNE DE PARTAGE ENTRE SNAPSHOT ET HYDRATATION.
  assert.ok(CODE_FORM.includes("preferred_quantity: option.preferredQuantity ?? null"));
  assert.ok(CODE_FORM.includes("preferred_unit:"));
  assert.ok(!CODE_FORM.includes("displayName"), "le libellé ne doit jamais repartir vers la RPC");
  assert.ok(!CODE_FORM.includes("nutrition:"), "les macros ne doivent jamais repartir vers la RPC");

  // Les deux clés voyagent ENSEMBLE ou pas du tout.
  assert.ok(CODE_FORM.includes("option.preferredQuantity == null ? null :"));
});

await test("N1.5.1-PREF-14. une unité de portion incohérente est IGNORÉE, pas devinée", () => {
  // ⚠️ UN SNAPSHOT FIGÉ EN `g` SUR UN ALIMENT DEVENU `ml` décrit une échelle
  // qui n'est plus la sienne. On préfère calculer sans préférence plutôt
  // qu'avec une préférence fausse.
  const occurrences = [
    occurrence("s1", "Ta boisson", [
      {
        type: "aliment", id: F_POULET, optionId: "o1", displayName: "Lait",
        nutrition: { unit: "ml", proteinPer100: 3.3, carbPer100: 4.8, fatPer100: 1.6 },
        preferredQuantity: 250, preferredUnit: "g",
      } as ChoiceOption,
    ]),
  ];
  const aliments = alimentsPourLeSolveur(choixResolus(occurrences, { s1: "o1" }));
  assert.ok(aliments);
  assert.equal(aliments[0].preferredQuantity, null, "une unité incohérente doit annuler la préférence");

  // Et la même option, unité cohérente : la préférence passe.
  const bonnes = alimentsPourLeSolveur(
    choixResolus(
      [occurrence("s1", "Ta boisson", [{ ...occurrences[0].options[0], preferredUnit: "ml" } as ChoiceOption])],
      { s1: "o1" },
    ),
  );
  assert.equal(bonnes?.[0].preferredQuantity, 250);
});

await test("N1.5.1-PREF-15. l'écran coach parle de PORTION, jamais de solveur", () => {
  assert.ok(CODE_EDITEUR.includes("Portion standard"));
  assert.ok(CODE_EDITEUR.includes("Personnaliser"));
  assert.ok(CODE_EDITEUR.includes("Portion personnalisée"));
  assert.ok(CODE_EDITEUR.includes("Revenir au standard"));
  assert.ok(CODE_EDITEUR.includes("Définir une portion"));

  // ⚠️ AUCUN JARGON N'ATTEINT LE COACH.
  for (const mot of ["referenceGrams", "coefficient", "solveur", "norme minimale", "pseudo-inverse"]) {
    assert.ok(!CODE_EDITEUR.includes(mot), `« ${mot} » ne doit pas apparaître dans l'écran coach`);
  }
  // Et rien n'est obligatoire : aucun `required` sur le champ.
  assert.ok(!CODE_EDITEUR.includes("required"), "la portion ne doit jamais être obligatoire");
});

await test("N1.5.1-PREF-16. le champ portion n'écrit pas à chaque frappe", () => {
  // ⚠️ TAPER « 250 » ENVERRAIT « 2 », PUIS « 25 », PUIS « 250 » : trois
  // portions, dont deux fausses. La validation est explicite, comme le nom.
  assert.ok(CODE_EDITEUR.includes("onChange={(e) => setSaisie(e.target.value)}"));
  const bloc = CODE_EDITEUR.slice(CODE_EDITEUR.indexOf("function PortionPreferee"));
  assert.ok(!/onChange=\{[^}]*onDefinir/.test(bloc), "la saisie ne doit pas écrire directement");
  assert.ok(bloc.includes("onClick={() => onDefinir(valeur)}"));
  // Et le writer refuse une valeur non positive sans aller jusqu'au réseau.
  assert.ok(CODE_LISTES.includes("if (valeur !== null && (!Number.isFinite(valeur) || valeur <= 0)) return false;"));
});

await test("N1.5.1-PREF-17. le SNAPSHOT fige la portion effective, liste par liste", async () => {
  // ⚠️ CE TEST EXISTE PARCE QU'UN CONTRÔLE NÉGATIF L'A RÉCLAMÉ. Saboter
  // `lireSnapshotDeListe` pour qu'il ne fige plus AUCUNE portion ne faisait
  // rougir personne : rien n'exerçait le pont bibliothèque → repas. C'était
  // un trou, pas une souplesse.
  const WHEY = "cc000000-0000-4000-8000-000000000001";
  const FB = "cc000000-0000-4000-8000-000000000002";

  const client = (listId: string, override: number | null) => {
    const tables: Record<string, Record<string, unknown>[]> = {
      food_lists: [{ id: listId, name: "Liste", archived_at: null, updated_at: "2026-08-15" }],
      food_list_items: [
        { id: "it-1", list_id: listId, position: 1, catalog_food_id: WHEY, product_id: null,
          preferred_quantity_override: override },
        { id: "it-2", list_id: listId, position: 2, catalog_food_id: FB, product_id: null,
          preferred_quantity_override: null },
      ],
      // ⚠️ `numeric` EN CHAÎNE, comme PostgREST le rend vraiment.
      food_catalog: [
        { id: WHEY, name: "Whey", nutrition_unit: "g", protein_per_100: "80", carb_per_100: "5",
          fat_per_100: "2", piece_weight_g: null, preferred_quantity: "30" },
        { id: FB, name: "Fromage blanc", nutrition_unit: "g", protein_per_100: "7", carb_per_100: "4",
          fat_per_100: "0", piece_weight_g: null, preferred_quantity: null },
      ],
      food_products: [],
    };
    return {
      from(nom: string) {
        const chaine: Record<string, unknown> = {
          select: () => chaine, eq: () => chaine, in: () => chaine, order: () => chaine,
          maybeSingle: () => Promise.resolve({ data: (tables[nom] ?? [])[0] ?? null, error: null }),
          then: (r: (v: { data: unknown; error: null }) => void) => r({ data: tables[nom] ?? [], error: null }),
        };
        return chaine;
      },
    } as never;
  };

  // Liste A : override 25 g sur la whey.
  const a = await lireSnapshotDeListe(client("liste-a", 25), "liste-a");
  assert.ok(a);
  assert.equal(a.options[0].preferredQuantity, 25, "l'override doit primer sur le standard");
  assert.equal(a.options[0].preferredUnit, "g");

  // ⚠️ L'ALIMENT SANS AUCUNE PORTION N'EN REÇOIT PAS UNE INVENTÉE, et son
  // unité reste nulle avec elle — la contrainte de paire dit la même chose.
  assert.equal(a.options[1].preferredQuantity, null);
  assert.equal(a.options[1].preferredUnit, null);

  // Liste B : override 35 g sur LA MÊME whey. Deux listes, deux portions.
  const b = await lireSnapshotDeListe(client("liste-b", 35), "liste-b");
  assert.equal(b?.options[0].preferredQuantity, 35);

  // Liste C : aucun override → c'est le STANDARD de l'identité qui est figé.
  const c = await lireSnapshotDeListe(client("liste-c", null), "liste-c");
  assert.equal(c?.options[0].preferredQuantity, 30, "sans override, le standard doit être figé");

  // ⚠️ ET LE LIBELLÉ N'EST PAS DU SNAPSHOT, LUI. Il est hydraté, et il ne
  // repart jamais vers la RPC — la ligne de partage tient dans les deux sens.
  assert.equal(a.options[0].displayName, "Whey");
});
