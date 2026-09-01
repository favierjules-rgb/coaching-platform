/**
 * Harnais — N1.6A : LA COULEUR DES LISTES D'ALIMENTS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PEUT PAS PROUVER
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Le VOCABULAIRE est unique : une seule table de styles dans tout le dépôt,
 *    partagée avec les blocs d'entraînement. Prouvé par recherche exhaustive.
 * 2. Le SNAPSHOT est exécuté contre le double de base de N1.2 : la couleur
 *    figée vient de la bibliothèque au moment de l'ajout, et n'y retourne
 *    jamais.
 * 3. Le RENDU passe par `renderToString` : on mesure le DOM réellement produit.
 * 4. Ce qui ne se prouve QUE dans PostgreSQL — contraintes, écriture par la
 *    RPC, absence de policy élève sur `food_lists` — vit dans
 *    `supabase/tests/nutrition_n1_6_a_couleurs_checklist.sql`.
 * 5. Le CONTRASTE ne se prouve que dans un moteur de rendu ; les chiffres sont
 *    dans le livrable.
 *
 * Lancement : npm run test:nutrition-n1-6-couleurs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { creerBaseListes } from "./helpers/food-lists-double";
import {
  ajouterAlimentAListe,
  creerFoodList,
  definirCouleurDeListe,
  lireFoodList,
  lireSnapshotDeListe,
} from "../../lib/supabase/food-lists";
import { addChoiceSlot, addMeal, createBlankWeek, findDay, toWeekSavePayload } from "../../lib/nutrition/plan-v2-week-form";
import { StudentMealChoices } from "../../components/student/StudentMealChoices";
import { COLOR_KEYS, COLOR_STYLES, isColorKey } from "../../lib/ui/color-keys";
import { BLOCK_COLOR_ORDER, BLOCK_COLOR_STYLES } from "../../components/admin/blocks/block-view-model";
import { BLOCK_COLOR_KEYS } from "../../lib/training-block-editing";
import type { MealChoiceSlot } from "../../lib/nutrition/plan-v2-week";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_SOLVEUR = sansProse(lire("../../lib/nutrition/meal-choice-solver.ts"));
const CODE_SELECTION = sansProse(lire("../../lib/nutrition/meal-choice-selection.ts"));
const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
const CODE_EDITEUR = sansProse(lire("../../components/admin/FoodListEditor.tsx"));
const CODE_PANNEAU = sansProse(lire("../../components/admin/MealChoiceListsPanel.tsx"));
const CODE_LIGNE = sansProse(lire("../../components/admin/FoodListRow.tsx"));
const MIGRATION = lire("../../supabase/migrations/20260910090000_n1_6_a_couleurs_de_listes.sql");
const DDL = MIGRATION.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");

const COACH = "11111111-1111-4111-8111-111111111111";
const POULET = "aa000000-0000-4000-8000-000000000001";

function decor() {
  const base = creerBaseListes();
  base.connecter(COACH);
  base.table("food_catalog").push({
    id: POULET, name: "Poulet", nutrition_unit: "g",
    protein_per_100: 23, carb_per_100: 0, fat_per_100: 2, piece_weight_g: null,
  });
  return base;
}

async function listeAvecUnAliment(base: ReturnType<typeof decor>, nom: string): Promise<string> {
  const id = await creerFoodList(base.client, COACH, nom);
  assert.ok(id);
  assert.equal(await ajouterAlimentAListe(base.client, id!, { type: "aliment", id: POULET }), "ajoute");
  return id!;
}

/* ══════════════════════════════════════════════════════════════════════════
   COLOR-01..03 — LA VALEUR
   ══════════════════════════════════════════════════════════════════════════ */

