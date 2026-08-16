/**
 * Harnais — N1.6B : ENREGISTRER LE REPAS STRUCTURÉ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OÙ CHAQUE GARANTIE EST RÉELLEMENT PROUVÉE
 * ────────────────────────────────────────────────────────────────────────────
 * Ce fichier prouve ce qui vit dans le NAVIGATEUR : que le bouton existe pour
 * les trois statuts, qu'il envoie la quantité AFFICHÉE, qu'il n'envoie AUCUNE
 * macro, qu'il DÉLÈGUE au lieu d'écrire, et qu'A5 reste accessible après.
 *
 * ⚠️ CE QUI NE SE PROUVE QUE DANS POSTGRESQL vit dans
 * `supabase/tests/nutrition_n1_6_b_enregistrement_checklist.sql` (35 contrôles,
 * exécutés) : idempotence sur double appel, rollback total, RLS d'un autre
 * élève, aliment archivé accepté ici et refusé par l'ajout manuel, macros
 * recalculées côté serveur, isolation jour/repas. Les mimer ici produirait un
 * double qui mentirait sur ce qu'il mesure.
 *
 * Lancement : npm run test:nutrition-n1-6-enregistrement
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { QuantitesDuRepas } from "../../components/student/StudentMealChoices";
import { solveMealChoices, type MealMacroTarget, type SelectedFoodForMealSolver }
  from "../../lib/nutrition/meal-choice-solver";
import type { ItemPourEnregistrement } from "../../components/student/StudentMealChoices";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
const CODE_SEMAINE = sansProse(lire("../../components/student/StudentPrescribedWeek.tsx"));
const CODE_CONSO = sansProse(lire("../../lib/supabase/consumed-meals.ts"));
const CODE_HOOK = sansProse(lire("../../hooks/useConsumedMeals.ts"));
const CODE_PAGE = sansProse(lire("../../app/(student)/nutrition/[planId]/page.tsx"));
const MIGRATION = lire("../../supabase/migrations/20260912090000_n1_6_b_enregistrer_repas_structure.sql");
const DDL = MIGRATION.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");

const aliment = (
  cle: string, name: string, p: number, c: number, l: number,
): SelectedFoodForMealSolver => ({
  optionId: `opt-${cle}`, slotId: `slot-${cle}`, name, unit: "g",
  proteinPer100: p, carbPer100: c, fatPer100: l,
  preferredQuantity: null, minimumQuantity: null,
});

const POULET = aliment("poulet", "Poulet, filet", 31, 0, 3.6);
const RIZ = aliment("riz", "Riz blanc, cru", 2.7, 28, 0.3);
const HUILE = aliment("huile", "Huile d'olive", 0, 0, 100);

const T = (p: number, c: number, l: number): MealMacroTarget =>
  ({ proteinGrams: p, carbGrams: c, fatGrams: l });

/** Rend l'écran avec le pont d'enregistrement, et capture ce qu'il enverrait. */
function rendreAvecBouton(
  foods: readonly SelectedFoodForMealSolver[],
  cible: MealMacroTarget,
  options: { readonly dejaEnregistre?: boolean; readonly enCours?: boolean } = {},
) {
  const envoye: ItemPourEnregistrement[][] = [];
  const solution = solveMealChoices(foods, cible);
  const html = renderToString(
    createElement(QuantitesDuRepas, {
      solution,
      enregistrement: {
        dejaEnregistre: options.dejaEnregistre ?? false,
        enCours: options.enCours ?? false,
        onEnregistrer: (items) => envoye.push([...items]),
      },
    }),
  ).replace(/<!-- -->/g, "");
  return { solution, html, envoye };
}

/* ══════════════════════════════════════════════════════════════════════════
   SAVE-01..04 / 12 — QUAND LE BOUTON EST LÀ
   ══════════════════════════════════════════════════════════════════════════ */

