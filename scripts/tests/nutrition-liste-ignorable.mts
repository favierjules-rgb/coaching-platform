process.env.TZ = "Europe/Paris";

/**
 * Harnais — N1.7 : UNE LISTE QU'ON PEUT NE PAS PRENDRE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROTÈGE
 * ════════════════════════════════════════════════════════════════════════
 *   • que « Rien » soit une RÉPONSE et non une case vide — un repas dont
 *     toutes les listes sont réglées doit être calculable ;
 *   • que les quantités des AUTRES aliments soient RECALCULÉES pour viser la
 *     même cible, et non simplement laissées telles quelles ;
 *   • que le SNAPSHOT fasse loi — une liste rendue ignorable après coup ne
 *     doit pas rendre facultative une occurrence figée obligatoire ;
 *   • qu'un « rien » SURVIVE à l'enregistrement puis au rechargement ;
 *   • qu'une occurrence écartée n'achète rien et ne se mange pas.
 *
 * Lancement : npx tsx scripts/tests/nutrition-liste-ignorable.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RIEN,
  calculDuRepas,
  choixResolus,
  estIgnoree,
  ignorerOccurrence,
  occurrencesIgnorees,
  optionChoisie,
  progressionDesChoix,
  selectionDepuisComposition,
  type SelectionDeChoix,
} from "@/lib/nutrition/meal-choice-selection";
import type { MealMacroTarget } from "@/lib/nutrition/meal-choice-solver";
import type { ChoiceOption, MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

/* ────────────────────────── Fixtures ────────────────────────── */

const option = (
  optionId: string,
  id: string,
  displayName: string,
  nutrition: ChoiceOption["nutrition"],
): ChoiceOption => ({ type: "aliment", id, optionId, displayName, nutrition }) as ChoiceOption;

const occurrence = (
  id: string,
  label: string,
  options: readonly ChoiceOption[],
  peutEtreIgnoree = false,
): MealChoiceSlot => ({ id, label, sourceListId: null, colorKey: null, peutEtreIgnoree, options });

const POULET = { unit: "g", proteinPer100: 31, carbPer100: 0, fatPer100: 3.6 } as const;
const RIZ = { unit: "g", proteinPer100: 2.7, carbPer100: 28, fatPer100: 0.3 } as const;
const CREME = { unit: "g", proteinPer100: 2.4, carbPer100: 3.4, fatPer100: 30 } as const;

/** Protéine et féculent OBLIGATOIRES, crème FACULTATIVE — le cas de Jules. */
function repas(): readonly MealChoiceSlot[] {
  return [
    occurrence("s1", "Ta protéine", [option("o1", "f-poulet", "Poulet", POULET)]),
    occurrence("s2", "Ton féculent", [option("o2", "f-riz", "Riz", RIZ)]),
    occurrence("s3", "Ta crème", [option("o3", "f-creme", "Crème", CREME)], true),
  ];
}

const CIBLE: MealMacroTarget = { proteinGrams: 40, carbGrams: 60, fatGrams: 15 };

const toutChoisi = (): SelectionDeChoix => ({ s1: "o1", s2: "o2", s3: "o3" });

/* ═══════════ 1-4. « RIEN » EST UNE RÉPONSE, PAS UNE CASE VIDE ═══════════ */

await test("1. « Rien » rend le repas COMPLET — c'est la ligne qui fait exister le lot", () => {
  const occurrences = repas();
  /*
   * ⚠️ LA PROPRIÉTÉ CENTRALE. Avant N1.7, une occurrence sans aliment laissait
   * le repas « incomplet » à jamais : aucune quantité n'était calculée et le
   * bouton de validation restait mort. Si `progressionDesChoix` cessait de
   * compter les « rien », toute la fonctionnalité redeviendrait inutilisable —
   * sans qu'aucun autre test ne le voie.
   */
  const partiel: SelectionDeChoix = { s1: "o1", s2: "o2" };
  assert.equal(progressionDesChoix(occurrences, partiel).complet, false, "deux choix sur trois : incomplet");

  const avecRien = ignorerOccurrence(partiel, occurrences[2]);
  const p = progressionDesChoix(occurrences, avecRien);
  assert.equal(p.choisis, 3, "les trois occurrences sont décidées");
  assert.equal(p.complet, true, "un repas dont TOUT est réglé est complet, « rien » compris");
});

await test("2. « Rien » n'est PAS « aucun choix » — deux états distincts", () => {
  const occurrences = repas();
  const rien = ignorerOccurrence({ s1: "o1", s2: "o2" }, occurrences[2]);
  /*
   * ⚠️ LES CONFONDRE SERAIT LA RÉGRESSION LA PLUS FACILE. `optionChoisie` rend
   * `null` dans les DEUX cas — c'est voulu, « rien » n'est pas une option —
   * mais `estIgnoree` doit les séparer, sinon l'écran afficherait « Aucun
   * choix » à un élève qui vient justement de répondre.
   */
  assert.equal(optionChoisie(occurrences[2], rien), null, "« rien » n'est jamais une option");
  assert.equal(estIgnoree(rien, "s3"), true, "mais l'occurrence EST écartée");
  assert.equal(estIgnoree({ s1: "o1" }, "s3"), false, "une occurrence non répondue n'est pas écartée");
});

