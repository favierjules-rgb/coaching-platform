/**
 * Harnais — N1.4 : L'ÉLÈVE CHOISIT UN ALIMENT DANS CHAQUE LISTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS NIVEAUX, ET CHACUN PROUVE CE QUE LES AUTRES NE PEUVENT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * 1. L'ÉTAT de composition est un module PUR (`meal-choice-selection.ts`) :
 *    ses fonctions sont appelées pour de vrai, sur de vraies occurrences.
 * 2. Le RENDU passe par `renderToString` : le dépôt n'a ni jsdom ni moteur de
 *    layout, donc aucun effet ne s'exécute et aucun doigt ne tape. Ce qu'on
 *    mesure, c'est le DOM RÉELLEMENT PRODUIT — en particulier ce qui n'y est
 *    PAS quand une liste est fermée. Prétendre « simuler un clic » ici serait
 *    mentir ; on appelle donc la fonction pure, puis on rend l'état obtenu.
 * 3. La LECTURE (`readNutritionPlanV2Week`) est exécutée contre un client qui
 *    journalise ses requêtes : c'est ainsi qu'on prouve l'absence de N+1 et
 *    l'absence totale de lecture de la bibliothèque.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE RÉELLE.
 *
 * Lancement : npm run test:nutrition-n1-4
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { StudentMealChoices } from "../../components/student/StudentMealChoices";
import {
  AUCUNE_SELECTION,
  choisirOption,
  choixResolus,
  cleDeComposition,
  estChoisie,
  optionChoisie,
  optionChoisieId,
  optionExploitable,
  progressionDesChoix,
} from "../../lib/nutrition/meal-choice-selection";
import { readNutritionPlanV2Week } from "../../lib/supabase/nutrition-week";
import type { ChoiceOption, MealChoiceSlot } from "../../lib/nutrition/plan-v2-week";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Commentaires de LIGNE d'abord — leçon `app/admin/**` d'A5.9. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
const CODE_SEMAINE = sansProse(lire("../../components/student/StudentPrescribedWeek.tsx"));
const CODE_SELECTION = sansProse(lire("../../lib/nutrition/meal-choice-selection.ts"));
const CODE_LECTURE = sansProse(lire("../../lib/supabase/nutrition-week.ts"));

/* ══════════════════════════════════════════════════════════════════════════
   LE DÉCOR
   ══════════════════════════════════════════════════════════════════════════ */

const POULET = "aa000000-0000-4000-8000-000000000001";
const OEUF = "aa000000-0000-4000-8000-000000000002";
const SAUMON = "aa000000-0000-4000-8000-000000000003";
const SKYR = "bb000000-0000-4000-8000-000000000001";

const option = (optionId: string, id: string, displayName: string | null, type: "aliment" | "produit" = "aliment"): ChoiceOption =>
  ({ type, id, optionId, displayName }) as ChoiceOption;

const occurrence = (id: string, label: string, options: readonly ChoiceOption[]): MealChoiceSlot => ({
  id,
  label,
  sourceListId: null, colorKey: null,
  options,
});

/** Deux occurrences issues de la MÊME liste, avec le même aliment dans les deux. */
function deuxProteines(): readonly MealChoiceSlot[] {
  return [
    occurrence("slot-A", "Choix de ta protéine", [
      option("opt-A1", POULET, "Poulet, filet sans peau cru"),
      option("opt-A2", OEUF, "Œuf cru"),
    ]),
    occurrence("slot-B", "Choix de ta protéine", [
      option("opt-B1", POULET, "Poulet, filet sans peau cru"),
      option("opt-B2", SAUMON, "Saumon, cuit"),
    ]),
  ];
}

const rendu = (occurrences: readonly MealChoiceSlot[]) =>
  renderToString(createElement(StudentMealChoices, { occurrences })).replace(/<!-- -->/g, "");

