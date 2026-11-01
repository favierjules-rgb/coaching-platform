/*
 * ════════════════════════════════════════════════════════════════════════════
 * LA DÉMONSTRATION, RENDUE POUR DE VRAI
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI CE HARNAIS EXISTE. Tous les autres contrôles du guide lisent le
 * CODE : ils savent dire qu'une ancre est écrite quelque part, pas qu'elle est
 * RENDUE dans l'état où l'étape la cherche. Or c'est exactement là qu'était le
 * défaut : la visite annonçait vingt-trois étapes et s'arrêtait à la dixième,
 * parce que les treize suivantes visaient l'intérieur d'une feuille que rien
 * n'ouvrait. Un test qui cherche « nutrition-ajout-quantite » dans un fichier
 * aurait été vert tout du long.
 *
 * Ici, on monte le VRAI composant — `GuideDemonstration`, qui monte lui-même
 * le vrai `AddFoodSheet` — scénario par scénario, et on lit le HTML produit.
 *
 * ⚠️ AUCUN RÉSEAU N'EST POSSIBLE PENDANT CE RENDU. `renderToString` n'exécute
 * aucun effet : la recherche à la frappe, l'hydratation des fiches produit et
 * le scan ne partent jamais. Et la feuille de démonstration ne reçoit de toute
 * façon aucune fonction d'écriture.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { FeuilleDemonstration } from "../../components/guide/GuideDemonstration";
import { ESPACES_GUIDES } from "../../lib/guide-categories";
import {
  DEMONSTRATION_ETEINTE,
  SCENARIOS_DEMONSTRATION,
  lireDemonstration,
  type CleDemonstration,
} from "../../lib/guide-demonstration";

/*
 * ⚠️ ON REND `FeuilleDemonstration`, PAS `GuideDemonstration`. Le second lit le
 * magasin par `useSyncExternalStore`, qui rend l'instantané SERVEUR pendant
 * `renderToString` — « éteinte », toujours. Le monter ici donnerait une chaîne
 * vide pour chaque scénario, et ce harnais serait vert sans rien prouver.
 */
function rendre(scenario: CleDemonstration): string {
  return renderToString(
    createElement(FeuilleDemonstration, { etat: SCENARIOS_DEMONSTRATION[scenario] }),
  );
}

/**
 * Le code sans les commentaires.
 *
 * ⚠️ INDISPENSABLE AVANT TOUTE ASSERTION « CE MOT N'APPARAÎT PAS ». Les
 * fichiers de ce dépôt expliquent longuement ce qu'ils NE font pas : chercher
 * ces mots dans la source brute fait échouer le test sur la phrase qui dit
 * précisément la bonne chose, et pousse à supprimer la documentation pour
 * faire passer le test.
 */
const RACINE = new URL("../../", import.meta.url).pathname;

function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function ancres(html: string): Set<string> {
  const trouvees = new Set<string>();
  for (const m of html.matchAll(/data-guide="([^"]+)"/g)) trouvees.add(m[1]!);
  return trouvees;
}

await test("R1. hors visite guidée, la démonstration ne rend RIEN", () => {
  assert.deepEqual(lireDemonstration(), DEMONSTRATION_ETEINTE,
    "le magasin est éteint tant qu'aucune visite ne l'a allumé");
  assert.equal(
    renderToString(createElement(FeuilleDemonstration, { etat: DEMONSTRATION_ETEINTE })),
    "",
    "une feuille d'exemple qui s'afficherait sur une page réelle serait le pire défaut possible",
  );
  assert.equal(rendre("aucun"), "", "et le scénario « aucun » ne rend rien non plus");
});