await test("3. la sentinelle ne peut pas entrer en collision avec un identifiant d'option", () => {
  // Les `optionId` sont des UUID de `meal_choice_options.id`. La sentinelle
  // n'en est pas un, et n'en sera jamais un.
  assert.ok(!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(RIEN), "la sentinelle n'a pas la forme d'un UUID");
  const occurrences = repas();
  assert.ok(
    occurrences.every((o) => o.options.every((opt) => opt.optionId !== RIEN)),
    "aucune option ne porte la sentinelle",
  );
});

await test("4. une occurrence écartée n'entre PAS dans l'entrée du solveur", () => {
  const occurrences = repas();
  const rien = ignorerOccurrence({ s1: "o1", s2: "o2" }, occurrences[2]);
  const resolus = choixResolus(occurrences, rien);
  assert.equal(resolus.length, 2, "deux aliments, pas trois");
  assert.deepEqual(resolus.map((r) => r.slotId), ["s1", "s2"], "et ce sont les deux retenus");
});

/* ═══════════ 5-7. LES QUANTITÉS DES AUTRES SONT RECALCULÉES ═══════════ */

await test("5. écarter une liste RECALCULE les autres — ce n'est pas un simple retrait", () => {
  const occurrences = repas();
  const complet = calculDuRepas(occurrences, toutChoisi(), CIBLE);
  assert.equal(complet.etat, "calcule");
  if (complet.etat !== "calcule") return;

  const sansCreme = calculDuRepas(
    occurrences,
    ignorerOccurrence(toutChoisi(), occurrences[2]),
    CIBLE,
  );
  assert.equal(sansCreme.etat, "calcule", "un repas amputé d'une liste facultative reste calculable");
  if (sansCreme.etat !== "calcule") return;

  const q = (s: typeof complet.solution, slot: string) =>
    s.items.find((i) => i.slotId === slot)?.displayQuantity ?? null;

  /*
   * ⚠️ C'EST LA DEMANDE DE JULES, MOT POUR MOT : « que le fonctionnement de
   * celle-ci donne toujours les quantités désirées pour les autres aliments ».
   * Si le poulet et le riz gardaient EXACTEMENT les mêmes grammes après le
   * retrait de la crème, cela prouverait qu'on a retiré une ligne d'affichage
   * sans refaire le calcul — la crème portait 30 g de lipides pour 100 g, ses
   * macros doivent être reprises par les autres.
   */
  assert.notEqual(q(sansCreme.solution, "s1"), q(complet.solution, "s1"), "la protéine est recalculée");
  assert.equal(sansCreme.solution.items.length, 2, "et la crème ne figure plus dans la solution");
  assert.ok(
    sansCreme.solution.items.every((i) => i.slotId !== "s3"),
    "aucune quantité n'est rendue pour l'occurrence écartée",
  );
});

await test("6. les deux aliments restants visent TOUJOURS la même cible", () => {
  const occurrences = repas();
  const calcul = calculDuRepas(occurrences, ignorerOccurrence(toutChoisi(), occurrences[2]), CIBLE);
  assert.equal(calcul.etat, "calcule");
  if (calcul.etat !== "calcule") return;

  /*
   * ⚠️ ON VÉRIFIE LA CIBLE ATTEINTE, PAS SEULEMENT « ça calcule ». Poulet + riz
   * peuvent porter les protéines et les glucides ; les 15 g de lipides, eux, ne
   * sont plus atteignables sans la crème — et c'est un fait NUTRITIONNEL, pas
   * un bug. Le solveur doit rendre la meilleure solution réalisable, et l'on
   * mesure ici que les deux macros couvrables le sont bien.
   */
  const atteint = { protein: 0, carbs: 0, fat: 0 };
  for (const item of calcul.solution.items) {
    const o = occurrences.flatMap((occ) => occ.options).find((x) => x.optionId === item.optionId);
    const n = o?.nutrition;
    if (!n) continue;
    atteint.protein += (n.proteinPer100 * item.displayQuantity) / 100;
    atteint.carbs += (n.carbPer100 * item.displayQuantity) / 100;
  }
  assert.ok(Math.abs(atteint.protein - CIBLE.proteinGrams) < 2, `protéines visées : ${atteint.protein}`);
  assert.ok(Math.abs(atteint.carbs - CIBLE.carbGrams) < 2, `glucides visés : ${atteint.carbs}`);
});

