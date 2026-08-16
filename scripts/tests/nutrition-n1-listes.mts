/**
 * Harnais — N1.2 : LA BIBLIOTHÈQUE DE LISTES ALIMENTAIRES DU COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS NIVEAUX, ET CHACUN PROUVE CE QUE LES AUTRES NE PEUVENT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Les ÉCRITURES de `lib/supabase/food-lists.ts` sont EXÉCUTÉES contre un
 *    double qui reproduit les contraintes de la migration N1.1 — dont
 *    `food_list_items_position_unique`, NON DÉFERRABLE. C'est ce qui rend
 *    démontrable, et pas seulement affirmé, que la réécriture des positions
 *    doit se faire en deux passes.
 * 2. Le RENDU passe par `renderToString` : le dépôt n'a ni jsdom ni moteur de
 *    layout, donc aucun effet ne s'exécute et aucun doigt ne tape. Prétendre
 *    « simuler un clic » ici serait mentir sur ce qui est mesuré.
 * 3. Le RESPONSIVE ne se prouve que dans un moteur de rendu ; les chiffres
 *    sont dans le livrable. Ce fichier garde les INVARIANTS DE CODE dont la
 *    mesure a montré qu'ils étaient la cause.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE RÉELLE. Ces tests n'écrivent nulle part
 * ailleurs qu'en mémoire.
 *
 * Lancement : npm run test:nutrition-n1-listes
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { creerBaseListes } from "./helpers/food-lists-double";
import { FoodSearchPicker, cleIdentite } from "../../components/admin/FoodSearchPicker";
import {
  DECALAGE_REORDONNANCEMENT,
  ErreurLectureFoodLists,
  TENTATIVES_AJOUT,
  ajouterAlimentAListe,
  archiverFoodList,
  creerFoodList,
  dupliquerFoodList,
  lireFoodList,
  listerFoodLists,
  nomDeCopie,
  nomPropre,
  renommerFoodList,
  reordonnerFoodList,
  retirerAlimentDeListe,
} from "../../lib/supabase/food-lists";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Commentaires de LIGNE d'abord — leçon `app/admin/**` d'A5.9. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const SOURCE_WRITER = lire("../../lib/supabase/food-lists.ts");
const CODE_WRITER = sansProse(SOURCE_WRITER);
const CODE_HOOK = sansProse(lire("../../hooks/useFoodLists.ts"));
const CODE_INDEX = sansProse(lire("../../app/admin/nutrition/listes/page.tsx"));
const CODE_FICHE = sansProse(lire("../../app/admin/nutrition/listes/[listId]/page.tsx"));
const CODE_EDITEUR = sansProse(lire("../../components/admin/FoodListEditor.tsx"));
const CODE_LIGNE = sansProse(lire("../../components/admin/FoodListRow.tsx"));
const CODE_PICKER = sansProse(lire("../../components/admin/FoodSearchPicker.tsx"));
const CODE_NUTRITION = sansProse(lire("../../app/admin/nutrition/page.tsx"));
const CODE_SIDEBAR = sansProse(lire("../../components/admin/AdminSidebar.tsx"));

const ECRANS: readonly (readonly [string, string])[] = [
  ["index des listes", CODE_INDEX],
  ["ligne de l'index", CODE_LIGNE],
  ["fiche d'une liste", CODE_FICHE],
  ["éditeur", CODE_EDITEUR],
  ["recherche", CODE_PICKER],
];

/* ══════════════════════════════════════════════════════════════════════════
   LE DÉCOR — deux coaches, quatre aliments, un produit
   ══════════════════════════════════════════════════════════════════════════ */

const COACH_A = "11111111-1111-4111-8111-111111111111";
const COACH_B = "22222222-2222-4222-8222-222222222222";

const POULET = "aa000000-0000-4000-8000-000000000001";
const RIZ = "aa000000-0000-4000-8000-000000000002";
const BROCOLI = "aa000000-0000-4000-8000-000000000003";
const SAUMON = "aa000000-0000-4000-8000-000000000004";
const SKYR = "bb000000-0000-4000-8000-000000000001";

function decor() {
  const base = creerBaseListes();
  base.connecter(COACH_A);
  const catalogue = base.table("food_catalog");
  catalogue.push(
    { id: POULET, name: "Blanc de poulet", nutrition_unit: "g", protein_per_100: 23, carb_per_100: 0, fat_per_100: 2, piece_weight_g: null },
    { id: RIZ, name: "Riz basmati cru", nutrition_unit: "g", protein_per_100: 8, carb_per_100: 78, fat_per_100: 1, piece_weight_g: null },
    { id: BROCOLI, name: "Brocoli", nutrition_unit: "g", protein_per_100: 3, carb_per_100: 2, fat_per_100: 0.4, piece_weight_g: null },
    { id: SAUMON, name: "Saumon", nutrition_unit: "g", protein_per_100: 20, carb_per_100: 0, fat_per_100: 13, piece_weight_g: null },
  );
  base.table("food_products").push({
    id: SKYR, gtin: "5701184005514", product_name: "Skyr nature", brand: "Arla",
    nutrition_unit: "g", protein_per_100: 11, carb_per_100: 4, fat_per_100: 0.2,
    image_url: null, detail_fetched_at: "2026-08-01T10:00:00Z",
  });
  return base;
}

/** Une liste garnie des aliments demandés, dans l'ordre. */
async function listeGarnie(
  base: ReturnType<typeof decor>,
  nom: string,
  aliments: readonly string[],
): Promise<string> {
  const id = await creerFoodList(base.client, COACH_A, nom);
  assert.ok(id, "la liste n'a pas été créée");
  for (const aliment of aliments) {
    const r = await ajouterAlimentAListe(base.client, id!, { type: "aliment", id: aliment });
    assert.equal(r, "ajoute");
  }
  return id!;
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-01..03 — L'INTÉGRATION DANS L'ADMIN EXISTANT
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-01. l'écran est atteignable depuis Nutrition, comme Recettes", () => {
  // ⚠️ UNE PAGE SANS PORTE D'ENTRÉE N'EST PAS INTÉGRÉE : elle ne serait
  // atteignable qu'en tapant l'URL.
  assert.ok(CODE_NUTRITION.includes('href="/admin/nutrition/listes"'), "aucun lien vers les listes");
  assert.ok(CODE_NUTRITION.includes("Listes"), "le lien n'est pas nommé");
  // Le lien voisine celui des recettes, dans le même conteneur d'actions.
  assert.ok(CODE_NUTRITION.includes('href="/admin/nutrition/recettes"'), "le lien Recettes a disparu");
});