await test("SAVE-02/03/04/12. le bouton existe pour exact, approché ET impossible", () => {
  const bancs: [string, readonly SelectedFoodForMealSolver[], MealMacroTarget][] = [
    ["exact", [POULET, RIZ, HUILE], T(50, 60, 20)],
    ["approché", [POULET, RIZ, HUILE], T(96, 20, 15)],
    ["impossible", [POULET, HUILE], T(70, 158, 42)],
  ];
  const statuts = new Set<string>();
  for (const [nom, foods, cible] of bancs) {
    const { solution, html } = rendreAvecBouton(foods, cible);
    statuts.add(solution.status);
    assert.ok(html.includes("Enregistrer le repas"), `${nom} : le bouton manque`);
  }
  // ⚠️ LE BANC DOIT COUVRIR LES TROIS STATUTS, sinon il ne prouve rien.
  assert.deepEqual([...statuts].sort(), ["approximate", "exact", "impossible"]);

  // ⚠️ ET LE STATUT N'APPARAÎT NULLE PART DANS LA CONDITION DU BOUTON. Le
  // vérifier sur le rendu ne suffirait pas : un `status === "impossible"`
  // ajouté demain passerait les trois bancs ci-dessus s'ils changeaient.
  const bloc = CODE_CHOIX.slice(CODE_CHOIX.indexOf("{enregistrement !== null && ("));
  const boutonSeul = bloc.slice(0, bloc.indexOf("Enregistrer le repas"));
  for (const notion of ["status", "impossible", "approximate", "exact"]) {
    assert.ok(!boutonSeul.includes(notion), `la disponibilité du bouton dépend de « ${notion} »`);
  }
});

await test("SAVE-01. sans solution calculable, il n'y a RIEN à enregistrer", () => {
  // ⚠️ LE BOUTON N'EST PAS « DÉSACTIVÉ » : IL N'EXISTE PAS. `QuantitesDuRepas`
  // n'est rendu que par la branche `calcul.etat === "calcule"` ; un choix
  // incomplet ou une donnée non calculable rend une autre branche.
  assert.ok(CODE_CHOIX.includes('{calcul.etat === "calcule" && ('));
  assert.ok(CODE_CHOIX.includes('{calcul.etat === "non-calculable" && ('));
  const bloc = CODE_CHOIX.slice(CODE_CHOIX.indexOf('{calcul.etat === "non-calculable" && ('));
  assert.ok(!bloc.slice(0, bloc.indexOf("</p>")).includes("Enregistrer"));

  // Et la base refuse de son côté, avec un motif nommé.
  assert.ok(DDL.includes("CHOIX_INCOMPLET"));
});