await test("7. un repas ENTIÈREMENT écarté est « vide », jamais « sans-cible »", () => {
  const occurrences = [
    occurrence("s1", "Ta boisson", [option("o1", "f-jus", "Jus", RIZ)], true),
    occurrence("s2", "Ta crème", [option("o2", "f-creme", "Crème", CREME)], true),
  ];
  let selection: SelectionDeChoix = {};
  for (const o of occurrences) selection = ignorerOccurrence(selection, o);

  const calcul = calculDuRepas(occurrences, selection, CIBLE);
  /*
   * ⚠️ « VIDE » ET « SANS-CIBLE » DISENT DEUX CHOSES DIFFÉRENTES, et les
   * confondre mentirait à l'élève. « Sans cible » veut dire « le jour n'a pas
   * de profil exploitable » ; ici le jour va très bien — la cible est fournie —
   * c'est le repas qui ne contient aucun aliment.
   */
  assert.equal(calcul.etat, "vide", "un repas sans aucun aliment se DIT vide");
});

/* ═══════════ 8-10. LE SNAPSHOT FAIT LOI ═══════════ */

await test("8. une occurrence OBLIGATOIRE refuse « Rien », même si on le lui demande", () => {
  const occurrences = repas();
  /*
   * ⚠️ LE GARDE-FOU VIT DANS LE MODÈLE, PAS DANS L'INTERFACE SEULE. Le bouton
   * n'est rendu que là où c'est permis — mais une interface n'est pas le lieu
   * où une règle métier se garde. Sans ce refus, un état restauré, un
   * brouillon recopié ou un appel direct pourraient écarter la protéine que le
   * coach a rendue obligatoire.
   */
  const refus = ignorerOccurrence({}, occurrences[0]);
  assert.deepEqual(refus, {}, "la sélection ressort INCHANGÉE");
  assert.equal(estIgnoree(refus, "s1"), false, "la protéine n'est pas écartée");
});

await test("9. le snapshet ancien l'emporte sur la bibliothèque d'aujourd'hui", () => {
  /*
   * ⚠️ LE CŒUR DE LA GARANTIE. Rendre « Ta crème » ignorable dans la
   * bibliothèque ne doit PAS rendre facultative une occurrence figée
   * obligatoire dans un repas construit avant. On simule les deux versions du
   * MÊME repas : seule celle dont le snapshot le permet accepte « rien ».
   */
  const figeObligatoire = occurrence("s3", "Ta crème", [option("o3", "f-creme", "Crème", CREME)], false);
  const figeFacultatif = occurrence("s3", "Ta crème", [option("o3", "f-creme", "Crème", CREME)], true);

  assert.deepEqual(ignorerOccurrence({}, figeObligatoire), {}, "le repas d'hier reste obligatoire");
  assert.equal(estIgnoree(ignorerOccurrence({}, figeFacultatif), "s3"), true, "le repas d'aujourd'hui accepte");
});

await test("10. `occurrencesIgnorees` revérifie le snapshot avant de partir en base", () => {
  const obligatoire = repas().map((o) => ({ ...o, peutEtreIgnoree: false }));
  // Une sélection FORGÉE, qui écarte une occurrence redevenue obligatoire.
  const forgee: SelectionDeChoix = { s1: "o1", s2: "o2", s3: RIEN };
  /*
   * ⚠️ ELLE NE DOIT PAS PARTIR VERS LA RPC. Celle-ci la refuserait avec
   * OCCURRENCE_NON_IGNORABLE, et l'élève verrait une erreur technique au lieu
   * d'une occurrence à recomposer.
   */
  assert.deepEqual(occurrencesIgnorees(obligatoire, forgee), [], "rien ne part");
  assert.deepEqual(occurrencesIgnorees(repas(), forgee), ["s3"], "mais le cas légitime part bien");
});

/* ═══════════ 11-13. LA PERSISTANCE ═══════════ */

await test("11. un « rien » enregistré SURVIT au rechargement", () => {
  const occurrences = repas();
  /*
   * ⚠️ SANS CETTE RELECTURE, LE LOT NE SERT À RIEN EN PRATIQUE. Une occurrence
   * écartée n'a AUCUNE ligne dans `planned_meal_items` — ses contraintes
   * l'interdisent. Elle reviendrait donc « pas encore choisie », et la carte du
   * repas repasserait « À RECOMPOSER » à chaque rafraîchissement.
   */
  const relue = selectionDepuisComposition(
    occurrences,
    [{ slotId: "s1", catalogFoodId: "f-poulet", productId: null, quantity: 120, unit: "g" },
     { slotId: "s2", catalogFoodId: "f-riz", productId: null, quantity: 200, unit: "g" }],
    ["s3"],
  );
  assert.equal(relue.s1, "o1", "la protéine est retrouvée");
  assert.equal(estIgnoree(relue, "s3"), true, "et la crème est toujours écartée");
  assert.equal(progressionDesChoix(occurrences, relue).complet, true, "le repas rouvre COMPLET");
});