await test("N1.2-02. aucune navigation parallèle n'est créée", () => {
  // La barre latérale garde « Nutrition » comme lien PLAT. Y ajouter une
  // sous-entrée créerait deux chemins vers le même écran, et un état actif à
  // maintenir dans deux endroits.
  assert.ok(!CODE_SIDEBAR.includes("/admin/nutrition/listes"), "sous-navigation ajoutée à la sidebar");
  assert.ok(!CODE_SIDEBAR.includes("/admin/nutrition/recettes"), "le précédent Recettes a changé");
});

await test("N1.2-03. le fil d'ariane remonte, dans les deux écrans", () => {
  assert.ok(CODE_INDEX.includes('href="/admin/nutrition"'), "l'index ne remonte pas vers Nutrition");
  assert.ok(CODE_FICHE.includes('href="/admin/nutrition/listes"'), "la fiche ne remonte pas vers l'index");
  assert.ok(CODE_INDEX.includes("ArrowLeft") && CODE_FICHE.includes("ArrowLeft"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-04..07 — CRÉER, NOMMER, RENOMMER
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-04. le nom est nettoyé, et un nom vide est refusé", async () => {
  const base = decor();
  assert.equal(nomPropre("  Protéines   maigres  "), "Protéines maigres");
  assert.equal(nomPropre("   "), "");

  const id = await creerFoodList(base.client, COACH_A, "  Protéines   maigres  ");
  assert.ok(id);
  assert.equal(base.table("food_lists")[0].name, "Protéines maigres");

  // ⚠️ REFUSÉ AVANT L'ALLER-RETOUR : la contrainte `food_lists_name_not_blank`
  // le dirait aussi, mais une requête partie pour rien est une requête de trop.
  const vide = await creerFoodList(base.client, COACH_A, "   ");
  assert.equal(vide, null);
  assert.equal(base.table("food_lists").length, 1, "une liste sans nom a été créée");
});

await test("N1.2-05. renommer change le nom, et rien d'autre", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET, RIZ]);
  const avant = base.table("food_list_items").map((l) => ({ ...l }));

  assert.equal(await renommerFoodList(base.client, id, "  Protéines  animales "), true);
  assert.equal(base.table("food_lists")[0].name, "Protéines animales");
  assert.deepEqual(base.table("food_list_items"), avant, "les aliments ont bougé");

  assert.equal(await renommerFoodList(base.client, id, "  "), false);
  assert.equal(base.table("food_lists")[0].name, "Protéines animales", "un nom vide est passé");
});

await test("N1.2-06. le nom se renomme au bouton, les aliments s'écrivent tout de suite", () => {
  // Le NOM est une frappe continue : écrire à chaque lettre enverrait vingt
  // requêtes pour un mot. Les aliments, eux, sont des gestes discrets.
  assert.ok(CODE_EDITEUR.includes("Renommer"), "aucun bouton de renommage");
  assert.ok(CODE_EDITEUR.includes("renommerFoodList(c, liste.id, nom)"));
  // ⚠️ PAS DE BROUILLON LOCAL DES ALIMENTS : un onglet fermé perdrait le
  // travail, et il faudrait réconcilier deux ordres.
  assert.ok(!CODE_EDITEUR.includes("Enregistrer les aliments"));
  assert.ok(CODE_EDITEUR.includes("ajouterAlimentAListe(c, liste.id, cible)"));
});

await test("N1.2-07. dupliquer produit une copie indépendante, dans le même ordre", async () => {
  const base = decor();
  const source = await listeGarnie(base, "Protéines", [POULET, SAUMON]);
  assert.equal(nomDeCopie("Protéines"), "Protéines — copie");

  const copie = await dupliquerFoodList(base.client, COACH_A, source, nomDeCopie("Protéines"));
  assert.ok(copie && copie !== source);

  const lue = await lireFoodList(base.client, copie!);
  assert.equal(lue?.name, "Protéines — copie");
  assert.deepEqual(
    lue?.items.map((i) => (i.source === "aliment" ? i.aliment.id : i.produit.id)),
    [POULET, SAUMON],
    "l'ordre n'est pas conservé",
  );
  assert.deepEqual(lue?.items.map((i) => i.position), [1, 2]);

  // ⚠️ INDÉPENDANTE PAR CONSTRUCTION : aucune colonne ne relie une copie à sa
  // source. On le vérifie en modifiant la copie et en relisant l'original.
  await retirerAlimentDeListe(base.client, copie!, lue!.items[0].id);
  const originale = await lireFoodList(base.client, source);
  assert.equal(originale?.items.length, 2, "toucher la copie a atteint l'original");
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-08..10 — AJOUTER : IDENTITÉS RÉELLES, DOUBLONS, PORTÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-08. un aliment ajouté prend la position suivante", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Féculents", [RIZ]);
  assert.deepEqual(base.positions(id), [1]);
  await ajouterAlimentAListe(base.client, id, { type: "produit", id: SKYR });
  assert.deepEqual(base.positions(id), [1, 2]);

  const lue = await lireFoodList(base.client, id);
  assert.equal(lue?.items[1].source, "produit");
  // Le produit est résolu contre sa source VIVANTE, marque comprise.
  assert.equal(lue?.items[1].source === "produit" ? lue.items[1].produit.brand : null, "Arla");
});