await test("R2. chaque scénario rend les ancres que ses étapes visent", () => {
  /*
   * LE CONTRÔLE CENTRAL. Pour chaque étape de la visite nutrition qui déclare
   * un scénario, on rend ce scénario et on vérifie que SA cible est bien dans
   * le HTML. Une étape mal rattachée tombe ici, pas chez l'utilisateur.
   */
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);

  const parScenario = new Map<CleDemonstration, string[]>();
  for (const etape of nutrition.etapes) {
    if (!etape.demo) continue;
    const liste = parScenario.get(etape.demo) ?? [];
    liste.push(etape.cible);
    parScenario.set(etape.demo, liste);
  }
  assert.ok(parScenario.size >= 4, "la visite s'appuie sur plusieurs scénarios");

  const manquantes: string[] = [];
  for (const [scenario, cibles] of parScenario) {
    const rendues = ancres(rendre(scenario));
    for (const cible of cibles) {
      if (!rendues.has(cible)) manquantes.push(`${scenario} → ${cible}`);
    }
  }
  assert.deepEqual(manquantes, [],
    "ces cibles ne sont PAS rendues par le scénario que leur étape déclare : la visite s'y arrêterait");
});

await test("R3. la feuille vide montre les quatre entrées de l'ajout", () => {
  const rendues = ancres(rendre("feuille-vide"));
  for (const attendue of [
    "nutrition-ajout-modes",
    "nutrition-ajout-recherche",
    "nutrition-ajout-resultats",
    "nutrition-ajout-scanner",
    "nutrition-ajout-manuel",
    "nutrition-liste-favoris",
    "nutrition-liste-recents",
  ]) {
    assert.ok(rendues.has(attendue), `${attendue} doit être rendue champ vide`);
  }
});

await test("R4. l'étape quantité et sa confirmation EXISTENT, sans aliment réel", () => {
  /*
   * ⚠️ CE QUI ÉTAIT IMPOSSIBLE AVANT. Ces deux cibles n'apparaissent qu'une
   * fois un aliment choisi. Les atteindre demandait auparavant que l'élève
   * sélectionne un vrai aliment pendant la visite — donc qu'il ouvre un repas
   * réel, lequel se crée en base. Avec la fixture, elles sont là, et rien
   * n'a été touché.
   */
  const html = rendre("quantite");
  const rendues = ancres(html);
  assert.ok(rendues.has("nutrition-ajout-quantite"), "le champ de quantité est rendu");
  assert.ok(rendues.has("nutrition-ajout-confirmer"), "le bouton de confirmation aussi");
  assert.ok(html.includes("Banane"), "et l'aliment d'exemple est nommé");
  assert.ok(!rendues.has("nutrition-ajout-resultats"),
    "la liste de résultats cède la place au formulaire de quantité — comme dans l'application");
});

await test("R5. la saisie manuelle montre ses champs et son enregistrement", () => {
  const rendues = ancres(rendre("saisie-manuelle"));
  assert.ok(rendues.has("nutrition-manuel-champs"));
  assert.ok(rendues.has("nutrition-manuel-enregistrer"));
});

await test("R6. le scanner est montré SANS caméra", () => {
  const html = rendre("scanner");
  const rendues = ancres(html);
  for (const attendue of ["nutrition-scan-intro", "nutrition-scan-camera", "nutrition-scan-cadre"]) {
    assert.ok(rendues.has(attendue), `${attendue} doit être rendue`);
  }
  assert.ok(html.includes("la caméra n&#x27;est pas allumée") || html.includes("caméra n'est pas allumée"),
    "l'écran annonce lui-même qu'il s'agit d'un aperçu");
});

await test("R7. les résultats affichés sont les fixtures, et elles se reconnaissent", () => {
  const html = rendre("recherche-resultats");
  assert.ok(html.includes("Banane, pulpe, crue"), "l'aliment de fixture est affiché");
  assert.ok(html.includes("banane"), "le terme de recherche est pré-saisi");
  assert.ok(!html.includes("undefined"), "aucun trou dans le rendu");
});

await test("R8. aucun identifiant de fixture ne ressemble à une donnée réelle", () => {
  /*
   * Si l'un d'eux arrivait par accident dans une requête, il faut qu'il se voie
   * au premier coup d'œil dans n'importe quel journal.
   */
  for (const scenario of ["feuille-vide", "recherche-resultats", "quantite"] as const) {
    const html = rendre(scenario);
    for (const m of html.matchAll(/demo-[a-z-]+/g)) {
      assert.ok(m[0]!.startsWith("demo-"), `${m[0]} doit porter le préfixe de démonstration`);
    }
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(html),
      "aucun identifiant qui ressemblerait à un UUID réel");
  }
});