await test("12. un « rien » relu sur une occurrence redevenue obligatoire est ABANDONNÉ", () => {
  const durci = repas().map((o) => ({ ...o, peutEtreIgnoree: false }));
  const relue = selectionDepuisComposition(durci, [], ["s3"]);
  /*
   * Le coach a refermé le droit depuis. L'occurrence redevient simplement sans
   * choix — l'élève doit trancher — plutôt que de rouvrir un droit retiré.
   */
  assert.equal(estIgnoree(relue, "s3"), false, "le « rien » périmé ne ressuscite pas");
  assert.equal(progressionDesChoix(durci, relue).complet, false, "et le repas redemande un choix");
});

await test("13. un aliment réellement enregistré l'emporte sur un « rien » résiduel", () => {
  const occurrences = repas();
  const relue = selectionDepuisComposition(
    occurrences,
    [{ slotId: "s3", catalogFoodId: "f-creme", productId: null, quantity: 30, unit: "g" }],
    ["s3"],
  );
  // Les deux tables ne devraient jamais désigner la même occurrence — la RPC
  // les efface ensemble — mais si une incohérence survivait, un aliment
  // RÉELLEMENT enregistré est le fait le plus fort des deux.
  assert.equal(relue.s3, "o3", "l'aliment gagne");
  assert.equal(estIgnoree(relue, "s3"), false);
});

/* ═══════ 11bis-11quater. LE CYCLE COMPLET, DE LA BASE À L'ÉCRAN ═══════ */

/**
 * ⚠️ CES TROIS TESTS EXISTENT PARCE QUE LE TEST 11 NE SUFFISAIT PAS, ET C'EST
 * LA LEÇON DU LOT.
 *
 * Le test 11 passe `["s3"]` À LA MAIN à `selectionDepuisComposition`. Il prouve
 * que la FONCTION sait relire un « rien ». Il ne prouve RIEN sur le fait que
 * quelqu'un, quelque part, aille chercher ce tableau en base — et pendant tout
 * un chantier, personne ne le faisait : `planned_meal_skipped_slots` était
 * écrite et jamais lue. La fonctionnalité était juste, le CÂBLAGE manquait, et
 * aucun test ne regardait le câblage.
 *
 * On teste donc ici les DEUX BOUTS de la paire :
 *   · que les lecteurs de base DEMANDENT la table (11bis) ;
 *   · qu'ils TRANSPORTENT le résultat jusqu'au modèle (11ter) ;
 *   · que la chaîne complète rende un repas COMPLET (11quater).
 */

/** Les lecteurs qui doivent interroger `planned_meal_skipped_slots`. */
const LECTEURS_DE_COMPOSITION = [
  "../../lib/supabase/consumed-meals.ts",
  "../../lib/supabase/repas-planifies.ts",
] as const;

await test("11bis. les DEUX lecteurs de composition interrogent réellement la table", () => {
  /*
   * ⚠️ IL Y EN A DEUX, ET LES OUBLIER À MOITIÉ EST PIRE QUE DE TOUT OUBLIER :
   * `lireCompositionsValidees` sert l'écran des repas, `lireRepasPlanifies…`
   * sert la liste de courses. Un seul des deux branché, et la moitié de
   * l'application croit l'élève indécis pendant que l'autre le sait décidé.
   */
  for (const chemin of LECTEURS_DE_COMPOSITION) {
    const source = readFileSync(new URL(chemin, import.meta.url), "utf8");
    const propre = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      /\.from\("planned_meal_skipped_slots"\)/.test(propre),
      `${chemin} n'interroge PAS planned_meal_skipped_slots : le « Rien » est écrit puis perdu`,
    );
    assert.ok(
      /choice_slot_id/.test(propre),
      `${chemin} doit sélectionner choice_slot_id`,
    );
  }
});