await test("N1.2-09. le même aliment deux fois dans une liste : refusé, sans erreur", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET]);
  const encore = await ajouterAlimentAListe(base.client, id, { type: "aliment", id: POULET });
  // ⚠️ « DÉJÀ PRÉSENT » N'EST PAS UNE ERREUR. L'index unique partiel rend
  // 23505, et la couche le traduit en information.
  assert.equal(encore, "deja-present");
  assert.equal(base.table("food_list_items").length, 1, "un doublon est entré");
  assert.deepEqual(base.positions(id), [1], "la position a avancé pour rien");
});

await test("N1.2-10. le même aliment dans DEUX listes : accepté", async () => {
  const base = decor();
  const a = await listeGarnie(base, "Protéines", [POULET]);
  const b = await creerFoodList(base.client, COACH_A, "Midi");
  const r = await ajouterAlimentAListe(base.client, b!, { type: "aliment", id: POULET });
  assert.equal(r, "ajoute", "l'unicité déborde d'une liste sur l'autre");
  assert.equal(base.table("food_list_items").filter((l) => l.catalog_food_id === POULET).length, 2);
  assert.deepEqual(base.positions(a), [1]);
  assert.deepEqual(base.positions(b!), [1]);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-11..13 — L'ORDRE : CONTINU, ET ÉCRIT EN DEUX PASSES
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-11. réordonner réussit malgré une contrainte NON DÉFERRABLE", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Légumes", [POULET, RIZ, BROCOLI]);
  const lue = await lireFoodList(base.client, id);
  const [a, b, c] = lue!.items.map((i) => i.id);

  /* ── CONTRÔLE NÉGATIF N1.2-NC1, PERMANENT ────────────────────────────────
   * La même permutation écrite en UNE passe échoue : poser la position 1 sur
   * `c` alors que `a` la détient encore lève 23505. Ce contrôle vit DANS le
   * test parce que c'est lui qui donne son sens au détour par 1000 — sans lui,
   * les deux upserts ressembleraient à une précaution gratuite. */
  const naif = base.ecrirePositionsEnUnePasse(id, [c, a, b]);
  assert.equal(naif?.code, "23505", "l'écriture naïve aurait dû échouer");
  assert.match(naif!.message, /food_list_items_position_unique/);
  assert.deepEqual(base.positions(id), [1, 2, 3], "l'échec a laissé des positions écrites");

  const avant = base.journal.length;
  assert.equal(await reordonnerFoodList(base.client, id, [c, a, b]), true);

  const après = await lireFoodList(base.client, id);
  assert.deepEqual(après?.items.map((i) => i.id), [c, a, b], "l'ordre demandé n'est pas appliqué");
  assert.deepEqual(après?.items.map((i) => i.position), [1, 2, 3], "positions non continues");

  // DEUX instructions d'écriture, pas 2N : le décalage puis les positions.
  const écritures = base.journal.slice(avant).filter((e) => e.startsWith("upsert:"));
  assert.deepEqual(écritures, ["upsert:food_list_items:3", "upsert:food_list_items:3"]);
  assert.equal(DECALAGE_REORDONNANCEMENT, 1000);
});

await test("N1.2-12. un ordre partiel ne perd aucun aliment", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Légumes", [POULET, RIZ, BROCOLI]);
  const lue = await lireFoodList(base.client, id);
  const [a, b, c] = lue!.items.map((i) => i.id);

  // Seul `c` est nommé ; `a` et `b` reviennent derrière, dans leur ordre.
  assert.equal(await reordonnerFoodList(base.client, id, [c, "identifiant-inconnu"]), true);
  const après = await lireFoodList(base.client, id);
  assert.deepEqual(après?.items.map((i) => i.id), [c, a, b]);
  assert.deepEqual(après?.items.map((i) => i.position), [1, 2, 3]);
});

await test("N1.2-13. retirer renumérote : aucun trou, aucun zéro", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Légumes", [POULET, RIZ, BROCOLI, SAUMON]);
  const lue = await lireFoodList(base.client, id);
  const [, b] = lue!.items.map((i) => i.id);

  assert.equal(await retirerAlimentDeListe(base.client, id, b), true);
  assert.deepEqual(base.positions(id), [1, 2, 3], "la renumérotation a laissé un trou");

  const après = await lireFoodList(base.client, id);
  assert.deepEqual(
    après?.items.map((i) => (i.source === "aliment" ? i.aliment.id : i.produit.id)),
    [POULET, BROCOLI, SAUMON],
    "l'ordre relatif a changé",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-14..16 — ARCHIVER, JAMAIS SUPPRIMER
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-14. les archivées sortent de la liste par défaut, et reviennent sur demande", async () => {
  const base = decor();
  const gardée = await listeGarnie(base, "Protéines", [POULET]);
  const rangée = await listeGarnie(base, "Anciennes", [RIZ]);

  assert.equal(await archiverFoodList(base.client, rangée, true), true);

  const visibles = await listerFoodLists(base.client);
  assert.deepEqual(visibles.map((l) => l.name), ["Protéines"]);
  assert.equal(visibles[0].nbAliments, 1, "le compte d'aliments est faux");

  const toutes = await listerFoodLists(base.client, { avecArchivees: true });
  assert.deepEqual(toutes.map((l) => l.name), ["Anciennes", "Protéines"], "tri par nom attendu");
  assert.ok(toutes.find((l) => l.id === rangée)?.archivedAt, "l'archivage n'est pas visible");

  // Désarchiver la remet dans le flux, avec ses aliments intacts.
  assert.equal(await archiverFoodList(base.client, rangée, false), true);
  assert.equal((await listerFoodLists(base.client)).length, 2);
  assert.equal((await lireFoodList(base.client, rangée))?.items.length, 1);
  assert.ok(gardée);
});

