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

await test("15. le chemin CONSOMMÉ écarte les « rien » — une absence ne se mange pas", () => {
  const source = readFileSync(new URL("../../lib/supabase/consumed-meals.ts", import.meta.url), "utf8");
  const propre = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const debut = propre.indexOf("export async function enregistrerRepasStructure(");
  assert.ok(debut > 0, "la fonction de consommation existe");
  const bloc = propre.slice(debut, debut + 1200);
  assert.ok(
    /\.filter\(\(item\) => item\.ignore !== true\)/.test(bloc),
    "la RPC de consommation ne reçoit JAMAIS une occurrence écartée : elle n'a aucune branche pour la recevoir",
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

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