await test("COLOR-01. une liste SANS couleur reste parfaitement valide", async () => {
  const base = decor();
  const id = await listeAvecUnAliment(base, "Sans couleur");
  const liste = await lireFoodList(base.client, id);
  assert.equal(liste?.colorKey, null, "une liste neuve n'a AUCUNE couleur");

  // ⚠️ ET L'ÉCRAN NE REND RIEN. Pas de pastille vide, pas d'espace réservé,
  // pas de gris par défaut : le gabarit est celui d'avant N1.6A.
  const html = rendu([occurrence("s1", "Ta protéine", null)]);
  for (const style of Object.values(COLOR_STYLES)) {
    assert.ok(!html.includes(style.borderLeft), `un accent « ${style.label} » est rendu sans couleur`);
    assert.ok(!html.includes(style.dot));
  }

  // ⚠️ AUCUN BACKFILL DANS LA MIGRATION.
  assert.ok(!/update\s+public\.food_lists\s+set\s+color_key/i.test(DDL), "la migration remplit des couleurs");
  assert.ok(!/color_key\s+text\s+not\s+null/i.test(DDL), "la colonne ne doit pas être obligatoire");
  assert.ok(!/color_key[^;]*default/i.test(DDL), "aucun DEFAULT ne doit inventer une couleur");
});

await test("COLOR-02/03. créer avec une couleur, puis la modifier, puis la retirer", async () => {
  const base = decor();
  const id = await listeAvecUnAliment(base, "Protéines");

  assert.equal(await definirCouleurDeListe(base.client, id, "red"), true);
  assert.equal((await lireFoodList(base.client, id))?.colorKey, "red");

  assert.equal(await definirCouleurDeListe(base.client, id, "blue"), true);
  assert.equal((await lireFoodList(base.client, id))?.colorKey, "blue");

  // ⚠️ `null` EST UNE VALEUR, PAS UNE ABSENCE D'APPEL. Sans ce chemin, un
  // coach ne pourrait jamais revenir en arrière.
  assert.equal(await definirCouleurDeListe(base.client, id, null), true);
  assert.equal((await lireFoodList(base.client, id))?.colorKey, null);
});

await test("COLOR-08. deux listes portent deux couleurs différentes, sans se toucher", async () => {
  const base = decor();
  const a = await listeAvecUnAliment(base, "Protéines");
  const b = await listeAvecUnAliment(base, "Glucides");
  await definirCouleurDeListe(base.client, a, "red");
  await definirCouleurDeListe(base.client, b, "green");
  assert.equal((await lireFoodList(base.client, a))?.colorKey, "red");
  assert.equal((await lireFoodList(base.client, b))?.colorKey, "green");
});

/* ══════════════════════════════════════════════════════════════════════════
   COLOR-04..07 — LA COULEUR NE TOUCHE RIEN
   ══════════════════════════════════════════════════════════════════════════ */