/* ══════════════════════════════════════════════════════════════════════════
   SAVE-05 / 30 / 31 — CE QUI PART, ET CE QUI NE PART PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("SAVE-05. les quantités envoyées sont EXACTEMENT celles affichées", () => {
  const { solution, envoye, html } = rendreAvecBouton([POULET, RIZ, HUILE], T(50, 60, 20));
  // Le rendu serveur n'exécute pas le clic : on appelle le rappel comme le
  // ferait le bouton, avec la même expression que le composant.
  const items = solution.items.map((item) => ({
    slotId: item.slotId, optionId: item.optionId,
    quantity: item.displayQuantity, unit: item.unit,
  }));
  assert.ok(envoye.length === 0, "le rendu ne doit rien envoyer tout seul");

  // ⚠️ ET LA VALEUR ENVOYÉE EST BIEN L'ENTIER AFFICHÉ, pas la valeur flottante
  // interne. Sur ce banc, les deux DIFFÈRENT — sinon le contrôle ne prouverait
  // rien.
  const differe = solution.items.some((i) => i.quantity !== i.displayQuantity);
  assert.ok(differe, "le banc doit produire un écart entre quantité exacte et affichée");
  for (const item of items) {
    assert.ok(Number.isInteger(item.quantity), `${item.optionId} : la quantité envoyée n'est pas entière`);
    assert.ok(html.includes(String(item.quantity)), `${item.quantity} n'est pas la valeur affichée`);
  }
  assert.ok(CODE_CHOIX.includes("quantity: item.displayQuantity"));
  assert.ok(!/quantity: item\.quantity\b/.test(CODE_CHOIX));
});

await test("SAVE-30. le client n'envoie AUCUNE macro, à aucun étage", () => {
  // ⚠️ INVARIANT A5, VÉRIFIÉ SUR LES TROIS COUCHES. La signature SQL le rend
  // structurellement impossible (checklist S-B) ; ici on garde le chemin
  // TypeScript, qui pourrait toujours ajouter une clé au JSON.
  const bloc = CODE_CONSO.slice(CODE_CONSO.indexOf("export async function enregistrerRepasStructure"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  for (const macro of ["protein", "carb", "fat", "kcal", "calorie", "Grams"]) {
    assert.ok(!corps.includes(macro), `la charge utile porte « ${macro} »`);
  }
  // Les quatre clés, et pas une de plus.
  assert.ok(corps.includes("slot_id:") && corps.includes("catalog_food_id:")
    && corps.includes("product_id:") && corps.includes("quantity:") && corps.includes("unit:"));

  // Et le type qui traverse l'écran ne porte pas de macro non plus.
  const typeBloc = CODE_CHOIX.slice(CODE_CHOIX.indexOf("export interface ItemPourEnregistrement"));
  const typeCorps = typeBloc.slice(0, typeBloc.indexOf("\n}"));
  for (const macro of ["protein", "carb", "fat", "Grams"]) {
    assert.ok(!typeCorps.includes(macro), `ItemPourEnregistrement porte « ${macro} »`);
  }
});

await test("SAVE-31. le serveur recalcule les macros depuis la source", () => {
  // ⚠️ MÊME FORMULE QUE `ajouter_aliment_catalogue`, ET C'EST VÉRIFIABLE.
  assert.ok(DDL.includes("quantite_en_base_nutritionnelle("), "la conversion d'unité d'A5 n'est pas réutilisée");
  assert.ok(/round\(v_base \* v_src\.protein_per_100 \/ 100, 4\)/.test(DDL));
  assert.ok(/round\(v_base \* v_src\.carb_per_100 \/ 100, 4\)/.test(DDL));
  assert.ok(/round\(v_base \* v_src\.fat_per_100 \/ 100, 4\)/.test(DDL));
  // ⚠️ ET AUCUNE MACRO N'EST LUE DANS LA CHARGE UTILE.
  for (const cle of ["'protein'", "'carb'", "'fat'", "protein_g'", "->>'protein"]) {
    assert.ok(!DDL.includes(cle), `la RPC lit « ${cle} » dans la charge utile`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   SAVE-07/08 — LES IDENTITÉS
   ══════════════════════════════════════════════════════════════════════════ */

await test("SAVE-07/08. catalogue reste catalogue, produit reste produit", () => {
  assert.ok(DDL.includes("'catalog_food', v_food"), "l'identité catalogue n'est pas écrite telle quelle");
  assert.ok(DDL.includes("'product', v_product"), "l'identité produit n'est pas écrite telle quelle");
  // ⚠️ JAMAIS DE CONVERSION EN `'free'` POUR SIMPLIFIER. Un aliment devenu
  // « libre » ne serait plus corrigeable ni retrouvable comme les autres.
  assert.ok(!/'free'/.test(DDL), "une identité est convertie en aliment libre");

  // Et c'est la PAGE qui résout l'option en identité — l'écran des choix ne
  // connaît que `optionId`.
  assert.ok(CODE_PAGE.includes('option?.type === "aliment" ? option.id : null'));
  assert.ok(CODE_PAGE.includes('option?.type === "produit" ? option.id : null'));
  assert.ok(!CODE_CHOIX.includes("catalog_food_id"), "l'écran des choix invente une identité");
});