/* ══════════════════════════════════════════════════════════════════════════
   N1.4-01..05 — CE QUI S'AFFICHE, ET SURTOUT CE QUI NE S'AFFICHE PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.4-01. un repas SANS occurrence ne change rien au parcours historique", () => {
  // ⚠️ LE COMPOSANT REND `null`. Il n'ajoute ni titre, ni cadre, ni séparateur :
  // un plan d'avant N1 s'affiche exactement comme avant.
  assert.equal(rendu([]), "");
  assert.ok(CODE_CHOIX.includes("if (occurrences.length === 0) return null;"));

  // Et l'écran ne touche à rien de ce qui existait : items, notes, consommation.
  assert.ok(CODE_SEMAINE.includes("repas.items.map"));
  assert.ok(CODE_SEMAINE.includes("repas.coachNotes"));
  assert.ok(CODE_SEMAINE.includes("<ConsumedMealSection"));
});

await test("N1.4-02/15. les occurrences s'affichent dans l'ordre du coach, jamais trié", () => {
  const html = rendu([
    occurrence("s1", "Choix de ta protéine", [option("o1", POULET, "Poulet")]),
    occurrence("s2", "Choix légumes", [option("o2", OEUF, "Brocoli")]),
    occurrence("s3", "Choix boisson", [option("o3", SAUMON, "Lait demi-écrémé")]),
  ]);
  const positions = ["Choix de ta protéine", "Choix légumes", "Choix boisson"].map((l) => html.indexOf(l));
  assert.ok(positions.every((p) => p >= 0), "un libellé manque");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "l'ordre du coach n'est pas respecté");

  // ⚠️ AUCUN TRI D'OCCURRENCE NI D'ALIMENT N'EST ÉCRIT. L'ordre vient de
  // `meal_choice_slots.position`, appliqué par le lecteur ; l'écran ne fait que
  // parcourir le tableau.
  //
  // ⚠️ N1.5.3 — LE CONTRÔLE EST RESSERRÉ, PAS LEVÉ. « Aucun `.sort(` nulle part
  // dans l'écran » est devenu trop large : les LIGNES D'ÉCART macro sont
  // triées, pour que la plus significative se lise en premier. Ce qui reste
  // interdit — et c'est ce que le contrôle gardait vraiment — c'est de trier ce
  // que le coach a ordonné : les occurrences et les aliments.
  assert.ok(!/occurrences[^;]*\.sort\(/.test(CODE_CHOIX), "les occurrences sont triées à l'affichage");
  assert.ok(!/\bitems\b[^;]*\.sort\(/.test(CODE_CHOIX), "les aliments sont triés à l'affichage");
  assert.ok(!/options[^;]*\.sort\(/.test(CODE_CHOIX), "les options d'une liste sont triées à l'affichage");
  assert.ok(CODE_LECTURE.includes('.order("position", { ascending: true })'));
});

await test("N1.4-03. AUCUN aliment n'est visible avant ouverture", () => {
  const html = rendu(deuxProteines());
  // ⚠️ PAS « MASQUÉ » : ABSENT DU DOM. Le nom des aliments ne doit apparaître
  // nulle part tant que l'élève n'a pas ouvert la liste.
  assert.ok(!html.includes("Poulet, filet sans peau cru"), "un aliment est rendu alors que la liste est fermée");
  assert.ok(!html.includes("Œuf cru"));
  assert.ok(!html.includes('role="radiogroup"'), "le groupe d'options est rendu à l'avance");
  assert.equal((html.match(/role="radio"/g) ?? []).length, 0);

  // Ce qui est visible : le libellé, l'état, et l'invitation.
  assert.ok(html.includes("Choix de ta protéine"));
  assert.ok(html.includes("Aucun choix"));
  assert.ok(html.includes("Choisir"));
  assert.ok(html.includes('aria-expanded="false"'));
});

await test("N1.4-04. ouvrir une occurrence n'ouvre QUE celle-là", () => {
  // Le composant tient `ouverte: string | null` — une seule à la fois — et
  // basculer ne touche jamais `selection`.
  assert.ok(CODE_CHOIX.includes("const [ouverte, setOuverte] = useState<string | null>(null);"));
  assert.ok(CODE_CHOIX.includes("ouverte={ouverte === occurrence.id}"));
  assert.ok(CODE_CHOIX.includes("setOuverte(ouverte === occurrence.id ? null : occurrence.id)"));
  // ⚠️ `onBasculer` NE TOUCHE PAS AUX CHOIX : replier n'efface rien.
  const bascule = CODE_CHOIX.slice(CODE_CHOIX.indexOf("onBasculer={"), CODE_CHOIX.indexOf("onChoisir={"));
  assert.ok(!bascule.includes("setSelection"), "ouvrir/fermer modifie la sélection");
});

await test("N1.4-05/13/14. les options viennent du snapshot de CETTE occurrence", () => {
  const [a, b] = deuxProteines();
  // Chaque occurrence a ses propres lignes, même quand l'aliment est le même.
  assert.deepEqual(a.options.map((o) => o.optionId), ["opt-A1", "opt-A2"]);
  assert.deepEqual(b.options.map((o) => o.optionId), ["opt-B1", "opt-B2"]);
  assert.equal(a.options[0].id, b.options[0].id, "le décor doit contenir le MÊME aliment des deux côtés");

  // ⚠️ CHOISIR DANS A NE TOUCHE PAS B, et réciproquement.
  let selection = choisirOption(AUCUNE_SELECTION, "slot-A", "opt-A1");
  assert.equal(optionChoisie(a, selection)?.optionId, "opt-A1");
  assert.equal(optionChoisie(b, selection), null, "le choix de A a fui vers B");

  selection = choisirOption(selection, "slot-B", "opt-B1");
  assert.equal(optionChoisie(a, selection)?.optionId, "opt-A1", "choisir dans B a changé A");
  assert.equal(optionChoisie(b, selection)?.optionId, "opt-B1");
  // Le MÊME aliment dans les deux : autorisé, et distinct ligne à ligne.
  assert.equal(optionChoisie(a, selection)?.id, optionChoisie(b, selection)?.id);
  assert.notEqual(optionChoisie(a, selection)?.optionId, optionChoisie(b, selection)?.optionId);

  // ⚠️ UNE SÉLECTION QUI DÉSIGNE UNE OPTION D'UNE AUTRE OCCURRENCE NE RÉSOUT
  // RIEN : on ne va jamais chercher l'option ailleurs que dans son snapshot.
  assert.equal(optionChoisie(a, { "slot-A": "opt-B2" }), null);

  // ⚠️ ET UN IDENTIFIANT D'ALIMENT N'EST PAS UNE CLÉ DE SÉLECTION. C'est le
  // cœur du §6 : retenir l'aliment rendrait « Poulet » identique dans les deux
  // occurrences. Un contrôle négatif a montré que rien ne l'épinglait — cette
  // assertion-ci est ce qui manquait.
  assert.equal(optionChoisie(a, { "slot-A": POULET }), null,
    "un identifiant d'ALIMENT ne doit jamais résoudre une sélection");
  assert.equal(optionChoisie(b, { "slot-B": POULET }), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.4-06..12 — CHOISIR, AFFICHER, REMPLACER
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.4-06/07/16. ouverte, l'occurrence montre les vrais noms, dans l'ordre snapshoté", () => {
  const avecProduit = occurrence("s1", "Choix boisson", [
    option("o1", POULET, "Poulet, filet sans peau cru"),
    option("o2", SKYR, "Arla — Skyr nature", "produit"),
  ]);
  // On rend l'état OUVERT en passant par le composant : le seul moyen honnête
  // sans moteur d'événements est de vérifier le contrat de rendu conditionnel.
  assert.ok(CODE_CHOIX.includes("{ouverte && ("), "les options doivent être rendues sous condition");
  assert.ok(CODE_CHOIX.includes('{option.displayName ?? "Aliment indisponible"}'));

  // Les noms viennent de l'hydratation N1.3, pas d'un texte recopié.
  assert.equal(avecProduit.options[0].displayName, "Poulet, filet sans peau cru");
  assert.equal(avecProduit.options[1].displayName, "Arla — Skyr nature");
  // L'ordre du tableau EST l'ordre snapshoté : le lecteur trie par position.
  assert.deepEqual(avecProduit.options.map((o) => o.optionId), ["o1", "o2"]);
  // ⚠️ CE QUE CETTE ASSERTION GARDE, C'EST LA LECTURE DE `id` ET DE L'IDENTITÉ,
  // pas la chaîne exacte du `select`. N1.5.1 y a ajouté les deux colonnes de
  // portion snapshotée ; épingler la chaîne entière ferait rougir ce test à
  // chaque enrichissement du snapshot, sans rien prouver de plus.
  const selectOptions = CODE_LECTURE.slice(
    CODE_LECTURE.indexOf('from("meal_choice_options")'),
    CODE_LECTURE.indexOf('.in("slot_id"'),
  );
  for (const colonne of ["id", "slot_id", "position", "catalog_food_id", "product_id"]) {
    assert.ok(selectOptions.includes(colonne), `le lecteur doit sélectionner ${colonne}`);
  }
});

await test("N1.4-08/09/12. un choix remplace le précédent, et referme la liste", () => {
  const [a] = deuxProteines();
  let selection = choisirOption(AUCUNE_SELECTION, "slot-A", "opt-A1");
  assert.equal(optionChoisieId(selection, "slot-A"), "opt-A1");

  // ⚠️ IL N'Y A JAMAIS DEUX CHOIX ACTIFS : la clé est l'occurrence.
  selection = choisirOption(selection, "slot-A", "opt-A2");
  assert.equal(optionChoisieId(selection, "slot-A"), "opt-A2");
  assert.equal(Object.keys(selection).length, 1, "deux choix coexistent pour une occurrence");
  assert.equal(optionChoisie(a, selection)?.displayName, "Œuf cru");

  // La fermeture après choix est dans le geste lui-même.
  const choisir = CODE_CHOIX.slice(CODE_CHOIX.indexOf("const choisir = useCallback"), CODE_CHOIX.indexOf("if (occurrences.length"));
  assert.ok(choisir.includes("setOuverte(null)"), "la liste doit se refermer après le choix");
  assert.ok(choisir.includes("choisirOption(precedente, slotId, optionId)"));
});

await test("N1.4-10/11. la ligne fermée montre le choix, et propose de le modifier", () => {
  // Fermée sans choix : « Aucun choix » + « Choisir ».
  const html = rendu([occurrence("s1", "Choix de ta protéine", [option("o1", POULET, "Poulet")])]);
  assert.ok(html.includes("Aucun choix") && html.includes("Choisir"));
  assert.ok(!html.includes("Modifier"), "« Modifier » ne doit pas s'afficher sans choix");

  // Avec choix : le NOM de l'option, et « Modifier » — le contrat de rendu.
  assert.ok(CODE_CHOIX.includes('{choisie ? (choisie.displayName ?? "Aliment indisponible") : "Aucun choix"}'));
  assert.ok(CODE_CHOIX.includes('{choisie ? "Modifier" : "Choisir"}'));
  // Rouvrir passe par le MÊME bouton : une seule commande, pas deux chemins.
  assert.equal((CODE_CHOIX.match(/aria-expanded=/g) ?? []).length, 1);
});

await test("N1.4-12bis. la progression sait compter, pour N1.5", () => {
  const occurrences = deuxProteines();
  assert.deepEqual(progressionDesChoix(occurrences, AUCUNE_SELECTION), { total: 2, choisis: 0, complet: false });

  const un = choisirOption(AUCUNE_SELECTION, "slot-A", "opt-A1");
  assert.deepEqual(progressionDesChoix(occurrences, un), { total: 2, choisis: 1, complet: false });

  const deux = choisirOption(un, "slot-B", "opt-B2");
  assert.deepEqual(progressionDesChoix(occurrences, deux), { total: 2, choisis: 2, complet: true });

  // ⚠️ UN REPAS SANS OCCURRENCE N'EST PAS « COMPLET » : il n'y a rien à
  // composer, et le dire complet tromperait N1.5.
  assert.deepEqual(progressionDesChoix([], AUCUNE_SELECTION), { total: 0, choisis: 0, complet: false });

  // La composition prête pour N1.5 : occurrence + option, dans l'ordre du coach.
  assert.deepEqual(choixResolus(occurrences, deux).map((c) => [c.slotId, c.optionId]),
    [["slot-A", "opt-A1"], ["slot-B", "opt-B2"]]);
  assert.deepEqual(choixResolus(occurrences, un).map((c) => c.slotId), ["slot-A"],
    "une occurrence non choisie ne doit pas recevoir un choix par défaut");
  assert.equal(estChoisie(un, "slot-B"), false);
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.4-17..23 — CE QUE LE PARCOURS ÉLÈVE NE FAIT PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.4-17/18/19/20. la bibliothèque n'est JAMAIS lue par le parcours élève", () => {
  // ⚠️ L'ABSENCE DE CHEMIN, PAS UN DRAPEAU. Ni l'écran, ni le module d'état, ni
  // la lecture du plan ne nomment `food_lists` ou `food_list_items`. Modifier,
  // archiver ou supprimer la bibliothèque ne peut donc rien changer : il n'y a
  // rien à changer.
  for (const [nom, code] of [
    ["l'écran des choix", CODE_CHOIX],
    ["l'état de composition", CODE_SELECTION],
    ["la semaine élève", CODE_SEMAINE],
    ["la lecture du plan", CODE_LECTURE],
  ] as const) {
    assert.ok(!code.includes("food_lists"), `${nom} touche food_lists`);
    assert.ok(!code.includes("food_list_items"), `${nom} touche food_list_items`);
  }
  // `sourceListId` existe dans le modèle — et n'est lu par aucun écran élève.
  assert.ok(!CODE_CHOIX.includes("sourceListId"));
});

await test("N1.4-21/22/23. choisir n'écrit RIEN, nulle part", () => {
  // ⚠️ AUCUNE PORTE DE SORTIE. Le composant et le module d'état n'importent
  // pas Supabase, n'appellent aucune RPC, ne touchent aucune table.
  for (const [nom, code] of [["l'écran des choix", CODE_CHOIX], ["l'état de composition", CODE_SELECTION]] as const) {
    assert.ok(!code.includes("@/lib/supabase"), `${nom} importe la couche Supabase`);
    assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(code), `${nom} écrit`);
    for (const table of ["consumed_meals", "meal_entries", "planned_meals", "planned_meal_items",
                         "meal_choice_slots", "meal_choice_options"]) {
      assert.ok(!code.includes(table), `${nom} nomme ${table}`);
    }
  }
  // Les écritures A5 restent hors de portée : aucune n'est nommée ici.
  for (const rpc of ["ouvrir_repas_prescrit", "ouvrirPrescrit", "ajouterAlimentCatalogue",
                     "ajouterAlimentProduit", "ajouterAlimentManuel", "useConsumedMeals"]) {
    assert.ok(!CODE_CHOIX.includes(rpc), `l'écran des choix appelle ${rpc}`);
  }

  // ⚠️ N1.6B — « ENREGISTRER LE REPAS » N'EST PLUS UN FAUX BOUTON. Ce contrôle
  // interdisait toute promesse d'enregistrement, à raison : en N1.4 il n'y
  // avait ni quantité ni consommation à enregistrer. Il y a désormais les
  // deux. La garantie gardée est ailleurs, et elle tient toujours : l'écran
  // DÉLÈGUE, il n'écrit pas — les assertions ci-dessus le prouvent.
  for (const mensonge of ["Valider mon repas", "Terminer", "Sauvegarder"]) {
    assert.ok(!CODE_CHOIX.includes(mensonge), `l'écran promet « ${mensonge} »`);
  }
  assert.ok(CODE_CHOIX.includes("Enregistrer le repas"));
  // `ouvrir_repas_prescrit` reste déclenchée par le SEUL « Ajouter un aliment ».
  assert.ok(CODE_SEMAINE.includes("onOuvrirConteneur={() => suivi.onOuvrirPrescrit(repas.id, date)}"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.4-24..28 — PORTÉE, RAFRAÎCHISSEMENT, ET CAS LIMITES
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.4-24/25/26. la composition ne fuit ni d'un repas à l'autre, ni d'un jour à l'autre", () => {
  // La clé de portée nomme le repas ET la date.
  assert.equal(cleDeComposition("repas-1", "2026-08-17"), "repas-1|2026-08-17");
  assert.notEqual(cleDeComposition("repas-1", "2026-08-17"), cleDeComposition("repas-1", "2026-08-24"));
  assert.notEqual(cleDeComposition("repas-1", "2026-08-17"), cleDeComposition("repas-2", "2026-08-17"));
  assert.equal(cleDeComposition("repas-1", null), "repas-1|sans-date");

  // ⚠️ ET C'EST CETTE CLÉ QUI MONTE LE COMPOSANT. React démonte donc le
  // brouillon dès que le repas ou le jour change — la fuite n'est pas
  // « évitée », elle est impossible.
  assert.ok(CODE_SEMAINE.includes("key={cleDeComposition(repas.id, date)}"));
  assert.ok(CODE_SEMAINE.includes("occurrences={repas.choiceSlots}"));

  // N1.4-26 : l'état est local et non persisté — un rafraîchissement le remet
  // à zéro, et c'est le comportement documenté pour ce lot.
  assert.ok(CODE_CHOIX.includes("useState<SelectionDeChoix>(AUCUNE_SELECTION)"));
  for (const persistance of ["localStorage", "sessionStorage", "indexedDB", "idb"]) {
    assert.ok(!CODE_CHOIX.includes(persistance), `une persistance ${persistance} a été inventée`);
  }
});

await test("N1.4-27. une option introuvable ne casse rien, et n'est pas proposée", () => {
  const abimee = occurrence("s1", "Choix de ta protéine", [
    option("o1", POULET, "Poulet, filet sans peau cru"),
    option("o2", OEUF, null),
  ]);
  // Elle RESTE dans le snapshot — on ne la retire pas du repas.
  assert.equal(abimee.options.length, 2);
  assert.equal(optionExploitable(abimee.options[0]), true);
  assert.equal(optionExploitable(abimee.options[1]), false);

  // ⚠️ VISIBLE MAIS DÉSACTIVÉE : N1.5 ne saurait pas calculer sa quantité,
  // faute de source à lire. On l'affiche nommée, on ne la propose pas.
  assert.ok(CODE_CHOIX.includes("disabled={!exploitable}"));
  assert.ok(CODE_CHOIX.includes('{option.displayName ?? "Aliment indisponible"}'));
  // Et le rendu fermé ne plante pas.
  assert.ok(rendu([abimee]).includes("Choix de ta protéine"));
});

await test("N1.4-28. une liste à UNE seule option exige quand même un clic", () => {
  const seule = occurrence("s1", "Choix boisson", [option("o1", POULET, "Lait demi-écrémé")]);
  const html = rendu([seule]);
  // Rien n'est présélectionné : la ligne dit « Aucun choix ».
  assert.ok(html.includes("Aucun choix"));
  assert.ok(!html.includes("Lait demi-écrémé"), "l'unique option est déjà visible");
  assert.deepEqual(progressionDesChoix([seule], AUCUNE_SELECTION), { total: 1, choisis: 0, complet: false });

  // ⚠️ AUCUNE AUTO-SÉLECTION dans le code : ni au montage, ni au rendu.
  assert.ok(!CODE_CHOIX.includes("useEffect"), "un effet pourrait choisir à la place de l'élève");
  assert.ok(!CODE_CHOIX.includes("options.length === 1"));
});

/* ══════════════════════════════════════════════════════════════════════════
   N1.4-29..30 — MOBILE, ACCESSIBILITÉ, ET LA LECTURE
   ══════════════════════════════════════════════════════════════════════════ */