await test("N1.2-15. aucune suppression de liste n'est offerte à l'utilisateur", () => {
  // ⚠️ PAS DE DELETE DESTRUCTIF EN UX N1.2. Une liste supprimée emporterait
  // ses items par cascade ; l'archivage ne casse rien, puisque les repas déjà
  // construits ne lisent pas la bibliothèque.
  assert.ok(!CODE_WRITER.includes("supprimerFoodList"), "une suppression de liste est exportée");
  for (const [nom, code] of ECRANS) {
    assert.ok(!code.includes("Supprimer"), `un bouton Supprimer est présent — ${nom}`);
    assert.ok(!/\.delete\(\)/.test(code), `un delete est écrit dans l'écran ${nom}`);
  }

  // ── LES DEUX SEULS `.delete()` DE LA COUCHE, ET LEUR PORTÉE EXACTE ────────
  const suppressions = CODE_WRITER.match(/\.delete\(\)/g) ?? [];
  assert.equal(suppressions.length, 2, "une troisième suppression est apparue dans la couche");

  // 1. Retirer UN aliment. Jamais une liste.
  assert.ok(CODE_WRITER.includes('from("food_list_items").delete().eq("id", itemId)'));

  // 2. Le ROLLBACK d'une duplication ratée — et il vit DANS `dupliquerFoodList`,
  //    pas ailleurs. C'est ce qui empêche une « suppression de liste » de
  //    réapparaître un jour sous couvert de nettoyage.
  const debut = CODE_WRITER.indexOf("export async function dupliquerFoodList");
  const suite = CODE_WRITER.indexOf("export function nomDeCopie");
  assert.ok(debut > 0 && suite > debut, "la couche n'a plus la forme attendue");
  const corpsDuplication = CODE_WRITER.slice(debut, suite);
  const horsDuplication = CODE_WRITER.slice(0, debut) + CODE_WRITER.slice(suite);

  assert.ok(
    /from\("food_lists"\)[\s\S]{0,80}\.delete\(\)/.test(corpsDuplication),
    "le rollback de duplication a disparu",
  );
  assert.ok(
    !/from\("food_lists"\)[\s\S]{0,80}\.delete\(\)/.test(horsDuplication),
    "une suppression de liste existe hors du rollback de duplication",
  );
  // Et elle ne peut viser que la liste qui vient d'être créée ici.
  assert.ok(corpsDuplication.includes('.eq("id", nouvelId)'));
});

await test("N1.2-16. l'écran dit qu'une liste archivée n'est pas perdue", () => {
  assert.ok(CODE_EDITEUR.includes("Cette liste est archivée"));
  assert.ok(CODE_EDITEUR.includes("Désarchiver"), "l'archivage est sans retour");
  assert.ok(CODE_INDEX.includes("Voir les archivées"));
  assert.ok(CODE_INDEX.includes("Elles ne sont pas supprimées."));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-17..18 — DEUX COACHES : LA RLS
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-17. un coach ne voit que ses listes", async () => {
  const base = decor();
  await listeGarnie(base, "Protéines de A", [POULET]);

  base.connecter(COACH_B);
  const chezB = await creerFoodList(base.client, COACH_B, "Protéines de B");
  assert.ok(chezB);
  const vuesParB = await listerFoodLists(base.client);
  assert.deepEqual(vuesParB.map((l) => l.name), ["Protéines de B"]);

  base.connecter(COACH_A);
  const vuesParA = await listerFoodLists(base.client);
  assert.deepEqual(vuesParA.map((l) => l.name), ["Protéines de A"]);
});

await test("N1.2-18. la liste d'un autre coach est INTROUVABLE, pas « interdite »", async () => {
  const base = decor();
  const listeDeA = await listeGarnie(base, "Protéines de A", [POULET, RIZ]);

  base.connecter(COACH_B);
  // ⚠️ MÊME RÉPONSE QU'UNE LISTE INEXISTANTE. Distinguer les deux messages
  // révélerait l'existence d'une liste qu'on n'a pas le droit de voir.
  assert.equal(await lireFoodList(base.client, listeDeA), null);
  assert.equal(await lireFoodList(base.client, "00000000-0000-4000-8000-000000000000"), null);

  // Et l'écriture ne passe pas davantage : elle ne touche AUCUNE ligne.
  assert.equal(await renommerFoodList(base.client, listeDeA, "Volée"), true);
  base.connecter(COACH_A);
  assert.equal(base.table("food_lists")[0].name, "Protéines de A", "un autre coach a renommé");
  assert.equal((await lireFoodList(base.client, listeDeA))?.items.length, 2);

  // Le hook ne raconte pas laquelle des deux causes c'est.
  assert.ok(CODE_HOOK.includes("introuvable"));
  assert.ok(CODE_FICHE.includes("Cette liste est introuvable."));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-19..20 — L'INSTANTANÉ DES REPAS DÉJÀ CONSTRUITS
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-19. renommer une liste ne renomme PAS une occurrence déjà posée", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET, SAUMON]);

  // Une occurrence a été ajoutée à un repas : son libellé est une COPIE du nom
  // de la liste au moment de l'ajout (`meal_choice_slots.label`).
  base.table("meal_choice_slots").push({
    id: "slot-1", meal_id: "repas-1", position: 1,
    label: "Protéines", source_list_id: id,
  });
  base.table("meal_choice_options").push(
    { id: "opt-1", slot_id: "slot-1", position: 1, catalog_food_id: POULET, product_id: null },
    { id: "opt-2", slot_id: "slot-1", position: 2, catalog_food_id: SAUMON, product_id: null },
  );

  assert.equal(await renommerFoodList(base.client, id, "Protéines animales"), true);
  assert.equal(base.table("meal_choice_slots")[0].label, "Protéines", "le libellé snapshoté a suivi");

  // Retirer un aliment de la bibliothèque ne retire pas l'option du repas.
  const lue = await lireFoodList(base.client, id);
  await retirerAlimentDeListe(base.client, id, lue!.items[0].id);
  assert.equal(base.table("meal_choice_options").length, 2, "une option du repas a disparu");

  // Archiver non plus.
  await archiverFoodList(base.client, id, true);
  assert.equal(base.table("meal_choice_options").length, 2);
  assert.equal(base.table("meal_choice_slots")[0].label, "Protéines");
});