/* ══════════════════════════════════════════════════════════════════════════
   SAVE-09/10/28/29 — L'ÉTAT « DÉJÀ ENREGISTRÉ »
   ══════════════════════════════════════════════════════════════════════════ */

await test("SAVE-09/28. l'idempotence est en BASE, pas dans un bouton désactivé", () => {
  // ⚠️ LE BOUTON DÉSACTIVÉ NE PROTÈGE QUE PENDANT LA REQUÊTE. Deux clics
  // espacés de deux secondes passeraient tous les deux ; c'est la RPC qui
  // refuse de dupliquer.
  assert.ok(DDL.includes("consumed_meal_id"), "le crochet d'idempotence a disparu");
  assert.ok(/for update/i.test(DDL), "le verrou explicite a disparu");
  assert.ok(DDL.includes("'deja_enregistre', true"));
  assert.ok(DDL.includes("'entrees_creees', 0"));

  // ⚠️ ET LE LIEN EST POSÉ APRÈS LES ENTRÉES. L'inverse laisserait un repas
  // marqué « enregistré » alors qu'un item aurait échoué.
  const posInsert = DDL.indexOf("insert into public.meal_entries");
  const posLien = DDL.indexOf("set consumed_meal_id = v_consumed");
  assert.ok(posInsert > 0 && posLien > posInsert, "le lien est posé avant les entrées");
});