await test("N1.4-29/30. dix occurrences restent utilisables, et rien ne déborde", () => {
  const dix = Array.from({ length: 10 }, (_, i) =>
    occurrence(`s${i}`, `Choix numéro ${i + 1} au libellé volontairement très long`, [
      option(`o${i}`, POULET, "Poulet, filet sans peau cru"),
    ]),
  );
  const html = rendu(dix);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 10);
  // Fermées : aucune option rendue, quel que soit leur nombre.
  assert.equal((html.match(/role="radio"/g) ?? []).length, 0);

  // Les invariants dont la mesure en moteur de rendu a montré qu'ils étaient
  // la cause d'un débordement.
  assert.ok(!CODE_CHOIX.includes("w-screen") && !CODE_CHOIX.includes("100vw"));
  assert.ok(!/(?<![\w-])w-\[\d+px\]/.test(CODE_CHOIX), "largeur fixe en px");
  assert.ok(CODE_CHOIX.includes("min-w-0"));
  assert.ok(CODE_CHOIX.includes("truncate"), "un libellé long doit être tronqué");
  assert.ok(CODE_CHOIX.includes("flex-wrap"));
  assert.ok(CODE_CHOIX.includes("min-h-[44px]"), "cibles tactiles");

  // Accessibilité : de vrais boutons, un groupe radio nommé, un état annoncé.
  assert.ok(html.includes("<button"), "de vrais boutons");
  assert.ok(!/<div[^>]*onClick/.test(CODE_CHOIX), "aucun div cliquable");
  assert.ok(CODE_CHOIX.includes('role="radiogroup"') && CODE_CHOIX.includes("aria-label={occurrence.label}"));
  assert.ok(CODE_CHOIX.includes('role="radio"') && CODE_CHOIX.includes("aria-checked={selectionnee}"));
  assert.ok(CODE_CHOIX.includes('aria-hidden="true"'), "l'icône ne porte pas le sens");
});

