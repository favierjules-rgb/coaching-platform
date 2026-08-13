/**
 * Harnais — ALIMENTS A2, CONSOMMATION PAR REPAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il prouve le RENDU (React rendu côté serveur) et les MODULES PURS, et il
 * vérifie que chacun des seize contrats A2-DB est bien démontré par des
 * contrôles EXÉCUTÉS dans supabase/tests/aliments_a2_checklist.sql.
 *
 * Il ne prouve PAS le comportement de PostgreSQL : aucun test statique ne peut
 * décider si un `revoke` mord réellement, si une contrainte refuse une ligne,
 * ou si une RPC calcule le bon instantané. Cette preuve-là est faite par la
 * checklist SQL, sur une base reconstruite baseline → toutes les migrations,
 * avec des contrôles négatifs qui la font rougir quand on casse la règle.
 *
 * Les deux sont donc complémentaires, et ce fichier le dit plutôt que de
 * laisser croire qu'un `assert` sur du texte vaut une exécution.
 *
 * Lancement : npm run test:aliments-a2
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { AddFoodSheet } from "../../components/student/AddFoodSheet";
import { ConsumedFoodBar } from "../../components/student/ConsumedFoodBar";
import { ConsumedFoodDetailSheet } from "../../components/student/ConsumedFoodDetailSheet";
import { DailyIntakeSummary } from "../../components/student/DailyIntakeSummary";
import {
  ConsumedMealSection,
  StudentMealCard,
} from "../../components/student/ConsumedMealSection";
import {
  StudentPrescribedWeek,
  type SuiviConsommation,
} from "../../components/student/StudentPrescribedWeek";
import {
  type ConsumedEntry,
  type ConsumedMeal,
  entryKcal,
  kcalFromMacros,
  prescribedConsumedMeal,
  studentMealsForDate,
  totalsForDay,
  totalsForMeal,
} from "../../lib/nutrition/consumed";
import { formatIntegerFr } from "../../lib/nutrition/basis-points";
import type { PlanV2Week } from "../../lib/nutrition/plan-v2-week";

const MIGRATION = "20260901090000_consumed_meals.sql";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
const migration = lire(`../../supabase/migrations/${MIGRATION}`);
const checklist = lire("../../supabase/tests/aliments_a2_checklist.sql");

/**
 * « Ce contrat est-il démontré par des contrôles EXÉCUTÉS ? »
 *
 * On exige au moins `minimum` contrôles portant le numéro, ET la présence des
 * marqueurs SQL qui matérialisent la règle dans la migration. Le second point
 * évite le piège inverse : une checklist verte qui éprouverait une règle que
 * la migration n'applique plus.
 */
function contratCouvert(numéro: string, marqueurs: readonly string[], minimum = 1): void {
  const contrôles = checklist.split(`noter('${numéro}',`).length - 1;
  assert.ok(
    contrôles >= minimum,
    `${numéro} : ${contrôles} contrôle(s) dans la checklist SQL, ${minimum} attendu(s) au minimum`,
  );
  for (const marqueur of marqueurs) {
    assert.ok(
      migration.includes(marqueur),
      `${numéro} : la migration ${MIGRATION} ne contient pas « ${marqueur} »`,
    );
  }
}

/* ═══════════════════ A2-DB — LES SEIZE CONTRATS DE BASE ═══════════════════ */

await test("A2-DB1. l'élève peut créer / obtenir son repas de consommation prescrit", () => {
  contratCouvert(
    "A2-DB1",
    [
      "create or replace function public.ouvrir_repas_prescrit(",
      // « obtiens ou crée » : la relecture précède l'insertion…
      "if v_existant is not null then",
      // …et l'index unique partiel arbitre deux appels concurrents.
      "create unique index if not exists consumed_meals_prescribed_unique",
      "exception when unique_violation then",
    ],
    3,
  );
});

await test("A2-DB2. un repas prescrit est réellement lié à une prescription valide de CET élève", () => {
  contratCouvert(
    "A2-DB2",
    [
      // La chaîne meals → nutrition_days → nutrition_plans.student_id est le
      // seul contrôle qui rend le rattachement réel.
      "join public.nutrition_days d on d.id = m.nutrition_day_id",
      "join public.nutrition_plans p on p.id = d.plan_id",
      "and p.student_id = v_student",
      // Et l'instantané de cible en découle, à la convention de l'écran.
      "prescribed_meal_id uuid references public.meals (id) on delete set null",
    ],
    6,
  );
});

await test("A2-DB3. l'élève ne peut pas fabriquer un faux repas prescrit d'un autre élève", () => {
  contratCouvert("A2-DB3", ["REPAS_PRESCRIT_INACCESSIBLE", "v_student := public.current_student_id();"], 4);

  // Le point structurel : AUCUNE RPC d'écriture ne prend d'identifiant
  // d'élève. Il n'y a donc rien à falsifier — pas même en forgeant la requête.
  const signatures = migration.match(/create or replace function public\.\w+\(([\s\S]*?)\)\s*returns/g) ?? [];
  const rpcÉcriture = signatures.filter((s) =>
    /(ouvrir_repas_prescrit|creer_repas_eleve|renommer_repas_eleve|supprimer_repas_eleve|ajouter_aliment_catalogue|ajouter_aliment_manuel|modifier_quantite_entree|supprimer_entree)/.test(
      s,
    ),
  );
  assert.equal(rpcÉcriture.length, 8, "les huit RPC d'écriture doivent être présentes");
  for (const signature of rpcÉcriture) {
    assert.ok(
      !/p_student/.test(signature),
      `une RPC d'écriture accepte un identifiant d'élève : ${signature.slice(0, 80)}`,
    );
  }
});