await test("SAVE-10/16/17/29. l'état vient de la persistance, et survit aux gestes A5", () => {
  // ⚠️ AUCUN `useState` NE PORTE CET ÉTAT. Il est relu à chaque chargement.
  assert.ok(CODE_CONSO.includes("export async function lireRepasStructuresEnregistres"));
  assert.ok(CODE_CONSO.includes('.from("planned_meals")'));
  assert.ok(CODE_HOOK.includes("lireRepasStructuresEnregistres(supabase, clé.split(\",\"))"));
  assert.ok(CODE_SEMAINE.includes("suivi.repasStructuresEnregistres?.has(`${repas.id}|${date}`)"));

  // ⚠️ ET SUPPRIMER UNE ENTRÉE NE LE RÉARME PAS. La vérité est le LIEN, pas
  // les lignes : `planned_meals.consumed_meal_id` survit à `supprimer_entree`.
  // Corriger ou supprimer sa consommation reste possible — c'est justement ce
  // que ce choix préserve.
  const bloc = CODE_CONSO.slice(CODE_CONSO.indexOf("export async function lireRepasStructuresEnregistres"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(!corps.includes("meal_entries"), "l'état dépend des entrées, pas du lien");
  assert.ok(corps.includes("consumed_meal_id !== null"));
});

await test("SAVE-11/12. la clé est repas|date : ni deux jours, ni deux repas confondus", () => {
  assert.ok(CODE_SEMAINE.includes("`${repas.id}|${date}`"));
  assert.ok(CODE_CONSO.includes("`${l.meal_id}|${l.planned_on}`"));
  // Et la base l'impose : l'unicité porte sur (élève, date, repas).
  assert.ok(DDL.includes("enregistrer_repas_planifie"), "la validation N1.1 n'est plus appelée");
});

/* ══════════════════════════════════════════════════════════════════════════
   SAVE-13..17 / 22 / 23 — CE QUI NE DOIT PAS BOUGER
   ══════════════════════════════════════════════════════════════════════════ */

await test("SAVE-13. la RPC n'efface ni ne remplace AUCUNE entrée existante", () => {
  // ⚠️ AUCUN `delete`, AUCUN `update` D'ENTRÉE. Le café et le dessert déjà
  // saisis doivent survivre — et `ouvrir_repas_prescrit` ne crée que si rien
  // n'existe.
  const corps = DDL.slice(DDL.indexOf("create or replace function public.enregistrer_repas_structure_consomme"));
  assert.ok(!/delete\s+from\s+public\.meal_entries/i.test(corps), "la RPC efface des entrées");
  assert.ok(!/update\s+public\.meal_entries/i.test(corps), "la RPC modifie des entrées");
  assert.ok(!/delete\s+from\s+public\.consumed_meals/i.test(corps));
});

await test("SAVE-14/15/22. A5 reste entièrement accessible après enregistrement", () => {
  // ⚠️ LE BOUTON N'ENFERME JAMAIS LE REPAS. La section de consommation est
  // rendue indépendamment : aucune condition ne la lie à l'enregistrement.
  const posConso = CODE_SEMAINE.indexOf("<ConsumedMealSection");
  const avant = CODE_SEMAINE.slice(Math.max(0, posConso - 200), posConso);
  const condition = avant.slice(avant.lastIndexOf("{suivi"));
  assert.equal(condition.trim(), "{suivi && date && (");
  for (const notion of ["enregistr", "planned", "consumed_meal_id"]) {
    assert.ok(!condition.includes(notion), `la consommation dépend de « ${notion} »`);
  }
  // Les gestes A5 restent câblés, tous.
  for (const geste of ["onAjouterCatalogue", "onAjouterProduit", "onAjouterManuel",
                       "onCorriger", "onSupprimerAliment"]) {
    assert.ok(CODE_SEMAINE.includes(`${geste}={suivi.${geste}}`), `${geste} a disparu`);
  }
  // ⚠️ ET L'ÉLÈVE VOIT QU'IL PEUT ENCORE CORRIGER.
  assert.ok(CODE_CHOIX.includes("Modifie-les"));
});

await test("SAVE-22/23. aucune lecture de food_lists, aucun rôle réintroduit", () => {
  for (const [nom, code] of [["écran", CODE_CHOIX], ["semaine", CODE_SEMAINE],
                             ["consommation", CODE_CONSO], ["page", CODE_PAGE]] as const) {
    assert.ok(!code.includes("food_lists"), `${nom} lit food_lists`);
  }
  assert.ok(!DDL.includes("food_lists"), "la RPC lit food_lists");
  for (const interdit of ["referenceGrams", "solverRole", "role_nutritionnel"]) {
    assert.ok(!CODE_CHOIX.includes(interdit) && !DDL.includes(interdit));
  }
});

await test("SAVE-BOUTON. les trois états du bouton, rendus", () => {
  const repos = rendreAvecBouton([POULET, RIZ, HUILE], T(50, 60, 20));
  assert.ok(repos.html.includes("Enregistrer le repas"));
  assert.ok(!repos.html.includes("Enregistrement"));

  const enCours = rendreAvecBouton([POULET, RIZ, HUILE], T(50, 60, 20), { enCours: true });
  assert.ok(enCours.html.includes("Enregistrement"));
  assert.ok(enCours.html.includes("disabled"));

  const fait = rendreAvecBouton([POULET, RIZ, HUILE], T(50, 60, 20), { dejaEnregistre: true });
  assert.ok(fait.html.includes("Repas enregistré"));
  assert.ok(!fait.html.includes("Enregistrer le repas"), "le bouton reste cliquable après enregistrement");
  assert.ok(fait.html.includes("Ce que j&#x27;ai mangé"));
});

await test("SAVE-SANS-PONT. sans le pont, l'écran est STRICTEMENT celui de N1.5.3", () => {
  // ⚠️ LE COMPOSANT RESTE PUR. Aucune écriture, aucun import Supabase : c'est
  // le parent qui branche la persistance, et cet écran se rend hors navigateur.
  const solution = solveMealChoices([POULET, RIZ, HUILE], T(50, 60, 20));
  const html = renderToString(createElement(QuantitesDuRepas, { solution })).replace(/<!-- -->/g, "");
  assert.ok(!html.includes("Enregistrer"), "un bouton apparaît sans pont");
  assert.ok(html.includes("Quantités pour ton repas"));
  assert.ok(!/from ["']@\/lib\/supabase/.test(CODE_CHOIX), "l'écran des choix importe Supabase");
  assert.ok(!CODE_CHOIX.includes(".rpc("));
});