await test("N1.4-31. la lecture ne coûte pas un N+1, et l'identité de l'option est lue", async () => {
  // Un client qui journalise ses requêtes — même outil qu'en N1.3-NAME-4.
  const requetes: string[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    nutrition_plans: [{ id: "plan-1", name: "Plan", nutrition_model_version: 2 }],
    nutrition_plan_profiles: [{ id: "prof-1", plan_id: "plan-1", profile_key: "default", daily_calories: 2000, protein_bp: 3000, carb_bp: 4000, fat_bp: 3000 }],
    nutrition_meal_slot_targets: [{ profile_id: "prof-1", slot: "dinner", enabled: true, protein_bp: 10000, carb_bp: 10000, fat_bp: 10000, display_order: 5 }],
    nutrition_days: [{ id: "jour-1", plan_id: "plan-1", day: "monday", status: "non-commence", profile_key: "default" }],
    meals: [{ id: "repas-1", nutrition_day_id: "jour-1", slot: "dinner", name: "Dîner", items: [], macros: {}, coach_notes: "" }],
    meal_choice_slots: [{ id: "slot-1", meal_id: "repas-1", position: 1, label: "Choix de ta protéine", source_list_id: null }],
    meal_choice_options: Array.from({ length: 20 }, (_, i) => ({
      id: `opt-${i}`, slot_id: "slot-1", position: i + 1,
      catalog_food_id: i === 19 ? null : POULET, product_id: i === 19 ? SKYR : null,
    })),
    food_catalog: [{ id: POULET, name: "Poulet, filet sans peau cru" }],
    food_products: [{ id: SKYR, product_name: "Skyr nature", brand: "Arla" }],
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
  const occurrences = semaine!.days.find((j) => j.day === "monday")!.meals[0].choiceSlots;
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].options.length, 20);

  // ⚠️ CHAQUE OPTION PORTE L'IDENTIFIANT DE SA LIGNE SNAPSHOTÉE. Sans lui, deux
  // occurrences contenant le même aliment seraient indiscernables.
  assert.deepEqual(occurrences[0].options.slice(0, 3).map((o) => o.optionId), ["opt-0", "opt-1", "opt-2"]);
  assert.equal(occurrences[0].options[19].displayName, "Arla — Skyr nature");

  // Vingt options, DEUX requêtes d'hydratation. Et la bibliothèque : zéro.
  assert.equal(requetes.filter((t) => t === "food_catalog").length, 1);
  assert.equal(requetes.filter((t) => t === "food_products").length, 1);
  assert.equal(requetes.filter((t) => t === "food_lists" || t === "food_list_items").length, 0);
});