await test("A2-DB4. l'élève peut créer un repas personnel, sans aucune cible coach", () => {
  contratCouvert(
    "A2-DB4",
    [
      "create or replace function public.creer_repas_eleve(",
      "constraint consumed_meals_student_has_no_target",
      "check (kind <> 'student' or (target_kcal is null and target_protein_g is null",
    ],
    4,
  );
});

await test("A2-DB5. l'élève ne modifie / ne supprime QUE son repas personnel", () => {
  contratCouvert(
    "A2-DB5",
    [
      "create or replace function public.renommer_repas_eleve(",
      "create or replace function public.supprimer_repas_eleve(",
      "REPAS_NON_MODIFIABLE",
      "REPAS_NON_SUPPRIMABLE",
    ],
    6,
  );
  // La clause `kind = 'student'` n'est pas décorative : c'est la règle produit,
  // et elle doit apparaître dans LES DEUX fonctions.
  const occurrences = migration.split("and kind = 'student'").length - 1;
  assert.ok(occurrences >= 2, `« and kind = 'student' » attendu deux fois, trouvé ${occurrences}`);
});

await test("A2-DB6. le coach ne peut pas modifier un repas d'élève", () => {
  contratCouvert(
    "A2-DB6",
    [
      // Le coach LIT — et rien de plus : sa policy est un SELECT.
      'create policy "consumed_meals_select_own_coach" on public.consumed_meals\n  for select to authenticated',
      "revoke all on table public.consumed_meals from authenticated;",
      "grant select on table public.consumed_meals to authenticated;",
    ],
    3,
  );
});

await test("A2-DB7. l'ajout d'un aliment calcule les macros CÔTÉ SERVEUR", () => {
  contratCouvert(
    "A2-DB7",
    [
      "create or replace function public.ajouter_aliment_catalogue(",
      "create or replace function public.ajouter_aliment_manuel(",
      // Le serveur charge la source lui-même…
      "from public.food_catalog f",
      // …et multiplie lui-même.
      "round(v_base * v_food.protein_per_100 / 100, 4)",
      "round(p_quantity * p_protein_per_100 / 100, 4)",
    ],
    2,
  );
});

await test("A2-DB8. 120 g donnent exactement l'instantané attendu", () => {
  contratCouvert("A2-DB8", ["quantite_en_base_nutritionnelle"], 2);

  // Le calcul attendu, refait ici à la main sur la banane du catalogue de test
  // (1,1 / 22,8 / 0,3 pour 100 g) : c'est la valeur que la checklist SQL
  // vérifie côté serveur, et elle doit être la même des deux côtés.
  const pour100 = { p: 1.1, g: 22.8, l: 0.3 };
  const facteur = 120 / 100;
  assert.equal(Number((pour100.p * facteur).toFixed(2)), 1.32);
  assert.equal(Number((pour100.g * facteur).toFixed(2)), 27.36);
  assert.equal(Number((pour100.l * facteur).toFixed(2)), 0.36);
  assert.ok(
    checklist.includes("1,32 / 27,36 / 0,36"),
    "la checklist SQL doit éprouver ces valeurs exactes",
  );

  // Et le 4/4/9 du module partagé rend bien les mêmes kcal.
  assert.equal(Number(kcalFromMacros(1.32, 27.36, 0.36).toFixed(2)), 117.96);
});

await test("A2-DB9. l'édition 120 → 150 g recalcule l'instantané", () => {
  contratCouvert(
    "A2-DB9",
    [
      "create or replace function public.modifier_quantite_entree(",
      // Pour un aliment du catalogue, le serveur RECHARGE la source.
      "select f.nutrition_unit, f.piece_weight_g,",
      "update public.meal_entries",
    ],
    2,
  );
  const facteur = 150 / 100;
  assert.equal(Number((1.1 * facteur).toFixed(2)), 1.65);
  assert.equal(Number((22.8 * facteur).toFixed(2)), 34.2);
  assert.equal(Number((0.3 * facteur).toFixed(2)), 0.45);
  assert.ok(
    checklist.includes("1,65 / 34,20 / 0,45"),
    "la checklist SQL doit éprouver la correction 120 → 150 g",
  );
});

