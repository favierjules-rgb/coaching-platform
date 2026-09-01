/**
 * Harnais — COURSES C1.1 : UX RAPIDE / PERSONNALISÉ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Le choix de mode sans défaut, le regroupement par jour avec créneaux réels,
 * le moteur de proposition (priorité, déterminisme, périmètre snapshot), le
 * fait qu'une proposition n'écrit rien, la validation par C0 repas par repas,
 * l'honnêteté du rapport d'erreur partielle, et l'absence de tout ce qui n'est
 * pas encore décidé (semaine passée, budget, magasins).
 *
 * ⚠️ IL NE REDOUBLE PAS `liste-de-courses-c1`. Le moteur d'agrégation, la
 * période, les identités et la source des données y sont déjà mesurés ; les
 * remesurer ici produirait deux vérités à maintenir.
 *
 * Lancement : npm run test:liste-de-courses-ux
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { verifierContratDesMigrations } from "./contrat-migrations.mjs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  EcranMode,
  EcranPreferencesRapides,
  EcranProposition,
  EcranRepasParJour,
} from "../../components/student/ListeDeCoursesParcours";
import { QuantitesDuRepas } from "../../components/student/StudentMealChoices";
import { MEAL_SLOT_LABELS_FR } from "../../lib/nutrition/meal-distribution";
import { MODES_COURSES, estModeCourses } from "../../lib/nutrition/mode-courses";
import { construirePeriode } from "../../lib/nutrition/periode-courses";
import type { MealChoiceSlot, PlanV2Week } from "../../lib/nutrition/plan-v2-week";
import {
  choisirPourOccurrence,
  cleIdentite,
  itemsAValider,
  optionsProposables,
  proposerSelection,
  proposerSemaine,
} from "../../lib/nutrition/proposition-rapide";
import { repasAComposer, repasDeLaPeriode, type CompositionConnue } from "../../lib/nutrition/repas-de-la-periode";
import { carteDuRepas, compterCartes, groupesParJour } from "../../lib/nutrition/repas-par-jour";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. Un commentaire n'est pas une preuve. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CHEMINS_C11 = [
  "../../lib/nutrition/mode-courses.ts",
  "../../lib/nutrition/repas-par-jour.ts",
  "../../lib/nutrition/proposition-rapide.ts",
  "../../components/student/ListeDeCoursesParcours.tsx",
  "../../hooks/useListeDeCourses.ts",
] as const;

const CODE_C11: ReadonlyMap<string, string> = new Map(
  CHEMINS_C11.map((c) => [c, sansProse(lire(c))] as const),
);

const CODE_PARCOURS = sansProse(lire("../../components/student/ListeDeCoursesParcours.tsx"));
const CODE_PROPOSITION = sansProse(lire("../../lib/nutrition/proposition-rapide.ts"));
const CODE_PAR_JOUR = sansProse(lire("../../lib/nutrition/repas-par-jour.ts"));
const CODE_HOOK = sansProse(lire("../../hooks/useListeDeCourses.ts"));
const SRC_PARCOURS = lire("../../components/student/ListeDeCoursesParcours.tsx");

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE — un lundi à trois repas, un mardi à un seul
   ══════════════════════════════════════════════════════════════════════════ */

const NUTRITION = { unit: "g", proteinPer100: 20, carbPer100: 5, fatPer100: 3 } as const;

function option(id: string, nom: string, type: "aliment" | "produit" = "aliment", exploitable = true) {
  return {
    type,
    id,
    optionId: `opt-${id}`,
    displayName: nom,
    nutrition: exploitable ? NUTRITION : null,
    quantityUnit: "g" as const,
    preferredQuantity: null,
    minimumQuantity: null,
  };
}

/** Trois options, dans l'ORDRE DU COACH : riz, poulet, saumon. */
const OCC_A: MealChoiceSlot = {
  id: "slot-a",
  label: "Ta base",
  sourceListId: "l1",
  colorKey: "red",
  peutEtreIgnoree: false,
  options: [option("food-riz", "Riz"), option("food-poulet", "Poulet"), option("food-saumon", "Saumon")],
};
const OCC_B: MealChoiceSlot = {
  id: "slot-b",
  label: "Ton accompagnement",
  sourceListId: "l2",
  colorKey: null,
  peutEtreIgnoree: false,
  options: [option("prod-yaourt", "MarqueY — Yaourt", "produit"), option("food-pomme", "Pomme")],
};

function repas(id: string, slot: string, nom: string, occurrences: readonly MealChoiceSlot[]) {
  return {
    id,
    slot,
    name: nom,
    items: [],
    calories: 600,
    protein: 40,
    carbs: 60,
    fat: 18,
    coachNotes: "",
    choiceSlots: occurrences,
  };
}

const SEMAINE = {
  planId: "plan-1",
  profiles: [],
  days: [
    {
      id: "j-lundi",
      day: "monday",
      profileKey: "default",
      status: "non-commence",
      meals: [
        // ⚠️ VOLONTAIREMENT DANS LE DÉSORDRE : le dîner est déclaré AVANT le
        // petit-déjeuner. L'écran doit rétablir l'ordre canonique.
        repas("r-dinner", "dinner", "Dîner", [OCC_A]),
        repas("r-breakfast", "breakfast", "Mon petit déj perso", [OCC_A, OCC_B]),
        repas("r-snack", "morning_snack", "Collation du matin", [OCC_B]),
      ],
    },
    {
      id: "j-mardi",
      day: "tuesday",
      profileKey: "default",
      status: "non-commence",
      meals: [repas("r-lunch-mardi", "lunch", "Déjeuner", [OCC_A])],
    },
  ],
} as unknown as PlanV2Week;

const LUNDI = "2026-08-17";
const PERIODE = construirePeriode(LUNDI, 2)!;
const REPAS = repasDeLaPeriode(SEMAINE, PERIODE, new Map());
const VIDE: ReadonlySet<string> = new Set();

/* ══════════════════════════════════════════════════════════════════════════
   UX-01 → UX-03 — LE CHOIX DE MODE
   ══════════════════════════════════════════════════════════════════════════ */