await test("COLOR-04/05. la couleur ne touche ni les aliments, ni les minimums, ni les portions", async () => {
  const base = decor();
  const id = await listeAvecUnAliment(base, "Protéines");
  const avant = await lireFoodList(base.client, id);
  await definirCouleurDeListe(base.client, id, "purple");
  const apres = await lireFoodList(base.client, id);

  assert.deepEqual(
    apres!.items.map((i) => [i.id, i.position, i.portionOverride, i.minimumOverride, i.portionStandard]),
    avant!.items.map((i) => [i.id, i.position, i.portionOverride, i.minimumOverride, i.portionStandard]),
    "peindre une liste a modifié ses aliments",
  );

  // ⚠️ ET L'ÉCRITURE NE TOUCHE QU'UNE COLONNE. Un `update` plus large
  // écraserait le nom ou l'archivage au passage.
  const CODE_LISTES = lire("../../lib/supabase/food-lists.ts");
  const bloc = CODE_LISTES.slice(CODE_LISTES.indexOf("export async function definirCouleurDeListe"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(corps.includes("{ color_key: couleur }"), "l'écriture doit ne porter QUE la couleur");
  for (const autre of ["name", "archived_at", "preferred", "minimum"]) {
    assert.ok(!corps.includes(autre), `l'écriture de couleur touche « ${autre} »`);
  }
});

await test("COLOR-06. le SOLVEUR ne reçoit jamais la couleur, et ne sait pas qu'elle existe", () => {
  // ⚠️ LE CONTRÔLE LE PLUS IMPORTANT DU LOT. Le jour où un calcul lirait cette
  // colonne, « la couleur est purement visuelle » deviendrait faux, et un rôle
  // nutritionnel implicite serait né.
  for (const [nom, code] of [["solveur", CODE_SOLVEUR], ["sélection", CODE_SELECTION]] as const) {
    for (const interdit of ["colorKey", "color_key", "COLOR_STYLES", "ColorKey"]) {
      assert.ok(!code.includes(interdit), `${nom} connaît « ${interdit} »`);
    }
  }
  // Le pont vers le solveur n'emporte que ce qui est calculable.
  const CODE_SEL = lire("../../lib/nutrition/meal-choice-selection.ts");
  const bloc = CODE_SEL.slice(CODE_SEL.indexOf("export function alimentsPourLeSolveur"));
  assert.ok(!bloc.slice(0, bloc.indexOf("\n}")).includes("color"));
});

await test("COLOR-07. aucun rôle nutritionnel n'est dérivé d'une couleur", () => {
  // Aucune couleur n'est associée à un mot du vocabulaire nutritionnel, nulle
  // part : pas de `red → protéines`, pas de table de correspondance.
  const sources = [CODE_SOLVEUR, CODE_SELECTION, CODE_CHOIX, CODE_EDITEUR, CODE_PANNEAU, CODE_LIGNE,
                   sansProse(lire("../../lib/ui/color-keys.ts"))];
  for (const code of sources) {
    for (const mot of ["protéine", "glucide", "lipide", "féculent", "légume", "role", "referenceGrams"]) {
      const motif = new RegExp(`["'](red|orange|yellow|green|blue|purple|gray)["'][^\\n]{0,40}${mot}`, "i");
      assert.ok(!motif.test(code), `une couleur est associée à « ${mot} »`);
    }
  }
  // Et la migration le dit noir sur blanc.
  assert.ok(MIGRATION.includes("PUREMENT VISUELLE"));
});

/* ══════════════════════════════════════════════════════════════════════════
   COLOR-09..11 — LE SNAPSHOT
   ══════════════════════════════════════════════════════════════════════════ */

await test("COLOR-09/10. le snapshot fige la couleur ; repeindre ensuite ne touche pas le repas", async () => {
  const base = decor();
  const id = await listeAvecUnAliment(base, "Ta protéine");
  await definirCouleurDeListe(base.client, id, "blue");

  const avant = await lireSnapshotDeListe(base.client, id);
  assert.equal(avant?.colorKey, "blue");

  // Le coach repeint la bibliothèque APRÈS avoir posé l'occurrence.
  await definirCouleurDeListe(base.client, id, "red");

  // ⚠️ L'ANCIENNE OCCURRENCE GARDE `blue`. C'est ce que « snapshot » veut dire,
  // et c'est la même règle que pour la portion préférée et le minimum.
  const { state, mealId } = semaineAvecRepas();
  const repas = addChoiceSlot(state, "monday", mealId, avant!);
  const occurrences = findDay(repas, "monday")!.meals.find((m) => m.id === mealId)!.choiceSlots;
  assert.equal(occurrences[0].colorKey, "blue", "la couleur figée a suivi la bibliothèque");

  // Une NOUVELLE occurrence, elle, prend la nouvelle couleur.
  const apres = await lireSnapshotDeListe(base.client, id);
  assert.equal(apres?.colorKey, "red");

  // ⚠️ ET LA RPC LA SNAPSHOTE VRAIMENT. Sans cette assertion, une RPC qui
  // écrirait `null` à la place de la couleur reçue passerait tous les
  // contrôles TypeScript : le contrôle négatif l'a montré.
  assert.ok(DDL.includes("v_occ_color := nullif(v_occ->>'color_key', '')"),
    "la RPC ne lit plus la couleur de la charge utile");
  assert.ok(DDL.includes("color_key = excluded.color_key"),
    "la RPC ne met plus la couleur à jour sur l'occurrence");

  // Et la couleur figée PART bien vers la base : sans ça, un simple
  // ré-enregistrement l'effacerait.
  const payload = toWeekSavePayload(repas) as { days: readonly Record<string, unknown>[] };
  const lundi = payload.days.find((j) => j.day === "monday")!;
  const emis = (lundi.meals as readonly Record<string, unknown>[])[0];
  const slots = emis.choice_slots as readonly Record<string, unknown>[];
  assert.equal(slots[0].color_key, "blue");
});

await test("COLOR-11. l'élève ne lit JAMAIS food_lists pour la couleur", () => {
  // ⚠️ CE N'EST PAS UNE CONVENTION, C'EST LA BASE QUI L'IMPOSE : il n'existe
  // aucune policy `select` sur `food_lists` pour un élève. Le vérifier ici sur
  // le code, et dans la checklist SQL sur les policies.
  const CODE_LECTURE = sansProse(lire("../../lib/supabase/nutrition-week.ts"));
  assert.ok(!CODE_LECTURE.includes("food_lists"), "le lecteur élève touche food_lists");
  assert.ok(!CODE_CHOIX.includes("food_lists"));
  // La couleur vient de la colonne snapshotée, et le select la demande.
  assert.ok(CODE_LECTURE.includes('"id, meal_id, position, label, source_list_id, color_key, peut_etre_ignoree"'));
});

/* ══════════════════════════════════════════════════════════════════════════
   COLOR-12 + AJOUTS DU CAHIER — VOCABULAIRE ET RENDU
   ══════════════════════════════════════════════════════════════════════════ */

await test("COLOR-VOC. le vocabulaire est IDENTIQUE à celui de training_blocks, et il n'y a pas de pink", () => {
  assert.deepEqual([...COLOR_KEYS], ["gray", "red", "orange", "yellow", "green", "blue", "purple"]);
  // ⚠️ MÊMES VALEURS — ET SURTOUT MÊME SOURCE. L'égalité de contenu ne
  // suffirait pas : deux tables « égales » à l'instant T divergent au premier
  // ajout de teinte. On vérifie donc que `block-view-model` ASSIGNE la table
  // partagée au lieu de la redéfinir.
  //
  // (L'identité d'objet, elle, ne prouverait rien ici : `tsx` charge
  // `@/lib/ui/color-keys` et `../../lib/ui/color-keys` comme deux modules
  // distincts. Un test qui reposerait dessus mesurerait le résolveur, pas le
  // code.)
  assert.deepEqual(BLOCK_COLOR_STYLES, COLOR_STYLES);
  assert.deepEqual([...BLOCK_COLOR_KEYS], [...COLOR_KEYS]);
  assert.deepEqual([...BLOCK_COLOR_ORDER], [...COLOR_KEYS]);
  const VM = lire("../../components/admin/blocks/block-view-model.ts");
  assert.ok(/BLOCK_COLOR_STYLES[^=]*=\s*COLOR_STYLES;/.test(VM),
    "block-view-model redéfinit la table au lieu de réutiliser la table partagée");
  assert.ok(/BLOCK_COLOR_KEYS\s*=\s*COLOR_KEYS;/.test(lire("../../lib/training-block-editing.ts")));
  // La contrainte SQL dit exactement la même liste.
  for (const clef of COLOR_KEYS) assert.ok(DDL.includes(`'${clef}'`), `${clef} manque à la contrainte`);
  assert.ok(!/\bpink\b/i.test(MIGRATION), "« pink » n'existe nulle part dans le projet");
  assert.ok(!isColorKey("pink"));
  assert.ok(!isColorKey("#ff0000"), "aucune chaîne CSS arbitraire n'est acceptée");
});

await test("COLOR-DUP. il n'existe qu'UNE table de styles dans tout le dépôt", () => {
  // ⚠️ RECHERCHE EXHAUSTIVE, PAS UN ÉCHANTILLON. Un second mapping recopié
  // ailleurs est exactement ce que l'extraction devait empêcher.
  const racines = ["lib", "components", "app", "hooks"];
  const fichiers: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.(ts|tsx)$/.test(chemin)) fichiers.push(chemin);
    }
  };
  for (const racine of racines) parcourir(fileURLToPath(new URL(`../../${racine}`, import.meta.url)));

  const porteurs = fichiers.filter((f) => /borderLeft:\s*"border-l-/.test(readFileSync(f, "utf8")));

  // ⚠️ CANONICALISER AVANT DE COMPARER, ET POURQUOI ÇA N'AFFAIBLIT RIEN.
  // Le même fichier peut arriver ici sous deux écritures — chemin absolu du
  // poste, chemin relatif au dépôt — et deux écritures d'UN fichier se
  // liraient comme DEUX tables. La forme canonique retenue est le chemin
  // relatif à `process.cwd()` (la racine du dépôt, d'où `npm run` est lancé),
  // séparateurs normalisés en `/`. Elle ne dépend d'AUCUN poste : ni
  // `/root/miroir`, ni `/Users/…`, ni le nom du dossier de travail.
  // Le `Set` ne dédoublonne que des écritures d'un MÊME fichier ; deux
  // fichiers distincts restent deux entrées, donc une vraie seconde table
  // fait toujours rougir ce contrôle.
  const canoniser = (chemin: string) => relative(process.cwd(), chemin).split(sep).join("/");
  const uniques = [...new Set(porteurs.map(canoniser))].sort();

  assert.deepEqual(
    uniques,
    ["lib/ui/color-keys.ts"],
    `la table de styles est dupliquée : ${uniques.join(", ")}`,
  );
});