await test("A2-DB10. une modification ultérieure de food_catalog ne change pas une entrée déjà saisie", () => {
  contratCouvert("A2-DB10", [], 2);

  // Le retrait du déclencheur de gel appartient à A1 : c'est là qu'il a été
  // posé puis supprimé. On l'assère donc contre A1 — et on vérifie ci-dessous
  // qu'A2 n'en réintroduit aucun d'aucune sorte.
  const a1 = lire("../../supabase/migrations/20260831090000_food_catalog_and_meal_entries.sql");
  assert.ok(
    a1.includes("drop trigger if exists meal_entries_freeze_snapshot"),
    "A1 doit toujours retirer le déclencheur de gel",
  );
  assert.ok(
    !migration.includes("meal_entries_freeze_snapshot()"),
    "A2 ne doit pas ressusciter la fonction de gel",
  );

  // Il n'existe AUCUN déclencheur, AUCUNE vue matérialisée, AUCUNE colonne
  // générée qui relierait une entrée à sa source après coup. Le seul
  // déclencheur admis sur meal_entries est l'horodatage.
  assert.ok(
    !/create trigger[\s\S]{0,200}on public\.food_catalog/.test(migration),
    "aucun déclencheur ne doit propager food_catalog vers meal_entries",
  );
  assert.ok(
    !migration.includes("generated always as"),
    "aucune colonne générée ne doit recalculer un instantané",
  );
});

await test("A2-DB11. la pièce ne fonctionne que si piece_weight_g existe", () => {
  contratCouvert(
    "A2-DB11",
    [
      "if p_unit = 'piece' then",
      "PIECE_UNIQUEMENT_EN_GRAMMES",
      "if p_piece_weight_g is null then",
      "PIECE_SANS_POIDS",
      "return p_quantity * p_piece_weight_g;",
    ],
    2,
  );

  // Et l'écran ne PROPOSE la pièce que dans ce cas : proposer un choix qui se
  // fait refuser serait une estimation cachée déguisée en liberté.
  const accès = lire("../../lib/supabase/consumed-meals.ts");
  assert.ok(
    accès.includes('if (aliment.nutritionUnit === "g" && aliment.pieceWeightG !== null) unités.push("piece");'),
    "unitesAutorisees doit refléter exactement la règle serveur",
  );
});

await test("A2-DB12. une quantité inférieure ou égale à zéro est refusée", () => {
  contratCouvert(
    "A2-DB12",
    ["if p_quantity is null or p_quantity <= 0 then", "QUANTITE_INVALIDE"],
    2,
  );
  // Le refus vit à DEUX niveaux : la fonction de conversion, et la contrainte
  // CHECK de A1. Retirer l'un ne suffit donc pas à faire passer un zéro.
  const occurrences = migration.split("QUANTITE_INVALIDE").length - 1;
  assert.ok(occurrences >= 3, `QUANTITE_INVALIDE attendu au moins 3 fois, trouvé ${occurrences}`);
});

await test("A2-DB13. un aliment inaccessible ou archivé est refusé", () => {
  contratCouvert(
    "A2-DB13",
    [
      "and f.owner_coach_id is null",
      "and f.status = 'active'",
      "ALIMENT_INACCESSIBLE",
      "UNITE_INCOMPATIBLE",
    ],
    3,
  );
});

await test("A2-DB14. un élève ne peut pas injecter de macros arbitraires", () => {
  contratCouvert(
    "A2-DB14",
    [
      // LA ligne qui rend la règle réelle. Sans elle, PostgREST expose la
      // table et tout le calcul serveur n'est qu'une politesse.
      "revoke insert, update, delete on table public.meal_entries from authenticated;",
    ],
    6,
  );

  // Aucune RPC ne prend de macro FINALE. `ajouter_aliment_manuel` prend des
  // valeurs POUR 100 — la référence, jamais le résultat.
  for (const nom of ["ajouter_aliment_catalogue", "modifier_quantite_entree"]) {
    const début = migration.indexOf(`create or replace function public.${nom}(`);
    const signature = migration.slice(début, migration.indexOf(") returns", début));
    assert.ok(!/protein|carb|fat/.test(signature), `${nom} ne doit prendre aucune macro en paramètre`);
  }
  const débutManuel = migration.indexOf("create or replace function public.ajouter_aliment_manuel(");
  const signatureManuel = migration.slice(débutManuel, migration.indexOf(") returns", débutManuel));
  assert.match(signatureManuel, /p_protein_per_100/);
  assert.ok(
    !/p_protein_g\b/.test(signatureManuel),
    "l'aliment manuel ne doit jamais prendre les grammes consommés",
  );

  // Et le navigateur ne les envoie pas : la couche d'accès n'écrit nulle part.
  const accès = lire("../../lib/supabase/consumed-meals.ts");
  for (const interdit of [".insert(", ".update(", ".delete(", ".upsert("]) {
    assert.ok(
      !accès.includes(interdit),
      `lib/supabase/consumed-meals.ts ne doit contenir aucun ${interdit}`,
    );
  }
});

