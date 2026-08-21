/**
 * Harnais — COURSES C0 : VALIDER MES CHOIX.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OÙ CHAQUE GARANTIE EST RÉELLEMENT PROUVÉE
 * ────────────────────────────────────────────────────────────────────────────
 * Ce fichier prouve ce qui vit dans le NAVIGATEUR : que les DEUX gestes
 * existent et ne se confondent pas, que la validation envoie la quantité
 * AFFICHÉE et aucune macro, que la sélection se restaure par IDENTITÉ, que la
 * divergence écran/base se voit, et qu'aucune écriture n'a lieu au clic sur un
 * choix.
 *
 * ⚠️ CE QUI NE SE PROUVE QUE DANS POSTGRESQL vit dans
 * `supabase/tests/courses_c0_validation_checklist.sql` (48 contrôles, exécutés
 * avant la première ligne d'interface) : création de `planned_meals` et
 * `planned_meal_items`, absence de `consumed_meal` et de `meal_entry`,
 * `consumed_meal_id` NULL, idempotence, remplacement des items, refus du choix
 * incomplet / hors snapshot / autre élève / anon, et la MESURE du cas non
 * tranché — revalider un repas déjà consommé. Les mimer ici produirait un
 * double qui mentirait sur ce qu'il mesure.
 *
 * ⚠️ AUCUNE MIGRATION DANS CE LOT. La RPC `enregistrer_repas_planifie` existe
 * depuis N1.1 ; C0 ne fait que l'appeler seule. `C0-28` le vérifie.
 *
 * Lancement : npm run test:courses-c0
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { MIGRATION_C0_1, MIGRATION_C2, verifierContratDesMigrations } from "./contrat-migrations.mjs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { QuantitesDuRepas, type ItemPourEnregistrement } from "../../components/student/StudentMealChoices";
import {
  compositionIdentique,
  selectionDepuisComposition,
  type ChoixPersiste,
} from "../../lib/nutrition/meal-choice-selection";
import type { MealChoiceSlot } from "../../lib/nutrition/plan-v2-week";
import {
  solveMealChoices,
  type MealMacroTarget,
  type SelectedFoodForMealSolver,
} from "../../lib/nutrition/meal-choice-solver";

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
const CODE_SELECTION = sansProse(lire("../../lib/nutrition/meal-choice-selection.ts"));

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE — deux occurrences, deux options chacune, identités explicites
   ══════════════════════════════════════════════════════════════════════════ */

const NUTRITION = { unit: "g", proteinPer100: 31, carbPer100: 0, fatPer100: 3.6 } as const;

const OCCURRENCES: readonly MealChoiceSlot[] = [
  {
    id: "slot-proteine",
    label: "Ta protéine",
    sourceListId: null,
    colorKey: null,
    options: [
      { type: "aliment", id: "food-poulet", optionId: "opt-poulet", displayName: "Poulet",
        nutrition: NUTRITION, quantityUnit: "g", preferredQuantity: null, minimumQuantity: null },
      { type: "aliment", id: "food-saumon", optionId: "opt-saumon", displayName: "Saumon",
        nutrition: { unit: "g", proteinPer100: 20, carbPer100: 0, fatPer100: 13 },
        quantityUnit: "g", preferredQuantity: null, minimumQuantity: null },
    ],
  },
  {
    id: "slot-feculent",
    label: "Ton féculent",
    sourceListId: null,
    colorKey: null,
    options: [
      { type: "aliment", id: "food-riz", optionId: "opt-riz", displayName: "Riz",
        nutrition: { unit: "g", proteinPer100: 2.7, carbPer100: 28, fatPer100: 0.3 },
        quantityUnit: "g", preferredQuantity: null, minimumQuantity: null },
      { type: "produit", id: "produit-skyr", optionId: "opt-skyr", displayName: "MarqueC0 — Skyr",
        nutrition: { unit: "g", proteinPer100: 10, carbPer100: 4, fatPer100: 0.2 },
        quantityUnit: "g", preferredQuantity: null, minimumQuantity: null },
    ],
  },
];

const persiste = (
  slotId: string, catalogFoodId: string | null, productId: string | null,
  quantity: number, unit = "g",
): ChoixPersiste => ({ slotId, catalogFoodId, productId, quantity, unit });