await test("N1.2-20. la couche N1.2 n'écrit JAMAIS dans les tables de repas", () => {
  // ⚠️ LA GARANTIE EST L'ABSENCE DE CHEMIN, PAS UN DRAPEAU. `food-lists.ts`
  // ne nomme aucune des tables de planification — ni en lecture, ni en
  // écriture. C'est ce qui rend le test précédent structurel.
  // ⚠️ ON CHERCHE UN NOM DE TABLE, PAS UNE SOUS-CHAÎNE. Chercher « meals » nu
  // trouve `@/lib/supabase/consumed-meals` — un import parfaitement légitime —
  // et rendrait ce test rouge pour une raison qui n'existe pas.
  for (const table of ["meal_choice_slots", "meal_choice_options", "planned_meals", "planned_meal_items", "meals", "consumed_meals"]) {
    const appel = `from("${table}")`;
    assert.ok(!CODE_WRITER.includes(appel), `la couche touche ${table}`);
    for (const [nom, code] of ECRANS) {
      assert.ok(!code.includes(appel), `${nom} touche ${table}`);
    }
  }
  // Et le contrôle reste discriminant : c'est bien ainsi que la couche nomme
  // les tables qu'elle a le droit de toucher.
  assert.ok(CODE_WRITER.includes('from("food_lists")') && CODE_WRITER.includes('from("food_list_items")'));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-21..22 — NI MACRO, NI QUANTITÉ, NI RÔLE ; ET UNE SEULE RECHERCHE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-21. une liste ne porte ni macro, ni quantité, ni rôle", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET]);

  // Ce qui est réellement écrit dans `food_list_items` : quatre colonnes.
  const ligne = base.table("food_list_items")[0];
  const colonnes = Object.keys(ligne).filter((c) => c !== "id" && c !== "created_at").sort();
  assert.deepEqual(colonnes, ["catalog_food_id", "list_id", "position", "product_id"]);
  for (const interdite of ["name", "protein_per_100", "carb_per_100", "fat_per_100", "grams", "role", "solver_role"]) {
    assert.ok(!(interdite in ligne), `la colonne ${interdite} a été écrite`);
  }

  // Les macros AFFICHÉES sont lues à la source, et suivent donc le catalogue.
  const catalogue = base.table("food_catalog").find((f) => f.id === POULET)!;
  catalogue.protein_per_100 = 31;
  const relue = await lireFoodList(base.client, id);
  assert.equal(relue?.items[0].source === "aliment" ? relue.items[0].aliment.proteinPer100 : 0, 31);

  // ⚠️ AUCUN ÉCRAN NE DEMANDE UNE QUANTITÉ À MANGER, ET C'EST TOUJOURS VRAI.
  // N1.5.1 a ajouté UNE saisie numérique, et une seule : la PORTION PRÉFÉRÉE,
  // qui n'est pas une quantité à manger mais une indication pour le calcul —
  // le solveur s'en écarte librement, et les plafonds la dominent. La règle
  // reste donc entière ailleurs, et l'exception est nommée plutôt que
  // silencieusement tolérée.
  for (const [nom, code] of ECRANS) {
    if (nom === "éditeur") {
      // ⚠️ DEUX SAISIES DEPUIS N1.5.2, ET LEURS DEUX NATURES SONT NOMMÉES :
      // la PORTION PRÉFÉRÉE (indication dont le calcul s'écarte) et la
      // QUANTITÉ MINIMALE (garantie de présence). Ni l'une ni l'autre n'est
      // une quantité à manger, et il n'y en a pas une troisième.
      const champs = code.match(/type="number"/g) ?? [];
      assert.equal(champs.length, 2, "l'éditeur ne doit porter QUE les deux saisies de quantité");
      assert.ok(code.includes("Portion préférée"), "la portion préférée doit être nommée");
      assert.ok(code.includes("Quantité minimale"), "la quantité minimale doit être nommée");
      // ⚠️ « Quantité » TOUT COURT SERAIT TROP LARGE depuis N1.5.2 :
      // « Quantité minimale » est légitime. Ce qui reste interdit, c'est une
      // quantité À MANGER — celle-là appartient à l'élève, pas au coach.
      for (const interdit of ["grammes à manger", "Quantité à manger", "Quantité consommée"]) {
        assert.ok(!code.includes(interdit), `« ${interdit} » est demandé au coach`);
      }
    } else {
      assert.ok(!code.includes('type="number"'), `saisie numérique dans ${nom}`);
    }
    assert.ok(!/solver_role|solverRole/.test(code), `un rôle apparaît dans ${nom}`);
  }
});