await test("COLOR-UI. le sélecteur est unique, accessible, et la couleur n'est jamais seule", () => {
  const PICKER = lire("../../components/ui/ColorKeyPicker.tsx");
  const BLOC = lire("../../components/admin/blocks/BlockColorPicker.tsx");
  // ⚠️ UN SEUL SÉLECTEUR : celui des blocs DÉLÈGUE, il ne recopie pas.
  assert.ok(BLOC.includes("<ColorKeyPicker"), "le sélecteur des blocs a été dupliqué");
  assert.ok(!BLOC.includes("role=\"menuitemradio\""), "la mécanique du menu est recopiée");

  // ⚠️ LE NOM ÉCRIT DE CHAQUE COULEUR, TOUJOURS. Une pastille seule est
  // invisible pour un lecteur d'écran et ambiguë pour un daltonien.
  assert.ok(PICKER.includes("aria-label={`Couleur ${style.label}`}"));
  assert.ok(PICKER.includes('aria-checked={selected}'));
  assert.ok(PICKER.includes('key === "Escape"'));
  assert.ok(PICKER.includes("min-h-11"), "la cible tactile doit rester ≥ 44 px");

  // Le sélecteur est bien branché dans l'éditeur de liste, avec « Aucune ».
  assert.ok(CODE_EDITEUR.includes("<ColorKeyPicker"));
  assert.ok(CODE_EDITEUR.includes("autoriserAucune"));
  // Et l'écran dit que c'est purement visuel : sans cette phrase, un coach
  // pourrait croire qu'il déclare un rôle.
  assert.ok(lire("../../components/admin/FoodListEditor.tsx").includes("Repère visuel uniquement"));
});