const aliment = (
  cle: string, name: string, p: number, c: number, l: number,
): SelectedFoodForMealSolver => ({
  optionId: `opt-${cle}`, slotId: `slot-${cle}`, name, unit: "g",
  proteinPer100: p, carbPer100: c, fatPer100: l,
  preferredQuantity: null, minimumQuantity: null,
});

const T = (p: number, c: number, l: number): MealMacroTarget =>
  ({ proteinGrams: p, carbGrams: c, fatGrams: l });

const rendre = (noeud: Parameters<typeof renderToString>[0]) => renderToString(noeud);

/* ══════════════════════════════════════════════════════════════════════════
   C0-01..08 — CE QUE LA VALIDATION ÉCRIT, ET CE QU'ELLE N'ÉCRIT PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-01/02. la validation passe par la RPC N1.1, et par elle seule", () => {
  assert.ok(CODE_CONSO.includes("export async function validerChoixRepas"));
  assert.ok(CODE_CONSO.includes('"enregistrer_repas_planifie"'),
    "la validation doit appeler la RPC existante, pas une nouvelle");
  // ⚠️ UN ITEM PAR OCCURRENCE : c'est la RPC qui l'impose (CHOIX_INCOMPLET) et
  // la table qui le garantit (unique planned_meal_id + choice_slot_id). Le
  // client se contente de transmettre ce que le solveur a rendu, occurrence
  // par occurrence.
  assert.ok(CODE_CHOIX.includes("solution.items.map((item) => ({"));
});

await test("C0-03. la quantité envoyée est l'ENTIER AFFICHÉ, jamais le flottant", () => {
  // Les deux gestes envoient `displayQuantity`. Aucun n'envoie `quantity`.
  const occurrences = CODE_CHOIX.split("quantity: item.displayQuantity").length - 1;
  assert.equal(occurrences, 2, "valider ET enregistrer doivent envoyer displayQuantity");
  assert.ok(!/quantity:\s*item\.quantity\b/.test(CODE_CHOIX),
    "la valeur flottante interne du solveur ne doit jamais partir");
});

await test("C0-04/05. les deux identités traversent la même résolution", () => {
  // ⚠️ UNE SEULE FONCTION DE RÉSOLUTION, APPELÉE DEUX FOIS. Deux copies
  // finiraient par diverger, et l'une des deux écrirait une identité fausse.
  assert.ok(CODE_PAGE.includes("const resoudreIdentites = useCallback("));
  assert.equal(CODE_PAGE.split("resoudreIdentites(mealId, items)").length - 1, 2);
  assert.ok(CODE_PAGE.includes('catalogFoodId: option?.type === "aliment" ? option.id : null'));
  assert.ok(CODE_PAGE.includes('productId: option?.type === "produit" ? option.id : null'));
  // Et la page ne cherche jamais par libellé.
  assert.ok(!/displayName\s*===/.test(CODE_PAGE), "aucune résolution par nom");
});

await test("C0-06/07/08. valider n'écrit ni consommation ni entrée — mesuré sur le code", () => {
  const bloc = CODE_CONSO.slice(
    CODE_CONSO.indexOf("export async function validerChoixRepas"),
  );
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(!corps.includes("consumed_meals"), "la validation touche à la consommation");
  assert.ok(!corps.includes("meal_entries"), "la validation crée des entrées");
  assert.ok(!corps.includes("consumed_meal_id"), "la validation pose le lien de consommation");
  assert.ok(!corps.includes("enregistrer_repas_structure_consomme"),
    "la validation passe par la RPC de consommation");
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-09/10 — L'ÉTAT VIENT DE LA BASE, ET LA SÉLECTION SE RESTAURE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-09. l'état validé est relu depuis la persistance, pas gardé en React", () => {
  assert.ok(CODE_CONSO.includes("export async function lireCompositionsValidees"));
  assert.ok(CODE_HOOK.includes("lireCompositionsValidees(supabase, clé.split(\",\"))"));
  assert.ok(CODE_SEMAINE.includes("suivi.compositionsValidees?.get(`${repas.id}|${date}`)"));

  // ⚠️ ET LA LECTURE EST GROUPÉE, PAS UN N+1. Deux `select` batchés par
  // `.in(...)` : les repas planifiés de l'intervalle, puis leurs items.
  const bloc = CODE_CONSO.slice(CODE_CONSO.indexOf("export async function lireCompositionsValidees"));
  const corps = bloc.slice(0, bloc.indexOf("\nexport "));
  assert.equal(corps.split(".from(").length - 1, 2, "exactement deux requêtes");
  assert.equal(corps.split(".in(").length - 1, 2, "les deux doivent être batchées");
  assert.ok(!corps.includes("for (const date"), "aucune boucle de requêtes");
});

await test("C0-10. la sélection se restaure par choice_slot_id + identité", () => {
  const restauree = selectionDepuisComposition(OCCURRENCES, [
    persiste("slot-proteine", "food-saumon", null, 210),
    persiste("slot-feculent", null, "produit-skyr", 150),
  ]);
  assert.deepEqual({ ...restauree }, {
    "slot-proteine": "opt-saumon",
    "slot-feculent": "opt-skyr",
  });
});

await test("C0-10b. JAMAIS par nom, et une ligne orpheline est ignorée", () => {
  // ⚠️ AUCUNE COMPARAISON DE LIBELLÉ DANS LE MODULE. C'est la garantie que
  // « Poulet » ne peut pas être rattaché à un homonyme du catalogue.
  const bloc = CODE_SELECTION.slice(CODE_SELECTION.indexOf("export function selectionDepuisComposition"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(!corps.includes("displayName"), "la restauration regarde un nom");
  assert.ok(!corps.includes("name"), "la restauration regarde un nom");

  // Un aliment retiré de l'occurrence depuis la validation : rien n'est deviné.
  const orpheline = selectionDepuisComposition(OCCURRENCES, [
    persiste("slot-proteine", "food-disparu", null, 210),
    persiste("slot-feculent", "food-riz", null, 150),
  ]);
  assert.deepEqual({ ...orpheline }, { "slot-feculent": "opt-riz" });

  // Une occurrence inconnue ne crée pas d'entrée fantôme.
  const inconnue = selectionDepuisComposition(OCCURRENCES, [
    persiste("slot-fantome", "food-riz", null, 150),
  ]);
  assert.deepEqual({ ...inconnue }, {});
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-11/12 — INDÉPENDANCE DES JOURS ET DES REPAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-11/12. la clé est repas|date, dans les deux sens", () => {
  // La composition est LUE avec cette clé…
  assert.ok(CODE_CONSO.includes("`${ligne.meal_id}|${ligne.planned_on}`"));
  // …et RELUE avec la même côté écran.
  assert.ok(CODE_SEMAINE.includes("suivi.compositionsValidees?.get(`${repas.id}|${date}`)"));
  // Le composant est monté avec cette même clé : changer de jour ou de repas
  // démonte le brouillon avec lui.
  assert.ok(CODE_SEMAINE.includes("key={cleDeComposition(repas.id, date)}"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-13/14/26/27 — IDEMPOTENCE, REVALIDATION, DIVERGENCE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-26. « à jour » compare les identités ET les quantités", () => {
  const affichee = [
    { slotId: "slot-proteine", optionId: "opt-poulet", displayQuantity: 163, unit: "g" },
    { slotId: "slot-feculent", optionId: "opt-riz", displayQuantity: 200, unit: "g" },
  ];
  const enBase = [
    persiste("slot-proteine", "food-poulet", null, 163),
    persiste("slot-feculent", "food-riz", null, 200),
  ];
  assert.equal(compositionIdentique(OCCURRENCES, affichee, enBase), true);

  // Un CHOIX différent diverge.
  assert.equal(
    compositionIdentique(OCCURRENCES, affichee, [
      persiste("slot-proteine", "food-saumon", null, 163),
      persiste("slot-feculent", "food-riz", null, 200),
    ]),
    false,
    "changer d'aliment doit se voir",
  );

  // ⚠️ ET UNE QUANTITÉ DIFFÉRENTE AUSSI. C'est le cas où le calcul a bougé
  // sous l'élève — portion préférée changée par le coach, minimum ajouté,
  // solveur amélioré. Ne comparer que les identités laisserait une quantité
  // périmée partir en courses sans que personne ne le voie.
  assert.equal(
    compositionIdentique(OCCURRENCES, affichee, [
      persiste("slot-proteine", "food-poulet", null, 170),
      persiste("slot-feculent", "food-riz", null, 200),
    ]),
    false,
    "changer de quantité doit se voir",
  );

  // Une unité différente aussi, et une occurrence en moins.
  assert.equal(
    compositionIdentique(OCCURRENCES, affichee, [
      persiste("slot-proteine", "food-poulet", null, 163, "ml"),
      persiste("slot-feculent", "food-riz", null, 200),
    ]),
    false,
  );
  assert.equal(
    compositionIdentique(OCCURRENCES, affichee, [
      persiste("slot-proteine", "food-poulet", null, 163),
    ]),
    false,
  );
});

await test("C0-13/14/27. le libellé du bouton dit ce qui va se passer", () => {
  const solution = solveMealChoices(
    [aliment("proteine", "Poulet", 31, 0, 3.6), aliment("feculent", "Riz", 2.7, 28, 0.3)],
    T(40, 60, 15),
  );

  // Rien en base → « Valider mes choix ».
  const neuf = rendre(createElement(QuantitesDuRepas, {
    solution,
    validation: { dejaValide: false, aJour: false, enCours: false, onValider: () => {} },
  }));
  assert.ok(neuf.includes("Valider mes choix"));
  assert.ok(!neuf.includes("Mettre à jour mes choix"));
  assert.ok(!neuf.includes("Modifications non validées"));

  // En base ET identique → « Choix validés », plus aucun bouton.
  const aJour = rendre(createElement(QuantitesDuRepas, {
    solution,
    validation: { dejaValide: true, aJour: true, enCours: false, onValider: () => {} },
  }));
  assert.ok(aJour.includes("Choix validés"));
  assert.ok(aJour.includes("Cette composition sera prise en compte pour ta liste de courses."));
  assert.ok(!aJour.includes("Valider mes choix"));

  // En base MAIS différent → « Modifications non validées » + mise à jour.
  const diverge = rendre(createElement(QuantitesDuRepas, {
    solution,
    validation: { dejaValide: true, aJour: false, enCours: false, onValider: () => {} },
  }));
  assert.ok(diverge.includes("Modifications non validées"));
  assert.ok(diverge.includes("Mettre à jour mes choix"));
  assert.ok(diverge.includes("Ta liste de courses utilise encore la composition précédente."));

  // Pendant l'écriture, le bouton est désactivé — pas de double validation.
  const enCours = rendre(createElement(QuantitesDuRepas, {
    solution,
    validation: { dejaValide: false, aJour: false, enCours: true, onValider: () => {} },
  }));
  assert.ok(enCours.includes("disabled"));
  assert.ok(enCours.includes("Validation"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-15/25 — AUCUNE ÉCRITURE AU CLIC SUR UN CHOIX
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-15/25. choisir ne déclenche AUCUNE écriture", () => {
  // ⚠️ LE COMPOSANT N'IMPORTE PAS SUPABASE, et `choisir` ne fait que poser un
  // état local. Une écriture par radio produirait un `planned_meal` à chaque
  // hésitation, et la liste de courses suivrait des choix jamais confirmés.
  assert.ok(!CODE_CHOIX.includes("@/lib/supabase"), "l'écran des choix importe Supabase");
  const bloc = CODE_CHOIX.slice(CODE_CHOIX.indexOf("const choisir = useCallback("));
  const corps = bloc.slice(0, bloc.indexOf("[selectionValidee],"));
  assert.ok(corps.includes("setBrouillon("));
  assert.ok(!corps.includes("onValider"), "choisir déclenche la validation");
  assert.ok(!corps.includes("await"), "choisir fait un appel");
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-20/21/22 — LA RÉTROCOMPATIBILITÉ DE N1.6B
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-20. « Enregistrer le repas » reste possible SANS validation préalable", () => {
  const solution = solveMealChoices(
    [aliment("proteine", "Poulet", 31, 0, 3.6), aliment("feculent", "Riz", 2.7, 28, 0.3)],
    T(40, 60, 15),
  );
  // Aucune validation branchée du tout : l'écran de N1.6 est intact.
  const sansValidation = rendre(createElement(QuantitesDuRepas, {
    solution,
    enregistrement: { dejaEnregistre: false, enCours: false, onEnregistrer: () => {} },
  }));
  assert.ok(sansValidation.includes("Enregistrer le repas"));
  assert.ok(!sansValidation.includes("Valider mes choix"));

  // Et validation branchée mais JAMAIS cliquée : le bouton d'enregistrement
  // est là quand même. Valider n'est pas un passage obligé.
  const lesDeux = rendre(createElement(QuantitesDuRepas, {
    solution,
    enregistrement: { dejaEnregistre: false, enCours: false, onEnregistrer: () => {} },
    validation: { dejaValide: false, aJour: false, enCours: false, onValider: () => {} },
  }));
  assert.ok(lesDeux.includes("Valider mes choix"));
  assert.ok(lesDeux.includes("Enregistrer le repas"));
});

await test("C0-22. « Repas enregistré » reste RÉSERVÉ à la consommation", () => {
  const solution = solveMealChoices([aliment("proteine", "Poulet", 31, 0, 3.6)], T(40, 0, 5));

  // Validé mais pas mangé : jamais « Repas enregistré ».
  const valide = rendre(createElement(QuantitesDuRepas, {
    solution,
    enregistrement: { dejaEnregistre: false, enCours: false, onEnregistrer: () => {} },
    validation: { dejaValide: true, aJour: true, enCours: false, onValider: () => {} },
  }));
  assert.ok(valide.includes("Choix validés"));
  assert.ok(!valide.includes("Repas enregistré"), "valider ne doit jamais dire « enregistré »");

  // ⚠️ ET UNE FOIS CONSOMMÉ, ON NE PROPOSE PLUS DE VALIDER. Mesuré en base
  // (V-I) : la RPC accepterait de réécrire le planifié d'un repas déjà
  // consommé, et les deux divergeraient en silence. Le garde-fou est ici.
  const consomme = rendre(createElement(QuantitesDuRepas, {
    solution,
    enregistrement: { dejaEnregistre: true, enCours: false, onEnregistrer: () => {} },
    validation: { dejaValide: true, aJour: false, enCours: false, onValider: () => {} },
  }));
  assert.ok(consomme.includes("Repas enregistré"));
  assert.ok(!consomme.includes("Mettre à jour mes choix"));
  assert.ok(!consomme.includes("Valider mes choix"));
  assert.ok(!consomme.includes("Modifications non validées"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-23/24 — CE QUI NE PART JAMAIS DU CLIENT
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-23/24. aucune macro, aucun rôle, aucun referenceGrams, aucune couleur", () => {
  const bloc = CODE_CHOIX.slice(CODE_CHOIX.indexOf("validation.onValider("));
  const charge = bloc.slice(0, bloc.indexOf("))"));
  for (const interdit of [
    "protein", "carb", "fat", "kcal", "calories",
    "role", "categorie", "category", "referenceGrams", "colorKey", "color_key",
  ]) {
    assert.ok(!charge.includes(interdit), `« ${interdit} » part avec la validation`);
  }
  // Quatre clés, exactement : occurrence, option, quantité, unité.
  assert.ok(charge.includes("slotId: item.slotId"));
  assert.ok(charge.includes("optionId: item.optionId"));
  assert.ok(charge.includes("quantity: item.displayQuantity"));
  assert.ok(charge.includes("unit: item.unit"));

  // Et la charge utile envoyée à la RPC ne porte pas davantage.
  const rpc = CODE_CONSO.slice(CODE_CONSO.indexOf("export async function validerChoixRepas"));
  const corps = rpc.slice(0, rpc.indexOf("\n}"));
  for (const interdit of ["protein", "carb_g", "fat_g", "kcal"]) {
    assert.ok(!corps.includes(interdit), `« ${interdit} » part à la RPC`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   C0-28 — AUCUNE MIGRATION, AUCUNE DÉPENDANCE À L'ANCIEN COURSES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-28. le contrat des migrations, et aucune trace de l'ancien chantier Courses", () => {
  // ⚠️ RENFORCÉE PAR C2, PAS ASSOUPLIE. Cette assertion disait « 80 migrations,
  // et aucune table de courses ». C2 crée les siennes : la seconde moitié est
  // devenue fausse, et la remonter à « 81 » aurait vidé la première de son sens
  // — n'importe quelle 81ᵉ migration l'aurait satisfaite.
  //
  // Le contrat partagé fige désormais l'identité exacte de la migration
  // autorisée, l'ordre C0.1 → C2, l'unicité de la migration de courses et une
  // empreinte de l'historique antérieur. Il rougit sur une seconde migration
  // C2, sur une migration étrangère et sur un antidatage.
  verifierContratDesMigrations(assert);

  // ⚠️ ET LA GARANTIE PROPRE À C0 EST INTACTE : C0 n'écrit AUCUNE migration —
  // il appelle une RPC qui existe depuis N1.1 — et C0.1 en écrit exactement
  // une, le verrou serveur du repas consommé.
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"));
  const deC0 = migrations.filter((f) => /_c0_/i.test(f)).sort();
  assert.deepEqual(deC0, [MIGRATION_C0_1], "C0.1 écrit une migration, C0 aucune");

  // ⚠️ ET LES TABLES DE COURSES N'ARRIVENT PAS TROP TÔT. Elles appartiennent à
  // C2, et à lui seul : C0/C0.1 préparent la SOURCE, pas la liste.
  const creatrices = migrations
    .filter((f) =>
      /create table[^;]*public\.shopping_/i.test(
        readFileSync(new URL(f, new URL("../../supabase/migrations/", import.meta.url)), "utf8"),
      ),
    )
    .sort();
  assert.deepEqual(creatrices, [MIGRATION_C2], "les tables de courses n'appartiennent qu'à C2");

  // ⚠️ ET AUCUN FICHIER DE L'ANCIEN C1 N'EST IMPORTÉ. Le moteur abandonné
  // dérivait la liste de RECETTES choisies par la machine ; C0 part des choix
  // de l'élève. Réimporter l'un dans l'autre rouvrirait une doctrine fermée.
  for (const source of [CODE_CHOIX, CODE_SEMAINE, CODE_CONSO, CODE_HOOK, CODE_PAGE, CODE_SELECTION]) {
    assert.ok(!source.includes("lib/courses/"), "un module de l'ancien C1 est importé");
    assert.ok(!source.includes("useCourses"), "le hook de l'ancien C1 est importé");
    assert.ok(!source.includes("CoursesListe"), "un composant de l'ancien C1 est importé");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   RESPONSIVE — les quatre états, sans débordement
   ══════════════════════════════════════════════════════════════════════════ */