await test("A2-DB15. le total d'un repas est la somme de SES entrées", () => {
  contratCouvert("A2-DB15", [], 4);

  // Aucune colonne de total n'est stockée sur le conteneur : elle pourrait
  // diverger de ses entrées, et il faudrait alors décider laquelle fait foi.
  assert.ok(
    !/consumed_meals[\s\S]*?total_kcal|consumed_kcal/.test(migration),
    "consumed_meals ne doit porter aucun total stocké",
  );

  const repas = repasAvec([
    entrée({ id: "e1", proteinG: 1.32, carbG: 27.36, fatG: 0.36 }),
    entrée({ id: "e2", proteinG: 6, carbG: 30, fatG: 3.5 }),
  ]);
  const totaux = totalsForMeal(repas);
  assert.equal(Number(totaux.proteinG.toFixed(2)), 7.32);
  assert.equal(Number(totaux.carbG.toFixed(2)), 57.36);
  assert.equal(Number(totaux.fatG.toFixed(2)), 3.86);
  assert.equal(Number(totaux.kcal.toFixed(2)), Number(kcalFromMacros(7.32, 57.36, 3.86).toFixed(2)));

  // Un repas vidé compte zéro — jamais NULL, jamais « — ».
  assert.equal(totalsForMeal(repasAvec([])).kcal, 0);
});

await test("A2-DB16. le total d'une journée additionne repas prescrits ET repas élèves", () => {
  contratCouvert(
    "A2-DB16",
    [
      "create or replace function public.consommation_du_jour(",
      // Le SUJET est explicite : sans lui, la RLS coach fait additionner
      // plusieurs élèves dans un même « total de journée » (mesuré).
      "and m.student_id = coalesce(p_student_id, public.current_student_id());",
    ],
    5,
  );

  const journée = [
    repasAvec([entrée({ id: "a", proteinG: 2.64, carbG: 54.72, fatG: 0.72 })], {
      id: "prescrit",
      kind: "prescribed",
    }),
    repasAvec([entrée({ id: "b", proteinG: 6, carbG: 3, fatG: 15 })], {
      id: "libre",
      kind: "student",
    }),
  ];
  const totaux = totalsForDay(journée);
  assert.equal(Number(totaux.proteinG.toFixed(2)), 8.64);
  assert.equal(Number(totaux.carbG.toFixed(2)), 57.72);
  assert.equal(Number(totaux.fatG.toFixed(2)), 15.72);
  // La MÊME arithmétique que `consommation_du_jour` en base : 4/4/9.
  assert.equal(
    Number(totaux.kcal.toFixed(4)),
    Number((8.64 * 4 + 57.72 * 4 + 15.72 * 9).toFixed(4)),
  );
});

/* ═══════════════════════ FIXTURES DE RENDU ═══════════════════════ */

function entrée(partiel: Partial<ConsumedEntry> & { id: string }): ConsumedEntry {
  return {
    consumedMealId: "cm-1",
    sourceType: "catalog_food",
    foodId: "f-1",
    label: "Banane, crue",
    quantity: 120,
    unit: "g",
    proteinG: 1.32,
    carbG: 27.36,
    fatG: 0.36,
    note: "",
    // Horodatage FIXE : une heure tirée de `now()` rendrait le test
    // non reproductible d'une exécution à l'autre.
    createdAt: "2026-08-13T13:24:00.000Z",
    ...partiel,
  };
}

function repasAvec(
  entrées: readonly ConsumedEntry[],
  partiel: Partial<ConsumedMeal> = {},
): ConsumedMeal {
  return {
    id: "cm-1",
    consumedOn: "2026-08-13",
    kind: "prescribed",
    prescribedMealId: "meal-pdj",
    slotKey: "breakfast",
    label: "Petit-déjeuner",
    position: 0,
    target: { kcal: 500, proteinG: 30, carbG: 50, fatG: 15 },
    entries: entrées,
    ...partiel,
  };
}

const SEMAINE: PlanV2Week = {
  planId: "plan-1",
  profiles: [
    {
      profileKey: "default",
      dailyCalories: 2000,
      proteinBp: 3000,
      carbBp: 4000,
      fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 10000, carbBp: 10000, fatBp: 10000, displayOrder: 0 },
      ],
    },
  ],
  days: [
    {
      id: "day-lundi",
      day: "monday",
      profileKey: "default",
      status: "non-commence",
      meals: [
        {
          id: "meal-pdj",
          slot: "breakfast",
          name: "Petit-déjeuner costaud",
          // La respiration voulue par le coach : une ligne sans nom NI
          // quantité. C'est le correctif du chantier retours à la ligne.
          items: [
            { name: "PROTÉINES", quantity: "" },
            { name: "150 g fromage blanc", quantity: "" },
            { name: "", quantity: "" },
            { name: "GLUCIDES", quantity: "80 g flocons" },
          ],
          calories: 500,
          protein: 30,
          carbs: 50,
          fat: 15,
          coachNotes: "Bien mastiquer, et boire un grand verre d'eau avant.",
        },
      ],
    },
  ],
};

function suivi(meals: readonly ConsumedMeal[]): SuiviConsommation {
  const vrai = async () => true;
  return {
    datesParJour: {
      monday: "2026-08-13",
      tuesday: "2026-08-14",
      wednesday: "2026-08-15",
      thursday: "2026-08-16",
      friday: "2026-08-17",
      saturday: "2026-08-18",
      sunday: "2026-08-19",
    },
    meals,
    chargement: false,
    enCours: false,
    erreur: null,
    onEffacerErreur: () => {},
    onOuvrirPrescrit: async () => "cm-1",
    onCreerRepas: async () => "cm-2",
    onRenommerRepas: vrai,
    onSupprimerRepas: vrai,
    onAjouterCatalogue: vrai,
    onAjouterManuel: vrai,
    onCorriger: vrai,
    onSupprimerAliment: vrai,
  };
}