await test("11ter. le résultat de la lecture est TRANSPORTÉ jusqu'au modèle", () => {
  /*
   * ⚠️ LIRE NE SUFFIT PAS. Une requête dont le résultat n'atteint jamais
   * `selectionDepuisComposition` coûte un aller-retour réseau et ne change
   * rien à l'écran. On épingle donc le transport : le type porte les
   * occurrences écartées, et les appels les passent.
   */
  const consumed = readFileSync(new URL("../../lib/supabase/consumed-meals.ts", import.meta.url), "utf8");
  assert.ok(/readonly ignorees: readonly string\[\]/.test(consumed), "CompositionValidee doit transporter les « rien »");

  const periode = readFileSync(new URL("../../lib/nutrition/repas-de-la-periode.ts", import.meta.url), "utf8");
  assert.ok(
    /selectionDepuisComposition\(repas\.choiceSlots, connue!\.items, connue!\.ignorees\)/.test(periode),
    "repas-de-la-periode doit passer les occurrences écartées",
  );

  const parJour = readFileSync(new URL("../../lib/nutrition/repas-par-jour.ts", import.meta.url), "utf8");
  assert.ok(
    /selectionDepuisComposition\(\s*repas\.occurrences,\s*repas\.composition,\s*repas\.compositionIgnorees\s*\)/.test(parJour),
    "repas-par-jour doit passer les occurrences écartées",
  );

  const ecran = readFileSync(new URL("../../components/student/StudentMealChoices.tsx", import.meta.url), "utf8");
  assert.ok(
    /selectionDepuisComposition\(occurrences, composition, compositionIgnorees\)/.test(ecran),
    "l'écran des choix doit passer les occurrences écartées",
  );

  // ⚠️ ET LES DEUX FOURNISSEURS AUSSI : un type qui accepte le champ ne
  // garantit pas qu'on le remplisse.
  for (const [chemin, motif] of [
    ["../../components/student/StudentPrescribedWeek.tsx", /compositionValideeIgnorees:/],
    ["../../components/student/ListeDeCoursesParcours.tsx", /compositionValideeIgnorees: carte\.repas\.compositionIgnorees/],
  ] as const) {
    const src = readFileSync(new URL(chemin, import.meta.url), "utf8");
    assert.ok(motif.test(src), `${chemin} doit fournir les occurrences écartées`);
  }
});

await test("11quater. LE CYCLE COMPLET : enregistrer « Rien » → relire → repas COMPLET", async () => {
  /*
   * ⚠️ LE TEST QUE CE LOT AURAIT DÛ AVOIR DÈS LE DÉPART. On rejoue la chaîne
   * ENTIÈRE avec un faux client Supabase : les deux tables répondent comme la
   * vraie base après un enregistrement où l'élève a écarté la crème, et l'on
   * vérifie que le repas rouvre COMPLET, avec ses quantités.
   *
   * ⚠️ LE FAUX CLIENT REND `planned_meal_items` SANS LA CRÈME — c'est la
   * réalité : cette table ne peut PAS porter une absence. Si le code cesse de
   * lire la seconde table, l'occurrence disparaît et ce test rougit.
   */
  const { lireCompositionsValidees } = await import("@/lib/supabase/consumed-meals");

  const REPAS = "pm-1";
  const reponses: Record<string, unknown[]> = {
    planned_meals: [{ id: REPAS, meal_id: "m1", planned_on: "2026-09-21", consumed_meal_id: null }],
    planned_meal_items: [
      { planned_meal_id: REPAS, choice_slot_id: "s1", catalog_food_id: "f-poulet", product_id: null, quantity: 120, unit: "g" },
      { planned_meal_id: REPAS, choice_slot_id: "s2", catalog_food_id: "f-riz", product_id: null, quantity: 200, unit: "g" },
    ],
    // La crème : AUCUN item, une ligne d'écart.
    planned_meal_skipped_slots: [{ planned_meal_id: REPAS, choice_slot_id: "s3" }],
  };
  const interrogees: string[] = [];
  const requete = (table: string) => {
    interrogees.push(table);
    const resultat = { data: reponses[table] ?? [], error: null };
    const chainable: Record<string, unknown> = {};
    for (const methode of ["select", "in", "order", "eq"]) {
      chainable[methode] = () => chainable;
    }
    // `await` sur la chaîne rend le résultat : c'est ce que fait PostgREST.
    chainable.then = (resoudre: (v: unknown) => unknown) => Promise.resolve(resultat).then(resoudre);
    return chainable;
  };
  const faux = { from: requete } as unknown as Parameters<typeof lireCompositionsValidees>[0];

  const carte = await lireCompositionsValidees(faux, ["2026-09-21"]);
  assert.ok(
    interrogees.includes("planned_meal_skipped_slots"),
    "la lecture doit INTERROGER planned_meal_skipped_slots",
  );

  const composition = carte.get("m1|2026-09-21");
  assert.ok(composition, "la composition validée doit être retrouvée");
  assert.deepEqual([...composition!.ignorees], ["s3"], "et transporter l'occurrence écartée");

  // ── Le bout de la chaîne : la sélection reconstruite, puis la progression ──
  const occurrences = repas();
  const selection = selectionDepuisComposition(occurrences, composition!.items, composition!.ignorees);
  assert.equal(estIgnoree(selection, "s3"), true, "la crème est TOUJOURS écartée après rechargement");
  assert.equal(
    progressionDesChoix(occurrences, selection).complet,
    true,
    "le repas rouvre COMPLET — c'est exactement ce qui échouait en production",
  );

  // ── Et les quantités réapparaissent ──
  const calcul = calculDuRepas(occurrences, selection, CIBLE);
  assert.equal(calcul.etat, "calcule", "les quantités doivent être recalculées après rechargement");
  if (calcul.etat !== "calcule") return;
  assert.equal(calcul.solution.items.length, 2, "deux aliments, la crème reste écartée du solveur");
  assert.ok(calcul.solution.items.every((i) => i.slotId !== "s3"));
});

