/**
 * Harnais — N1.3 : LES OCCURRENCES DE LISTES DANS LE CONSTRUCTEUR COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OÙ CHAQUE GARANTIE EST RÉELLEMENT PROUVÉE
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Les GESTES (ajouter, retirer, déplacer, remplacer, dupliquer un jour)
 *    sont des fonctions PURES : elles sont appelées pour de vrai.
 * 2. Le PONT bibliothèque → instantané (`lireSnapshotDeListe`) est exécuté
 *    contre le double de base de N1.2, avec les contraintes de N1.1.
 * 3. Ce qui ne se prouve QUE dans PostgreSQL — atomicité, positions dérivées,
 *    OCCURRENCE_HORS_REPAS, RLS de `source_list_id`, cascade — vit dans
 *    `supabase/tests/nutrition_n1_3_occurrences_checklist.sql` (43 contrôles,
 *    exécutés). Les tests d'ici le NOMMENT plutôt que de le mimer : un double
 *    qui rejouerait une transaction PostgreSQL mentirait sur ce qu'il mesure.
 * 4. Le RESPONSIVE ne se prouve que dans un moteur de rendu ; les chiffres
 *    sont dans le livrable, et les invariants de code sont gardés ici.
 *
 * Lancement : npm run test:nutrition-n1-3
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creerBaseListes } from "./helpers/food-lists-double";
import {
  ajouterAlimentAListe,
  archiverFoodList,
  creerFoodList,
  lireSnapshotDeListe,
  renommerFoodList,
  retirerAlimentDeListe,
} from "../../lib/supabase/food-lists";
import {
  addChoiceSlot,
  addMeal,
  applyDayToWholeWeek,
  createBlankWeek,
  duplicateDay,
  findDay,
  moveChoiceSlot,
  removeChoiceSlot,
  replaceChoiceSlot,
  toDuplicateWeekPayload,
  toWeekSavePayload,
  updateMeal,
  type WeekFormState,
} from "../../lib/nutrition/plan-v2-week-form";
import type { MealChoiceSlot } from "../../lib/nutrition/plan-v2-week";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Commentaires de LIGNE d'abord — leçon `app/admin/**` d'A5.9. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_PANNEAU = sansProse(lire("../../components/admin/MealChoiceListsPanel.tsx"));
const CODE_REPAS = sansProse(lire("../../components/admin/NutritionDayManualMeals.tsx"));
const CODE_SEMAINE = sansProse(lire("../../components/admin/NutritionPlanV2WeekPanel.tsx"));
const CODE_FORM = sansProse(lire("../../lib/nutrition/plan-v2-week-form.ts"));
const CODE_LECTURE = sansProse(lire("../../lib/supabase/nutrition-week.ts"));
const MIGRATION = lire("../../supabase/migrations/20260907090000_n1_3_occurrences_de_listes_dans_les_repas.sql");
const CHECKLIST = lire("../../supabase/tests/nutrition_n1_3_occurrences_checklist.sql");

const ECRANS: readonly (readonly [string, string])[] = [
  ["panneau des choix", CODE_PANNEAU],
  ["éditeur de repas", CODE_REPAS],
];

/* ══════════════════════════════════════════════════════════════════════════
   LE DÉCOR
   ══════════════════════════════════════════════════════════════════════════ */

const COACH = "11111111-1111-4111-8111-111111111111";
const POULET = "aa000000-0000-4000-8000-000000000001";
const OEUF = "aa000000-0000-4000-8000-000000000002";
const SAUMON = "aa000000-0000-4000-8000-000000000003";
const THON = "aa000000-0000-4000-8000-000000000004";

function decor() {
  const base = creerBaseListes();
  base.connecter(COACH);
  base.table("food_catalog").push(
    { id: POULET, name: "Poulet", nutrition_unit: "g", protein_per_100: 23, carb_per_100: 0, fat_per_100: 2, piece_weight_g: null },
    { id: OEUF, name: "Oeuf", nutrition_unit: "g", protein_per_100: 13, carb_per_100: 1, fat_per_100: 11, piece_weight_g: null },
    { id: SAUMON, name: "Saumon", nutrition_unit: "g", protein_per_100: 20, carb_per_100: 0, fat_per_100: 13, piece_weight_g: null },
    { id: THON, name: "Thon", nutrition_unit: "g", protein_per_100: 26, carb_per_100: 0, fat_per_100: 1, piece_weight_g: null },
  );
  return base;
}