const REPAS_PRESCRIT_AVEC_BANANE = repasAvec([entrée({ id: "e1" })]);

/* ═══════════════════ A2-UI — LES QUATORZE CONTRATS D'ÉCRAN ═══════════════════ */

await test("A2-UI1. les repas prescrits existants sont toujours affichés", () => {
  const html = renderToString(
    createElement(StudentPrescribedWeek, { week: SEMAINE, suivi: suivi([]) } as never),
  );
  assert.ok(html.includes("Petit-déjeuner costaud"), "le titre du repas prescrit doit rester");
  assert.ok(html.includes("Petit déjeuner"), "le libellé du créneau doit rester");
  assert.ok(html.includes("150 g fromage blanc"), "le texte alimentaire du coach doit rester");
  assert.ok(html.includes("Lundi"), "le jour doit rester");
});

await test("A2-UI2. la cible du coach reste IDENTIQUE après l'ajout d'un aliment", () => {
  const avant = renderToString(
    createElement(StudentPrescribedWeek, { week: SEMAINE, suivi: suivi([]) } as never),
  );
  const après = renderToString(
    createElement(StudentPrescribedWeek, {
      week: SEMAINE,
      suivi: suivi([REPAS_PRESCRIT_AVEC_BANANE]),
    } as never),
  );

  // La zone de PRESCRIPTION est comparée telle quelle : tout ce qui précède la
  // frontière « Ce que j'ai mangé » doit être octet pour octet le même.
  const frontière = "Ce que j";
  const prescriptionAvant = avant.slice(0, avant.indexOf(frontière));
  const prescriptionAprès = après.slice(0, après.indexOf(frontière));
  assert.equal(
    prescriptionAprès,
    prescriptionAvant,
    "l'ajout d'un aliment ne doit rien changer au bloc de prescription",
  );
  assert.ok(prescriptionAprès.includes("500"), "la cible kcal du coach doit y figurer");
});

await test("A2-UI3. ajouter un aliment fait apparaître une barre", () => {
  const sans = renderToString(
    createElement(ConsumedMealSection, {
      repas: repasAvec([]),
      titre: "Petit-déjeuner",
      cibleFigée: true,
      enCours: false,
      erreur: null,
      onOuvrirConteneur: async () => "cm-1",
      onAjouterCatalogue: async () => true,
      onAjouterManuel: async () => true,
      onCorriger: async () => true,
      onSupprimerAliment: async () => true,
      onEffacerErreur: () => {},
    } as never),
  );
  const avec = renderToString(
    createElement(ConsumedMealSection, {
      repas: REPAS_PRESCRIT_AVEC_BANANE,
      titre: "Petit-déjeuner",
      cibleFigée: true,
      enCours: false,
      erreur: null,
      onOuvrirConteneur: async () => "cm-1",
      onAjouterCatalogue: async () => true,
      onAjouterManuel: async () => true,
      onCorriger: async () => true,
      onSupprimerAliment: async () => true,
      onEffacerErreur: () => {},
    } as never),
  );
  assert.ok(!sans.includes("Banane, crue"), "aucune barre tant qu'aucun aliment n'est saisi");
  assert.ok(avec.includes("Banane, crue"), "la barre apparaît dès qu'un aliment est saisi");
  assert.ok(sans.includes("Ajouter un aliment"), "le bouton d'ajout est là dans les deux cas");

  // ── LES DEUX PARCOURS, ET AUCUN CUL-DE-SAC ──────────────────────────────
  // `food_catalog` est vide en Production : un écran qui n'offrirait que la
  // recherche ne rendrait jamais rien. La saisie manuelle est un onglet de
  // MÊME RANG, et l'état vide de la recherche y mène explicitement.
  const feuille = renderToString(
    createElement(AddFoodSheet, {
      titreRepas: "Petit-déjeuner",
      enCours: false,
      erreur: null,
      onFermer: () => {},
      onAjouterCatalogue: async () => true,
      onAjouterManuel: async () => true,
    } as never),
  );
  assert.ok(feuille.includes("Rechercher"), "le parcours catalogue est offert");
  assert.ok(feuille.includes("Saisir à la main"), "le parcours manuel est offert au même rang");
  assert.ok(
    feuille.includes("Saisir un aliment à la main"),
    "l'état vide de la recherche mène au parcours manuel, jamais à un cul-de-sac",
  );
  assert.ok(
    (feuille.match(/role="tab"/g) ?? []).length === 2,
    "deux onglets, pas un lien discret en bas de page",
  );
});