await test("N1.2-22. la recherche d'aliments est CELLE de l'élève, pas une seconde", () => {
  // ⚠️ UN SEUL MOTEUR. Deux recherches donneraient deux classements, deux
  // seuils et deux dédoublonnages — et le coach ne verrait pas les mêmes
  // aliments que son élève.
  assert.ok(CODE_PICKER.includes("searchCatalogFoods"));
  assert.ok(CODE_PICKER.includes("searchCachedProducts"));
  assert.ok(CODE_PICKER.includes('from "@/lib/supabase/consumed-meals"'));
  // Aucune requête bâtie sur place.
  assert.ok(!CODE_PICKER.includes(".ilike("), "une seconde recherche est écrite ici");
  assert.ok(!CODE_PICKER.includes('.from("food_catalog")'));

  // ⚠️ AUCUNE SAISIE LIBRE : le composant rend une identité, jamais un nom.
  assert.ok(CODE_PICKER.includes('onChoisir({ type: "aliment", id: a.id })'));
  assert.ok(CODE_PICKER.includes('onChoisir({ type: "produit", id: p.id })'));
  assert.equal(cleIdentite({ type: "aliment", id: POULET }), `aliment:${POULET}`);
  assert.equal(cleIdentite({ type: "produit", id: SKYR }), `produit:${SKYR}`);

  // Un aliment déjà présent reste VISIBLE mais inactif, et le dit.
  const html = renderToString(
    createElement(FoodSearchPicker, {
      onChoisir: () => {},
      dejaPresents: new Set([`aliment:${POULET}`]),
    }),
  );
  assert.ok(html.includes("Rechercher un aliment"));
  assert.ok(html.includes("min-h-[44px]"), "cible tactile de 44 px");
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-23..24 — LES ÉTATS, ET LE RESPONSIVE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-23. aucun écran blanc : chaque état a sa phrase", () => {
  // Chargement, erreur, aucune liste, liste vide, introuvable, archivée,
  // écriture en cours.
  assert.ok(CODE_INDEX.includes("Chargement…"));
  assert.ok(CODE_FICHE.includes("Chargement…"));
  assert.ok(CODE_INDEX.includes("Aucune liste pour le moment"));
  assert.ok(CODE_EDITEUR.includes("Cette liste est vide"));
  assert.ok(CODE_PICKER.includes("Aucun aliment ne correspond"));
  assert.ok(CODE_PICKER.includes("Deux lettres au minimum."));
  assert.ok(CODE_FICHE.includes("Cette liste est introuvable."));
  assert.ok(CODE_EDITEUR.includes("Cette liste est archivée"));
  // L'écriture en cours désarme les boutons et se montre.
  assert.ok(CODE_EDITEUR.includes("Loader2") && CODE_EDITEUR.includes("disabled={occupe}"));
  assert.ok(CODE_INDEX.includes("Loader2"));

  // Les erreurs sont annoncées aux lecteurs d'écran, l'information ne l'est pas.
  for (const [nom, code] of [["index", CODE_INDEX], ["éditeur", CODE_EDITEUR], ["recherche", CODE_PICKER]] as const) {
    assert.ok(code.includes('role="alert"'), `pas de role=alert dans ${nom}`);
  }
  assert.ok(CODE_EDITEUR.includes('role="status"'));

  // ⚠️ `chargement` NE REPASSE JAMAIS À VRAI : un refetch qui remet l'écran en
  // « Chargement… » démonterait le formulaire en cours de saisie.
  assert.ok(CODE_HOOK.includes("premier) setChargement(false)"));
  assert.ok(!CODE_HOOK.includes("setChargement(true)"), "le chargement est réarmé");
});

await test("N1.2-24. rien ne peut déborder horizontalement", () => {
  // Les invariants dont la mesure en moteur de rendu a montré qu'ils étaient
  // la cause : la chaîne de `min-w-0`, le `truncate` des noms, et l'absence
  // des motifs qui recréent le défaut.
  for (const [nom, code] of ECRANS) {
    assert.ok(!code.includes("w-screen"), `w-screen dans ${nom}`);
    assert.ok(!code.includes("100vw"), `100vw dans ${nom}`);
    // ⚠️ `\b` NE SUFFIT PAS : dans « min-w-[44px] », le tiret ouvre une
    // frontière de mot, et la règle condamnerait les cibles tactiles de 44 px
    // qu'elle est justement censée exiger. On exclut donc explicitement un
    // préfixe collé (`min-`, `max-`).
    assert.ok(!/(?<![\w-])w-\[\d+px\]/.test(code), `largeur fixe en px dans ${nom}`);
    assert.ok(!code.includes("overflow-x-auto"), `débordement avalé par un défilement dans ${nom}`);
    assert.ok(code.includes("min-w-0"), `aucun min-w-0 dans ${nom}`);
  }
  // Un nom d'aliment long est TRONQUÉ, il ne pousse pas la ligne.
  assert.ok(CODE_EDITEUR.includes("truncate"));
  assert.ok(CODE_PICKER.includes("truncate"));
  assert.ok(CODE_LIGNE.includes("truncate"), "le nom de liste n'est pas tronqué");
  assert.ok(CODE_LIGNE.includes("flex-shrink-0"), "l'action de la ligne peut être écrasée");
  // Les actions passent à la ligne au lieu de dépasser.
  assert.ok(CODE_EDITEUR.includes("flex-wrap"));
  assert.ok(CODE_LIGNE.includes("flex-wrap"));
  // Toutes les cibles tactiles font 44 px, et chaque bouton-icône est nommé.
  assert.ok(CODE_EDITEUR.includes("min-h-[44px] min-w-[44px]"));
  assert.ok(CODE_EDITEUR.includes("aria-label={libelle}"));
  assert.ok(CODE_LIGNE.includes('aria-label={`Dupliquer ${liste.name}`}'));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-ERR-1..4 — UNE ERREUR DE LECTURE N'EST PAS UNE ABSENCE DE DONNÉES

   ⚠️ C'EST LE DÉFAUT LE PLUS DANGEREUX DU LOT, PARCE QU'IL EST SILENCIEUX.
   Un `data ?? []` posé après une erreur ne casse rien : il rend un écran
   calme, vide, et faux. Le coach conclut qu'il a perdu sa bibliothèque, ou
   qu'une liste est vide — et il la re-remplit par-dessus.
   ══════════════════════════════════════════════════════════════════════════ */

/** L'erreur qu'un PostgREST en panne rend réellement. */
const PANNE = { code: "57014", message: "canceling statement due to statement timeout" };

await test("N1.2-ERR-1. échec du SELECT food_lists : erreur, PAS « aucune liste »", async () => {
  const base = decor();
  await listeGarnie(base, "Protéines", [POULET]);

  base.injecter({ op: "select", table: "food_lists", erreur: PANNE });
  await assert.rejects(
    () => listerFoodLists(base.client),
    (e: unknown) => e instanceof ErreurLectureFoodLists && e.code === "57014",
    "la panne a été rendue comme un tableau vide",
  );

  // Le hook traduit ce rejet en état d'erreur — et l'écran montre l'erreur
  // AVANT de conclure « aucune liste » : l'ordre des branches compte.
  assert.ok(CODE_HOOK.includes("Les listes n'ont pas pu être chargées."));
  const brancheErreur = CODE_INDEX.indexOf("erreur ?");
  const brancheVide = CODE_INDEX.indexOf("listes.length === 0 ?");
  assert.ok(brancheErreur > 0 && brancheVide > brancheErreur, "« aucune liste » passe avant l'erreur");
});

await test("N1.2-ERR-2. échec du SELECT d'une liste : erreur, PAS « introuvable »", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET]);

  base.injecter({ op: "select", table: "food_lists", erreur: PANNE });
  await assert.rejects(() => lireFoodList(base.client, id), ErreurLectureFoodLists);

  // ⚠️ `null` GARDE UN SENS UNIQUE : « pas de ligne visible ». Une liste
  // réellement absente rend toujours `null`, sans jeter.
  assert.equal(await lireFoodList(base.client, "00000000-0000-4000-8000-000000000000"), null);

  const brancheErreur = CODE_FICHE.indexOf("erreur ?");
  const brancheIntrouvable = CODE_FICHE.indexOf("introuvable || !liste ?");
  assert.ok(brancheErreur > 0 && brancheIntrouvable > brancheErreur, "« introuvable » passe avant l'erreur");
  // Et le hook ne pose PAS `introuvable` sur le chemin d'erreur.
  assert.ok(!/catch[\s\S]{0,200}setIntrouvable/.test(CODE_HOOK), "introuvable posé dans le catch");
});