async function listeProteines(base: ReturnType<typeof decor>): Promise<string> {
  const id = await creerFoodList(base.client, COACH, "Choix de ta protéine");
  assert.ok(id);
  for (const aliment of [POULET, OEUF, SAUMON]) {
    assert.equal(await ajouterAlimentAListe(base.client, id!, { type: "aliment", id: aliment }), "ajoute");
  }
  return id!;
}

/** Une semaine à un repas, prête à recevoir des occurrences. */
function semaineAvecRepas(): { state: WeekFormState; mealId: string } {
  const state = addMeal(createBlankWeek(), "monday", "dinner");
  const mealId = findDay(state, "monday")!.meals[0].id;
  return { state, mealId };
}

const occurrenceDe = (label: string, ...ids: string[]): Omit<MealChoiceSlot, "id"> => ({
  label,
  sourceListId: null,
  options: ids.map((id) => ({ type: "aliment" as const, id })),
});

const occurrencesDe = (state: WeekFormState, mealId: string): readonly MealChoiceSlot[] =>
  findDay(state, "monday")!.meals.find((m) => m.id === mealId)!.choiceSlots;

/** Les repas du lundi, tels qu'ils partent réellement à la base. */
function repasEnvoyes(state: WeekFormState): readonly Record<string, unknown>[] {
  const payload = toWeekSavePayload(state) as { days: readonly Record<string, unknown>[] };
  const lundi = payload.days.find((j) => j.day === "monday")!;
  return lundi.meals as readonly Record<string, unknown>[];
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.3-01..06 — UN REPAS LIBRE, PUIS UNE OCCURRENCE SNAPSHOTÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.3-01. un repas à ZÉRO liste reste parfaitement valide", () => {
  const { state, mealId } = semaineAvecRepas();
  assert.deepEqual(occurrencesDe(state, mealId), [], "un repas neuf reçoit une liste d'office");

  const [repas] = repasEnvoyes(state);
  assert.deepEqual(repas.choice_slots, [], "la charge utile doit dire « aucune », pas se taire");

  // ⚠️ ET L'ÉCRAN LE DIT. Un repas sans liste n'est pas un repas incomplet :
  // les listes sont une aide de composition, pas une étape obligatoire.
  assert.ok(CODE_PANNEAU.includes("Ce repas reste libre"));
  assert.ok(!CODE_PANNEAU.includes("obligatoire"));
});

await test("N1.3-02/03. ajouter une liste crée UNE occurrence, et fige ses aliments", async () => {
  const base = decor();
  const listId = await listeProteines(base);

  // Le pont bibliothèque → instantané, EXÉCUTÉ.
  const snapshot = await lireSnapshotDeListe(base.client, listId);
  assert.ok(snapshot);
  assert.equal(snapshot!.label, "Choix de ta protéine");
  assert.equal(snapshot!.sourceListId, listId);
  assert.deepEqual(snapshot!.options.map((o) => o.id), [POULET, OEUF, SAUMON]);

  const { state, mealId } = semaineAvecRepas();
  const apres = addChoiceSlot(state, "monday", mealId, snapshot!);
  const occurrences = occurrencesDe(apres, mealId);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].label, "Choix de ta protéine");
  assert.deepEqual(occurrences[0].options.map((o) => o.id), [POULET, OEUF, SAUMON]);
});