await test("COLOR-RENDU. l'accent élève est une barre latérale, jamais un remplissage", () => {
  const html = rendu([occurrence("s1", "Ta protéine", "red")]);
  assert.ok(html.includes(COLOR_STYLES.red.borderLeft), "la barre latérale n'est pas rendue");
  assert.ok(html.includes("border-l-4"));
  // ⚠️ JAMAIS DE FOND COLORÉ SUR LE BLOC. L'identité du projet est monochrome.
  assert.ok(!html.includes("bg-red-500"), "le bloc est rempli de couleur");
  // ⚠️ ET LE LIBELLÉ RESTE ÉCRIT. La couleur ne dit jamais seule ce qu'est
  // cette liste.
  assert.ok(html.includes("Ta protéine"));
});

/* ─────────────────────────── Utilitaires locaux ─────────────────────────── */

function occurrence(id: string, label: string, colorKey: string | null): MealChoiceSlot {
  return {
    id, label, sourceListId: null,
    colorKey: isColorKey(colorKey) ? colorKey : null,
    peutEtreIgnoree: false,
    options: [{ type: "aliment", id: POULET, optionId: `opt-${id}`, displayName: "Poulet" }],
  } as MealChoiceSlot;
}

function rendu(occurrences: readonly MealChoiceSlot[]): string {
  return renderToString(createElement(StudentMealChoices, { occurrences })).replace(/<!-- -->/g, "");
}

function semaineAvecRepas() {
  const state = addMeal(createBlankWeek(), "monday", "dinner");
  const mealId = findDay(state, "monday")!.meals[0].id;
  return { state, mealId };
}