await test("N1.2-ERR-3. échec du SELECT food_list_items : la liste n'est jamais rendue vide", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET, RIZ, BROCOLI]);

  base.injecter({ op: "select", table: "food_list_items", erreur: PANNE });
  await assert.rejects(
    () => lireFoodList(base.client, id),
    (e: unknown) => e instanceof ErreurLectureFoodLists && e.contexte === "lireFoodList (items)",
    "les aliments illisibles ont été rendus comme une liste vide",
  );

  // Une liste réellement vide, elle, se lit sans erreur — sinon ce test
  // confondrait « vide » et « en panne » dans l'autre sens.
  const vide = await creerFoodList(base.client, COACH_A, "Vide");
  assert.deepEqual((await lireFoodList(base.client, vide!))?.items, []);
});

await test("N1.2-ERR-4. échec du comptage : jamais « 0 aliment » en silence", async () => {
  const base = decor();
  await listeGarnie(base, "Protéines", [POULET, RIZ]);

  // Le premier SELECT (food_lists) passe ; c'est le comptage qui tombe.
  base.injecter({ op: "select", table: "food_list_items", erreur: PANNE });
  await assert.rejects(
    () => listerFoodLists(base.client),
    (e: unknown) => e instanceof ErreurLectureFoodLists && e.contexte === "listerFoodLists (compte)",
    "le comptage en panne a été rendu comme 0 aliment",
  );

  // Sans panne, le compte est juste — le test resterait vert s'il ne mesurait
  // que l'exception.
  assert.equal((await listerFoodLists(base.client))[0].nbAliments, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-RACE-1 — 23505 N'EST PAS UN SYNONYME DE « DÉJÀ PRÉSENT »
   ══════════════════════════════════════════════════════════════════════════ */

const COLLISION_POSITION = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "food_list_items_position_unique"',
};

await test("N1.2-RACE-1. une collision de POSITION n'est jamais « déjà présent »", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET]);

  // Course : un autre onglet a pris la position pendant qu'on insérait. Deux
  // aliments DIFFÉRENTS — il n'y a aucun doublon d'identité ici.
  base.injecter({ op: "insert", table: "food_list_items", erreur: COLLISION_POSITION });
  const resultat = await ajouterAlimentAListe(base.client, id, { type: "aliment", id: RIZ });
  assert.notEqual(resultat, "deja-present", "une collision de position a été annoncée comme un doublon");
  // La tentative suivante relit la position et aboutit.
  assert.equal(resultat, "ajoute");
  assert.deepEqual(base.positions(id), [1, 2]);

  // Collision DURABLE : on ne boucle pas, on rend une vraie erreur.
  base.injecter({ op: "insert", table: "food_list_items", erreur: COLLISION_POSITION, fois: TENTATIVES_AJOUT });
  const durable = await ajouterAlimentAListe(base.client, id, { type: "aliment", id: BROCOLI });
  assert.equal(durable, "erreur", "une panne durable a été maquillée");
  assert.notEqual(durable, "deja-present");
  assert.equal(base.table("food_list_items").filter((l) => l.list_id === id).length, 2);

  // ⚠️ ET LE CAS LÉGITIME RESTE INTACT : même aliment, même liste.
  const doublon = await ajouterAlimentAListe(base.client, id, { type: "aliment", id: POULET });
  assert.equal(doublon, "deja-present");

  // Un 23505 d'une contrainte qu'on ne sait pas nommer n'est PAS un doublon.
  base.injecter({
    op: "insert", table: "food_list_items",
    erreur: { code: "23505", message: 'duplicate key value violates unique constraint "une_contrainte_inconnue"' },
  });
  assert.equal(await ajouterAlimentAListe(base.client, id, { type: "produit", id: SKYR }), "erreur");
});