await test("N1.3-04/05/06. les options n'ont QUE des identités : ni nom, ni macro, ni rôle", async () => {
  const base = decor();
  const snapshot = (await lireSnapshotDeListe(base.client, await listeProteines(base)))!;
  const { state, mealId } = semaineAvecRepas();
  const [repas] = repasEnvoyes(addChoiceSlot(state, "monday", mealId, snapshot));

  const occurrences = repas.choice_slots as readonly Record<string, unknown>[];
  assert.equal(occurrences.length, 1);
  assert.deepEqual(Object.keys(occurrences[0]).sort(), ["id", "label", "options", "source_list_id"]);

  const options = occurrences[0].options as readonly Record<string, unknown>[];
  for (const option of options) {
    assert.deepEqual(Object.keys(option).sort(), ["catalog_food_id", "product_id"]);
    // Exactement UNE des deux, et c'est un identifiant de base.
    assert.equal((option.catalog_food_id === null) !== (option.product_id === null), true);
  }

  const texte = JSON.stringify(occurrences);
  for (const interdit of ["protein", "carb", "fat", "calories", "grams", "quantity", "role", "solver_role", "name\":"]) {
    assert.ok(!texte.includes(interdit), `« ${interdit} » ne doit pas voyager avec une option`);
  }
  // ⚠️ `label` est le SEUL texte, et c'est le libellé de l'occurrence — pas
  // un nom d'aliment. Aucun nom d'aliment n'est recopié nulle part.
  assert.ok(!texte.includes("Poulet") && !texte.includes("Saumon"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.3-07..11 — PLUSIEURS LISTES, INDÉPENDANCE, ORDRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.3-07/08/09. plusieurs listes, deux fois la même, et indépendantes", async () => {
  const base = decor();
  const listId = await listeProteines(base);
  const snapshot = (await lireSnapshotDeListe(base.client, listId))!;

  const { state, mealId } = semaineAvecRepas();
  let apres = addChoiceSlot(state, "monday", mealId, snapshot);
  apres = addChoiceSlot(apres, "monday", mealId, { ...snapshot, label: "Protéine secondaire" });
  apres = addChoiceSlot(apres, "monday", mealId, occurrenceDe("Fruits", THON));

  const occurrences = occurrencesDe(apres, mealId);
  assert.equal(occurrences.length, 3, "trois occurrences dans un repas");
  // ⚠️ AUCUNE UNICITÉ SUR LA PROVENANCE : deux sélections indépendantes issues
  // de la même liste sont exactement le cas d'usage visé.
  assert.equal(occurrences.filter((o) => o.sourceListId === listId).length, 2);
  assert.notEqual(occurrences[0].id, occurrences[1].id, "deux occurrences, deux identifiants");

  // Chacune a SON instantané : en remplacer une ne touche pas l'autre.
  const modifie = replaceChoiceSlot(apres, "monday", mealId, occurrences[1].id, occurrenceDe("Autre", OEUF));
  const apresModif = occurrencesDe(modifie, mealId);
  assert.deepEqual(apresModif[0].options.map((o) => o.id), [POULET, OEUF, SAUMON], "la première a bougé");
  assert.deepEqual(apresModif[1].options.map((o) => o.id), [OEUF]);
  assert.equal(apresModif[1].id, occurrences[1].id, "remplacer garde l'identifiant");
  assert.equal(apresModif[2].label, "Fruits", "et le rang des autres");
});

await test("N1.3-10/11/28. l'ordre est celui du tableau, et il tient à dix occurrences", () => {
  const { state, mealId } = semaineAvecRepas();
  let apres = state;
  for (let i = 1; i <= 10; i += 1) {
    apres = addChoiceSlot(apres, "monday", mealId, occurrenceDe(`Liste ${i}`, POULET));
  }
  assert.equal(occurrencesDe(apres, mealId).length, 10);

  // Monter la dernière d'un cran.
  const ids = occurrencesDe(apres, mealId).map((o) => o.id);
  const remonte = moveChoiceSlot(apres, "monday", mealId, ids[9], -1);
  assert.deepEqual(occurrencesDe(remonte, mealId).map((o) => o.label).slice(8), ["Liste 10", "Liste 9"]);

  // Les bornes ne cassent rien.
  assert.deepEqual(
    occurrencesDe(moveChoiceSlot(apres, "monday", mealId, ids[0], -1), mealId).map((o) => o.label),
    occurrencesDe(apres, mealId).map((o) => o.label),
  );

  // ⚠️ ET L'ORDRE ENVOYÉ EST L'ORDRE AFFICHÉ. La base DÉRIVE la position de
  // cet ordre : aucune renumérotation applicative n'existe, donc 1..N ne peut
  // pas être trouée. Le contrôle SQL N13-C le prouve côté base.
  const [repas] = repasEnvoyes(remonte);
  const labels = (repas.choice_slots as readonly { label: string }[]).map((o) => o.label);
  assert.deepEqual(labels, occurrencesDe(remonte, mealId).map((o) => o.label));
  assert.ok(!JSON.stringify(repas.choice_slots).includes('"position"'), "aucune position n'est envoyée");
  assert.ok(MIGRATION.includes("La position n'est JAMAIS lue dans la charge utile"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.3-12..18 — RETIRER, REMPLACER, ET L'INSTANTANÉ FACE À LA BIBLIOTHÈQUE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.3-12/13. retirer une occurrence ne touche ni la bibliothèque ni les autres", async () => {
  const base = decor();
  const listId = await listeProteines(base);
  const snapshot = (await lireSnapshotDeListe(base.client, listId))!;

  const { state, mealId } = semaineAvecRepas();
  let apres = addChoiceSlot(state, "monday", mealId, snapshot);
  apres = addChoiceSlot(apres, "monday", mealId, occurrenceDe("Fruits", THON));
  const [premiere, seconde] = occurrencesDe(apres, mealId);

  const avantBibliotheque = base.table("food_list_items").map((l) => ({ ...l }));
  const retire = removeChoiceSlot(apres, "monday", mealId, premiere.id);

  assert.deepEqual(occurrencesDe(retire, mealId).map((o) => o.id), [seconde.id]);
  assert.deepEqual(occurrencesDe(retire, mealId)[0].options.map((o) => o.id), [THON], "l'autre est intacte");
  // ⚠️ AUCUNE ÉCRITURE N'A EU LIEU : le geste est PUR. La bibliothèque ne
  // pouvait donc pas bouger — et on le constate plutôt que de le supposer.
  assert.deepEqual(base.table("food_list_items"), avantBibliotheque);
  assert.equal(base.table("food_lists").length, 1);
});

await test("N1.3-14. remplacer produit un NOUVEAU snapshot pour CETTE occurrence", async () => {
  const base = decor();
  const proteines = await listeProteines(base);
  const autre = await creerFoodList(base.client, COACH, "Féculents");
  assert.equal(await ajouterAlimentAListe(base.client, autre!, { type: "aliment", id: THON }), "ajoute");

  const { state, mealId } = semaineAvecRepas();
  const avecProteines = addChoiceSlot(state, "monday", mealId, (await lireSnapshotDeListe(base.client, proteines))!);
  const cible = occurrencesDe(avecProteines, mealId)[0];

  const remplace = replaceChoiceSlot(
    avecProteines, "monday", mealId, cible.id,
    (await lireSnapshotDeListe(base.client, autre!))!,
  );
  const apres = occurrencesDe(remplace, mealId)[0];
  assert.equal(apres.id, cible.id, "même occurrence, pas une nouvelle");
  assert.equal(apres.label, "Féculents");
  assert.equal(apres.sourceListId, autre);
  assert.deepEqual(apres.options.map((o) => o.id), [THON]);
});

await test("N1.3-15/16/17. modifier, renommer ou archiver la bibliothèque ne change RIEN au repas", async () => {
  const base = decor();
  const listId = await listeProteines(base);
  const snapshot = (await lireSnapshotDeListe(base.client, listId))!;
  const { state, mealId } = semaineAvecRepas();
  const apres = addChoiceSlot(state, "monday", mealId, snapshot);
  const fige = occurrencesDe(apres, mealId)[0];

  // La bibliothèque bouge dans tous les sens.
  assert.equal(await ajouterAlimentAListe(base.client, listId, { type: "aliment", id: THON }), "ajoute");
  const items = base.table("food_list_items").filter((l) => l.list_id === listId);
  assert.equal(await retirerAlimentDeListe(base.client, listId, items[0].id as string), true);
  assert.equal(await renommerFoodList(base.client, listId, "Sources protéinées"), true);
  assert.equal(await archiverFoodList(base.client, listId, true), true);

  // ⚠️ L'INSTANTANÉ N'A PAS BOUGÉ D'UN OCTET, et il ne le pouvait pas : il
  // vit dans l'état du repas, sans aucun chemin vers la bibliothèque.
  const toujours = occurrencesDe(apres, mealId)[0];
  assert.deepEqual(toujours, fige);
  assert.equal(toujours.label, "Choix de ta protéine", "le libellé snapshoté a suivi le renommage");
  assert.deepEqual(toujours.options.map((o) => o.id), [POULET, OEUF, SAUMON]);
  assert.ok(!toujours.options.some((o) => o.id === THON), "le Thon ajouté après coup est entré");

  // Le nouvel instantané, lui, voit bien la bibliothèque d'aujourd'hui : sans
  // cela le test précédent serait vert même si la lecture était morte.
  const relu = (await lireSnapshotDeListe(base.client, listId))!;
  assert.equal(relu.label, "Sources protéinées");
  assert.ok(relu.options.some((o) => o.id === THON));
});

await test("N1.3-18. la provenance peut disparaître sans emporter le snapshot", () => {
  // Côté type : `sourceListId` est NULLABLE, et une occurrence sans provenance
  // est un état normal — c'est là que `on delete set null` de N1.1 amène.
  const { state, mealId } = semaineAvecRepas();
  const apres = addChoiceSlot(state, "monday", mealId, occurrenceDe("Sans provenance", POULET));
  assert.equal(occurrencesDe(apres, mealId)[0].sourceListId, null);
  const [repas] = repasEnvoyes(apres);
  assert.equal((repas.choice_slots as readonly { source_list_id: unknown }[])[0].source_list_id, null);

  // Et la base le confirme, exécuté : la checklist N1.1 supprime le modèle et
  // constate que les options restent (N1-P), la checklist N1.3 accepte une
  // provenance nulle (N13-I).
  assert.ok(CHECKLIST.includes("une provenance NULLE reste parfaitement valide"));
  assert.ok(MIGRATION.includes("source_list_id is null"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.3-19..23 — ANCIENS REPAS, ET LES DUPLICATIONS RÉELLEMENT SUPPORTÉES
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.3-19/30. un ancien repas sans liste continue de fonctionner, items compris", () => {
  const { state, mealId } = semaineAvecRepas();
  const avecTexte = updateMeal(state, "monday", mealId, {
    name: "Dîner",
    items: [{ name: "Riz", quantity: "100 g" }],
    coachNotes: "Peser cru.",
  });
  const [repas] = repasEnvoyes(avecTexte);
  assert.deepEqual(repas.items, [{ name: "Riz", quantity: "100 g" }], "meals.items n'est pas touché");
  assert.equal(repas.coach_notes, "Peser cru.");
  assert.deepEqual(repas.choice_slots, []);

  // ⚠️ ET LA RPC NE TOUCHE À RIEN QUAND LA CLÉ EST ABSENTE. C'est ce qui rend
  // valides, à l'octet près, toutes les charges utiles écrites avant N1.3 —
  // la checklist SQL le vérifie en exécutant les deux formes.
  assert.ok(MIGRATION.includes("if v_meal ? 'choice_slots' then"));
  assert.ok(CHECKLIST.includes("ré-enregistrer SANS la clé ne retire aucune occurrence"));
});

await test("N1.3-20/21/22. dupliquer un jour emporte les occurrences, et la copie est indépendante", () => {
  const { state, mealId } = semaineAvecRepas();
  let lundi = addChoiceSlot(state, "monday", mealId, occurrenceDe("Protéines", POULET, OEUF));
  lundi = addChoiceSlot(lundi, "monday", mealId, occurrenceDe("Fruits", THON));

  const duplique = duplicateDay(lundi, "monday", ["wednesday"]);
  const copie = findDay(duplique, "wednesday")!.meals[0];
  const source = findDay(duplique, "monday")!.meals[0];

  assert.equal(copie.choiceSlots.length, 2, "les occurrences n'ont pas suivi");
  assert.deepEqual(copie.choiceSlots.map((o) => o.label), ["Protéines", "Fruits"]);
  assert.deepEqual(copie.choiceSlots[0].options.map((o) => o.id), [POULET, OEUF]);

  // ⚠️ DE NOUVEAUX IDENTIFIANTS, PARTOUT. Réutiliser ceux de la source les
  // DÉPLACERAIT vers la copie — la base refuserait d'ailleurs, et c'est
  // exactement ce que prouve N1.3-RPC-ID-2.
  assert.notEqual(copie.id, source.id);
  for (const [i, occurrence] of copie.choiceSlots.entries()) {
    assert.notEqual(occurrence.id, source.choiceSlots[i].id, "identifiant d'occurrence partagé");
  }
  assert.ok(MIGRATION.includes("OCCURRENCE_HORS_REPAS"));

  // Modifier la copie ne touche pas la source.
  const modifie = removeChoiceSlot(duplique, "wednesday", copie.id, copie.choiceSlots[0].id);
  assert.equal(findDay(modifie, "wednesday")!.meals[0].choiceSlots.length, 1);
  assert.equal(findDay(modifie, "monday")!.meals[0].choiceSlots.length, 2, "la source a bougé");

  // « Appliquer à toute la semaine » : les six autres jours, même règle.
  const semaine = applyDayToWholeWeek(lundi, "monday");
  const identifiants = new Set<string>();
  for (const jour of semaine.days) {
    for (const occurrence of jour.meals[0].choiceSlots) {
      assert.ok(!identifiants.has(occurrence.id), "un identifiant d'occurrence est partagé entre deux jours");
      identifiants.add(occurrence.id);
    }
  }
  assert.equal(identifiants.size, 14, "sept jours × deux occurrences");
});

await test("N1.3-23. dupliquer un PLAN détache les identifiants, occurrences comprises", () => {
  const { state, mealId } = semaineAvecRepas();
  const lundi = addChoiceSlot(state, "monday", mealId, occurrenceDe("Protéines", POULET));

  const payload = toDuplicateWeekPayload(lundi) as { days: readonly Record<string, unknown>[] };
  const repas = (payload.days.find((j) => j.day === "monday")!.meals as readonly Record<string, unknown>[])[0];

  assert.equal(repas.id, null, "l'identifiant du repas doit être détaché");
  const occurrences = repas.choice_slots as readonly Record<string, unknown>[];
  assert.equal(occurrences.length, 1, "la copie a perdu ses occurrences");
  assert.equal(occurrences[0].id, null, "un identifiant d'occurrence de l'original partirait dans la copie");
  assert.equal(occurrences[0].label, "Protéines", "le snapshot, lui, est bien recopié");
  assert.deepEqual(
    (occurrences[0].options as readonly { catalog_food_id: string }[]).map((o) => o.catalog_food_id),
    [POULET],
  );

  // ⚠️ LA DUPLICATION D'UN REPAS SEUL N'EXISTE PAS dans l'application — audit
  // §16. On ne teste donc pas un chemin qu'aucun bouton n'emprunte.
  assert.ok(!CODE_SEMAINE.includes("duplicateMeal"));
  assert.ok(!CODE_REPAS.includes("Dupliquer"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.3-24..27 — SÉCURITÉ, ÉCHECS, ET LISTE VIDE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.3-24/25. le cloisonnement est tenu par la BASE, pas par l'écran", () => {
  // Le sélecteur ne propose que les listes du coach connecté — mais l'écran
  // n'est pas une garantie de sécurité. Ce qui l'est : la policy N1.3.
  assert.ok(CODE_PANNEAU.includes("useFoodLists"), "le sélecteur lit les listes du coach connecté");
  assert.ok(!CODE_PANNEAU.includes("coach_id"), "aucun coach n'est nommé côté client");

  assert.ok(MIGRATION.includes("meal_choice_slots_manage_staff"));
  assert.ok(MIGRATION.includes("fl.coach_id = public.current_coach_id()"));
  assert.ok(MIGRATION.includes("public.is_admin()"), "l'administrateur ne doit pas être mis dehors");
  // ⚠️ Le SQL double ses apostrophes : on cherche donc un fragment qui n'en
  // contient pas, plutôt qu'une phrase qu'aucun fichier ne porte telle quelle.
  assert.ok(CHECKLIST.includes("AUTRE coach est refusé par la policy"));

  // L'élève : aucune écriture. C'est un privilège de N1.1, vérifié par sa
  // propre checklist (N1-N), et N1.3 n'y touche pas.
  assert.ok(!MIGRATION.includes("grant insert") && !MIGRATION.includes("grant update"));
});

await test("N1.3-26. un instantané qui échoue n'est JAMAIS un succès", () => {
  // ⚠️ `onChoisir` N'EST APPELÉ QU'APRÈS une lecture réussie et non vide.
  // `indexOf("return (")` tomberait sur le PREMIER rendu du fichier, bien
  // au-dessus de `prendre` : la tranche serait vide et le test vert à vide.
  const bloc = CODE_PANNEAU.slice(CODE_PANNEAU.indexOf("const prendre"));
  assert.ok(bloc.length > 200, "la tranche mesurée ne doit pas être vide");
  assert.ok(bloc.includes("if (!snapshot || snapshot.options.length === 0)"));
  assert.ok(bloc.indexOf("setEchec") < bloc.indexOf("onChoisir(snapshot)"), "l'échec doit précéder le succès");
  assert.ok(bloc.includes("catch"), "une lecture qui jette est rattrapée");
  assert.ok(CODE_PANNEAU.includes('role="alert"'));

  // Et côté base : un refus annule TOUT, il n'y a pas de demi-succès.
  assert.ok(CHECKLIST.includes("RPC-ID-3 · le refus n"), "le contrôle d'atomicité doit exister");
  assert.ok(CHECKLIST.includes("modifié AUCUN repas"));
  assert.ok(MIGRATION.includes("Une fonction plpgsql est UNE"));
});

await test("N1.3-27. une liste VIDE a un comportement explicite, des deux côtés", () => {
  assert.ok(CODE_PANNEAU.includes("Cette liste est vide"));
  assert.ok(CODE_PANNEAU.includes("if (nbAliments === 0)"));
  // La base refuse aussi, avec un code nommé : l'écran est une politesse, pas
  // la garantie.
  assert.ok(MIGRATION.includes("OCCURRENCE_SANS_OPTION"));
  assert.ok(CHECKLIST.includes("une occurrence SANS option est refusée, et nommée"));

  // Les archivées ne sont pas proposées — mais n'ont jamais cassé un repas.
  assert.ok(!CODE_PANNEAU.includes("avecArchivees"), "le sélecteur reste sur les listes actives");
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.3-29..30 — RESPONSIVE, ET L'ABSENCE DE CHEMIN
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.3-29. rien ne peut déborder, et tout reste tactile", () => {
  for (const [nom, code] of ECRANS) {
    assert.ok(!code.includes("w-screen"), `w-screen dans ${nom}`);
    assert.ok(!code.includes("100vw"), `100vw dans ${nom}`);
    assert.ok(!/(?<![\w-])w-\[\d+px\]/.test(code), `largeur fixe en px dans ${nom}`);
    assert.ok(code.includes("min-w-0"), `aucun min-w-0 dans ${nom}`);
  }
  assert.ok(CODE_PANNEAU.includes("truncate"), "un libellé long doit être tronqué");
  assert.ok(CODE_PANNEAU.includes("flex-wrap"), "les quatre actions doivent passer à la ligne");
  assert.ok(CODE_PANNEAU.includes("min-h-[44px] min-w-[44px]"), "cibles tactiles");
  assert.ok(CODE_PANNEAU.includes("aria-label={libelle}"));
  // Le sélecteur est une feuille en bas d'écran sur mobile, centrée ensuite.
  assert.ok(CODE_PANNEAU.includes("items-end") && CODE_PANNEAU.includes("sm:items-center"));
  assert.ok(CODE_PANNEAU.includes("max-h-[80vh]") && CODE_PANNEAU.includes("overflow-y-auto"));
});

await test("N1.3-30. aucun chemin de lecture ne relie un repas à la bibliothèque", () => {
  // ⚠️ LA GARANTIE EST L'ABSENCE DE CHEMIN, pas un drapeau. La lecture d'une
  // semaine ne nomme jamais la bibliothèque ; seul le PONT explicite le fait,
  // et une seule fois, au moment de l'ajout.
  for (const table of ["food_lists", "food_list_items"]) {
    assert.ok(!CODE_LECTURE.includes(`from("${table}")`), `la lecture d'un repas touche ${table}`);
  }
  assert.ok(CODE_LECTURE.includes('from("meal_choice_slots")'));
  assert.ok(CODE_LECTURE.includes('from("meal_choice_options")'));

  // Le pont est unique, nommé, et vit dans la couche — pas dans un composant.
  assert.ok(CODE_PANNEAU.includes("lireSnapshotDeListe"));
  assert.ok(!CODE_PANNEAU.includes(".from("), "aucune requête écrite dans l'écran");
  assert.ok(!CODE_FORM.includes("supabase"), "l'état du formulaire ne connaît pas la base");

  // Et la migration ne crée AUCUNE table ni colonne : N1.1 suffisait.
  assert.ok(!/create table/i.test(MIGRATION));
  assert.ok(!/add column/i.test(MIGRATION));
});