/* ═══════ S. LES RECETTES : LA VISITE PILOTE RÉELLEMENT LA PAGE ═══════ */

import { StudentAdaptiveRecipes } from "../../components/student/StudentAdaptiveRecipes";
import { recipesForSlot } from "../../lib/nutrition/plan-v2-week";
import { describeRecipeFit } from "../../lib/nutrition/recipe-matching";
import { solveRecipe } from "../../lib/nutrition/recipe-solver";
import { RECETTES_DEMONSTRATION } from "../../lib/guide-demonstration";
import type { PlanV2Week } from "../../lib/nutrition/plan-v2-week";

/**
 * Une semaine minimale mais COMPLÈTE : un profil avec ses objectifs, un jour
 * qui s'y rattache, un repas prescrit. C'est tout ce que la page des recettes
 * lit — elle ne consulte ni la base, ni le journal.
 */
const SEMAINE: PlanV2Week = {
  planId: "plan-test",
  profiles: [
    {
      profileKey: "standard",
      dailyCalories: 2200,
      // Points de base : 30 % protéines, 40 % glucides, 30 % lipides.
      proteinBp: 3000,
      carbBp: 4000,
      fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 2500, carbBp: 3000, fatBp: 2500, displayOrder: 1 },
        { slot: "lunch", enabled: true, proteinBp: 4000, carbBp: 4000, fatBp: 4000, displayOrder: 2 },
        { slot: "dinner", enabled: true, proteinBp: 3500, carbBp: 3000, fatBp: 3500, displayOrder: 3 },
      ],
    },
  ],
  days: [
    {
      id: "jour-lundi",
      day: "monday",
      profileKey: "standard",
      status: "ready",
      meals: [],
    },
  ],
};

await test("S1. la page des recettes porte les trois commandes que la visite presse", () => {
  /*
   * ⚠️ C'EST LA CAUSE EXACTE DU DÉFAUT CORRIGÉ. Afficher une recette demande
   * trois gestes successifs — jour, créneau, recette — et la page n'en fait
   * aucun toute seule : seul le jour est présélectionné. La visite expliquait
   * donc des ingrédients que rien n'avait fait apparaître. Elle presse
   * maintenant ces commandes ; encore faut-il qu'elles portent leur ancre.
   */
  const html = renderToString(
    createElement(StudentAdaptiveRecipes, { week: SEMAINE, recipes: [] }),
  );
  assert.ok(html.includes('data-guide="recettes-jour-premier"'), "le premier jour est pressable");
  assert.ok(html.includes('data-guide="recettes-jour"'), "et la zone du jour reste ancrée");
  assert.ok(html.includes('data-guide="recettes-creneau"'), "la zone du créneau est ancrée");
});

await test("S2. la recette d'exemple ne s'affiche QUE si le coach n'en a aucune", () => {
  /*
   * ⚠️ LA CONDITION LA PLUS IMPORTANTE DE CE LOT. Afficher un exemple à un
   * élève qui a de vraies recettes lui ferait croire que son coach lui a
   * prescrit du poulet au riz. La substitution exige donc DEUX conditions.
   */
  const composant = sansProse(
    readFileSync(`${RACINE}components/student/StudentAdaptiveRecipes.tsx`, "utf8"),
  );
  /* La règle est sortie du composant : elle se vérifie désormais sur la
     fonction pure, qui porte la garantie, ET sur son usage. */
  assert.match(composant, /recettesAAfficher\(demo\.recettes, recipes\)/,
    "le composant délègue la décision, il ne la réécrit pas");
  assert.match(composant, /cibleAAfficher\(exemple, créneauChoisi, cibleReelle\)/,
    "et la cible fictive est conditionnée à la substitution de la recette");
  const regle = sansProse(readFileSync(`${RACINE}lib/guide-demonstration.ts`, "utf8"));
  assert.match(regle, /demonstrationActive && recettesReelles\.length === 0/,
    "la visite le demande ET la bibliothèque est vide");
  assert.match(regle, /exemple \? RECETTES_DEMONSTRATION : recettesReelles/,
    "sinon ce sont les vraies recettes qui sont affichées, sans exception");
  assert.doesNotMatch(composant, /from "@\/lib\/supabase/,
    "la page des recettes n'écrit toujours rien : la substitution ne change que l'affichage");
});