await test("11quinquies. un repas ENTIÈREMENT écarté reste une composition validée", () => {
  /*
   * ⚠️ LE PIÈGE `items.length === 0`. Deux lecteurs écartaient une composition
   * sans aucun item — « un repas sans item ne décrit aucune composition ».
   * C'était vrai avant N1.7 ; ça ne l'est plus. Un élève qui écarte TOUTES ses
   * listes a bel et bien validé quelque chose, et son repas repassait
   * « à valider ».
   */
  for (const [chemin, motif] of [
    ["../../lib/supabase/consumed-meals.ts", /items\.length === 0 && ignorees\.length === 0/],
    ["../../lib/nutrition/repas-de-la-periode.ts", /connue\.items\.length > 0 \|\| connue\.ignorees\.length > 0/],
    ["../../hooks/useListeDeCourses.ts", /repas\.items\.length === 0 && repas\.ignorees\.length === 0/],
  ] as const) {
    const src = readFileSync(new URL(chemin, import.meta.url), "utf8");
    assert.ok(motif.test(src), `${chemin} écarte encore une composition entièrement « Rien »`);
  }
});

/* ═══════════ 14-16. CE QUI NE DOIT PAS BOUGER ═══════════ */

await test("14. une occurrence écartée n'achète RIEN", () => {
  const occurrences = repas();
  const calcul = calculDuRepas(occurrences, ignorerOccurrence(toutChoisi(), occurrences[2]), CIBLE);
  assert.equal(calcul.etat, "calcule");
  if (calcul.etat !== "calcule") return;
  /*
   * ⚠️ LA LISTE DE COURSES DÉRIVE DE LA SOLUTION DU SOLVEUR, et de rien
   * d'autre. C'est CE fait qui la rend automatiquement juste — mais il mérite
   * d'être épinglé : le jour où la liste de courses lirait la SÉLECTION plutôt
   * que la SOLUTION, elle achèterait de la crème que personne ne mange.
   */
  assert.ok(
    calcul.solution.items.every((i) => i.slotId !== "s3"),
    "aucun article pour l'occurrence écartée",
  );
});

await test("15. le chemin CONSOMMÉ NE FILTRE PLUS — la régression exacte de la Preview", () => {
  /*
   * ⚠️ CE TEST DISAIT L'INVERSE, ET IL AVAIT TORT. Sa version précédente
   * EXIGEAIT le filtre `.filter((item) => item.ignore !== true)` — au motif que
   * « la RPC de consommation n'a aucune branche pour recevoir une occurrence
   * écartée ». C'était faux : elle DÉLÈGUE à `enregistrer_repas_planifie`, qui
   * exige TOUTES les occurrences. Le filtre faisait donc échouer
   * l'enregistrement avec CHOIX_INCOMPLET, et ce test-ci le GARDAIT en place.
   *
   * Un test peut épingler une erreur aussi solidement qu'une vérité. Celui-ci
   * garde désormais la propriété inverse : le filtre ne doit PAS revenir.
   *
   * « Une absence ne se mange pas » reste vrai — c'est la RPC qui le porte
   * maintenant (test 21), et c'est le bon endroit : un garde-fou métier vit en
   * base, pas dans un `.map()` de client.
   */
  const source = readFileSync(new URL("../../lib/supabase/consumed-meals.ts", import.meta.url), "utf8");
  const propre = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const debut = propre.indexOf("export async function enregistrerRepasStructure(");
  assert.ok(debut > 0, "la fonction de consommation existe");
  const bloc = propre.slice(debut, debut + 1400);

  // ⚠️ `[^)]*` NE MARCHE PAS ICI, ET LE SABOTAGE L'A PROUVÉ. Le filtre s'écrit
  // `.filter((item) => item.ignore !== true)` : la parenthèse fermante de
  // `(item)` arrête la classe négative AVANT le mot `ignore`, et la garde
  // laissait donc revenir exactement ce qu'elle devait interdire. On regarde
  // une FENÊTRE après `.filter(`, sans essayer d'équilibrer des parenthèses.
  for (const t of bloc.matchAll(/\.filter\(/g)) {
    const fenetre = bloc.slice(t.index, t.index + 80);
    assert.ok(
      !fenetre.includes("ignore"),
      `le filtre des « rien » ne doit PAS revenir — il fait lever CHOIX_INCOMPLET : ${fenetre.slice(0, 60)}`,
    );
  }
  assert.ok(/item\.ignore/.test(bloc), "l'occurrence écartée doit être ÉMISE, marquée ignore");
  assert.ok(
    /\{ slot_id: item\.slotId, ignore: true \}/.test(bloc),
    "et émise sans identité ni quantité",
  );
});

await test("16. TOUS les défauts laissent une liste OBLIGATOIRE", () => {
  /*
   * ⚠️ LE DÉFAUT SÛR EST CELUI QUI NE RETIRE RIEN AU COACH. Un snapshot
   * partiel, une colonne absente, une valeur nulle : rien de tout cela ne doit
   * ouvrir un droit que personne n'a accordé.
   */
  const sansReglage = occurrence("s9", "Une liste", [option("o9", "f", "A", POULET)]);
  assert.equal(sansReglage.peutEtreIgnoree, false, "le défaut d'une fixture");
  assert.deepEqual(ignorerOccurrence({}, sansReglage), {}, "et il refuse « rien »");

  for (const fichier of ["../../lib/supabase/nutrition-week.ts", "../../lib/supabase/food-lists.ts"]) {
    const src = readFileSync(new URL(fichier, import.meta.url), "utf8");
    assert.ok(
      /peut_etre_ignoree === true/.test(src),
      `${fichier} doit lire la colonne en « === true » — jamais en « != null »`,
    );
  }
});

/* ═══════════ 17-19. LA BASE ═══════════ */

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20260920090000_n1_7_listes_ignorables.sql", import.meta.url),
  "utf8",
);

