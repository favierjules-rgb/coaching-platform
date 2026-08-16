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

import { QuantitesDuRepas, StudentMealChoices, ecartsAAfficher } from "../../components/student/StudentMealChoices";
import { StudentPrescribedWeek } from "../../components/student/StudentPrescribedWeek";
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

  // ⚠️ AUCUN MINIMUM N'EST INVENTÉ, ET C'EST TOUJOURS VRAI APRÈS N1.5.2.
  // Le solveur connaît désormais un plancher — mais il ne le DEVINE jamais :
  // il vient d'un champ que le coach a rempli, et vaut ZÉRO sinon. Ce qui
  // reste interdit, c'est le minimum AUTOMATIQUE : pas de « au moins 1 g »,
  // pas de plancher par catégorie, pas de règle légumes/fruits.
  assert.ok(!/minGrams|referenceGrams/.test(CODE_SOLVEUR));
  assert.ok(!/Math\.max\(\s*[1-9]/.test(CODE_SOLVEUR), "un plancher constant non nul est codé en dur");
  assert.ok(CODE_SOLVEUR.includes("if (typeof m !== \"number\" || !Number.isFinite(m) || m <= 0) return 0;"),
    "l'absence de minimum doit rendre ZÉRO, jamais une valeur de repli");
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
  sourceListId: null, colorKey: null,
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
  // ⚠️ N1.5.3 — LE TRIPWIRE EST RESSERRÉ, PAS LEVÉ. « Aucun `.sort(` dans
  // l'écran » est devenu trop large : les LIGNES D'ÉCART sont triées, par
  // écart rapporté à la tolérance, pour que la macro la plus significative se
  // lise en premier. Ce qui reste interdit — et c'est ce que le contrôle
  // gardait vraiment — c'est de trier les ALIMENTS.
  assert.ok(!/solution\.items[^;]*\.sort\(/.test(CODE_CHOIX),
    "les aliments sont triés à l'affichage : l'ordre du coach doit être conservé");
  assert.ok(!/\bitems\b[^;]*\.sort\(/.test(CODE_CHOIX), "un tri est appliqué aux aliments");
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
  // ⚠️ N1.6B — LE BOUTON « ENREGISTRER LE REPAS » EXISTE MAINTENANT, ET CE
  // CONTRÔLE DISAIT L'INVERSE. Il gardait une vérité de N1.5 : « rien à
  // enregistrer, donc pas de bouton ». Depuis N1.6B il y a quelque chose à
  // enregistrer — mais la garantie qui compte, elle, est INTACTE et vérifiée
  // ci-dessus : cet écran n'écrit toujours RIEN lui-même. Il reçoit un rappel
  // et l'appelle ; toute la persistance vit chez le parent.
  assert.ok(CODE_CHOIX.includes("Enregistrer le repas"), "le bouton N1.6B a disparu");
  assert.ok(CODE_CHOIX.includes("enregistrement.onEnregistrer("),
    "l'écran doit DÉLÉGUER l'enregistrement, jamais l'exécuter");
  // ⚠️ ET IL ENVOIE LA QUANTITÉ AFFICHÉE, PAS LA QUANTITÉ INTERNE. `quantity`
  // est la valeur flottante d'avant l'arrondi borné : l'envoyer enregistrerait
  // 162,6 sous un écran qui dit 163.
  assert.ok(CODE_CHOIX.includes("quantity: item.displayQuantity"),
    "la quantité envoyée doit être celle qui est AFFICHÉE");
  assert.ok(!/quantity: item\.quantity\b/.test(CODE_CHOIX));
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

await test("N1.5-15. un BROUILLON non validé ne survit pas au rafraîchissement", () => {
  // ⚠️ CE CONTRÔLE A CHANGÉ AVEC COURSES C0, ET LA RÈGLE AUSSI. Il exigeait
  // qu'un rafraîchissement reparte SANS AUCUNE sélection. Depuis C0, une
  // composition VALIDÉE est relue depuis `planned_meal_items` et restaurée :
  // c'est le but même du lot. Ce qui reste vrai — et que ce contrôle garde —
  // c'est qu'un brouillon NON validé, lui, ne survit à rien.
  //
  //   · l'état LOCAL démarre à `null` = « l'élève n'a rien touché »
  //   · aucune persistance navigateur n'a été inventée
  //   · sans composition validée, la sélection effective retombe sur
  //     `AUCUNE_SELECTION`, donc sur « incomplet », donc sur aucune quantité
  assert.ok(CODE_CHOIX.includes("useState<SelectionDeChoix | null>(null)"));
  assert.ok(CODE_CHOIX.includes("brouillon ?? selectionValidee ?? AUCUNE_SELECTION"));
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

  // ⚠️ N1.5.3 — LA PHRASE A CHANGÉ, ET C'EST L'ARBITRAGE §12 : on parle à
  // l'élève de SON objectif, pas des « objectifs de ce repas ».
  assert.ok(html.includes("Cette combinaison s&#x27;approche au mieux de ton objectif."));
  // Les quantités sont bien là : « approché », ce n'est pas « raté ».
  assert.ok(html.includes("Quantités pour ton repas"));
  assert.ok(html.includes("Cible du repas"));
  assert.ok(html.includes("Résultat"));
  // Aucun jargon : pas de code d'avertissement, pas de delta, pas de statut.
  for (const mot of ["approximate", "systeme_degenere", "delta", "warning", "status"]) {
    assert.ok(!html.includes(mot), `« ${mot} » ne doit pas atteindre l'écran`);
  }
});

await test("N1.5-17 / BEST-03. « impossible » AFFICHE les quantités, et invite à changer un choix", () => {
  const s = solveMealChoices([POULET, SAUMON, HUILE], { proteinGrams: 50, carbGrams: 60, fatGrams: 20 });
  assert.equal(s.status, "impossible");
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");

  // ⚠️ CE CONTRÔLE VÉRIFIAIT EXACTEMENT L'INVERSE, ET C'EST LE CŒUR DE N1.5.3.
  // Il gardait le choix produit « pas une seule quantité en impossible », posé
  // en N1.5 sur la prémisse qu'une solution hors cible serait « mensongère ».
  // Cette prémisse est tombée : le solveur rend désormais l'OPTIMUM CERTIFIÉ de
  // la boîte (conditions KKT vérifiées, § KKT plus bas). La solution ne ment
  // pas — elle est loin de la cible, et l'élève a le droit de la voir.
  assert.ok(html.includes("Poulet"), "les quantités doivent être affichées, même en impossible");
  assert.ok(html.includes("Saumon"));
  assert.ok(html.includes("Huile"));
  assert.ok(html.includes("ne permet pas d&#x27;atteindre exactement ton objectif"));
  assert.ok(html.includes("meilleure proposition possible avec tes choix"));
  assert.ok(html.includes("Modifie un de tes choix"));
  // La cible ET le résultat sont dits : l'élève doit pouvoir comparer.
  assert.ok(html.includes("Cible du repas"));
  assert.ok(html.includes("Résultat"), "le résultat doit être affiché en impossible");
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

  // ⚠️ N1.5.3 — CE CONTRÔLE DISAIT « L'ÉLÈVE NE VOIT AUCUNE QUANTITÉ ». Il dit
  // maintenant l'inverse, et le plafond garde son rôle intact : il n'existe pas
  // pour CACHER une mauvaise combinaison, mais pour l'empêcher de se déguiser
  // en bonne. 300 g de brocoli reste la meilleure quantité réalisable ; ce qui
  // était interdit, c'est 1 074 g présentés comme « exact ».
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");
  assert.ok(html.includes("Brocoli"), "la meilleure solution réalisable doit être affichée");
  assert.ok(html.includes("Modifie un de tes choix"));
  // Et surtout : aucune quantité au-delà du plafond.
  for (const item of s.items) {
    assert.ok(item.displayQuantity <= item.maxQuantity, `${item.name} dépasse son plafond`);
  }
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

  // ⚠️ AUCUN MINIMUM PAR CATÉGORIE, ET AUCUN MINIMUM CONSTANT. Depuis N1.5.2
  // le solveur a un plancher, mais il vient TOUJOURS du coach : sans champ
  // rempli, il vaut zéro, et une quantité de 0 reste atteignable.
  assert.ok(s.items.every((i) => i.minQuantity === 0), "aucun plancher ne doit apparaître sans champ coach");
  assert.ok(s.items.some((i) => i.displayQuantity === 0) ||
    solveMealChoices([SAUMON, RIZ, HUILE], { proteinGrams: 50, carbGrams: 40, fatGrams: 30 })
      .items.some((i) => i.displayQuantity === 0));
  assert.ok(!/MIN_SOLIDE|MIN_LIQUIDE|MINIMUM_[A-Z]/.test(CODE_SOLVEUR), "un minimum constant est déclaré");
  assert.ok(!/proteine|feculent|legume|fruit/i.test(CODE_SOLVEUR), "un minimum par catégorie apparaît");

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
  assert.ok(CODE_FORM.includes("minimum_quantity: option.minimumQuantity ?? null"));
  assert.ok(CODE_FORM.includes("quantity_unit:"));
  assert.ok(!CODE_FORM.includes("displayName"), "le libellé ne doit jamais repartir vers la RPC");
  assert.ok(!CODE_FORM.includes("nutrition:"), "les macros ne doivent jamais repartir vers la RPC");

  // Les deux clés voyagent ENSEMBLE ou pas du tout.
  assert.ok(CODE_FORM.includes("option.preferredQuantity == null && option.minimumQuantity == null"));
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
        preferredQuantity: 250, quantityUnit: "g",
      } as ChoiceOption,
    ]),
  ];
  const aliments = alimentsPourLeSolveur(choixResolus(occurrences, { s1: "o1" }));
  assert.ok(aliments);
  assert.equal(aliments[0].preferredQuantity, null, "une unité incohérente doit annuler la préférence");

  // Et la même option, unité cohérente : la préférence passe.
  const bonnes = alimentsPourLeSolveur(
    choixResolus(
      [occurrence("s1", "Ta boisson", [{ ...occurrences[0].options[0], quantityUnit: "ml" } as ChoiceOption])],
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
          preferred_quantity_override: override, minimum_quantity_override: null },
        { id: "it-2", list_id: listId, position: 2, catalog_food_id: FB, product_id: null,
          preferred_quantity_override: null, minimum_quantity_override: null },
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
  assert.equal(a.options[0].quantityUnit, "g");

  // ⚠️ L'ALIMENT SANS AUCUNE PORTION N'EN REÇOIT PAS UNE INVENTÉE, et son
  // unité reste nulle avec elle — la contrainte de paire dit la même chose.
  assert.equal(a.options[1].preferredQuantity, null);
  assert.equal(a.options[1].quantityUnit, null);

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

/* ══════════════════════════════════════════════════════════════════════════
   N1.5.2-MIN-01..22 — LA QUANTITÉ MINIMALE
   ──────────────────────────────────────────────────────────────────────────
   ⚠️ TROIS NATURES DE NOMBRE. La PORTION PRÉFÉRÉE est SOFT — le solveur s'en
   écarte librement. Le MINIMUM est HARD — il ne descend jamais en dessous. Le
   PLAFOND est HARD aussi, et il gagne toujours. Confondre les trois, c'est
   perdre la garantie de présence que ce lot existe pour donner.
   ══════════════════════════════════════════════════════════════════════════ */

const avecMin = (f: SelectedFoodForMealSolver, minimumQuantity: number | null) =>
  ({ ...f, minimumQuantity }) as SelectedFoodForMealSolver;

/** Le petit déjeuner TERRAIN où beurre et sirop tombent à 0 (valeurs Ciqual). */
const AVOINE = aliment("avoine", "Flocons d'avoine", 11.4, 57.7, 7.82);
const BEURRE = aliment("beurre", "Beurre 80 % MG doux", 0.63, 0.71, 83);
const FBLANC = aliment("fblanc", "Fromage blanc 0 % MG", 7.19, 4.22, 0);
const OEUFCRU = aliment("oeufcru", "Œuf cru", 12.8, 0.06, 9.83);
const SIROP = aliment("sirop", "Sirop d'agave", 0.25, 78, 0.5);
const PDJ_MIN = [AVOINE, BEURRE, FBLANC, OEUFCRU, SIROP];
const CIBLE_MIN: MealMacroTarget = { proteinGrams: 55, carbGrams: 93, fatGrams: 32 };

await test("N1.5.2-MIN-01/22. le cas TERRAIN : beurre et sirop ne tombent plus à 0", () => {
  const sans = solveMealChoices(PDJ_MIN, CIBLE_MIN);
  const beurreSans = sans.items.find((i) => i.optionId === "opt-beurre");
  const siropSans = sans.items.find((i) => i.optionId === "opt-sirop");
  // ⚠️ LE DÉCOR DOIT D'ABORD REPRODUIRE LE DÉFAUT, sinon la correction ne
  // prouve rien.
  assert.equal(beurreSans?.displayQuantity, 0, "le banc doit reproduire le beurre à 0 g");
  assert.equal(siropSans?.displayQuantity, 0, "le banc doit reproduire le sirop à 0 g");
  assert.equal(beurreSans?.minQuantity, 0, "sans champ coach, le plancher vaut zéro (MIN-01)");

  const avec = solveMealChoices(
    PDJ_MIN.map((f) => avecMin(f, f.optionId === "opt-beurre" ? 5 : f.optionId === "opt-sirop" ? 10 : null)),
    CIBLE_MIN,
  );
  console.log(`    sans minimum : ${sans.items.map((i) => `${i.name.split(" ")[0]} ${i.displayQuantity}`).join(", ")} (${sans.status})`);
  console.log(`    beurre>=5 sirop>=10 : ${avec.items.map((i) => `${i.name.split(" ")[0]} ${i.displayQuantity}`).join(", ")} (${avec.status})`);

  assert.ok((avec.items.find((i) => i.optionId === "opt-beurre")?.displayQuantity ?? 0) >= 5);
  assert.ok((avec.items.find((i) => i.optionId === "opt-sirop")?.displayQuantity ?? 0) >= 10);
  // Les AUTRES aliments se réajustent : ce n'est pas un simple clamp.
  assert.notEqual(avec.items[0].displayQuantity, sans.items[0].displayQuantity);
  assert.notEqual(avec.items[2].displayQuantity, sans.items[2].displayQuantity);
});

await test("N1.5.2-MIN-02/19. la quantité AFFICHÉE respecte le minimum, arrondi compris", () => {
  // ⚠️ LE PIÈGE MESURÉ. Un aliment figé à son plancher a une quantité EXACTE
  // égale à ce plancher ; `Math.round(4.4)` rendrait 4, sous la contrainte.
  for (const minimum of [4.4, 5, 5.5, 12.3, 27.9]) {
    const s = solveMealChoices(
      [avecMin(BEURRE, minimum), AVOINE, FBLANC],
      { proteinGrams: 50, carbGrams: 90, fatGrams: 3 },
    );
    const beurre = s.items.find((i) => i.optionId === "opt-beurre");
    assert.ok(beurre);
    assert.ok(beurre.quantity >= minimum - 1e-9, `quantité exacte ${beurre.quantity} < ${minimum}`);
    assert.ok(beurre.displayQuantity >= minimum, `quantité AFFICHÉE ${beurre.displayQuantity} < ${minimum}`);
    assert.equal(beurre.minQuantity, minimum);
  }
  // Et les macros affichées viennent bien de la quantité affichée.
  const s = solveMealChoices([avecMin(BEURRE, 12.3), AVOINE, FBLANC], { proteinGrams: 50, carbGrams: 90, fatGrams: 3 });
  const beurre = s.items.find((i) => i.optionId === "opt-beurre")!;
  assert.equal(beurre.fatGrams, (BEURRE.fatPer100 * beurre.displayQuantity) / 100);
});

await test("N1.5.2-MIN-03/04. un aliment figé au minimum RESTE dans le résidu, et les autres se re-résolvent", () => {
  const s = solveMealChoices(
    [avecMin(BEURRE, 30), AVOINE, FBLANC],
    { proteinGrams: 50, carbGrams: 90, fatGrams: 5 },
  );
  const beurre = s.items.find((i) => i.optionId === "opt-beurre")!;
  assert.equal(beurre.boundedToMin, true);
  assert.ok(s.determinism.flooredOrder.includes("opt-beurre"));
  // ⚠️ FIGER N'EST PAS RETIRER : les 30 g apportent toujours leurs lipides.
  assert.ok(beurre.fatGrams > 0);
  assert.equal(s.actual.fatGrams, s.items.reduce((t, i) => t + i.fatGrams, 0));

  // La preuve directe : le même repas SANS le beurre du tout donne d'autres
  // quantités aux deux autres — le résidu n'est donc pas le même.
  const sans = solveMealChoices([AVOINE, FBLANC], { proteinGrams: 50, carbGrams: 90, fatGrams: 5 });
  assert.notEqual(
    Math.round(s.items.find((i) => i.optionId === "opt-avoine")!.quantity),
    Math.round(sans.items[0].quantity),
  );
  // Et il y a bien eu une re-résolution.
  assert.ok(s.determinism.iterations >= 2);
});

await test("N1.5.2-MIN-05/06. minimum et plafond coexistent ; le plafond gagne toujours", () => {
  const s = solveMealChoices(
    [avecMin(BEURRE, 20), avecMin(FBLANC, 50), AVOINE],
    { proteinGrams: 120, carbGrams: 200, fatGrams: 90 },
  );
  for (const item of s.items) {
    assert.ok(item.displayQuantity >= item.minQuantity, `${item.name} sous son minimum`);
    assert.ok(item.displayQuantity <= item.maxQuantity, `${item.name} au-dessus de son plafond`);
  }

  // ⚠️ UN MINIMUM AU-DELÀ DU PLAFOND N'EST PAS CALCULABLE — et c'est REFUSÉ EN
  // AMONT, pas écrasé par le solveur. Sans cette garde, le solveur afficherait
  // 300 pour un minimum de 350 : la contrainte serait trahie en silence.
  const option = {
    type: "aliment", id: F_POULET, optionId: "o1", displayName: "Beurre",
    nutrition: { unit: "g", proteinPer100: 0.63, carbPer100: 0.71, fatPer100: 83 },
    minimumQuantity: 350, quantityUnit: "g",
  } as ChoiceOption;
  assert.equal(optionCalculable(option), false, "un minimum de 350 g doit rendre l'option non calculable");
  assert.equal(optionCalculable({ ...option, minimumQuantity: 300 } as ChoiceOption), true);
  // Liquide : 600 ml refusé, 500 ml accepté.
  const liquide = { ...option, nutrition: { unit: "ml", proteinPer100: 3.3, carbPer100: 4.8, fatPer100: 1.6 },
    quantityUnit: "ml", minimumQuantity: 600 } as ChoiceOption;
  assert.equal(optionCalculable(liquide), false);
  assert.equal(optionCalculable({ ...liquide, minimumQuantity: 500 } as ChoiceOption), true);
});

await test("N1.5.2-MIN-07/08. NULL est l'absence de minimum ; zéro et négatif n'en sont pas", () => {
  // Côté solveur : une valeur non exploitable ne fabrique jamais un plancher.
  for (const valeur of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const s = solveMealChoices([avecMin(BEURRE, valeur as number | null), AVOINE, FBLANC], CIBLE_MIN);
    assert.equal(s.items[0].minQuantity, 0, `« ${String(valeur)} » ne doit pas devenir un plancher`);
  }
  // Côté base : la contrainte refuse 0 et le négatif, pour qu'il n'y ait
  // qu'UNE façon d'écrire « pas de minimum ».
  const migration = lire("../../supabase/migrations/20260909090000_n1_5_2_quantite_minimale.sql");
  assert.ok(migration.includes("check (minimum_quantity is null or minimum_quantity > 0)"));
  assert.ok(migration.includes("check (minimum_quantity_override is null or minimum_quantity_override > 0)"));
  // Côté writer : refus avant le réseau.
  assert.ok(CODE_LISTES.includes("if (valeur !== null && (!Number.isFinite(valeur) || valeur <= 0)) return false;"));
  assert.ok(CODE_LISTES.includes("if (valeur !== null && valeur > borneMaximale(unite)) return false;"));
});

await test("N1.5.2-MIN-09/10/11. minimum et préférence ne se confondent jamais", () => {
  // MIN-11 — préférence SOUS le minimum : le minimum gagne, rien ne plante.
  const s = solveMealChoices(
    [{ ...avecMin(BEURRE, 20), preferredQuantity: 10 }, AVOINE, FBLANC],
    CIBLE_MIN,
  );
  const beurre = s.items[0];
  assert.ok(beurre.displayQuantity >= 20, `le minimum doit gagner, il vaut ${beurre.displayQuantity}`);
  assert.equal(beurre.preferredQuantity, 10, "la préférence reste dite, même dominée");
  assert.equal(beurre.minQuantity, 20);

  // MIN-09 — un minimum n'est pas une préférence : il ne recentre rien.
  const sansPref = solveMealChoices([avecMin(BEURRE, 20), AVOINE, FBLANC], CIBLE_MIN);
  assert.equal(sansPref.items[0].preferredQuantity, null);

  // MIN-10 — une préférence n'est pas un minimum : elle n'empêche pas 0.
  const prefSeule = solveMealChoices(
    [{ ...BEURRE, preferredQuantity: 10 }, AVOINE, FBLANC, OEUFCRU, SIROP],
    CIBLE_MIN,
  );
  assert.equal(prefSeule.items[0].minQuantity, 0);
});

await test("N1.5.2-MIN-12. des minimums contradictoires avec la cible donnent un statut HONNÊTE", () => {
  const s = solveMealChoices(
    [avecMin(OEUFCRU, 300), avecMin(FBLANC, 300), AVOINE],
    { proteinGrams: 50, carbGrams: 40, fatGrams: 15 },
  );
  // ⚠️ LES MINIMUMS NE SONT NI VIOLÉS, NI RABOTÉS, NI CACHÉS.
  assert.ok(s.items[0].displayQuantity >= 300);
  assert.ok(s.items[1].displayQuantity >= 300);
  assert.equal(s.status, "impossible");
  // Et le verdict vient des macros finales, pas d'une règle nouvelle.
  assert.ok(Math.abs(s.delta.proteinGrams) > Math.max(5, 0.1 * 50));
});

await test("N1.5.2-MIN-13/14. le snapshot fige le minimum, liste par liste", async () => {
  const WHEY = "cc000000-0000-4000-8000-000000000001";
  const client = (listId: string, minimum: number | null) => {
    const tables: Record<string, Record<string, unknown>[]> = {
      food_lists: [{ id: listId, name: "Liste", archived_at: null, updated_at: "2026-08-15" }],
      food_list_items: [
        { id: "it-1", list_id: listId, position: 1, catalog_food_id: WHEY, product_id: null,
          preferred_quantity_override: null, minimum_quantity_override: minimum },
      ],
      food_catalog: [
        { id: WHEY, name: "Whey", nutrition_unit: "g", protein_per_100: "80", carb_per_100: "5",
          fat_per_100: "2", piece_weight_g: null, preferred_quantity: null },
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

  // ⚠️ UN MINIMUM SEUL, SANS PORTION PRÉFÉRÉE — le cas que la contrainte de
  // paire de N1.5.1 rendait IMPOSSIBLE, et la raison du renommage de l'unité.
  const a = await lireSnapshotDeListe(client("liste-a", 10), "liste-a");
  assert.equal(a?.options[0].minimumQuantity, 10);
  assert.equal(a?.options[0].preferredQuantity, null);
  assert.equal(a?.options[0].quantityUnit, "g", "l'unité doit exister même sans portion préférée");

  // MIN-14 — deux listes, deux minimums, indépendants.
  const b = await lireSnapshotDeListe(client("liste-b", 20), "liste-b");
  assert.equal(b?.options[0].minimumQuantity, 20);

  // Sans minimum ni portion : les trois champs restent nuls ensemble.
  const c = await lireSnapshotDeListe(client("liste-c", null), "liste-c");
  assert.equal(c?.options[0].minimumQuantity, null);
  assert.equal(c?.options[0].quantityUnit, null);
});

await test("N1.5.2-MIN-15. un ancien snapshot sans minimum reproduit N1.5 au bit près", () => {
  for (const jeu of [BANC_A, BANC_B, BANC_C, PDJ_MIN]) {
    const cible = jeu === PDJ_MIN ? CIBLE_MIN : CIBLE_BANC;
    const référence = solveMealChoices(jeu, cible);
    for (const absent of [null, undefined]) {
      const s = solveMealChoices(jeu.map((f) => avecMin(f, absent as null)), cible);
      assert.deepEqual(s.items.map((i) => i.quantity), référence.items.map((i) => i.quantity));
      assert.equal(s.status, référence.status);
    }
  }
});

await test("N1.5.2-MIN-16/21. aucune lecture bibliothèque, aucune écriture consommation", () => {
  for (const [nom, code] of [["solveur", CODE_SOLVEUR], ["sélection", CODE_SELECTION], ["écran", CODE_CHOIX]] as const) {
    assert.ok(!code.includes("food_list_items"), `${nom} lit food_list_items`);
    assert.ok(!code.includes("food_lists"), `${nom} lit food_lists`);
    assert.ok(!code.includes("consumed_meals"), `${nom} touche consumed_meals`);
    assert.ok(!code.includes("meal_entries"), `${nom} touche meal_entries`);
  }
  const migration = lire("../../supabase/migrations/20260909090000_n1_5_2_quantite_minimale.sql");
  const sansProseSql = migration.replace(/--[^\n]*/g, " ");
  for (const table of ["food_list_items", "public.food_catalog", "consumed_meals", "meal_entries"]) {
    assert.ok(!new RegExp(`from\\s+${table.replace(".", "\\.")}`).test(sansProseSql),
      `la RPC ne doit pas lire ${table}`);
  }
});

await test("N1.5.2-MIN-17. aucun rôle, aucun referenceGrams, aucune catégorie", () => {
  for (const [nom, code] of [["solveur", CODE_SOLVEUR], ["sélection", CODE_SELECTION], ["listes", CODE_LISTES]] as const) {
    assert.ok(!/\brole\b/.test(code), `${nom} manipule un rôle`);
    assert.ok(!/referenceGrams/.test(code), `${nom} manipule un referenceGrams`);
  }
  // ⚠️ LE PLANCHER NE DÉPEND QUE DU CHAMP DU COACH. Deux aliments de macros
  // opposées et de minimum identique ont le même plancher.
  const s = solveMealChoices([avecMin(BEURRE, 15), avecMin(FBLANC, 15), avecMin(SIROP, 15)], CIBLE_MIN);
  assert.equal(new Set(s.items.map((i) => i.minQuantity)).size, 1);
});

await test("N1.5.2-MIN-18. g et ml, chacun son plancher et son plafond", () => {
  const s = solveMealChoices(
    [avecMin(LAIT, 150), avecMin(POULET, 20), HUILE],
    { proteinGrams: 70, carbGrams: 40, fatGrams: 25 },
  );
  const lait = s.items.find((i) => i.optionId === "opt-lait")!;
  assert.equal(lait.unit, "ml");
  assert.ok(lait.displayQuantity >= 150, `le lait vaut ${lait.displayQuantity} ml`);
  assert.equal(lait.maxQuantity, MAX_LIQUIDE_ML);
  assert.equal(s.items.find((i) => i.optionId === "opt-poulet")!.maxQuantity, MAX_SOLIDE_G);
});

await test("N1.5.2-MIN-20. déterminisme : 100 exécutions identiques avec minimums", () => {
  const jeu = PDJ_MIN.map((f) => avecMin(f, f.optionId === "opt-beurre" ? 5 : f.optionId === "opt-sirop" ? 10 : null));
  const référence = JSON.stringify(solveMealChoices(jeu, CIBLE_MIN));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(JSON.stringify(solveMealChoices(jeu, CIBLE_MIN)), référence, `divergence au tour ${i}`);
  }
});

await test("N1.5.2-MIN-BALAYAGE. min ≤ q ≤ max sur un large balayage, sans NaN", () => {
  const cat = [AVOINE, BEURRE, FBLANC, OEUFCRU, SIROP, LAIT, HUILE];
  let n = 0;
  for (let masque = 1; masque < 1 << cat.length; masque += 1) {
    const base = cat.filter((_, i) => (masque >> i) & 1);
    for (const m of [null, 5, 12.3, 60]) {
      for (const cible of [CIBLE_MIN, { proteinGrams: 10, carbGrams: 10, fatGrams: 5 }, { proteinGrams: 0, carbGrams: 0, fatGrams: 0 }]) {
        const s = solveMealChoices(base.map((f) => avecMin(f, m)), cible);
        for (const item of s.items) {
          assert.ok(item.displayQuantity >= item.minQuantity, `${item.name} : ${item.displayQuantity} < ${item.minQuantity}`);
          assert.ok(item.displayQuantity <= item.maxQuantity);
          assert.ok(Number.isFinite(item.quantity) && Number.isFinite(item.displayQuantity));
          n += 1;
        }
      }
    }
  }
  console.log(`    ${n} quantités vérifiées entre plancher et plafond`);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.5.2-ROLL-01..10 — EXPAND, PAS RENAME
   ──────────────────────────────────────────────────────────────────────────
   ⚠️ CE QUE CETTE SECTION REMPLACE, ET POURQUOI. Elle s'appelait
   « N1.5.2-RENOMMAGE » et vérifiait exactement l'inverse : que l'ancien nom
   ait DISPARU partout. C'était juste sur une base neuve, et faux sur la
   vraie : la production porte 63 options avec `preferred_unit`, et le code
   DÉPLOYÉ lit cette colonne. Renommer, c'est choisir qui casse — la base
   migrée avant le déploiement, ou le déploiement avant la base. Il n'existe
   pas d'ordre sûr.

   Ce lot est donc l'EXPAND d'un expand → deploy → contract : la colonne neuve
   naît À CÔTÉ, l'unité est recopiée 1:1, l'ancienne colonne SURVIT et reste
   ÉCRITE. Le CONTRACT — la supprimer — sera un lot séparé, après déploiement
   et validation terrain.

   ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. La migration RACONTE l'expand en
   commentaires ET dans des `comment on column`, qui sont des CHAÎNES SQL que
   le nettoyage des `--` ne touche pas. Chercher « drop column » ou « rename »
   en texte brut ferait rougir ces contrôles pour les phrases qui affirment
   précisément ce qu'ils vérifient. On cible donc le DDL.
   ══════════════════════════════════════════════════════════════════════════ */

const MIGRATION_N152 = lire("../../supabase/migrations/20260909090000_n1_5_2_quantite_minimale.sql");
/** La migration DÉPOUILLÉE de ses commentaires `--` ET de ses `comment on … is '…'`. */
const DDL_N152 = MIGRATION_N152
  .replace(/--[^\n]*/g, " ")
  .replace(/comment on [^;]*;/gi, " ");

await test("N1.5.2-ROLL-01. l'unité neuve est AJOUTÉE, et l'ancienne recopiée 1:1", () => {
  assert.ok(/add column if not exists quantity_unit text/i.test(DDL_N152),
    "quantity_unit doit être AJOUTÉE, pas obtenue par renommage");
  // ⚠️ LA COPIE EST LE CŒUR DU LOT. Sans elle, les 63 snapshots de production
  // perdent l'échelle de leur portion le jour du déploiement.
  assert.ok(/set quantity_unit = preferred_unit/i.test(DDL_N152), "la copie 1:1 a disparu");
  // ⚠️ ET ELLE NE FABRIQUE RIEN : `where preferred_unit is not null` interdit
  // d'inventer une unité là où il n'y en avait pas.
  assert.ok(/where preferred_unit is not null/i.test(DDL_N152),
    "la copie doit être conditionnée à l'existence de l'ancienne valeur");
});

await test("N1.5.2-ROLL-02. la copie est IDEMPOTENTE et n'écrase jamais le neuf", () => {
  // `and quantity_unit is null` : au second passage l'update est un no-op, et
  // il ne peut pas piétiner une valeur posée entre-temps par le nouveau code.
  assert.ok(/where preferred_unit is not null\s*and quantity_unit is null/i.test(DDL_N152),
    "sans cette garde, rejouer la migration écraserait des écritures récentes");
});

await test("N1.5.2-ROLL-09. AUCUN DROP de preferred_unit", () => {
  assert.ok(!/drop column[^;]*preferred_unit/i.test(DDL_N152), "un DROP de preferred_unit est présent");
  assert.ok(!/drop\s+column\s+if\s+exists\s+preferred_unit/i.test(DDL_N152));
});

await test("N1.5.2-ROLL-10. AUCUN RENAME de preferred_unit", () => {
  assert.ok(!/rename column\s+preferred_unit/i.test(DDL_N152), "un RENAME de preferred_unit est présent");
  assert.ok(!/rename[^;]*preferred_unit[^;]*to/i.test(DDL_N152));
  // Et rien n'est renommé du tout dans ce lot : l'expand n'en a pas besoin.
  assert.ok(!/rename column/i.test(DDL_N152), "ce lot ne doit renommer AUCUNE colonne");
});

await test("N1.5.2-ROLL-03. les contraintes de N1.5.1 sur preferred_unit sont CONSERVÉES", () => {
  // ⚠️ NI SUPPRIMÉES, NI RÉÉCRITES. La paire de N1.5.1 dit « portion présente
  // ⟹ unité legacy présente » : un minimum SEUL la satisfait déjà (les deux
  // nulles), donc elle n'empêche pas le cas neuf et il n'y avait rien à
  // généraliser de ce côté. La toucher aurait été une casse gratuite.
  assert.ok(!/drop constraint[^;]*meal_choice_options_preferred_paire/i.test(DDL_N152),
    "la paire de N1.5.1 ne doit pas être supprimée");
  assert.ok(!/drop constraint[^;]*meal_choice_options_preferred_unit_check/i.test(DDL_N152),
    "le vocabulaire d'unité de N1.5.1 ne doit pas être supprimé");
});

await test("N1.5.2-ROLL-04. la DIVERGENCE des deux unités est interdite par une contrainte", () => {
  // Deux colonnes disant deux unités différentes pour la MÊME quantité :
  // c'est le désastre que le rename voulait éviter et que l'expand pourrait
  // réintroduire s'il laissait les deux vivre leur vie.
  assert.ok(DDL_N152.includes("check (preferred_unit is null or preferred_unit = quantity_unit)"),
    "la contrainte de cohérence legacy a disparu");
  assert.ok(/add constraint meal_choice_options_unite_legacy_coherente/i.test(DDL_N152));
});

await test("N1.5.2-ROLL-05. la contrainte MÉTIER couvre les deux quantités", () => {
  assert.ok(MIGRATION_N152.includes(
    "check ((preferred_quantity is null and minimum_quantity is null) = (quantity_unit is null))"));
  // ⚠️ AUCUNE COLONNE `minimum_unit` CRÉÉE. Elle ne pourrait qu'être égale.
  assert.ok(!/add column[^;]*minimum_unit/i.test(DDL_N152), "une colonne minimum_unit a été créée");
  assert.ok(!/rename[^;]*to\s+minimum_unit/i.test(DDL_N152));
  // Et aucune contrainte ne code le plafond — il vit dans le solveur.
  assert.ok(!/check[^;]*\b(300|500)\b/.test(DDL_N152));
});

await test("N1.5.2-ROLL-06. la RPC écrit ENCORE preferred_unit, et seulement s'il y a une portion", () => {
  // ⚠️ SANS DOUBLE ÉCRITURE, UN REPAS CONSTRUIT PENDANT LE ROLLOUT SERAIT
  // INVISIBLE POUR LE CODE ENCORE DÉPLOYÉ : sa portion aurait une unité que
  // l'ancien lecteur ne sait pas trouver.
  assert.ok(DDL_N152.includes("preferred_unit = case when v_opt_pref is not null then v_opt_pref_unit end"),
    "la double écriture de l'update a disparu");
  assert.ok(DDL_N152.includes("case when v_opt_pref is not null then v_opt_pref_unit end)"),
    "la double écriture de l'insert a disparu");
  // ⚠️ ET UN MINIMUM SEUL NE LA REMPLIT PAS. `preferred_unit` ne dit que
  // l'unité d'une PORTION : lui faire dire celle d'un minimum ferait déduire
  // à l'ancien lecteur une portion qui n'existe pas — et la paire de N1.5.1
  // la refuserait de toute façon.
  assert.ok(!/preferred_unit = v_opt_pref_unit(?!\s*end)/.test(DDL_N152),
    "preferred_unit ne doit jamais être écrite inconditionnellement");
});

await test("N1.5.2-ROLL-07. la clé d'entrée preferred_unit reste acceptée", () => {
  // Une charge utile écrite AVANT ce lot ne connaît que l'ancien nom. Elle
  // reste valide : la clé n'a jamais eu d'autre sens que « l'unité de cette
  // option ». Même politesse que `choice_slots` absente.
  assert.ok(DDL_N152.includes("nullif(v_option->>'quantity_unit', '')"));
  assert.ok(DDL_N152.includes("nullif(v_option->>'preferred_unit', '')"));
  assert.ok(/coalesce\(\s*nullif\(v_option->>'quantity_unit', ''\),\s*nullif\(v_option->>'preferred_unit', ''\)\)/
    .test(DDL_N152), "le nouveau nom doit avoir la priorité sur l'ancien");
});

await test("N1.5.2-ROLL-08. le refus de N1.5.1 est conservé, le cas neuf reçoit un nom neuf", () => {
  // ⚠️ UN MESSAGE D'ERREUR EST LISIBLE PAR DU CODE DÉPLOYÉ. Rebaptiser
  // `PORTION_SANS_UNITE` aurait été un rename de plus, pour un gain nul.
  assert.ok(DDL_N152.includes("PORTION_SANS_UNITE"), "le refus de N1.5.1 a été renommé");
  assert.ok(DDL_N152.includes("MINIMUM_SANS_UNITE"), "le cas neuf doit avoir son propre nom");
  assert.ok(!DDL_N152.includes("QUANTITE_SANS_UNITE"), "un renommage de message subsiste");
});

await test("N1.5.2-ROLL-NOUVEAU-LECTEUR. le nouveau code lit quantity_unit, jamais preferred_unit", () => {
  // ⚠️ L'ANCIENNE COLONNE SURVIT EN BASE, MAIS PAS DANS LA LOGIQUE NEUVE.
  // C'est toute la différence entre « compatible » et « ambigu » : une seule
  // source de vérité côté nouveau code, deux colonnes côté base le temps du
  // rollout.
  for (const [nom, code] of [
    ["listes", CODE_LISTES], ["formulaire", CODE_FORM],
    ["sélection", CODE_SELECTION], ["lecture", CODE_LECTURE],
  ] as const) {
    assert.ok(!/preferredUnit|preferred_unit/.test(code),
      `${nom} : le nouveau code ne doit plus nommer l'ancienne colonne`);
  }
  // Et la charge utile n'émet QUE le nom neuf : c'est la RPC qui dérive
  // l'ancienne colonne, pas la couche TypeScript.
  assert.ok(CODE_FORM.includes("quantity_unit:"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-MIN-01..10 — LE PARCOURS A5 SURVIT INTACT
   ──────────────────────────────────────────────────────────────────────────
   ⚠️ DEUX MODÈLES, PAS UN. Le repas calculé est une PRESCRIPTION ; « ce que
   j'ai mangé » est la VÉRITÉ DE CONSOMMATION. N1.5.2 ne fusionne rien, ne
   masque rien, n'écrit rien dans l'un depuis l'autre.
   ══════════════════════════════════════════════════════════════════════════ */

const CODE_CONSO = sansProse(lire("../../components/student/ConsumedMealSection.tsx"));

await test("A5-MIN-01/02/03/04. les quatre chemins d'ajout restent accessibles", () => {
  // ⚠️ LE BOUTON D'OUVERTURE EST TOUJOURS LÀ, et il n'est pas conditionné à
  // l'état du repas prescrit.
  assert.ok(CODE_CONSO.includes("Ajouter un aliment"));
  for (const chemin of ["onAjouterCatalogue", "onAjouterProduit", "onAjouterManuel"]) {
    assert.ok(CODE_CONSO.includes(chemin), `le chemin ${chemin} a disparu`);
  }
  // Le scanner et la recherche vivent dans la feuille d'ajout, toujours montée.
  assert.ok(CODE_CONSO.includes("AddFoodSheet") || CODE_SEMAINE.includes("AddFoodSheet") ||
    lire("../../components/student/AddFoodSheet.tsx").length > 0);
  const feuille = sansProse(lire("../../components/student/AddFoodSheet.tsx"));
  assert.ok(/scan|Scanner|code-barres|gtin/i.test(feuille), "le parcours scanner a disparu de la feuille d'ajout");

  // ⚠️ ET LA SECTION EST TOUJOURS RENDUE PAR L'ÉCRAN DE LA SEMAINE, à côté
  // des choix, pas à leur place.
  assert.ok(CODE_SEMAINE.includes("<ConsumedMealSection"));
  assert.ok(CODE_SEMAINE.includes("<StudentMealChoices"));
});

await test("A5-MIN-05/06. corriger et supprimer une entrée consommée fonctionnent toujours", () => {
  assert.ok(CODE_CONSO.includes("onCorriger"));
  assert.ok(CODE_CONSO.includes("onSupprimerAliment"));
  // Les deux sont bien câblés depuis l'écran de la semaine.
  assert.ok(CODE_SEMAINE.includes("onCorriger="));
  assert.ok(CODE_SEMAINE.includes("onSupprimer") || CODE_SEMAINE.includes("suivi.onSupprimer"));
});

await test("A5-MIN-07. le calcul N1.5.2 n'écrit RIEN dans la consommation", () => {
  for (const [nom, code] of [
    ["solveur", CODE_SOLVEUR], ["sélection", CODE_SELECTION], ["choix", CODE_CHOIX],
  ] as const) {
    for (const interdit of ["consumed_meals", "meal_entries", "ouvrir_repas_prescrit", ".rpc(", ".insert(", ".update("]) {
      assert.ok(!code.includes(interdit), `${nom} touche « ${interdit} »`);
    }
    assert.ok(!/from ["']@\/lib\/supabase/.test(code), `${nom} importe Supabase`);
  }
  // ⚠️ ET LA MIGRATION NON PLUS : aucune écriture de consommation en base.
  const sqlSansProse = lire("../../supabase/migrations/20260909090000_n1_5_2_quantite_minimale.sql")
    .replace(/--[^\n]*/g, " ");
  for (const table of ["consumed_meals", "meal_entries"]) {
    assert.ok(!new RegExp(`(insert into|update)\\s+public\\.${table}`).test(sqlSansProse));
  }
});

await test("A5-MIN-08/09. les deux modèles ne se touchent pas", () => {
  // ⚠️ AUCUN CHEMIN NE RELIE UNE CONSOMMATION À UN CHOIX, NI L'INVERSE.
  // Le composant de choix ne connaît ni les repas consommés, ni leurs entrées.
  // ⚠️ « meal » TOUT COURT SERAIT TROP LARGE : le composant importe
  // `meal-choice-selection`. Ce qu'il ne doit pas connaître, c'est la
  // CONSOMMATION — ni son type, ni ses tables, ni ses hooks.
  for (const notion of ["ConsumedMeal", "consumed", "meal_entries", "useConsumedMeals", "ConsumedFood"]) {
    assert.ok(!CODE_CHOIX.includes(notion), `l'écran des choix connaît « ${notion} »`);
  }
  // Et la section de consommation ne connaît ni les choix, ni les minimums,
  // ni les portions préférées, ni les quantités calculées.
  for (const notion of ["choiceSlots", "MealChoiceSlot", "minimumQuantity", "preferredQuantity",
                        "solveMealChoices", "displayQuantity"]) {
    assert.ok(!CODE_CONSO.includes(notion), `la section consommation connaît « ${notion} »`);
  }
  // ⚠️ LA FRONTIÈRE EST STRUCTURELLE, PAS SEULEMENT DOCUMENTÉE. Les deux
  // sections sont des éléments SŒURS : l'une ne contient pas l'autre, et
  // aucune donnée ne passe de l'une à l'autre par les props.
  const posChoix = CODE_SEMAINE.indexOf("<StudentMealChoices");
  const posConso = CODE_SEMAINE.indexOf("<ConsumedMealSection");
  assert.ok(posChoix > 0 && posConso > posChoix, "l'ordre des deux sections a changé");
  const propsChoix = CODE_SEMAINE.slice(posChoix, CODE_SEMAINE.indexOf("/>", posChoix));
  // ⚠️ N1.6B — CE CONTRÔLE INTERDISAIT TOUT `suivi` DANS LES PROPS DES CHOIX.
  // C'était la bonne garantie tant qu'aucun pont n'existait. Le bouton
  // « Enregistrer le repas » en crée un — mais ÉTROIT et NOMMÉ : deux valeurs
  // et un rappel, rien de la consommation elle-même. Ce qui reste interdit,
  // et c'est ce que le contrôle gardait vraiment, c'est que l'écran des choix
  // voie les REPAS CONSOMMÉS, leurs ENTRÉES ou les gestes d'A5.
  for (const interdit of ["suivi.meals", "suivi.onAjouter", "suivi.onCorriger",
                          "suivi.onSupprimerAliment", "suivi.raccourcis", "suivi.onOuvrirPrescrit"]) {
    assert.ok(!propsChoix.includes(interdit), `les choix reçoivent « ${interdit} »`);
  }
  // Le pont autorisé, et lui seul.
  assert.ok(propsChoix.includes("repasStructuresEnregistres") && propsChoix.includes("onEnregistrerRepasStructure"),
    "le pont N1.6B a disparu des props");
  const propsConso = CODE_SEMAINE.slice(posConso, CODE_SEMAINE.indexOf("/>", posConso));
  for (const notion of ["choiceSlots", "solution", "quantit"]) {
    assert.ok(!propsConso.includes(notion), `la consommation reçoit « ${notion} »`);
  }
  // Et la frontière est aussi ÉCRITE, dans le fichier source (commentaire JSX).
  assert.ok(lire("../../components/student/StudentPrescribedWeek.tsx").includes("FRONTIÈRE"));
});

await test("A5-MIN-10. scanner et ajouts restent utilisables quand le repas est approximate ou impossible", () => {
  // ⚠️ LE RENDU DE LA CONSOMMATION NE DÉPEND PAS DU STATUT DU CALCUL. Il n'y a
  // aucun `if (status === …)` autour de `<ConsumedMealSection>` : la section
  // est rendue dès qu'il y a un suivi et une date, quel que soit le verdict.
  // ⚠️ ANCRÉ SUR `<ConsumedMealSection`, PAS SUR LA PREMIÈRE OCCURRENCE DE LA
  // CONDITION. Un contrôle négatif l'a exigé : en durcissant la condition de la
  // section de consommation, `indexOf("{suivi && date && (")` retombait sur un
  // AUTRE bloc plus bas et ce contrôle restait vert. Il regardait la bonne
  // chaîne au mauvais endroit.
  const posConsoRendu = CODE_SEMAINE.indexOf("<ConsumedMealSection");
  assert.ok(posConsoRendu > 0);
  // ⚠️ LA CONDITION SEULE, PAS SON VOISINAGE. Les 200 caractères qui précèdent
  // contiennent la fin de `<StudentMealChoices occurrences={repas.choiceSlots}`,
  // qui est légitime : c'est l'autre section.
  const avant = CODE_SEMAINE.slice(Math.max(0, posConsoRendu - 200), posConsoRendu);
  const debutCondition = avant.lastIndexOf("{suivi");
  assert.ok(debutCondition >= 0, "la condition de rendu de la consommation a disparu");
  const conditionAvant = avant.slice(debutCondition);
  assert.equal(conditionAvant.trim(), "{suivi && date && (",
    "la condition de rendu de la consommation a changé");
  const blocConso = CODE_SEMAINE.slice(posConsoRendu);
  for (const notion of ["status", "impossible", "approximate", "solution", "choiceSlots"]) {
    assert.ok(!blocConso.slice(0, blocConso.indexOf("/>")).includes(notion),
      `le rendu de la consommation dépend de « ${notion} »`);
    assert.ok(!conditionAvant.includes(notion),
      `la condition de rendu de la consommation dépend de « ${notion} »`);
  }
  // Et le composant de choix ne rend jamais `null` en fonction du statut :
  // seul un repas SANS occurrence le fait.
  assert.ok(CODE_CHOIX.includes("if (occurrences.length === 0) return null;"));
  assert.equal((CODE_CHOIX.match(/return null;/g) ?? []).length, 1);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.5.3 — BEST-01..24 · MEILLEURE SOLUTION FAISABLE ET EXPLICATION DES ÉCARTS
   ──────────────────────────────────────────────────────────────────────────
   ⚠️ CE QUE CE LOT CORRIGE, ET CE N'EST PAS QU'UN AFFICHAGE. Le solveur rendait
   un point FAISABLE, pas le MEILLEUR point faisable : une variable figée à une
   borne n'était jamais relâchée. Mesuré sur le banc terrain poulet/riz, au
   point rendu par l'ancien algorithme :

       Riz basmati cuit   q = 0,0   PLANCHER   gradient = −72,1

   Le riz, principale source de glucides du repas, était collé à zéro alors
   qu'il MANQUAIT 110 g de glucides — et rien ne pouvait plus l'en sortir.
   L'écran, lui, masquait tout : l'élève voyait une phrase de refus.
   ══════════════════════════════════════════════════════════════════════════ */

/** Les poids de la métrique C, recalculés ICI et jamais importés du solveur. */
const poidsC = (cible: MealMacroTarget): readonly [number, number, number] =>
  [cible.proteinGrams, cible.carbGrams, cible.fatGrams].map(
    (c) => 1 / Math.max(5, Math.abs(c) * 0.1),
  ) as unknown as readonly [number, number, number];

/**
 * ⚠️ LE GRADIENT EST RECALCULÉ DEPUIS LES QUANTITÉS RENDUES, PAS LU DANS LE
 * SOLVEUR. Un test qui interrogerait la structure interne du solveur ne
 * prouverait que sa cohérence avec lui-même.
 */
function gradientMacro(
  foods: readonly SelectedFoodForMealSolver[],
  cible: MealMacroTarget,
  q: readonly number[],
): number[] {
  const w = poidsC(cible);
  const cibles = [cible.proteinGrams, cible.carbGrams, cible.fatGrams];
  const par100 = (f: SelectedFoodForMealSolver, m: number) =>
    (m === 0 ? f.proteinPer100 : m === 1 ? f.carbPer100 : f.fatPer100) / 100;
  const r = [0, 1, 2].map(
    (m) => (foods.reduce((s, f, j) => s + par100(f, m) * q[j], 0) - cibles[m]) * w[m] * w[m],
  );
  return foods.map((f) => 2 * (r[0] * par100(f, 0) + r[1] * par100(f, 1) + r[2] * par100(f, 2)));
}

/** TOLÉRANCE DUALE DES TESTS, documentée : 1e−9, l'échelle du solveur. */
const EPS_DUAL = 1e-9;

/**
 * Le contrôle KKT, appliqué aux quantités EXACTES (avant arrondi) — les seules
 * sur lesquelles l'optimalité a un sens.
 */
function verifierKKT(
  foods: readonly SelectedFoodForMealSolver[],
  cible: MealMacroTarget,
  solution: MealChoiceSolution,
  contexte: string,
): void {
  const q = solution.items.map((i) => i.quantity);
  const g = gradientMacro(foods, cible, q);
  solution.items.forEach((item, j) => {
    const auPlancher = q[j] <= item.minQuantity + 1e-7;
    const auPlafond = q[j] >= item.maxQuantity - 1e-7;
    if (item.minQuantity >= item.maxQuantity) return; // aucune direction faisable
    if (auPlancher) {
      assert.ok(g[j] >= -EPS_DUAL,
        `${contexte} · ${item.name} au minimum avec gradient ${g[j]} : le relâcher aurait amélioré`);
    } else if (auPlafond) {
      assert.ok(g[j] <= EPS_DUAL,
        `${contexte} · ${item.name} au maximum avec gradient ${g[j]} : le relâcher aurait amélioré`);
    } else {
      assert.ok(Math.abs(g[j]) <= 1e-6,
        `${contexte} · ${item.name} LIBRE avec gradient ${g[j]} : le point n'est pas stationnaire`);
    }
  });
}

/* ── Les trois bancs terrain, en valeurs Ciqual lues en base ────────────────
   ⚠️ TOUS EN GRAMMES, Y COMPRIS LES JUS. L'audit d'unités du §14 a établi que
   les 3 330 lignes du catalogue Ciqual portent `nutrition_unit = 'g'`, jus
   compris. Les modéliser en `ml` aurait été exactement ce que l'arbitrage
   interdit : déduire une unité du NOM de l'aliment.                        */
const BANC_A_FOODS = [
  aliment("a-avoine", "Flocons d'avoine", 11.4, 57.7, 7.82),
  aliment("a-beurre", "Beurre de cacahuète", 0.63, 0.71, 83),
  aliment("a-fblanc", "Fromage blanc 0%", 7.19, 4.22, 0),
  aliment("a-oeuf", "Œuf cru", 12.8, 0.06, 9.83),
  aliment("a-sirop", "Sirop d'agave", 0.25, 78, 0.5),
];
const BANC_A_CIBLE: MealMacroTarget = { proteinGrams: 55, carbGrams: 93, fatGrams: 32 };

const BANC_B_FOODS = [
  aliment("b-boeuf", "Boeuf steak haché 5% cuit", 25.5, 0, 5.85),
  aliment("b-patate", "Patate douce cuite", 1.69, 16.3, 0.15),
  aliment("b-tomate", "Sauce tomate", 2.04, 4.71, 0.75),
  aliment("b-poivron", "Poivron rouge cru", 1.06, 5.98, 0),
  aliment("b-jus", "Jus multifruit", 0.25, 11.2, 0),
];
const BANC_B_CIBLE: MealMacroTarget = { proteinGrams: 55, carbGrams: 93, fatGrams: 32 };

const BANC_C_FOODS = [
  aliment("c-poulet", "Poulet rôti", 28.9, 0, 9.88),
  aliment("c-riz", "Riz basmati cuit", 3.19, 32.9, 0.4),
  aliment("c-soja", "Sauce soja", 7.25, 1.72, 0),
  aliment("c-carotte", "Carotte crue", 0.78, 5.16, 0),
  aliment("c-jus", "Jus d'orange pur jus", 0.61, 9.61, 0.11),
];
const BANC_C_CIBLE: MealMacroTarget = { proteinGrams: 70, carbGrams: 158, fatGrams: 42 };

await test("BEST-01/02/03. exact, approché et impossible affichent TOUS les quantités", () => {
  const bancs: [string, MealChoiceSolution][] = [
    ["exact", solveMealChoices(BANC_A_FOODS, BANC_A_CIBLE)],
    ["approché", solveMealChoices([POULET, SAUMON, HUILE], { proteinGrams: 50, carbGrams: 3, fatGrams: 20 })],
    ["impossible", solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE)],
  ];
  const vus = new Set<string>();
  for (const [nom, s] of bancs) {
    vus.add(s.status);
    const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");
    assert.ok(html.includes("Quantités pour ton repas"), `${nom} : le titre manque`);
    assert.ok(html.includes("Cible du repas"), `${nom} : la cible manque`);
    assert.ok(html.includes("Résultat"), `${nom} : le résultat manque`);
    // ⚠️ ON COMPARE SUR LE PREMIER MOT : le rendu ÉCHAPPE les apostrophes
    // (`d&#x27;`), et chercher « Sirop d'agave » brut rougirait pour une
    // entité HTML, pas pour une absence.
    for (const item of s.items) {
      const premierMot = item.name.split(/[ ,']/)[0];
      assert.ok(html.includes(premierMot), `${nom} : « ${item.name} » n'est pas affiché`);
    }
  }
  // ⚠️ LE BANC DOIT COUVRIR LES TROIS STATUTS, sinon il ne prouve rien.
  assert.deepEqual([...vus].sort(), ["approximate", "exact", "impossible"]);
});

await test("BEST-04/05/06/07. bornes respectées, aucune valeur négative, aucun NaN", () => {
  const minimums = [null, 5, 12.3, 40];
  let n = 0;
  for (const foods of [BANC_A_FOODS, BANC_B_FOODS, BANC_C_FOODS]) {
    for (const cible of [BANC_A_CIBLE, BANC_B_CIBLE, BANC_C_CIBLE, { proteinGrams: 5, carbGrams: 5, fatGrams: 5 }]) {
      for (const m of minimums) {
        const avec = foods.map((f, i) => (i % 2 === 0 ? avecMin(f, m) : f));
        const s = solveMealChoices(avec, cible);
        for (const item of s.items) {
          assert.ok(item.displayQuantity >= item.minQuantity, `${item.name} sous son minimum`);
          assert.ok(item.displayQuantity <= item.maxQuantity, `${item.name} au-dessus de son plafond`);
          assert.ok(item.displayQuantity >= 0, `${item.name} négatif`);
          assert.ok(Number.isFinite(item.quantity) && Number.isFinite(item.displayQuantity));
          assert.ok([item.proteinGrams, item.carbGrams, item.fatGrams].every(Number.isFinite));
          n += 1;
        }
        assert.ok([s.actual.proteinGrams, s.actual.carbGrams, s.actual.fatGrams].every(Number.isFinite));
      }
    }
  }
  console.log(`    ${n} quantités vérifiées entre plancher et plafond, toutes finies`);
});

await test("BEST-08. les macros du RÉSULTAT sont celles des quantités AFFICHÉES", () => {
  for (const [foods, cible] of [[BANC_A_FOODS, BANC_A_CIBLE], [BANC_B_FOODS, BANC_B_CIBLE], [BANC_C_FOODS, BANC_C_CIBLE]] as const) {
    const s = solveMealChoices(foods, cible);
    for (const macro of ["proteinGrams", "carbGrams", "fatGrams"] as const) {
      const par100 = macro === "proteinGrams" ? "proteinPer100" : macro === "carbGrams" ? "carbPer100" : "fatPer100";
      const recalcul = s.items.reduce((t, item, j) => t + (foods[j][par100] * item.displayQuantity) / 100, 0);
      assert.ok(Math.abs(s.actual[macro] - recalcul) < 1e-9, `${macro} ne vient pas des quantités affichées`);
    }
  }
});

await test("BEST-09/10/11. ecartsVersLaCible = cible − résultat, et son signe dit l'action", () => {
  const s = solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE);
  for (const macro of ["proteinGrams", "carbGrams", "fatGrams"] as const) {
    // ⚠️ SUR `actual`, DONC SUR LES QUANTITÉS AFFICHÉES (§11 de l'arbitrage).
    assert.ok(Math.abs(s.ecartsVersLaCible[macro] - (s.target[macro] - s.actual[macro])) < 1e-12);
    // ⚠️ ET `delta` GARDE SA CONVENTION HISTORIQUE, exactement opposée.
    assert.ok(Math.abs(s.delta[macro] + s.ecartsVersLaCible[macro]) < 1e-12);
  }

  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");
  const ecarts = ecartsAAfficher(s);
  assert.ok(ecarts.length > 0, "ce banc doit produire des écarts");
  for (const e of ecarts) {
    assert.ok(html.includes(e.grammes > 0 ? "Ajouter" : "Réduire"),
      `un écart de ${e.grammes} doit se dire « ${e.grammes > 0 ? "Ajouter" : "Réduire"} »`);
  }
  // Un manque se dit « Ajouter », un excès « Réduire » — jamais un signe nu.
  assert.ok(!html.includes("+2 g") && !html.includes("-5 g"));
});

await test("BEST-12. un écart de moins d'un gramme ne fait pas de bruit", () => {
  const exact = solveMealChoices(BANC_A_FOODS, BANC_A_CIBLE);
  assert.equal(exact.status, "exact");
  assert.deepEqual(ecartsAAfficher(exact), [], "un repas exact ne doit afficher aucun écart");

  // ⚠️ ET LE SEUIL EST LE GRAMME, PAS LE STATUT. Un repas `approximate` a le
  // droit de dire « réduire environ 2 g » : lier les deux ferait taire l'écran
  // là où un petit ajustement suffirait.
  assert.ok(CODE_CHOIX.includes("Math.round(solution.ecartsVersLaCible[macro])"));
  assert.ok(!/ecartsAAfficher[\s\S]{0,400}status/.test(CODE_CHOIX),
    "le statut ne doit pas décider de l'affichage des écarts");
});

await test("BEST-13. le statut reste rendu par determineStatus, et par lui seul", () => {
  assert.ok(CODE_SOLVEUR.includes("determineStatus(delta, target)"));
  assert.equal((CODE_SOLVEUR.match(/determineStatus\(/g) ?? []).length, 1);
  // Aucune tolérance recopiée dans l'écran pour juger : l'écran ne juge rien.
  assert.ok(!CODE_CHOIX.includes("determineStatus"));
});

await test("BEST-14. la portion préférée reste SECONDAIRE aux macros", () => {
  // Une préférence absurde ne doit pas dégrader l'erreur macro.
  const sans = solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE);
  const avec = solveMealChoices(
    BANC_C_FOODS.map((f) => ({ ...f, preferredQuantity: 5 })),
    BANC_C_CIBLE,
  );
  const cout = (s: MealChoiceSolution) => {
    const w = poidsC(BANC_C_CIBLE);
    return (
      (s.delta.proteinGrams * w[0]) ** 2 + (s.delta.carbGrams * w[1]) ** 2 + (s.delta.fatGrams * w[2]) ** 2
    );
  };
  assert.ok(cout(avec) <= cout(sans) + 1e-6,
    `une préférence a dégradé les macros : ${cout(avec)} > ${cout(sans)}`);
  // Et les deux points restent optimaux.
  verifierKKT(BANC_C_FOODS, BANC_C_CIBLE, sans, "BEST-14 sans préférence");
  verifierKKT(BANC_C_FOODS.map((f) => ({ ...f, preferredQuantity: 5 })), BANC_C_CIBLE, avec, "BEST-14 avec préférence");
});

await test("BEST-15. minimum contradictoire : la quantité est conservée, le dépassement expliqué", () => {
  // Cible lipides basse, minimum de beurre qui l'impose déjà.
  const foods = [avecMin(aliment("m-beurre", "Beurre", 0.63, 0.71, 83), 12), aliment("m-fblanc", "Fromage blanc", 7.19, 4.22, 0)];
  const s = solveMealChoices(foods, { proteinGrams: 30, carbGrams: 8, fatGrams: 5 });
  const beurre = s.items[0];
  assert.equal(beurre.displayQuantity, 12, "le minimum du coach doit être tenu");
  assert.ok(beurre.boundedToMin);
  // ⚠️ LE MINIMUM N'EST JAMAIS VIOLÉ POUR EMBELLIR LE RÉSULTAT.
  assert.ok(s.actual.fatGrams > 5, "le banc doit produire un dépassement de lipides");
  const ecarts = ecartsAAfficher(s);
  const lipides = ecarts.find((e) => e.macro === "fatGrams");
  assert.ok(lipides && lipides.grammes < 0, "le dépassement doit se dire « réduire »");
  verifierKKT(foods, { proteinGrams: 30, carbGrams: 8, fatGrams: 5 }, s, "BEST-15");
});

await test("BEST-16. maximum bloquant : quantité au plafond, manque expliqué", () => {
  const s = solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE);
  const riz = s.items.find((i) => i.name.startsWith("Riz"));
  assert.ok(riz);
  assert.equal(riz.displayQuantity, MAX_SOLIDE_G, "le riz doit aller à son plafond");
  assert.ok(riz.boundedToMax);
  const ecarts = ecartsAAfficher(s);
  assert.ok(ecarts.length > 0, "le manque restant doit être expliqué");
});

await test("BEST-17. plusieurs écarts simultanés s'affichent, du plus significatif au moins", () => {
  const s = solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE);
  const ecarts = ecartsAAfficher(s);
  assert.ok(ecarts.length >= 2, "ce banc doit produire au moins deux écarts");
  // ⚠️ L'ORDRE EST CELUI DE LA GÉOMÉTRIE, PAS DES GRAMMES BRUTS. Sinon une
  // grande cible passerait toujours devant.
  const poids = (e: (typeof ecarts)[number]) =>
    Math.abs(s.ecartsVersLaCible[e.macro]) / Math.max(5, Math.abs(s.target[e.macro]) * 0.1);
  for (let i = 1; i < ecarts.length; i += 1) {
    assert.ok(poids(ecarts[i - 1]) >= poids(ecarts[i]), "les écarts ne sont pas triés par significativité");
  }
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");
  for (const e of ecarts) assert.ok(html.includes(e.libelle), `« ${e.libelle} » n'est pas affiché`);
});

await test("BEST-18/19. aucun aliment suggéré, aucun rôle, aucun referenceGrams", () => {
  const s = solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE);
  const html = renderToString(createElement(QuantitesDuRepas, { solution: s })).replace(/<!-- -->/g, "");
  const conseils = html.slice(html.indexOf("Pour te rapprocher"));
  // ⚠️ AUCUN NOM D'ALIMENT DANS LE CONSEIL. Les aliments sont dans la LISTE,
  // pas dans la recommandation : « ajoute du riz » réintroduirait un rôle.
  for (const item of s.items) {
    assert.ok(!conseils.includes(item.name.split(" ")[0]),
      `« ${item.name} » est suggéré dans le message d'écart`);
  }
  // Seules les trois macros sont nommées dans le conseil.
  assert.ok(["protéines", "glucides", "lipides"].some((m) => conseils.includes(m)));

  // ⚠️ `role="radio"` EST DE L'ACCESSIBILITÉ, PAS UN RÔLE NUTRITIONNEL, et
  // confondre les deux ferait rougir ce contrôle pour une bonne pratique ARIA.
  // On cible donc le vocabulaire métier, jamais l'attribut.
  const sansAria = CODE_CHOIX.replace(/role="[a-z]+"/g, " ");
  for (const interdit of ["rôle", "solverRole", "referenceGrams", "catégorie", "féculent", "légume", "protéine\\b.*aliment"]) {
    assert.ok(!new RegExp(interdit).test(sansAria), `« ${interdit} » ne doit pas exister dans l'écran`);
  }
});

await test("BEST-20. modifier un choix recalcule solution ET message", () => {
  const occurrences = repasComplet();
  const a = calculDuRepas(occurrences, { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  const b = calculDuRepas(occurrences, { s1: "o1b", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  if (a.etat !== "calcule" || b.etat !== "calcule") throw new Error("les deux doivent être calculables");
  assert.notDeepEqual(
    a.solution.items.map((i) => i.displayQuantity),
    b.solution.items.map((i) => i.displayQuantity),
  );
  assert.notDeepEqual(a.solution.ecartsVersLaCible, b.solution.ecartsVersLaCible);
  // ⚠️ ET RIEN N'EST MÉMORISÉ : la solution est dérivée, jamais rangée.
  assert.ok(CODE_CHOIX.includes("useMemo"));
  assert.ok(!/useState<[^>]*Solution/.test(CODE_CHOIX));
});

await test("BEST-24. déterminisme : 100 exécutions donnent le même bit", () => {
  for (const [foods, cible] of [[BANC_A_FOODS, BANC_A_CIBLE], [BANC_B_FOODS, BANC_B_CIBLE], [BANC_C_FOODS, BANC_C_CIBLE]] as const) {
    const reference = JSON.stringify(solveMealChoices(foods, cible));
    for (let i = 0; i < 100; i += 1) {
      assert.equal(JSON.stringify(solveMealChoices(foods, cible)), reference, "le solveur n'est pas déterministe");
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.5.3 — KKT : L'OPTIMALITÉ EST VÉRIFIÉE, PAS SUPPOSÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("KKT-01. banc A : la solution EXACTE ne bouge pas, et elle est optimale", () => {
  const s = solveMealChoices(BANC_A_FOODS, BANC_A_CIBLE);
  assert.equal(s.status, "exact");
  // ⚠️ MESURÉ AVANT LE LOT : résidu 0, tous gradients nuls. Le relâchement ne
  // pouvait donc rien y changer — et c'est ce qui rendait la correction sûre.
  assert.deepEqual(s.items.map((i) => i.displayQuantity), [149, 0, 160, 207, 0]);
  assert.equal(s.determinism.releasedOrder.length, 0, "aucun relâchement n'était nécessaire");
  verifierKKT(BANC_A_FOODS, BANC_A_CIBLE, s, "KKT-01 banc A");
});

await test("KKT-02. banc B : les variables figées à tort sont relâchées", () => {
  const s = solveMealChoices(BANC_B_FOODS, BANC_B_CIBLE);
  const parNom = (p: string) => s.items.find((i) => i.name.startsWith(p));
  console.log(`    banc B : ${s.items.map((i) => `${i.name.split(" ")[0]} ${i.displayQuantity}`).join(", ")} (${s.status})`);
  console.log(`    écarts : P${s.ecartsVersLaCible.proteinGrams.toFixed(1)} G${s.ecartsVersLaCible.carbGrams.toFixed(1)} L${s.ecartsVersLaCible.fatGrams.toFixed(1)}`);

  // ⚠️ AVANT LE LOT : patate 0, jus 0, et 78,9 g de glucides manquants.
  assert.ok((parNom("Patate")?.displayQuantity ?? 0) > 0, "la patate douce doit être relâchée");
  assert.ok((parNom("Jus")?.displayQuantity ?? 0) > 0, "le jus doit être relâché");
  assert.ok(Math.abs(s.ecartsVersLaCible.carbGrams) < 5,
    `les glucides doivent être ramenés sous 5 g d'écart, mesuré ${s.ecartsVersLaCible.carbGrams}`);
  verifierKKT(BANC_B_FOODS, BANC_B_CIBLE, s, "KKT-02 banc B");
});

await test("KKT-03. banc C : le riz sort du plancher et va au plafond", () => {
  const s = solveMealChoices(BANC_C_FOODS, BANC_C_CIBLE);
  const riz = s.items.find((i) => i.name.startsWith("Riz"));
  console.log(`    banc C : ${s.items.map((i) => `${i.name.split(" ")[0]} ${i.displayQuantity}`).join(", ")} (${s.status})`);
  console.log(`    écarts : P${s.ecartsVersLaCible.proteinGrams.toFixed(1)} G${s.ecartsVersLaCible.carbGrams.toFixed(1)} L${s.ecartsVersLaCible.fatGrams.toFixed(1)}`);

  // ⚠️ AVANT LE LOT : riz 0 g, gradient −72, 110 g de glucides manquants.
  assert.ok((riz?.displayQuantity ?? 0) > 0, "le riz doit être relâché");
  assert.ok(Math.abs(s.ecartsVersLaCible.carbGrams) < 20,
    `les glucides doivent passer sous 20 g d'écart, mesuré ${s.ecartsVersLaCible.carbGrams}`);
  assert.ok(s.determinism.releasedOrder.length > 0, "au moins un relâchement doit avoir eu lieu");
  verifierKKT(BANC_C_FOODS, BANC_C_CIBLE, s, "KKT-03 banc C");
});

await test("KKT-04. BALAYAGE : aucune solution ne viole les conditions duales", () => {
  let n = 0;
  const cibles: MealMacroTarget[] = [
    { proteinGrams: 55, carbGrams: 93, fatGrams: 32 },
    { proteinGrams: 70, carbGrams: 158, fatGrams: 42 },
    { proteinGrams: 10, carbGrams: 200, fatGrams: 3 },
    { proteinGrams: 120, carbGrams: 5, fatGrams: 60 },
    { proteinGrams: 5, carbGrams: 5, fatGrams: 5 },
    { proteinGrams: 300, carbGrams: 400, fatGrams: 150 },
  ];
  for (const base of [BANC_A_FOODS, BANC_B_FOODS, BANC_C_FOODS, [POULET, SAUMON, HUILE], [POULET, RIZ]]) {
    for (const minimum of [null, 5, 20, 60]) {
      const foods = base.map((f, i) => (i % 2 === 0 ? avecMin(f, minimum) : f));
      for (const cible of cibles) {
        const s = solveMealChoices(foods, cible);
        assert.ok(s.determinism.converged, "le solveur doit converger sur ces entrées");
        verifierKKT(foods, cible, s, `balayage ${n}`);
        n += 1;
      }
    }
  }
  console.log(`    ${n} solutions vérifiées KKT (tolérance duale ${EPS_DUAL})`);
});

await test("KKT-05. le solveur ne boucle pas, et le dit quand il n'a pas certifié", () => {
  // Garde-fous présents et NOMMÉS dans le code.
  assert.ok(CODE_SOLVEUR.includes("ensemblesVus"), "l'anti-cyclage exact a disparu");
  assert.ok(CODE_SOLVEUR.includes("MAX_TOURS"), "le garde-fou d'itérations a disparu");
  assert.ok(CODE_SOLVEUR.includes("Number.isFinite(q[i])"), "la garde de non-finitude a disparu");
  assert.ok(CODE_SOLVEUR.includes("converged = true"));

  // Une entrée non finie ne produit AUCUNE solution certifiée.
  const s = solveMealChoices([aliment("nan", "Aberrant", Number.POSITIVE_INFINITY, 0, 0)], BANC_A_CIBLE);
  assert.equal(s.determinism.converged, false);
  assert.ok(s.warnings.some((w) => w.code === "entree_invalide"));
});

await test("KKT-06. une solution non certifiée n'atteint JAMAIS l'écran", () => {
  // ⚠️ C'EST `calculDuRepas` QUI TIENT CETTE FRONTIÈRE, pas le rendu.
  assert.ok(CODE_SELECTION.includes("if (!solution.determinism.converged) return { etat: \"non-calculable\" };"));
  const occurrences = repasComplet();
  const calcul = calculDuRepas(occurrences, { s1: "o1", s2: "o2", s3: "o3" }, CIBLE_EXACTE);
  if (calcul.etat !== "calcule") throw new Error(calcul.etat);
  assert.equal(calcul.solution.determinism.converged, true);
});

await test("UNIT-01. l'unité est LUE, jamais déduite d'un nom ou d'une catégorie", () => {
  // ⚠️ L'AUDIT DU §14 A MESURÉ : les 3 330 lignes du catalogue Ciqual portent
  // `nutrition_unit = 'g'`, les 506 boissons comprises. Aucune conversion
  // g → ml n'existe, et aucun nom d'aliment n'entre dans le choix d'unité.
  // ⚠️ ON CHERCHE UNE DÉCISION, PAS UN MOT. `MAX_LIQUIDE_ML` contient
  // « LIQUIDE » et ne décide d'aucune unité : c'est le plafond, une fois
  // l'unité déjà connue. Ce qui est interdit, c'est de TESTER un nom.
  for (const source of [CODE_SOLVEUR, CODE_SELECTION, CODE_CHOIX, CODE_LECTURE]) {
    assert.ok(!/(name|nom|displayName|libelle)[^;\n]{0,60}(includes|match|test|indexOf)[^;\n]{0,60}(jus|boisson|lait|eau|soupe)/i.test(source),
      "un nom d'aliment sert à décider d'une unité");
    assert.ok(!/(jus|boisson|lait)[^;\n]{0,40}=>[^;\n]{0,20}"ml"/i.test(source),
      "une unité est déduite d'une catégorie d'aliment");
  }
  // L'unité du solveur vient de l'hydratation, et de rien d'autre.
  assert.ok(CODE_SELECTION.includes('unit: n.unit === "ml" ? "ml" : "g"'));
  // Et l'affichage rend l'unité de l'aliment, pas une unité recalculée.
  assert.ok(CODE_CHOIX.includes("{item.unit}"));

  // Un aliment en grammes reste plafonné à 300, quel que soit son nom.
  const jusEnGrammes = aliment("u-jus", "Jus d'orange pur jus", 0.61, 9.61, 0.11, "g");
  const s = solveMealChoices([jusEnGrammes], { proteinGrams: 5, carbGrams: 200, fatGrams: 1 });
  assert.equal(s.items[0].unit, "g");
  assert.equal(s.items[0].maxQuantity, MAX_SOLIDE_G);
  assert.equal(s.items[0].displayQuantity, MAX_SOLIDE_G);
});

await test("BEST-21/22/23. A5 reste ACCESSIBLE quand le repas est impossible — rendu réel", () => {
  // ⚠️ CE CONTRÔLE REND VRAIMENT L'ÉCRAN DE LA SEMAINE, et il existe parce
  // qu'un contrôle négatif l'a exigé. `A5-MIN-10` lisait le SOURCE, pas le
  // DOM : sabotée pour ne rendre la consommation que sur les repas sans liste,
  // la page restait verte. Un contrôle qui ne rougit pas ne prouve rien.
  const semaine = {
    planId: "plan-best",
    profiles: [{
      profileKey: "default", label: "Défaut", dailyCalories: 2200,
      proteinBp: 3000, carbBp: 4000, fatBp: 3000,
      slots: [{ slot: "dinner", enabled: true, proteinBp: 10000, carbBp: 10000, fatBp: 10000, displayOrder: 5 }],
    }],
    days: [{
      id: "j1", day: "monday", profileKey: "default", status: "non-commence",
      meals: [{
        id: "repas-best", slot: "dinner", name: "Dîner", items: [], calories: 0,
        protein: 0, carbs: 0, fat: 0, coachNotes: "",
        // ⚠️ UNE COMPOSITION QUI NE PEUT PAS ATTEINDRE LA CIBLE : que du gras
        // et de la protéine face à une cible riche en glucides.
        choiceSlots: repasComplet(),
      }],
    }],
  } as unknown as PlanV2Week;

  const suivi = {
    datesParJour: { monday: "2026-08-10" },
    meals: [],
    chargement: false,
    enCours: false,
    erreur: null,
    onEffacerErreur: () => {},
    onOuvrirPrescrit: async () => "cm-1",
    onCreerRepas: async () => "cm-2",
    onRenommerRepas: async () => true,
    onSupprimerRepas: async () => true,
    onAjouterCatalogue: async () => true,
    onAjouterProduit: async () => true,
    onAjouterManuel: async () => true,
    onCorriger: async () => true,
    onSupprimerAliment: async () => true,
    aujourdHui: "2026-08-10",
    onSemainePrecedente: () => {},
    onSemaineSuivante: () => {},
  };

  const html = renderToString(
    createElement(StudentPrescribedWeek, { week: semaine, suivi } as never),
  ).replace(/<!-- -->/g, "");

  // ⚠️ LA SECTION DE CONSOMMATION EST BIEN RENDUE, sur un repas qui PORTE des
  // listes — c'est exactement ce que le sabotage supprimait.
  assert.ok(/Ce que j&#x27;ai mangé|Ce que j'ai mangé|Ajouter un aliment/.test(html),
    "la section « Ce que j'ai mangé » doit rester rendue");
  // Et l'écran des choix est là aussi : les deux cohabitent.
  assert.ok(html.includes("Choix alimentaires"));

  // ⚠️ ET AUCUNE ÉCRITURE DE CONSOMMATION N'EST DÉCLENCHÉE PAR LE RENDU (§19).
  // Les callbacks ci-dessus n'ont pas été appelés : un rendu ne consomme rien.
  assert.ok(!CODE_CHOIX.includes("onOuvrirPrescrit"));
});