await test("S3. la recette d'exemple se résout vraiment, avec des quantités plausibles", () => {
  /*
   * ⚠️ UNE FIXTURE QUI NE SE RÉSOUT PAS N'APPREND RIEN. La page ne montre des
   * ingrédients et des quantités que si le solveur rend une solution. On la
   * calcule donc ici avec le MÊME solveur que la page, sur une cible de
   * créneau réaliste.
   */
  const proposees = recipesForSlot(RECETTES_DEMONSTRATION, "lunch");
  assert.equal(proposees.length, 1, "la recette d'exemple convient à tous les créneaux");

  const solution = solveRecipe(proposees[0]!.recipe, {
    target: { proteinGrams: 45, carbGrams: 75, fatGrams: 20 },
  });
  assert.ok(solution.ingredients.length >= 3, "elle a des ingrédients");
  const dosables = solution.ingredients.filter(
    (i) => i.role === "protein" || i.role === "carbohydrate" || i.role === "fat",
  );
  assert.equal(dosables.length, 3, "les trois rôles ajustables sont présents");
  for (const ingredient of dosables) {
    assert.ok(ingredient.displayGrams > 0, `${ingredient.name} a une quantité`);
    assert.ok(Number.isFinite(ingredient.calories) && ingredient.calories >= 0,
      `${ingredient.name} a des apports calculables`);
  }
  for (const ingredient of solution.ingredients) {
    assert.ok(Number.isFinite(ingredient.displayGrams) && ingredient.displayGrams >= 0,
      `${ingredient.name} a une quantité lisible`);
  }
  const verdict = describeRecipeFit(solution);
  assert.ok(verdict.summary.length > 0, "et un verdict lisible");
  assert.notEqual(verdict.status, "impossible",
    "une recette d'exemple qui ne peut pas atteindre une cible courante montrerait l'échec, pas le fonctionnement");
});

await test("S4. l'exemple se présente comme tel, toujours", () => {
  const html = renderToString(
    createElement(StudentAdaptiveRecipes, { week: SEMAINE, recipes: [] }),
  );
  // Hors visite guidée, aucun bandeau : le magasin est éteint.
  assert.ok(!html.includes("recettes-exemple"),
    "aucun exemple ne s'affiche quand la visite n'est pas lancée");

  const source = readFileSync(`${RACINE}components/student/StudentAdaptiveRecipes.tsx`, "utf8");
  assert.match(source, /Exemple de démonstration/,
    "quand il s'affiche, le bandeau le dit sans ambiguïté");
  assert.match(source, /n&apos;est pas une\s*\n?\s*prescription/,
    "et écarte explicitement l'idée d'une prescription");
});

await test("S5. aucune donnée d'exemple ne peut être enregistrée", () => {
  const fixtures = sansProse(readFileSync(`${RACINE}lib/guide-demonstration.ts`, "utf8"));
  for (const m of RECETTES_DEMONSTRATION) {
    assert.ok(m.recipe.id.startsWith("demo-"), "la recette porte le préfixe de démonstration");
    assert.ok((m.sourceKey ?? "").startsWith("demo-"), "sa provenance aussi");
    for (const ing of m.recipe.ingredients) {
      assert.ok(ing.id.startsWith("demo-"), `${ing.name} : identifiant marqué`);
    }
  }
  assert.doesNotMatch(fixtures, /createSupabaseBrowserClient|supabase\.from/,
    "le magasin de démonstration n'a aucun moyen d'écrire");
});

/* ═══════ T. LES QUATRE SITUATIONS D'UN PLAN ═══════ */