await test("17. la migration est ADDITIVE — aucune contrainte de sécurité relâchée", () => {
  /*
   * ⚠️ LES TROIS CONTRAINTES DE `planned_meal_items` SONT CE QUI EMPÊCHE DE
   * PLANIFIER UN ALIMENT HORS DES LISTES DU COACH. Loger une absence en les
   * affaiblissant aurait rouvert ce trou ; c'est précisément pourquoi une
   * table à part existe. Ce test interdit le raccourci.
   */
  for (const interdit of [
    /drop\s+constraint\s+.*planned_meal_items/i,
    /alter\s+table\s+public\.planned_meal_items/i,
    /drop\s+column/i,
    /drop\s+table/i,
  ]) {
    assert.ok(!interdit.test(MIGRATION), `la migration ne doit pas contenir ${interdit}`);
  }
  assert.ok(/create table if not exists public\.planned_meal_skipped_slots/.test(MIGRATION));
});

await test("18. les deux colonnes sont `not null default false`", () => {
  for (const table of ["food_lists", "meal_choice_slots"]) {
    const motif = new RegExp(
      `alter table public\\.${table}\\s+add column if not exists peut_etre_ignoree boolean not null default false`,
      "i",
    );
    assert.ok(motif.test(MIGRATION), `${table} doit gagner la colonne avec le défaut sûr`);
  }
  // ⚠️ AUCUN BACKFILL : aucune liste existante ne devient ignorable d'office.
  assert.ok(!/update public\.food_lists\s+set peut_etre_ignoree/i.test(MIGRATION), "aucun backfill");
});

await test("19. la RPC refuse « rien » sur une occurrence non ignorable", () => {
  /*
   * ⚠️ LE GARDE-FOU EXISTE AUX DEUX BOUTS, ET C'EST VOULU. Le modèle refuse
   * côté client ; la RPC refuse côté base. Un appel direct — hors interface —
   * ne doit pas pouvoir contourner la décision du coach.
   */
  assert.ok(/OCCURRENCE_NON_IGNORABLE/.test(MIGRATION), "le refus est nommé");
  assert.ok(
    /where s\.id = v_slot and s\.peut_etre_ignoree/.test(MIGRATION),
    "et il lit le SNAPSHOT de l'occurrence, pas la bibliothèque",
  );
  // La signature ne change pas : une surcharge rendrait ambigu tout appel à
  // trois arguments.
  assert.ok(
    /FUNCTION public\.enregistrer_repas_planifie\(p_meal_id uuid, p_planned_on date, p_items jsonb\)/.test(MIGRATION),
    "la signature de la RPC est inchangée",
  );
});

/* ═══════ 20-22. LE REPAS CONSOMMÉ — LE DÉFAUT DE LA PREVIEW ═══════ */