await test("A2-UI4. la barre affiche nom, quantité, unité, kcal et heure", () => {
  const html = renderToString(
    createElement(ConsumedFoodBar, {
      entrée: entrée({ id: "e1" }),
      onOuvrir: () => {},
    } as never),
  );
  assert.ok(html.includes("Banane, crue"), "le nom");
  assert.ok(/120/.test(html), "la quantité");
  assert.ok(/\bg\b/.test(html), "l'unité");
  // 1,32×4 + 27,36×4 + 0,36×9 = 117,96 → 118 à l'affichage entier.
  assert.equal(Math.round(entryKcal(entrée({ id: "e1" }))), 118);
  assert.ok(html.includes("118"), "les kcal dérivées du 4/4/9");
  assert.match(html, /\d{2}:\d{2}/, "l'heure au format HH:MM");

  // Deux lignes, pas une carte : la barre reste compacte.
  assert.ok(html.includes("min-h-[56px]"), "la barre garde une hauteur de cible tactile compacte");
  assert.ok(!html.includes("rounded-card"), "la barre n'est pas une carte");
});

await test("A2-UI5. modifier la quantité met à jour la barre ET le total", () => {
  const rendre = (quantité: number, p: number, g: number, l: number) =>
    renderToString(
      createElement(ConsumedMealSection, {
        repas: repasAvec([entrée({ id: "e1", quantity: quantité, proteinG: p, carbG: g, fatG: l })]),
        titre: "Petit-déjeuner",
        cibleFigée: true,
        enCours: false,
        erreur: null,
        onOuvrirConteneur: async () => "cm-1",
        onAjouterCatalogue: async () => true,
        onAjouterManuel: async () => true,
        onCorriger: async () => true,
        onSupprimerAliment: async () => true,
        onEffacerErreur: () => {},
      } as never),
    );

  const à120 = rendre(120, 1.32, 27.36, 0.36);
  const à150 = rendre(150, 1.65, 34.2, 0.45);
  assert.ok(à120.includes("120"), "la barre affiche 120 g");
  assert.ok(à150.includes("150"), "la barre affiche 150 g après correction");
  assert.ok(à120.includes("118"), "total à 120 g : 118 kcal");
  assert.ok(à150.includes("147"), "total à 150 g : 147 kcal");

  // La feuille de détail propose bien la correction, et l'unité n'y est pas
  // modifiable — le serveur refuserait une unité incompatible.
  const feuille = renderToString(
    createElement(ConsumedFoodDetailSheet, {
      entrée: entrée({ id: "e1" }),
      enCours: false,
      erreur: null,
      onFermer: () => {},
      onCorriger: async () => true,
      onSupprimer: async () => true,
    } as never),
  );
  assert.ok(feuille.includes("Enregistrer la quantité"), "la correction est offerte");
  assert.match(feuille, /inputmode="decimal"/i, "clavier décimal sur téléphone");
});

await test("A2-UI6. supprimer un aliment met à jour le total", () => {
  const rendre = (entrées: readonly ConsumedEntry[]) =>
    renderToString(
      createElement(ConsumedMealSection, {
        repas: repasAvec(entrées),
        titre: "Petit-déjeuner",
        cibleFigée: true,
        enCours: false,
        erreur: null,
        onOuvrirConteneur: async () => "cm-1",
        onAjouterCatalogue: async () => true,
        onAjouterManuel: async () => true,
        onCorriger: async () => true,
        onSupprimerAliment: async () => true,
        onEffacerErreur: () => {},
      } as never),
    );

  const deux = rendre([entrée({ id: "e1" }), entrée({ id: "e2", label: "Flocons", proteinG: 6, carbG: 30, fatG: 3.5 })]);
  const un = rendre([entrée({ id: "e1" })]);
  const zéro = rendre([]);

  assert.ok(deux.includes("Flocons"), "les deux aliments sont là");
  assert.ok(!un.includes("Flocons"), "l'aliment supprimé disparaît");
  assert.ok(un.includes("118"), "le total redescend à celui qui reste");
  assert.ok(!zéro.includes("kcal"), "un repas vidé n'affiche plus de total");

  // La suppression est en DEUX temps : une barre se vise au pouce.
  const feuille = renderToString(
    createElement(ConsumedFoodDetailSheet, {
      entrée: entrée({ id: "e1" }),
      enCours: false,
      erreur: null,
      onFermer: () => {},
      onCorriger: async () => true,
      onSupprimer: async () => true,
    } as never),
  );
  assert.ok(feuille.includes("Supprimer cet aliment"), "la suppression est offerte");
  assert.ok(
    !feuille.includes("Supprimer «"),
    "la confirmation n'apparaît qu'après un premier appui",
  );
});

await test("A2-UI7. « Ajouter un repas » crée un repas personnel", () => {
  const html = renderToString(
    createElement(StudentPrescribedWeek, { week: SEMAINE, suivi: suivi([]) } as never),
  );
  assert.ok(html.includes("Ajouter un repas"), "le bouton existe au niveau de la journée");

  // Le câblage : le bouton mène bien à `onCreerRepas`, avec la DATE du jour et
  // le libellé saisi — pas un identifiant deviné côté client.
  const source = lire("../../components/student/StudentPrescribedWeek.tsx");
  assert.ok(
    source.includes("await suivi.onCreerRepas(date, propre)"),
    "la création doit passer par onCreerRepas(date, libellé)",
  );
  assert.ok(
    source.includes("const propre = nom.trim();") && source.includes('if (propre === "") return;'),
    "un libellé vide ne doit pas partir jusqu'au serveur",
  );

  // Deux « Collation » le même jour coexistent : la clé de liste est
  // l'identifiant, jamais le libellé.
  assert.ok(source.includes("key={repas.id}"), "la clé React doit être l'identifiant du repas");
  const deuxCollations = [
    repasAvec([], { id: "c1", kind: "student", label: "Collation", target: null, prescribedMealId: null, position: 1000 }),
    repasAvec([], { id: "c2", kind: "student", label: "Collation", target: null, prescribedMealId: null, position: 1001 }),
  ];
  assert.equal(
    studentMealsForDate(deuxCollations, "2026-08-13").length,
    2,
    "deux collations du même nom restent deux repas distincts",
  );
});