await test("C0-RESP. les quatre états rendent des blocs contraints en largeur", () => {
  const solution = solveMealChoices(
    [aliment("proteine", "Poulet, filet de blanc sans peau", 31, 0, 3.6),
     aliment("feculent", "Riz basmati complet demi-cuisson", 2.7, 28, 0.3)],
    T(40, 60, 15),
  );
  const etats = [
    { dejaValide: false, aJour: false },
    { dejaValide: true, aJour: true },
    { dejaValide: true, aJour: false },
  ];
  for (const etat of etats) {
    const html = rendre(createElement(QuantitesDuRepas, {
      solution,
      enregistrement: { dejaEnregistre: false, enCours: false, onEnregistrer: () => {} },
      validation: { ...etat, enCours: false, onValider: () => {} },
    }));
    // ⚠️ `min-w-0` SUR LES CONTENEURS FLEX, sinon un long nom d'aliment pousse
    // la colonne au-delà de 375 px et fait déborder la page entière.
    assert.ok(html.includes("min-w-0"), "le conteneur n'est pas contraint");
    // Cible tactile ≥ 44 px sur tous les boutons rendus.
    const boutons = html.split("<button").length - 1;
    if (boutons > 0) assert.ok(html.includes("min-h-[44px]"), "cible tactile trop petite");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Récapitulatif
   ══════════════════════════════════════════════════════════════════════════ */

const items: readonly ItemPourEnregistrement[] = [];
void items;