await test("N1.2-RACE-2. une lecture de position en panne n'insère rien à l'aveugle", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Protéines", [POULET, RIZ]);

  // ⚠️ SANS CE GARDE, `data ?? []` viserait la position 1 — occupée — et la
  // collision qui s'ensuivrait serait de notre fait.
  base.injecter({ op: "select", table: "food_list_items", erreur: PANNE });
  assert.equal(await ajouterAlimentAListe(base.client, id, { type: "aliment", id: BROCOLI }), "erreur");
  assert.equal(base.table("food_list_items").filter((l) => l.list_id === id).length, 2, "une ligne est passée");
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-DUP-ERR-1..2 — UNE DUPLICATION À MOITIÉ FAITE EST UN ÉCHEC
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-DUP-ERR-1. échec de la copie des items : aucun succès rendu", async () => {
  const base = decor();
  const source = await listeGarnie(base, "Protéines", [POULET, SAUMON]);

  base.injecter({ op: "insert", table: "food_list_items", erreur: PANNE });
  const copie = await dupliquerFoodList(base.client, COACH_A, source, nomDeCopie("Protéines"));
  // ⚠️ RENDRE UN IDENTIFIANT ICI OUVRIRAIT UNE LISTE VIDE PORTANT « — copie »,
  // que le coach croirait fidèle.
  assert.equal(copie, null, "une duplication ratée a été annoncée réussie");

  // La source, elle, n'a pas bougé d'un aliment.
  assert.equal((await lireFoodList(base.client, source))?.items.length, 2);
});

await test("N1.2-DUP-ERR-2. aucune copie ACTIVE et vide ne subsiste", async () => {
  const base = decor();
  const source = await listeGarnie(base, "Protéines", [POULET, SAUMON]);

  base.injecter({ op: "insert", table: "food_list_items", erreur: PANNE });
  assert.equal(await dupliquerFoodList(base.client, COACH_A, source, nomDeCopie("Protéines")), null);

  // La coquille a été retirée : l'index ne montre que la source.
  const visibles = await listerFoodLists(base.client, { avecArchivees: true });
  assert.deepEqual(visibles.map((l) => l.name), ["Protéines"], "une coquille a survécu");

  // ── LE REPLI, quand le retrait lui-même échoue ────────────────────────────
  // La coquille ne peut alors plus être supprimée ; elle est ARCHIVÉE, donc
  // absente de l'index par défaut et du sélecteur. C'est la seule garantie
  // qu'un chemin de rollback local puisse encore offrir.
  base.injecter({ op: "insert", table: "food_list_items", erreur: PANNE });
  base.injecter({ op: "delete", table: "food_lists", erreur: PANNE });
  assert.equal(await dupliquerFoodList(base.client, COACH_A, source, nomDeCopie("Protéines")), null);

  const actives = await listerFoodLists(base.client);
  assert.deepEqual(actives.map((l) => l.name), ["Protéines"], "une copie vide est restée active");
  const toutes = await listerFoodLists(base.client, { avecArchivees: true });
  const coquille = toutes.find((l) => l.name === "Protéines — copie");
  assert.ok(coquille, "la coquille a disparu des relevés : le test ne mesure plus rien");
  assert.ok(coquille!.archivedAt, "la coquille est restée active");
  assert.equal(coquille!.nbAliments, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.2-ERR-WRITE-1..2 — LES LECTURES INTERNES AUX ÉCRITURES

   ⚠️ MÊME PIÈGE QUE LES READERS, MAIS PLUS SOURNOIS : ici le `data ?? []` ne
   rend pas un écran vide, il rend `true`. L'écran annonce donc une opération
   réussie qui n'a jamais eu lieu — et le coach n'a aucune raison de vérifier.
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.2-ERR-WRITE-1. réordonner sur une lecture en panne : false, et rien n'est écrit", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Légumes", [POULET, RIZ, BROCOLI]);
  const lue = await lireFoodList(base.client, id);
  const [a, b, c] = lue!.items.map((i) => i.id);

  const avant = base.journal.length;
  base.injecter({ op: "select", table: "food_list_items", erreur: PANNE });
  assert.equal(
    await reordonnerFoodList(base.client, id, [c, a, b]),
    false,
    "un réordonnancement jamais tenté a été annoncé réussi",
  );

  // ⚠️ AUCUNE ÉCRITURE TENTÉE — ni le décalage, ni les positions finales.
  const écritures = base.journal.slice(avant).filter((e) => e.startsWith("upsert:"));
  assert.deepEqual(écritures, [], "une écriture est partie malgré la lecture en panne");
  // Et l'ordre d'origine est intact.
  assert.deepEqual((await lireFoodList(base.client, id))?.items.map((i) => i.id), [a, b, c]);

  // Une liste réellement VIDE reste un succès : sans ce contrôle, le test
  // serait vert pour la mauvaise raison (tout rendre `false`).
  const vide = await creerFoodList(base.client, COACH_A, "Vide");
  assert.equal(await reordonnerFoodList(base.client, vide!, []), true);
});

await test("N1.2-ERR-WRITE-2. retrait puis relecture en panne : false, aucune passe de positions", async () => {
  const base = decor();
  const id = await listeGarnie(base, "Légumes", [POULET, RIZ, BROCOLI]);
  const lue = await lireFoodList(base.client, id);
  const [, b] = lue!.items.map((i) => i.id);

  const avant = base.journal.length;
  base.injecter({ op: "select", table: "food_list_items", erreur: PANNE });
  assert.equal(
    await retirerAlimentDeListe(base.client, id, b),
    false,
    "une renumérotation jamais faite a été annoncée réussie",
  );

  // Le DELETE, lui, est bien passé — on ne prétend pas l'annuler.
  const journal = base.journal.slice(avant);
  assert.ok(journal.includes("delete:food_list_items"), "le retrait n'a pas eu lieu");
  assert.deepEqual(journal.filter((e) => e.startsWith("upsert:")), [], "une passe de positions est partie");
  // L'état réel est celui d'un retrait sans renumérotation : le trou est là,
  // visible, et le prochain réordonnancement le comble.
  assert.deepEqual(base.positions(id), [1, 3]);

  // ── LE CAS VALIDE : la liste devient VIDE ────────────────────────────────
  const seul = await listeGarnie(base, "Un seul", [SAUMON]);
  const lueSeul = await lireFoodList(base.client, seul);
  assert.equal(await retirerAlimentDeListe(base.client, seul, lueSeul!.items[0].id), true);
  assert.deepEqual(base.positions(seul), [], "la liste n'est pas vide");
  assert.deepEqual((await lireFoodList(base.client, seul))?.items, []);
});