await test("20. ENREGISTRER LE REPAS transmet l'occurrence écartée — pas de CHOIX_INCOMPLET", async () => {
  /*
   * ⚠️ LE CAS EXACT CONSTATÉ SUR LA PREVIEW : « Sucrants » à Rien, les trois
   * autres aliments calculés, et l'enregistrement qui échoue.
   *
   * Le chemin CONSOMMÉ filtrait les « rien » avant l'appel, en affirmant que
   * cette RPC n'avait aucune branche pour les recevoir. Elle DÉLÈGUE à
   * `enregistrer_repas_planifie`, qui exige TOUTES les occurrences du repas :
   * l'occurrence retirée faisait lever CHOIX_INCOMPLET.
   *
   * ⚠️ ON MESURE LE PAYLOAD, PAS LE RETOUR. C'est là que la donnée se perdait,
   * et un faux client qui rendrait « ok » ne prouverait rien.
   */
  const { enregistrerRepasStructure } = await import("@/lib/supabase/consumed-meals");
  const OCCURRENCES = ["s1", "s2", "s3"];
  let envoye: { p_items?: readonly Record<string, unknown>[] } | null = null;
  const faux = {
    rpc: (_nom: string, args: { p_items?: readonly Record<string, unknown>[] }) => {
      envoye = args;
      return Promise.resolve({ data: {}, error: null });
    },
  };

  await enregistrerRepasStructure(faux as never, "m1", "2026-09-21", [
    { slotId: "s1", catalogFoodId: "f-pain", productId: null, quantity: 229, unit: "g" },
    { slotId: "s2", catalogFoodId: "f-oeuf", productId: null, quantity: 82, unit: "g" },
    { slotId: "s3", catalogFoodId: null, productId: null, quantity: 0, unit: "g", ignore: true },
  ]).catch(() => {});

  const items = (envoye as { p_items?: readonly Record<string, unknown>[] } | null)?.p_items ?? [];
  const slots = items.map((i) => i.slot_id as string).sort();
  assert.deepEqual(slots, OCCURRENCES, "TOUTES les occurrences doivent partir, « rien » compris");

  const ecartee = items.find((i) => i.slot_id === "s3");
  assert.equal(ecartee?.ignore, true, "l'occurrence écartée porte ignore:true");
  // ⚠️ ET AUCUNE IDENTITÉ, AUCUNE QUANTITÉ. Les envoyer à zéro ferait lever
  // IDENTITE_INVALIDE puis QUANTITE_INVALIDE : la base refuse, à juste titre,
  // un aliment qui n'en est pas un.
  assert.equal(ecartee?.catalog_food_id, undefined, "aucune identité — une absence n'en a pas");
  assert.equal(ecartee?.quantity, undefined, "aucune quantité non plus");

  // Les aliments réels, eux, partent complets.
  const pain = items.find((i) => i.slot_id === "s1");
  assert.equal(pain?.catalog_food_id, "f-pain");
  assert.equal(pain?.quantity, 229);
});

await test("21. la RPC de consommation SAUTE les occurrences écartées", () => {
  /*
   * ⚠️ LA MOITIÉ BASE DE LA PAIRE. Renvoyer l'occurrence sans toucher à la RPC
   * aurait seulement changé le motif de l'erreur : après la délégation, cette
   * fonction reboucle sur `p_items` pour créer les `meal_entries`. Un item sans
   * identité tombait dans la branche « produit », `p.id = null` ne trouvait
   * rien, et elle levait PRODUIT_INACCESSIBLE.
   */
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260921090000_n1_7_1_consommer_avec_rien.sql", import.meta.url),
    "utf8",
  );
  assert.ok(
    /if coalesce\(\(v_item ->> 'ignore'\)::boolean, false\) then\s+continue;/.test(migration),
    "la boucle des entrées doit sauter les items marqués ignore",
  );
  // ⚠️ ET LE SAUT EST AVANT LA LECTURE DES IDENTITÉS, sinon il ne sert à rien.
  //
  // ⚠️ ON DÉPOUILLE LES COMMENTAIRES AVANT DE MESURER L'ORDRE. Une première
  // version comparait deux `indexOf` sur le fichier BRUT : le mot
  // `catalog_food_id` figure dans la prose qui EXPLIQUE le saut, donc il
  // apparaissait avant le `continue` et le test rougissait sur son propre
  // commentaire. On mesure ce qu'on croit mesurer.
  const codeSeul = migration.replace(/--[^\n]*/g, " ");
  const boucle = codeSeul.slice(codeSeul.indexOf("for v_item in select * from jsonb_array_elements(p_items) loop"));
  assert.ok(
    boucle.indexOf("continue;") < boucle.indexOf("catalog_food_id"),
    "le saut doit précéder la lecture de l'identité",
  );
  // ⚠️ AUCUNE AUTRE FONCTION REDONNÉE : réécrire `enregistrer_repas_planifie`
  // ici risquerait d'écraser sa version N1.7 par une copie périmée.
  assert.equal(
    (migration.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length,
    1,
    "la migration ne redonne qu'UNE fonction",
  );
  assert.ok(!/enregistrer_repas_planifie\(p_meal_id uuid/.test(migration), "et ce n'est pas la RPC planifiée");
});

await test("22. le correctif N1.7.1 ne touche NI table NI contrainte NI policy", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260921090000_n1_7_1_consommer_avec_rien.sql", import.meta.url),
    "utf8",
  );
  const code = migration.replace(/--[^\n]*/g, " ");
  for (const interdit of [/create table/i, /alter table/i, /drop /i, /create policy/i, /add column/i]) {
    assert.ok(!interdit.test(code), `la migration ne doit rien contenir de ${interdit}`);
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