await test("A2-UI8. un repas personnel n'affiche AUCUNE cible coach", () => {
  const html = renderToString(
    createElement(StudentMealCard, {
      repas: repasAvec([entrée({ id: "e1" })], {
        id: "cm-2",
        kind: "student",
        label: "Collation",
        target: null,
        prescribedMealId: null,
        slotKey: null,
        position: 1000,
      }),
      enCours: false,
      erreur: null,
      onRenommer: async () => true,
      onSupprimerRepas: async () => true,
      onAjouterCatalogue: async () => true,
      onAjouterManuel: async () => true,
      onCorriger: async () => true,
      onSupprimerAliment: async () => true,
      onEffacerErreur: () => {},
    } as never),
  );
  assert.ok(html.includes("Collation"), "le nom du repas libre s'affiche");
  assert.ok(html.includes("aucun objectif coach"), "l'absence de cible est dite explicitement");
  assert.ok(!html.includes("Restant"), "aucun « restant » : il n'y a pas de cible à retrancher");
  assert.ok(html.includes("118"), "le TOTAL consommé, lui, s'affiche bien");
});

await test("A2-UI9. un repas personnel est renommable et supprimable", () => {
  const html = renderToString(
    createElement(StudentMealCard, {
      repas: repasAvec([], {
        id: "cm-2",
        kind: "student",
        label: "Collation",
        target: null,
        prescribedMealId: null,
        slotKey: null,
      }),
      enCours: false,
      erreur: null,
      onRenommer: async () => true,
      onSupprimerRepas: async () => true,
      onAjouterCatalogue: async () => true,
      onAjouterManuel: async () => true,
      onCorriger: async () => true,
      onSupprimerAliment: async () => true,
      onEffacerErreur: () => {},
    } as never),
  );
  assert.ok(html.includes("Renommer Collation"), "le bouton de renommage est offert et nommé");
  assert.ok(html.includes("Supprimer Collation"), "le bouton de suppression est offert et nommé");
});

await test("A2-UI10. un repas du coach n'est ni renommable ni supprimable", () => {
  const html = renderToString(
    createElement(StudentPrescribedWeek, {
      week: SEMAINE,
      suivi: suivi([REPAS_PRESCRIT_AVEC_BANANE]),
    } as never),
  );
  // Aucune commande de renommage ni de suppression n'est rendue pour un repas
  // prescrit : elle n'existe pas dans l'arbre, elle n'est pas seulement
  // désactivée. Le serveur refuserait de toute façon (A2-DB5).
  assert.ok(
    !html.includes("Renommer Petit-déjeuner costaud"),
    "aucun renommage sur un repas prescrit",
  );
  assert.ok(
    !html.includes("Supprimer Petit-déjeuner costaud"),
    "aucune suppression sur un repas prescrit",
  );
  // Mais ses aliments consommés, eux, restent modifiables.
  assert.ok(html.includes("Banane, crue"), "les aliments consommés du repas prescrit sont là");
  assert.ok(html.includes("Ajouter un aliment"), "et on peut en ajouter d'autres");
});

await test("A2-UI11. le total journalier est correct", () => {
  const html = renderToString(
    createElement(DailyIntakeSummary, {
      objectif: { proteinG: 150, carbG: 200, fatG: 66.67, kcal: 2000 },
      consommé: { proteinG: 8.64, carbG: 57.72, fatG: 15.72, kcal: 407.88 },
    } as never),
  );
  assert.ok(html.includes("Objectif du jour"), "les trois colonnes sont nommées");
  assert.ok(html.includes("Consommé"));
  assert.ok(html.includes("Restant"));
  // L'espace des milliers est une espace INSÉCABLE : on compare avec le
  // formateur du produit plutôt qu'avec une chaîne tapée à la main, sinon le
  // test échouerait pour une raison étrangère au total.
  assert.ok(html.includes(formatIntegerFr(2000)), "l'objectif en kcal");
  assert.ok(html.includes(formatIntegerFr(407.88)), "le consommé en kcal, arrondi");
  assert.ok(html.includes(formatIntegerFr(2000 - 407.88)), "le restant en kcal");

  // Un dépassement s'affiche NÉGATIF : le tronquer à zéro effacerait
  // exactement l'information utile.
  const dépassé = renderToString(
    createElement(DailyIntakeSummary, {
      objectif: { proteinG: 150, carbG: 200, fatG: 66, kcal: 2000 },
      consommé: { proteinG: 200, carbG: 300, fatG: 90, kcal: 2810 },
    } as never),
  );
  assert.ok(dépassé.includes("Objectif dépassé"), "le dépassement est nommé");
  assert.ok(
    dépassé.includes(formatIntegerFr(-810)),
    "l'écart négatif est affiché tel quel, jamais tronqué à zéro",
  );
});