import {
  MACROS_CIBLE_DEMONSTRATION,
  cibleAAfficher,
  cibleDemonstration,
  recettesAAfficher,
} from "../../lib/guide-demonstration";
import { slotTargetForDay } from "../../lib/nutrition/plan-v2-week";

/** La même semaine que `SEMAINE`, mais sans objectifs : le coach n'a rien fixé. */
const SEMAINE_SANS_OBJECTIFS: PlanV2Week = {
  ...SEMAINE,
  profiles: [{ ...SEMAINE.profiles[0]!, dailyCalories: 0 }],
};

/** Une vraie recette du coach, pour les situations où la bibliothèque n'est pas vide. */
const RECETTE_REELLE = {
  ...RECETTES_DEMONSTRATION[0]!,
  recipe: { ...RECETTES_DEMONSTRATION[0]!.recipe, id: "vraie-recette", name: "Poulet du coach" },
  sourceKey: null,
};

const JOUR = SEMAINE.days[0]!;

await test("T1. plan AVEC objectifs et recettes réelles : rien n'est substitué", () => {
  /*
   * ⚠️ LA SITUATION LA PLUS IMPORTANTE DES QUATRE. C'est celle de la plupart
   * des élèves, et c'est celle où une substitution serait un mensonge : des
   * quantités calculées sur un objectif inventé, affichées sous une recette
   * que le coach a réellement écrite.
   */
  const { recettes, exemple } = recettesAAfficher(true, [RECETTE_REELLE]);
  assert.equal(exemple, false, "la visite n'affiche pas d'exemple quand il y a de vraies recettes");
  assert.deepEqual(recettes, [RECETTE_REELLE], "ce sont les recettes du coach, intactes");

  const reelle = slotTargetForDay(SEMAINE, JOUR, "lunch");
  assert.equal(reelle.ok, true, "le plan a bien des objectifs");
  const { cible, fictive } = cibleAAfficher(exemple, "lunch", reelle);
  assert.equal(fictive, false, "et l'objectif reste celui du coach");
  assert.deepEqual(cible, reelle);
});

await test("T2. plan AVEC objectifs mais AUCUNE recette : exemple, objectif réel", () => {
  const { recettes, exemple } = recettesAAfficher(true, []);
  assert.equal(exemple, true);
  assert.equal(recettes.length, 1, "la recette d'exemple prend le relais");

  const reelle = slotTargetForDay(SEMAINE, JOUR, "lunch");
  const { cible, fictive } = cibleAAfficher(exemple, "lunch", reelle);
  assert.equal(fictive, false,
    "les objectifs existent : on n'invente rien, la recette d'exemple est dosée sur les VRAIS objectifs");
  assert.equal(cible?.ok, true);
});

await test("T3. plan SANS objectifs et sans recette : exemple ET objectif d'exemple", () => {
  /*
   * ⚠️ LA LIMITE QUE CE LOT LÈVE. `buildRecipeTargetForMealSlot` refuse un
   * profil sans calories — refus juste, puisqu'une cible à zéro est une cible
   * valide que le solveur traiterait. Sans cible, la page ne rendait pas la
   * liste des recettes, et la visite n'avait rien à montrer.
   */
  const reelle = slotTargetForDay(SEMAINE_SANS_OBJECTIFS, JOUR, "lunch");
  assert.equal(reelle.ok, false, "le plan n'a pas d'objectifs");

  const { recettes, exemple } = recettesAAfficher(true, []);
  assert.equal(exemple, true);
  const { cible, fictive } = cibleAAfficher(exemple, "lunch", reelle);
  assert.equal(fictive, true, "un objectif d'exemple permet enfin le calcul");
  assert.equal(cible?.ok, true);
  assert.deepEqual(cible?.ok ? cible.target : null, MACROS_CIBLE_DEMONSTRATION);

  // Et le calcul aboutit réellement, avec cette cible-là.
  const solution = solveRecipe(recettes[0]!.recipe, { target: MACROS_CIBLE_DEMONSTRATION });
  const dosables = solution.ingredients.filter(
    (i) => i.role === "protein" || i.role === "carbohydrate" || i.role === "fat",
  );
  assert.equal(dosables.length, 3);
  for (const ingredient of dosables) {
    assert.ok(ingredient.displayGrams > 0, `${ingredient.name} a une quantité`);
    assert.ok(ingredient.calories > 0, `${ingredient.name} a des apports`);
  }
  assert.ok(solution.totals.calories > 0, "la recette a un total");
  assert.ok(Number.isFinite(solution.deltas.proteinGrams), "et un écart calculable");
  assert.notEqual(describeRecipeFit(solution).status, "impossible");
});