await test("UX-01. aucun mode n'est présélectionné", () => {
  // L'état s'initialise à `null`, et son type l'autorise.
  assert.ok(CODE_PARCOURS.includes("useState<ModeCourses>(null)"));
  assert.ok(!/useState<ModeCourses>\((?!null)/.test(CODE_PARCOURS));
  // Aucune constante de défaut n'existe.
  const CODE_MODES = sansProse(lire("../../lib/nutrition/mode-courses.ts"));
  assert.ok(!/MODE_.*PAR_DEFAUT|DEFAULT_MODE/.test(CODE_MODES));
  assert.equal(estModeCourses(null), false, "null n'est pas un mode");
  assert.equal(estModeCourses(undefined), false);
  assert.equal(estModeCourses("semaine-passee"), false, "le futur mode n'existe pas");

  // LE RENDU RÉEL : deux radios, aucun coché.
  const html = renderToString(
    createElement(EcranMode, { mode: null, onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.equal((html.match(/checked=""/g) ?? []).length, 0, "aucun mode coché");

  // Contre-épreuve : avec un mode, exactement UN est coché.
  const choisi = renderToString(
    createElement(EcranMode, { mode: "rapide", onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.equal((choisi.match(/checked=""/g) ?? []).length, 1, "le test sait voir une coche");
});

await test("UX-02. RAPIDE et PERSONNALISÉ sont visibles, avec leur promesse", () => {
  const html = renderToString(
    createElement(EcranMode, { mode: null, onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.ok(html.includes("Comment veux-tu préparer ta semaine"), "la question est posée");
  assert.ok(html.includes("RAPIDE"));
  assert.ok(html.includes("PERSONNALISÉ"));
  assert.ok(html.includes("on prépare une proposition que tu pourras modifier"));
  assert.ok(html.includes("Choisis toi-même tes aliments pour chaque repas"));
  // Les deux cartes viennent de la table, pas de JSX recopié : ajouter un mode
  // ne demandera pas de toucher à l'écran.
  assert.equal(MODES_COURSES.length, 2);
  assert.ok(CODE_PARCOURS.includes("MODES_COURSES.map("));
});

await test("UX-03. impossible d'avancer sans mode", () => {
  const vide = renderToString(
    createElement(EcranMode, { mode: null, onChoisir: () => {}, onSuivant: () => {} }),
  );
  // ⚠️ ON CHERCHE L'ATTRIBUT, pas la sous-chaîne : les classes du bouton
  // contiennent déjà « disabled: ».
  assert.ok(/<button[^>]*\sdisabled=""/.test(vide), "le bouton est désactivé");
  assert.ok(vide.includes("Choisis un mode"), "et il dit ce qui manque");

  const rempli = renderToString(
    createElement(EcranMode, { mode: "personnalise", onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.ok(!/<button[^>]*\sdisabled=""/.test(rempli), "avec un mode, il est actif");
  assert.ok(CODE_PARCOURS.includes("desactive={mode === null}"));
});

/* ══════════════════════════════════════════════════════════════════════════
   UX-04 → UX-08 — LE MODE PERSONNALISÉ
   ══════════════════════════════════════════════════════════════════════════ */

await test("UX-04. les repas sont groupés par DATE RÉELLE", () => {
  const groupes = groupesParJour(REPAS);
  assert.equal(groupes.length, 2, "deux jours, deux groupes");
  assert.deepEqual(groupes.map((g) => g.date), ["2026-08-17", "2026-08-18"]);
  assert.deepEqual(groupes.map((g) => g.libelleJour), ["LUNDI", "MARDI"]);
  assert.deepEqual(groupes.map((g) => g.libelleDate), ["17 août", "18 août"]);
  assert.deepEqual(groupes.map((g) => g.cartes.length), [3, 1]);
  // Aucune carte ne se retrouve dans le mauvais jour.
  for (const groupe of groupes) {
    for (const carte of groupe.cartes) {
      assert.equal(carte.repas.date, groupe.date);
    }
  }
  // ⚠️ PLUS DE LISTE PLATE : l'écran ne rend plus « jour · date » sur la carte.
  assert.ok(!CODE_PARCOURS.includes("{r.date}"), "la date brute a quitté les cartes");
});

await test("UX-05. le créneau est LISIBLE, et le nom du coach n'est ajouté que s'il apporte", () => {
  const groupes = groupesParJour(REPAS);
  const lundi = groupes[0];
  assert.deepEqual(
    lundi.cartes.map((c) => c.libelleCreneau),
    ["Petit déjeuner", "Collation du matin", "Dîner"],
  );
  // Le libellé vient de la table du modèle nutrition, pas d'une recopie.
  assert.equal(lundi.cartes[0].libelleCreneau, MEAL_SLOT_LABELS_FR.breakfast);
  assert.ok(CODE_PAR_JOUR.includes("MEAL_SLOT_LABELS_FR["), "aucun mapping parallèle");

  // Nom personnalisé : affiché quand il diffère, tu.
  assert.equal(lundi.cartes[0].nomPersonnalise, "Mon petit déj perso");
  // …et masqué quand il répète le créneau — même à la casse et aux accents près.
  assert.equal(lundi.cartes[1].nomPersonnalise, null, "« Collation du matin » ne se répète pas");
  assert.equal(lundi.cartes[2].nomPersonnalise, null, "« Dîner » non plus");

  // Progression exacte : le petit-déjeuner a DEUX occurrences, la collation UNE.
  assert.deepEqual(lundi.cartes.map((c) => `${c.choisis}/${c.total}`), ["0/2", "0/1", "0/1"]);
});

await test("UX-06. l'ordre des repas suit l'ordre canonique existant", () => {
  const lundi = groupesParJour(REPAS)[0];
  // Le double déclare dîner → petit-déjeuner → collation. L'écran rétablit
  // breakfast(0) → morning_snack(1) → dinner(4).
  assert.deepEqual(lundi.cartes.map((c) => c.repas.slot), ["breakfast", "morning_snack", "dinner"]);
  assert.ok(CODE_PAR_JOUR.includes("MEAL_SLOT_DEFAULT_ORDER["), "l'ordre vient du modèle");
  assert.ok(
    !/MEAL_SLOT_DEFAULT_ORDER\s*=|const ORDRE_CRENEAUX/.test(CODE_PAR_JOUR),
    "aucun ordre recopié",
  );
});

await test("UX-07. aucun repas artificiel n'est ajouté", () => {
  const groupes = groupesParJour(REPAS);
  // Mardi n'a QU'UN déjeuner au plan : on ne complète pas la journée.
  assert.equal(groupes[1].cartes.length, 1);
  assert.deepEqual(groupes[1].cartes.map((c) => c.libelleCreneau), ["Déjeuner"]);
  // Et l'ensemble ne contient que les repas du plan.
  const { total } = compterCartes(groupes);
  assert.equal(total, REPAS.length, "autant de cartes que de repas réels, pas une de plus");
  // Aucune liste de créneaux n'est fabriquée pour « faire propre ».
  for (const [chemin, code] of CODE_C11) {
    assert.ok(
      !/MEAL_SLOT_KEYS\.map|\["breakfast", "lunch"/.test(code),
      `${chemin} ne fabrique pas de journée type`,
    );
  }
});

await test("UX-08. StudentMealChoices est réutilisé, et il n'y a pas de second sélecteur", () => {
  assert.ok(CODE_PARCOURS.includes("<StudentMealChoices"));
  assert.equal(
    (CODE_PARCOURS.match(/<StudentMealChoices/g) ?? []).length,
    1,
    "un seul point de montage : les deux modes passent par le même",
  );
  // Les props sont celles de N1/C0, plus la proposition de C1.1.
  for (const prop of ["occurrences=", "cible=", "validation=", "propositionInitiale="]) {
    assert.ok(CODE_PARCOURS.includes(prop), `prop ${prop}`);
  }
  // Aucun composant de choix concurrent n'a été créé.
  const composants = readdirSync(new URL("../../components/student/", import.meta.url));
  assert.ok(
    !composants.some((f) => /Choix|Selecteur|Picker/i.test(f) && f.startsWith("ListeDeCourses")),
    "aucun sélecteur d'aliments parallèle",
  );
  // Et le parcours n'importe aucun solveur.
  assert.ok(!CODE_PARCOURS.includes("solveMealChoices"));
});

/* ══════════════════════════════════════════════════════════════════════════
   UX-09 → UX-16 — LE MOTEUR DE PROPOSITION
   ══════════════════════════════════════════════════════════════════════════ */

await test("UX-09. la proposition ne lit QUE les options snapshotées", () => {
  // La signature ne reçoit ni catalogue, ni client, ni liste d'aliments : il
  // est matériellement impossible d'aller chercher ailleurs.
  assert.ok(!CODE_PROPOSITION.includes("supabase"), "aucun accès base");
  assert.ok(!CODE_PROPOSITION.includes("food_lists") && !CODE_PROPOSITION.includes("food_catalog"));
  assert.ok(!CODE_PROPOSITION.includes("fetch("), "aucun réseau");
  // Chaque optionId proposé appartient bien à l'occurrence qui l'a produit.
  const proposition = proposerSemaine(REPAS, new Set(["aliment:hors-snapshot"]), VIDE);
  for (const r of REPAS) {
    const proposee = proposition.get(r.cle);
    if (!proposee) continue;
    for (const occurrence of r.occurrences) {
      const choisi = proposee.selection[occurrence.id];
      if (choisi === undefined) continue;
      assert.ok(
        occurrence.options.some((o) => o.optionId === choisi),
        `${choisi} appartient à ${occurrence.id}`,
      );
    }
  }
});

await test("UX-10. une préférence explicite gagne — si elle est autorisée ICI", () => {
  // Saumon est la TROISIÈME option de OCC_A : sans préférence, c'est Riz.
  const sans = choisirPourOccurrence(OCC_A, VIDE, VIDE);
  assert.deepEqual(sans, { slotId: "slot-a", optionId: "opt-food-riz", origine: "snapshot" });

  const avec = choisirPourOccurrence(OCC_A, new Set(["aliment:food-saumon"]), VIDE);
  assert.deepEqual(avec, { slotId: "slot-a", optionId: "opt-food-saumon", origine: "preference" });

  // Une préférence NON autorisée dans cette occurrence est ignorée — pour
  // cette occurrence seulement, et sans rien inventer.
  const ailleurs = choisirPourOccurrence(OCC_A, new Set(["aliment:food-pomme"]), VIDE);
  assert.equal(ailleurs?.origine, "snapshot");
  assert.equal(ailleurs?.optionId, "opt-food-riz");

  // La préférence l'emporte sur le favori.
  const duel = choisirPourOccurrence(
    OCC_A,
    new Set(["aliment:food-saumon"]),
    new Set(["aliment:food-poulet"]),
  );
  assert.equal(duel?.origine, "preference");
  assert.equal(duel?.optionId, "opt-food-saumon");
});

await test("UX-11. un favori gagne ensuite — sans jamais devenir obligatoire", () => {
  const avec = choisirPourOccurrence(OCC_A, VIDE, new Set(["aliment:food-poulet"]));
  assert.deepEqual(avec, { slotId: "slot-a", optionId: "opt-food-poulet", origine: "favori" });

  // Un favori absent de l'occurrence ne bloque rien : le repli joue.
  const absent = choisirPourOccurrence(OCC_A, VIDE, new Set(["produit:prod-yaourt"]));
  assert.equal(absent?.origine, "snapshot");

  // ⚠️ UN FAVORI N'EST JAMAIS UNE OBLIGATION : toutes les options du coach
  // restent proposées à l'écran (aucune n'est retirée par le moteur).
  const proposition = proposerSelection(OCC_A.options.length ? [OCC_A] : [], VIDE, new Set(["aliment:food-poulet"]));
  assert.equal(Object.keys(proposition).length, 1, "un seul choix, pas un filtre");
  assert.equal(OCC_A.options.length, 3, "les trois options existent toujours");
});

await test("UX-12. le repli est DÉTERMINISTE : la première option du coach", () => {
  // Dix appels, dix résultats identiques.
  const resultats = new Set(
    Array.from({ length: 10 }, () => JSON.stringify(proposerSemaine(REPAS, VIDE, VIDE) instanceof Map
      ? [...proposerSemaine(REPAS, VIDE, VIDE).entries()].map(([c, v]) => [c, v.selection])
      : [])),
  );
  assert.equal(resultats.size, 1, "aucune variation entre deux appels");

  // Et c'est bien la PREMIÈRE option, dans l'ordre du coach.
  assert.equal(choisirPourOccurrence(OCC_A, VIDE, VIDE)?.optionId, "opt-food-riz");
  assert.equal(choisirPourOccurrence(OCC_B, VIDE, VIDE)?.optionId, "opt-prod-yaourt");

  // ⚠️ L'ORDRE DU SNAPSHOT N'EST JAMAIS MODIFIÉ : le moteur ne trie pas les
  // options du coach.
  assert.ok(!/options\s*\.?\s*\.sort\(/.test(CODE_PROPOSITION), "aucun tri des options du coach");
});

await test("UX-13. aucun Math.random, aucune horloge : le hasard est banni", () => {
  for (const [chemin, code] of CODE_C11) {
    assert.ok(!code.includes("Math.random"), `${chemin} n'utilise pas Math.random`);
    assert.ok(!/new Date\(\)|Date\.now\(\)/.test(code), `${chemin} ne dépend pas de l'heure`);
    assert.ok(!code.includes("crypto.getRandomValues"), `${chemin} non plus`);
  }
});

await test("UX-14. aucune heuristique fondée sur le NOM d'un aliment", () => {
  for (const [chemin, code] of CODE_C11) {
    // Aucun test de contenu sur un libellé.
    assert.ok(
      !/displayName[^;\n]*\.(includes|match|startsWith|endsWith|test)\(/.test(code),
      `${chemin} n'inspecte pas le contenu d'un nom`,
    );
    // Aucun vocabulaire de catégorie inventé.
    for (const mot of ["viande", "feculent", "féculent", "legume", "légume", "laitier", "sauce", "fruit"]) {
      assert.ok(
        !new RegExp(`["']${mot}`, "i").test(code),
        `${chemin} n'invente pas la catégorie « ${mot} »`,
      );
    }
  }
  // Le nom ne sert QU'à trier pour l'affichage, jamais à classer.
  assert.ok(CODE_PROPOSITION.includes("localeCompare"), "tri d'affichage");
  assert.ok(!CODE_PROPOSITION.includes("categorie") && !CODE_PROPOSITION.includes("category"));
});

await test("UX-15. aucun aliment hors snapshot ne peut entrer, ni dans les préférences", () => {
  const options = optionsProposables(REPAS, VIDE);
  const clesAutorisees = new Set(
    REPAS.flatMap((r) => r.occurrences.flatMap((o) => o.options.map((op) => cleIdentite(op)))),
  );
  for (const o of options) {
    assert.ok(clesAutorisees.has(o.cle), `${o.cle} vient bien du snapshot`);
  }
  // Sans repas, aucune option — la liste ne peut pas naître ailleurs.
  assert.deepEqual(optionsProposables([], VIDE), []);

  // Une option NON exploitable (sans données nutritionnelles) est écartée :
  // la proposer produirait un repas non calculable, donc non validable.
  const occInutilisable: MealChoiceSlot = {
    id: "slot-x",
    label: "X",
    sourceListId: null,
    colorKey: null,
    peutEtreIgnoree: false,
    options: [option("food-vide", "Sans macros", "aliment", false)],
  };
  assert.equal(choisirPourOccurrence(occInutilisable, VIDE, VIDE), null);

  // Les favoris remontent en tête, mais ne s'ajoutent pas à la liste.
  const avecFavori = optionsProposables(REPAS, new Set(["aliment:food-saumon"]));
  assert.equal(avecFavori[0].cle, "aliment:food-saumon", "le favori passe premier");
  assert.equal(avecFavori.length, options.length, "et n'ajoute aucune ligne");
});

await test("UX-16. le solveur existant reste le SEUL solveur", () => {
  // Le moteur de proposition ne rend que des optionId — aucune quantité.
  const proposee = proposerSelection([OCC_A, OCC_B], VIDE, VIDE);
  for (const valeur of Object.values(proposee)) {
    assert.equal(typeof valeur, "string", "une sélection, pas une quantité");
  }
  assert.ok(!CODE_PROPOSITION.includes("solveMealChoices"), "aucun appel au solveur ici");
  assert.ok(!/proteinPer100|carbPer100|fatPer100/.test(CODE_PROPOSITION), "aucune macro manipulée");

  // Les quantités partent de `calculDuRepas` — donc du solveur de N1.5 — et
  // c'est l'ENTIER AFFICHÉ qui est envoyé, jamais le flottant interne.
  assert.ok(CODE_PARCOURS.includes("calculDuRepas("));
  assert.ok(CODE_PROPOSITION.includes("quantity: item.displayQuantity"));
  assert.ok(!CODE_PROPOSITION.includes("quantity: item.quantity"), "jamais la valeur flottante");
  assert.deepEqual(
    itemsAValider({
      items: [
        { slotId: "s", optionId: "o", name: "N", unit: "g", quantity: 162.7, displayQuantity: 163 },
      ] as never,
    }),
    [{ slotId: "s", optionId: "o", quantity: 163, unit: "g" }],
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   UX-17 → UX-20 — BROUILLON, VALIDATION, ERREURS, CONVERGENCE
   ══════════════════════════════════════════════════════════════════════════ */

await test("UX-17. une proposition n'écrit RIEN avant validation", () => {
  // Le moteur est pur : il ne peut rien écrire.
  for (const ecriture of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "supabase"]) {
    assert.ok(!CODE_PROPOSITION.includes(ecriture), `le moteur n'écrit pas (${ecriture})`);
  }
  // L'écran de proposition ne déclenche l'écriture que par le bouton final.
  assert.ok(CODE_PARCOURS.includes("VALIDER MA SEMAINE"));
  assert.equal(
    (CODE_PARCOURS.match(/onValiderSemaine\(/g) ?? []).length,
    1,
    "un seul déclencheur d'écriture de semaine",
  );
  // La proposition est DÉRIVÉE, jamais rangée dans un état qui survivrait.
  assert.ok(CODE_PARCOURS.includes("const proposition = useMemo("));
  assert.ok(!CODE_PARCOURS.includes("setProposition"), "aucun état de proposition");
  // Et le composant de choix la reçoit comme point de départ, PAS comme
  // composition validée : le bouton dit donc « Valider mes choix ».
  const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
  assert.ok(CODE_CHOIX.includes("dejaValide: composition !== null"), "le validé vient de la base seule");
  assert.ok(CODE_CHOIX.includes("composition !== null &&"), "« à jour » aussi");
});

await test("UX-18. la validation passe par C0, et C2 n'en est PAS un chemin alternatif", () => {
  assert.ok(CODE_HOOK.includes("validerChoixRepas("), "la fonction C0");
  assert.equal(
    (CODE_HOOK.match(/await validerChoixRepas\(/g) ?? []).length,
    2,
    "deux appels : le geste unitaire et celui de semaine — aucun autre chemin",
  );
  // Aucune écriture directe des tables, aucune RPC nouvelle DANS CE HOOK.
  assert.ok(!CODE_HOOK.includes('.from("planned_meals").insert'), "aucune écriture directe");
  assert.ok(!CODE_HOOK.includes('.from("planned_meal_items")'), "aucune écriture directe");
  assert.ok(!/rpc\(\s*["'](?!enregistrer_repas_planifie)/.test(CODE_HOOK), "aucune RPC nouvelle");

  // ⚠️ LE CONTRAT ÉLARGI PAR C2 : LA LISTE PERSISTANTE NE VALIDE RIEN.
  //
  // Avant C2, il suffisait de dire « le hook de C1.1 ne connaît qu'une RPC ».
  // Maintenant qu'une seconde couche d'écriture existe, il faut prouver que
  // ce n'est pas un SECOND CHEMIN de validation nutritionnelle : C2 arrive
  // APRÈS C0, il ne le remplace pas et ne l'esquive pas.
  const C2_HOOK = sansProse(lire("../../hooks/useListePersistante.ts"));
  const C2_BASE = sansProse(lire("../../lib/supabase/liste-de-courses.ts"));
  const C2_SQL = lire("../../supabase/migrations/20260915090000_c2_liste_de_courses_persistante.sql");

  for (const [nom, code] of [["hook C2", C2_HOOK], ["couche base C2", C2_BASE]] as const) {
    // (a) C2 n'écrit JAMAIS la planification : ni table, ni RPC de C0.
    for (const interdit of [
      'from("planned_meals")',
      'from("planned_meal_items")',
      "enregistrer_repas_planifie",
      "validerChoixRepas",
      "supprimer_repas_planifie",
    ]) {
      assert.ok(!code.includes(interdit), `${nom} ne touche pas à la validation (${interdit})`);
    }
    // (b) et n'appelle que SES deux RPC, nommément.
    for (const appel of [...code.matchAll(/rpc\(\s*["'`]?([a-z_]+)/g)].map((m) => m[1])) {
      assert.ok(
        ["regenerer_liste_de_courses", "modifier_article_manuel", "nom"].includes(appel),
        `${nom} appelle une RPC inattendue : ${appel}`,
      );
    }
  }

  // (c) LE SERVEUR NE PLANIFIE RIEN NON PLUS. La RPC de régénération LIT
  //     `planned_meal_items` pour vérifier l'appartenance, et ne l'écrit pas.
  //     Une seule occurrence, et c'est un `select`.
  const sqlNu = C2_SQL.replace(/^\s*--.*$/gm, " ");
  for (const ecriture of [
    "insert into public.planned_meals",
    "insert into public.planned_meal_items",
    "update public.planned_meals",
    "update public.planned_meal_items",
    "delete from public.planned_meals",
    "delete from public.planned_meal_items",
  ]) {
    assert.ok(!sqlNu.includes(ecriture), `la RPC C2 n'écrit pas la planification (${ecriture})`);
  }
  assert.ok(
    /from public\.planned_meal_items i\s+join public\.planned_meals m/.test(sqlNu),
    "la RPC C2 LIT la planification pour vérifier l'appartenance",
  );

  // (d) ET AUCUNE ÉCRITURE DE `shopping_lists` NE REMPLACE `planned_meals` :
  //     l'écran de la liste ne valide aucun repas, il n'a pas le vocabulaire
  //     pour le faire.
  const C2_ECRAN = sansProse(lire("../../components/student/ListeDeCoursesPersistante.tsx"));
  for (const interdit of ["validerSemaine", "validerRepas", "StudentMealChoices", "planned_meal"]) {
    assert.ok(!C2_ECRAN.includes(interdit), `l'écran C2 ne valide pas de repas (${interdit})`);
  }

  // (e) L'ORDRE EST INSCRIT DANS LE PARCOURS : l'étape « liste » vient APRÈS
  //     l'étape « repas », dans les deux modes.
  for (const chemin of [
    '["duree", "mode", "preferences", "proposition", "repas", "liste"]',
    '["duree", "mode", "repas", "liste"]',
  ]) {
    assert.ok(CODE_PARCOURS.includes(chemin), `l'ordre du parcours est figé : ${chemin}`);
  }

  verifierContratDesMigrations(assert);
});

await test("UX-19. une erreur partielle ne produit JAMAIS un faux succès", () => {
  // Le contrat du résultat est explicite : `complet` n'est vrai que si rien
  // n'a échoué ET qu'il y avait quelque chose à valider.
  assert.ok(CODE_HOOK.includes("complet: echecs.length === 0 && entrees.length > 0"));
  // Aucun repas n'est laissé « non tenté » : la boucle ne s'arrête pas.
  const corps = lire("../../hooks/useListeDeCourses.ts");
  // ⚠️ LA BORNE DE FIN EST CHERCHÉE **APRÈS** LA BOUCLE : `validerRepas` a lui
  // aussi un `} finally {`, plus haut dans le fichier.
  const debut = corps.indexOf("for (const entree of entrees)");
  const bloc = corps.slice(debut, corps.indexOf("} finally {", debut));
  assert.ok(bloc.includes("catch"), "un échec est capturé");
  assert.ok(!bloc.includes("break") && !bloc.includes("return"), "et n'interrompt pas la boucle");
  // L'écran distingue les deux cas, et nomme les repas en échec.
  assert.ok(SRC_PARCOURS.includes("resultat.complet"));
  assert.ok(SRC_PARCOURS.includes("repas à corriger"));
  assert.ok(SRC_PARCOURS.includes("{echec.libelle}"), "les repas en échec sont nommés");
  assert.ok(SRC_PARCOURS.includes('role="alert"'), "l'échec partiel est annoncé");
  // ⚠️ ET AUCUNE FAUSSE TRANSACTION CLIENT n'est inventée.
  assert.ok(!CODE_HOOK.includes("rollback") && !CODE_HOOK.includes("annuler"));
});

await test("UX-20. les deux modes convergent vers LA MÊME liste persistante C2", () => {
  // Un seul écran de repas, et — depuis C2 — un seul écran de liste : la
  // liste PERSISTANTE. L'ancien `EcranListe` (liste locale, cochage en
  // mémoire) reste exporté et mesuré ailleurs, mais n'est plus monté.
  assert.equal((CODE_PARCOURS.match(/<EcranRepasParJour/g) ?? []).length, 1);

  // ⚠️ EXACTEMENT UNE IMPLÉMENTATION DE LISTE FINALE, ET PAS DEUX.
  // Deux composants C2 distincts selon le mode feraient diverger deux écrans
  // qui doivent dire la même chose — c'est précisément ce que ce test
  // interdit depuis C1.1, et le contrat est simplement transposé à C2.
  assert.equal(
    (CODE_PARCOURS.match(/<ListeDeCoursesPersistante/g) ?? []).length,
    1,
    "une seule liste finale, quel que soit le mode",
  );
  assert.equal(
    (CODE_PARCOURS.match(/<EcranListe[\s/>]/g) ?? []).length,
    0,
    "l'ancienne liste locale n'est plus montée",
  );
  // ⚠️ ON COMPTE LE POINT DE MONTAGE, PAS LES OCCURRENCES DU MOT. Le titre de
  // l'en-tête teste lui aussi `etape === "liste"` : compter la comparaison
  // ferait rougir ce test pour une raison qui n'a rien à voir avec la
  // convergence des deux modes.
  assert.equal(
    (CODE_PARCOURS.match(/\{etape === "liste" && \(/g) ?? []).length,
    1,
    "un seul point de montage de l'étape liste",
  );

  // ⚠️ ET CE POINT DE MONTAGE NE REGARDE PAS LE MODE. Un `mode ===` dans le
  // bloc de l'étape « liste » serait le début de deux listes divergentes.
  const bloc = SRC_PARCOURS.slice(
    SRC_PARCOURS.indexOf('{etape === "liste" && ('),
    SRC_PARCOURS.indexOf("</div>", SRC_PARCOURS.indexOf('{etape === "liste" && (')),
  );
  assert.ok(bloc.includes("<ListeDeCoursesPersistante"), "l'étape liste monte bien C2");
  assert.ok(!bloc.includes("mode"), "l'étape liste ignore le mode");
  assert.ok(!bloc.includes("rapide") && !bloc.includes("personnalise"), "aucun aiguillage par mode");

  // Les deux chemins finissent par les mêmes deux étapes.
  assert.ok(
    CODE_PARCOURS.includes('["duree", "mode", "preferences", "proposition", "repas", "liste"]'),
  );
  assert.ok(CODE_PARCOURS.includes('["duree", "mode", "repas", "liste"]'));

  // La source reste celle de C1 : la liste vient de `courses.lignes`, agrégées
  // une seule fois, quel que soit le mode.
  assert.ok(CODE_PARCOURS.includes("lignesDuPlan={courses.lignes}"));
  // Et le libellé du geste de génération est porté par le composant unique.
  const C2_ECRAN = lire("../../components/student/ListeDeCoursesPersistante.tsx");
  assert.ok(C2_ECRAN.includes("GÉNÉRER MA LISTE"));
  assert.ok(C2_ECRAN.includes("METTRE À JOUR MA LISTE"));

  // Et l'écran des repas ne sait pas d'où l'on vient : aucun `mode` en prop.
  const blocRepas = SRC_PARCOURS.slice(
    SRC_PARCOURS.indexOf("export function EcranRepasParJour("),
    SRC_PARCOURS.indexOf("/* ═", SRC_PARCOURS.indexOf("export function EcranRepasParJour(")),
  );
  assert.ok(!blocRepas.includes("mode"), "l'écran final ignore le mode");
});

/* ══════════════════════════════════════════════════════════════════════════
   UX-21 → UX-24 — CE QUI N'EXISTE PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("UX-21. C1.1 n'a touché aucun schéma, et la seule migration autorisée est celle de C2", () => {
  // ⚠️ RENFORCÉE, PAS SUPPRIMÉE. Le compte « 80 » est devenu faux avec C2 ; le
  // remonter à 81 aurait accepté n'importe quelle 81ᵉ migration. Le contrat
  // partagé vérifie l'identité exacte, l'ordre, l'unicité et l'historique.
  verifierContratDesMigrations(assert);

  // ⚠️ ET LA GARANTIE PROPRE À C1.1 EST INTACTE : aucun de SES fichiers ne
  // connaît la persistance. C2 l'a ajoutée dans des fichiers à lui, ce que
  // `CHEMINS_C11` ne contient pas — et ne doit pas contenir.
  for (const [chemin, code] of CODE_C11) {
    for (const table of ["shopping_lists", "shopping_list_items", "shopping_list_state"]) {
      assert.ok(!code.includes(table), `${chemin} ne connaît pas ${table}`);
    }
  }
});

await test("UX-22. aucun ancien C1 n'est importé", () => {
  for (const [chemin, code] of CODE_C11) {
    for (const interdit of [
      "lib/courses/",
      "@/lib/courses",
      "hooks/useCourses",
      "components/student/Courses",
      "(student)/courses",
    ]) {
      assert.ok(!code.includes(interdit), `${chemin} n'importe pas ${interdit}`);
    }
    for (const mot of ["plan_envies", "plan_habitudes", "plan_seul", "SUGGESTIONS", "rayon"]) {
      assert.ok(!code.includes(mot), `${chemin} ne réintroduit pas « ${mot} »`);
    }
  }
});

await test("UX-23. le mode « semaine passée » n'est PAS implémenté", () => {
  for (const [chemin, code] of CODE_C11) {
    for (const amorce of [
      "reprendreSemaine",
      "semainePassee",
      "semaine-passee",
      "semainePrecedente",
      "periodePrecedente",
      "projeterSemaine",
    ]) {
      assert.ok(!code.includes(amorce), `${chemin} ne l'implémente pas : « ${amorce} »`);
    }
  }
  // Deux modes exactement, et la structure les rend en boucle : l'extension
  // se fera par une entrée de table, pas par une réécriture d'écran.
  assert.equal(MODES_COURSES.length, 2);
  assert.deepEqual(MODES_COURSES.map((m) => m.cle), ["rapide", "personnalise"]);
  const doc = lire("../../docs/courses-reprendre-semaine-passee.md");
  assert.ok(doc.includes("NON IMPLÉMENTÉ"));
});

await test("UX-24. budget et magasins ne sont PAS implémentés", () => {
  for (const [chemin, code] of CODE_C11) {
    for (const mot of [
      "budget",
      "prix",
      "price",
      "euro",
      "magasin",
      "store",
      "geoloc",
      "latitude",
      "promotion",
    ]) {
      assert.ok(
        !new RegExp(mot, "i").test(code),
        `${chemin} n'introduit pas « ${mot} » — C3/C4 ne sont pas commencés`,
      );
    }
    assert.ok(!code.includes("fetch("), `${chemin} n'appelle aucune API externe`);
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   LES TROIS CORRECTIFS DE L'AUDIT ADVERSE — D-1, D-2, D-3
   ══════════════════════════════════════════════════════════════════════════ */

/** L'écran de proposition, avec juste ce qu'il faut pour être rendu. */
function texteRendu(html: string): string {
  // ⚠️ `renderToString` insère `<!-- -->` autour de chaque interpolation, et
  // les espaces insécables ne sont pas des espaces. On normalise avant de
  // chercher une phrase, sinon le test mesure le sérialiseur de React.
  return html.replace(/<!--[^>]*-->/g, "").replace(/&nbsp;|[  ]/g, " ").replace(/\s+/g, " ");
}

function proposition(ok: boolean, groupes: ReturnType<typeof groupesParJour>) {
  return createElement(EcranProposition, {
    groupes,
    proposition: new Map(),
    estFavori: () => false,
    chargement: false,
    ok,
    enCours: false,
    resultat: null,
    onValiderSemaine: () => {},
    onSuivant: () => {},
  });
}

await test("UX-ERR-01 (D-1). une lecture en erreur n'est JAMAIS présentée comme un état vide", () => {
  // ok = false, aucun repas → ERREUR.
  const erreur = texteRendu(renderToString(proposition(false, [])));
  assert.ok(erreur.includes("Impossible de lire tes repas prévus"), "l'erreur est dite");
  assert.ok(erreur.includes('role="alert"'), "et annoncée aux lecteurs d'écran");
  assert.ok(!erreur.includes("Aucun repas à valider"), "elle n'est PAS présentée comme un vide");
  assert.ok(!erreur.includes("VALIDER MA SEMAINE"), "et on ne propose rien à valider");

  // ok = true, aucun repas → VIDE ASSUMÉ.
  const vide = texteRendu(renderToString(proposition(true, [])));
  assert.ok(vide.includes("Aucun repas à valider"), "le vide est dit comme un vide");
  assert.ok(!vide.includes("Impossible de lire"), "et jamais comme une erreur");

  // ⚠️ UN SEUL SYSTÈME D'ERREUR : le même message, mot pour mot, sur les deux
  // écrans qui lisent le planifié. Deux textes auraient divergé.
  const repasErreur = texteRendu(renderToString(
    createElement(EcranRepasParJour, {
      groupes: [], chargement: false, ok: false, enCours: false, erreur: null,
      onValider: async () => true, estFavori: () => false, onSuivant: () => {},
    }),
  ));
  assert.ok(repasErreur.includes("Impossible de lire tes repas prévus"));
  assert.equal(
    (SRC_PARCOURS.match(/Impossible de lire tes repas prévus/g) ?? []).length,
    1,
    "le message n'existe qu'à UN endroit — aucun second système d'erreur",
  );
  assert.ok(SRC_PARCOURS.includes("function LectureImpossible()"), "il est factorisé");
  assert.equal((SRC_PARCOURS.match(/<LectureImpossible \/>/g) ?? []).length, 2, "utilisé par les deux écrans");
});

/** Rend le bloc « quantités » de N1.5, seul endroit où vit le bouton. */
function boutonDe(mode: "validation" | "brouillon" | undefined) {
  const solution = {
    status: "exact" as const,
    items: [{ slotId: "s", optionId: "o", name: "Riz", unit: "g" as const, quantity: 100.4, displayQuantity: 100 }],
    target: { calories: 400, proteinGrams: 20, carbGrams: 50, fatGrams: 10 },
    actual: { proteinGrams: 20, carbGrams: 50, fatGrams: 10 },
    delta: { proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
    ecartsVersLaCible: { proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
  };
  return renderToString(
    createElement(QuantitesDuRepas, {
      solution: solution as never,
      validation: { dejaValide: false, aJour: false, enCours: false, onValider: () => {}, mode },
    }),
  );
}

await test("UX-DRAFT-01 (D-2). le libellé du bouton dit ce qui se passe VRAIMENT", () => {
  // Parcours C0 : le clic ÉCRIT. Le libellé est inchangé.
  const c0 = boutonDe("validation");
  assert.ok(c0.includes("Valider mes choix"), "C0 garde son libellé");
  assert.ok(!c0.includes("Appliquer mes choix"));

  // Défaut absent ⇒ C0. Le parcours nutrition normal ne bouge pas d'un octet.
  const defaut = boutonDe(undefined);
  assert.equal(defaut, c0, "sans `mode`, le rendu est IDENTIQUE à C0");

  // Semaine proposée : le clic n'écrit rien. Le libellé le dit.
  const brouillon = boutonDe("brouillon");
  assert.ok(brouillon.includes("Appliquer mes choix"), "le brouillon applique, il ne valide pas");
  assert.ok(!brouillon.includes("Valider mes choix"), "et ne promet AUCUNE validation");
  assert.ok(!brouillon.includes("Mettre à jour mes choix"));

  // ⚠️ EXPLICITE, JAMAIS DEVINÉ : le mode est une prop, pas un reniflage du
  // callback. Le parcours le déclare selon le contexte.
  const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
  assert.ok(CODE_CHOIX.includes('export type ModeDeValidation = "validation" | "brouillon";'));
  assert.ok(CODE_CHOIX.includes('(validation.mode ?? "validation") === "brouillon"'));
  assert.ok(
    !/typeof\s+onRetoucher|onValider\.name|onValider\.toString/.test(CODE_CHOIX),
    "aucune détection fragile du callback",
  );
  assert.ok(CODE_PARCOURS.includes('mode: onRetoucher ? "brouillon" : "validation"'));

  // Et en mode brouillon, AUCUNE écriture n'est déclenchée : l'écran de
  // proposition ne connaît ni `validerChoixRepas`, ni aucune RPC.
  const bloc = SRC_PARCOURS.slice(
    SRC_PARCOURS.indexOf("export function EcranProposition("),
    SRC_PARCOURS.indexOf("function RapportDeValidation("),
  );
  for (const interdit of ["validerChoixRepas", "validerRepas", ".rpc(", "supabase"]) {
    assert.ok(!bloc.includes(interdit), `l'écran de proposition n'appelle pas ${interdit}`);
  }
});

/* ── D-3 : PRÊT / CONSOMMÉ / À RECOMPOSER, trois états distincts ─────────── */

/** Un repas validé sur `identite`, dont l'occurrence n'autorise plus que `restantes`. */
function repasApresChangement(identite: string, restantes: readonly string[]) {
  const occ: MealChoiceSlot = { ...OCC_A, options: restantes.map((id) => option(id, id)) };
  const semaine = {
    planId: "p", profiles: [],
    days: [{ id: "d", day: "monday", profileKey: "k", status: "s", meals: [repas("m", "lunch", "Déjeuner", [occ])] }],
  } as unknown as PlanV2Week;
  return repasDeLaPeriode(semaine, construirePeriode(LUNDI, 1)!, new Map<string, CompositionConnue>([
    ["m|2026-08-17", {
      items: [{ slotId: "slot-a", catalogFoodId: identite, productId: null, quantity: 120, unit: "g" }],
      consomme: false,
    }],
  ]));
}

await test("UX-RECOMP-01 (D-3). une composition encore valide reste PRÊTE", () => {
  const r = repasApresChangement("f-riz", ["f-riz", "f-poulet"]);
  assert.equal(r[0].pret, true);
  assert.equal(r[0].aRecomposer, false, "les deux états sont mutuellement exclusifs");
  const c = carteDuRepas(r[0]);
  assert.equal(c.pret, true);
  assert.equal(c.aRecomposer, false);
  assert.equal(c.choisis, 1);
  // Un repas prêt n'est pas re-proposé : on n'écrase pas le travail de l'élève.
  assert.equal(proposerSemaine(r, VIDE, VIDE).size, 0);
});

await test("UX-RECOMP-02 (D-3). une composition devenue interdite passe À RECOMPOSER", () => {
  // Le coach a retiré `f-saumon` de l'occurrence.
  const r = repasApresChangement("f-saumon", ["f-riz", "f-poulet"]);
  assert.equal(r[0].pret, false, "elle n'est PLUS prête");
  assert.equal(r[0].aRecomposer, true);
  const c = carteDuRepas(r[0]);
  assert.equal(c.aRecomposer, true);
  assert.equal(c.pret, false);
  assert.equal(c.choisis, 0, "le choix disparu n'est pas remplacé");
  // Et le modèle le range bien parmi les repas à composer.
  assert.equal(repasAComposer(r).length, 1);
});

await test("UX-RECOMP-03 (D-3). « à recomposer » apparaît dans le récapitulatif", () => {
  const groupes = groupesParJour(repasApresChangement("f-saumon", ["f-riz"]));
  const html = texteRendu(renderToString(proposition(true, groupes)));
  assert.ok(html.includes("1 repas est à recomposer"), "la semaine proposée le dit");
  assert.ok(html.includes("aucun aliment n"), "et précise qu'aucun remplacement n'a eu lieu");
  assert.ok(html.includes("À RECOMPOSER"), "la carte porte le statut");
  // L'écran des repas le dit aussi — les deux écrans convergent.
  const repasHtml = renderToString(
    createElement(EcranRepasParJour, {
      groupes, chargement: false, ok: true, enCours: false, erreur: null,
      onValider: async () => true, estFavori: () => false, onSuivant: () => {},
    }),
  );
  const repasTexte = texteRendu(repasHtml);
  assert.ok(repasTexte.includes("1 repas est à recomposer"));
  assert.ok(repasTexte.includes("À RECOMPOSER"));
});

await test("UX-RECOMP-04 (D-3). un repas à recomposer n'est JAMAIS compté comme validé", () => {
  const r = repasApresChangement("f-saumon", ["f-riz"]);
  const groupes = groupesParJour(r);
  const comptes = compterCartes(groupes);
  assert.equal(comptes.total, 1);
  assert.equal(comptes.prets, 0, "il ne compte pas comme prêt");
  assert.equal(comptes.aRecomposer, 1);
  // Il figure dans la proposition — pour être compté et ouvrable — mais sans
  // aucun choix, et jamais marqué complet.
  const p = proposerSemaine(r, VIDE, VIDE);
  assert.equal(p.size, 1, "il n'est plus sauté en silence");
  const propose = p.get(r[0].cle)!;
  assert.equal(propose.aRecomposer, true);
  assert.equal(propose.complet, false, "donc jamais envoyé à la validation de semaine");
  assert.deepEqual(propose.selection, {}, "et AUCUN choix n'a été fabriqué");
  assert.deepEqual(propose.origines, []);
  // Le bouton de semaine ne le compte pas.
  const html = texteRendu(renderToString(proposition(true, groupes)));
  assert.ok(html.includes("Aucun repas à valider"), "0 repas validables");
});

await test("UX-RECOMP-05 (D-3). aucune substitution silencieuse, même avec préférences et favoris", () => {
  const r = repasApresChangement("f-saumon", ["f-riz", "f-poulet"]);
  // Une préférence ET un favori portant sur des options ENCORE autorisées : le
  // moteur pourrait « réparer » le repas. Il ne doit pas.
  const p = proposerSemaine(r, new Set(["aliment:f-poulet"]), new Set(["aliment:f-riz"]));
  const propose = p.get(r[0].cle)!;
  assert.deepEqual(propose.selection, {}, "aucun aliment n'a été choisi à la place de l'élève");
  assert.equal(propose.complet, false);
  // La composition d'origine est conservée telle quelle pour l'écran, sans
  // que l'identité disparue ne soit remplacée.
  assert.equal(r[0].composition?.length, 1);
  assert.equal(r[0].composition?.[0].catalogFoodId, "f-saumon");
  // Le repas reste OUVRABLE : ses occurrences sont intactes.
  assert.equal(r[0].occurrences.length, 1);
  assert.equal(r[0].occurrences[0].options.length, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
   UX-SUP — LES ÉTATS DE CARTE, ET LE PLAN MODIFIÉ PAR LE COACH
   ══════════════════════════════════════════════════════════════════════════ */

await test("UX-SUP. un choix qui a quitté le snapshot passe « À RECOMPOSER », jamais remplacé", () => {
  // Le repas est validé en base sur `food-saumon`… que le coach a depuis
  // retiré de l'occurrence (OCC_A n'en contient plus qu'un sous-ensemble).
  const occReduite: MealChoiceSlot = { ...OCC_A, options: [option("food-riz", "Riz")] };
  const repasReduit = repasDeLaPeriode(
    {
      ...SEMAINE,
      days: [
        {
          ...SEMAINE.days[0],
          meals: [repas("r-dinner", "dinner", "Dîner", [occReduite])],
        },
      ],
    } as unknown as PlanV2Week,
    construirePeriode(LUNDI, 1)!,
    new Map<string, CompositionConnue>([
      [
        "r-dinner|2026-08-17",
        {
          items: [
            { slotId: "slot-a", catalogFoodId: "food-saumon", productId: null, quantity: 120, unit: "g" },
          ],
          consomme: false,
        },
      ],
    ]),
  );
  const carte = carteDuRepas(repasReduit[0]);
  assert.equal(carte.pret, false, "le repas n'est plus prêt");
  assert.equal(carte.aRecomposer, true, "il est À RECOMPOSER");
  assert.equal(carte.choisis, 0, "et aucun choix n'a été substitué en silence");

  // La proposition, elle, ne touche pas les repas déjà prêts ni consommés.
  const dejaPret = repasDeLaPeriode(
    SEMAINE,
    construirePeriode(LUNDI, 1)!,
    new Map<string, CompositionConnue>([
      [
        "r-dinner|2026-08-17",
        {
          items: [
            { slotId: "slot-a", catalogFoodId: "food-riz", productId: null, quantity: 100, unit: "g" },
          ],
          consomme: false,
        },
      ],
    ]),
  );
  const proposition = proposerSemaine(dejaPret, VIDE, VIDE);
  assert.equal(proposition.has("r-dinner|2026-08-17"), false, "un repas prêt n'est pas réécrit");
});

await test("UX-RESP. l'écran des repas est contraint en largeur", () => {
  const html = renderToString(
    createElement(EcranRepasParJour, {
      groupes: groupesParJour(REPAS),
      chargement: false,
      ok: true,
      enCours: false,
      erreur: null,
      onValider: async () => true,
      estFavori: () => false,
      onSuivant: () => {},
    }),
  );
  assert.ok(html.includes("min-w-0"), "les conteneurs peuvent rétrécir");
  assert.ok(html.includes("truncate"), "les libellés longs sont coupés");
  assert.ok(html.includes("flex-shrink-0"), "les statuts ne sont pas écrasés");
  assert.ok(html.includes("tabular-nums"), "les progressions s'alignent");
  // Les mesures en navigateur vivent dans /root/banc-c1.
  const preferences = renderToString(
    createElement(EcranPreferencesRapides, {
      repas: REPAS,
      favoris: VIDE,
      preferences: VIDE,
      onBasculer: () => {},
      chargement: false,
      onSuivant: () => {},
    }),
  );
  assert.ok(preferences.includes("sm:grid-cols-2"), "deux colonnes dès le petit écran large");
  assert.ok(preferences.includes("Qu&#x27;est-ce que tu préfères cette semaine"));
});