await test("A2-UI12. la prescription textuelle du coach n'est JAMAIS modifiée", () => {
  const sansSuivi = renderToString(createElement(StudentPrescribedWeek, { week: SEMAINE } as never));
  const avecSuivi = renderToString(
    createElement(StudentPrescribedWeek, {
      week: SEMAINE,
      suivi: suivi([REPAS_PRESCRIT_AVEC_BANANE]),
    } as never),
  );

  // Sans la prop `suivi`, le composant est STRICTEMENT celui d'avant A2 : rien
  // de la consommation n'apparaît. C'est la non-régression du §12.
  assert.ok(!sansSuivi.includes("Ce que j"), "aucun bloc de suivi sans la prop");
  assert.ok(!sansSuivi.includes("Ajouter un aliment"), "aucun bouton d'ajout sans la prop");

  // Et avec le suivi, chaque élément prescrit est encore là, à l'identique.
  for (const attendu of ["Petit-déjeuner costaud", "PROTÉINES", "150 g fromage blanc", "GLUCIDES", "80 g flocons"]) {
    assert.ok(sansSuivi.includes(attendu), `« ${attendu} » attendu sans suivi`);
    assert.ok(avecSuivi.includes(attendu), `« ${attendu} » attendu avec suivi`);
  }

  // Le composant n'écrit rien dans le plan : il ne reçoit aucun callback qui
  // toucherait `meals`, et il n'appelle aucune écriture.
  const source = lire("../../components/student/StudentPrescribedWeek.tsx");
  for (const motif of ["meals.update", "save_nutrition_plan", ".from(\"meals\")"]) {
    assert.ok(!source.includes(motif), `le composant ne doit jamais contenir « ${motif} »`);
  }
});

await test("A2-UI13. les notes du coach sont conservées", () => {
  const avecSuivi = renderToString(
    createElement(StudentPrescribedWeek, {
      week: SEMAINE,
      suivi: suivi([REPAS_PRESCRIT_AVEC_BANANE]),
    } as never),
  );
  assert.ok(
    avecSuivi.includes("Bien mastiquer, et boire un grand verre d"),
    "la note du coach doit survivre à l'ajout du suivi",
  );
  // Elle reste DANS la zone de prescription, au-dessus de la frontière.
  const frontière = avecSuivi.indexOf("Ce que j");
  assert.ok(
    avecSuivi.indexOf("Bien mastiquer") < frontière,
    "la note du coach reste du côté prescription, jamais mêlée à la consommation",
  );
});

await test("A2-UI14. les retours à la ligne du plan alimentaire sont toujours conservés", () => {
  const html = renderToString(
    createElement(StudentPrescribedWeek, {
      week: SEMAINE,
      suivi: suivi([REPAS_PRESCRIT_AVEC_BANANE]),
    } as never),
  );
  // La respiration voulue par le coach (ligne sans nom NI quantité) se rend
  // comme un espace, jamais comme une puce vide — correctif du chantier
  // précédent, qu'A2 ne doit pas défaire.
  assert.ok(html.includes('aria-hidden="true"'), "la respiration est rendue, masquée aux lecteurs d'écran");
  assert.ok(html.includes("whitespace-pre-wrap"), "les espaces internes des libellés sont préservés");
  assert.ok(!html.includes("<br"), "aucun <br> n'est injecté");
  assert.ok(!html.includes("dangerouslySetInnerHTML"), "aucun HTML brut");
});

/* ═══════════════════════ RÉCAPITULATIF ═══════════════════════ */

await test("RÉCAP. les seize contrats A2-DB et les quatorze A2-UI sont couverts", () => {
  const manquants: string[] = [];
  for (let n = 1; n <= 16; n += 1) {
    if (!checklist.includes(`noter('A2-DB${n}',`)) manquants.push(`A2-DB${n}`);
  }
  assert.deepEqual(manquants, [], "chaque numéro A2-DB doit être exécuté par la checklist SQL");

  // Et la checklist ne doit contenir AUCUN numéro au-delà de 16 : un A2-DB17
  // signifierait que la numérotation officielle a dérivé.
  assert.ok(
    !/noter\('A2-DB(1[7-9]|[2-9]\d)'/.test(checklist),
    "aucun numéro A2-DB au-delà de 16 : la numérotation officielle en compte seize",
  );

  const moi = lire("./aliments-a2.mts");
  for (let n = 1; n <= 14; n += 1) {
    assert.ok(moi.includes(`A2-UI${n}.`), `A2-UI${n} doit avoir son test de rendu`);
  }

  // La checklist SQL et la migration sont bien celles de A2.
  assert.ok(checklist.includes("Migration couverte : 20260901090000_consumed_meals.sql"));
  assert.ok(prescribedConsumedMeal([], "meal-pdj", "2026-08-13") === null);
});