await test("T4. un objectif d'exemple n'accompagne JAMAIS une vraie recette", () => {
  /*
   * Le verrou le plus important du lot : `cibleAAfficher` reçoit `exemple` en
   * premier argument. Un plan sans objectifs MAIS avec de vraies recettes ne
   * doit donc rien inventer — l'élève verrait sinon des quantités prescrites
   * par personne.
   */
  const reelle = slotTargetForDay(SEMAINE_SANS_OBJECTIFS, JOUR, "lunch");
  const { exemple } = recettesAAfficher(true, [RECETTE_REELLE]);
  const { cible, fictive } = cibleAAfficher(exemple, "lunch", reelle);
  assert.equal(fictive, false, "aucune cible inventée sous une recette réelle");
  assert.equal(cible?.ok, false, "la page dira simplement que les objectifs manquent");
});

await test("T5. hors visite guidée, les quatre situations sont STRICTEMENT inchangées", () => {
  for (const recettesReelles of [[], [RECETTE_REELLE]]) {
    const { recettes, exemple } = recettesAAfficher(false, recettesReelles);
    assert.equal(exemple, false, "aucune substitution sans visite guidée");
    assert.deepEqual(recettes, recettesReelles);
    for (const semaine of [SEMAINE, SEMAINE_SANS_OBJECTIFS]) {
      const reelle = slotTargetForDay(semaine, JOUR, "lunch");
      const { cible, fictive } = cibleAAfficher(exemple, "lunch", reelle);
      assert.equal(fictive, false);
      assert.deepEqual(cible, reelle, "la page se comporte exactement comme avant ce lot");
    }
  }
});

await test("T6. sans créneau choisi, rien n'est inventé non plus", () => {
  const { exemple } = recettesAAfficher(true, []);
  const { cible, fictive } = cibleAAfficher(exemple, null, null);
  assert.equal(fictive, false, "tant qu'aucun créneau n'est choisi, il n'y a pas de cible à inventer");
  assert.equal(cible, null);
});

await test("T7. les calories de l'objectif d'exemple sont DÉRIVÉES, pas saisies", () => {
  /*
   * Un trio de macros et un total écrits à la main finissent toujours par se
   * contredire. Le total passe donc par le 4/4/9 de l'application.
   */
  const cible = cibleDemonstration("lunch");
  assert.equal(cible.ok, true);
  if (!cible.ok) return;
  const attendu =
    MACROS_CIBLE_DEMONSTRATION.proteinGrams * 4 +
    MACROS_CIBLE_DEMONSTRATION.carbGrams * 4 +
    MACROS_CIBLE_DEMONSTRATION.fatGrams * 9;
  assert.equal(cible.calories, attendu, "4 / 4 / 9, comme partout ailleurs");
  assert.ok(cible.calories > 400 && cible.calories < 1200,
    "et l'ordre de grandeur reste celui d'un repas, pas d'une journée");
});

await test("T8. l'objectif d'exemple ne se fait jamais passer pour celui du coach", () => {
  const source = readFileSync(`${RACINE}components/student/StudentAdaptiveRecipes.tsx`, "utf8");
  assert.match(source, /data-guide="recettes-cible-exemple"/,
    "la mention est posée LÀ OÙ LE CHIFFRE SE LIT, pas seulement dans un bandeau en haut de page");
  assert.match(source, /Objectif d&apos;exemple/);
  assert.match(source, /n&apos;a pas encore\s*\n?\s*fixé d&apos;objectif pour ce créneau/);
  // Et elle ne s'affiche que dans ce cas précis.
  assert.match(sansProse(source), /\{cibleFictive && \(/);
});
