/**
 * Harnais — COURSES C1 : PARCOURS 1 À 7 JOURS + PRÉFÉRENCES + GÉNÉRATION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il prouve ce qui est VÉRIFIABLE SANS BASE : l'arithmétique de la période,
 * l'agrégation et ses trois interdits (par nom, par conversion d'unité, par
 * somme d'options), la préservation des identités, la provenance, le point
 * d'entrée bleu, la route, l'absence totale d'ancien C1 dans le nouveau code,
 * l'absence de migration et de table de liste.
 *
 * ⚠️ IL NE MIME AUCUNE BASE. Les garanties serveur du planifié
 * (`planned_meals`, `planned_meal_items`, RLS, verrou C0.1) sont déjà prouvées
 * par `supabase/tests/courses_c0_validation_checklist.sql`. Les redoubler ici
 * produirait un double qui mentirait sur ce qu'il mesure.
 *
 * ⚠️ CE FICHIER N'IMPORTE RIEN DE L'ANCIEN CHANTIER COURSES. `NC-01` le
 * vérifie sur TOUS les fichiers neufs, pas seulement sur celui-ci.
 *
 * Lancement : npm run test:liste-de-courses
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { MIGRATION_C2, verifierContratDesMigrations } from "./contrat-migrations.mjs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { EcranDuree } from "../../components/student/ListeDeCoursesParcours";

import {
  agregerListeDeCourses,
  cleDeLigne,
  formatQuantite,
  type ItemPourAgregation,
} from "../../lib/nutrition/liste-de-courses";
import {
  DUREES_COURSES,
  construirePeriode,
  datesDeLaPeriode,
  estDureeCourses,
  jourDeLaDate,
  libellePeriode,
} from "../../lib/nutrition/periode-courses";
import {
  couleursParOccurrence,
  identitesDeChoix,
  optionsAutoriseesDeLaPeriode,
  repasAComposer,
  repasDeLaPeriode,
  type CompositionConnue,
} from "../../lib/nutrition/repas-de-la-periode";
import type { MealChoiceSlot, PlanV2Week } from "../../lib/nutrition/plan-v2-week";
import { messageDeRefus } from "../../hooks/useListeDeCourses";
import { NBSP } from "../../lib/nutrition/basis-points";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. Un commentaire n'est pas une preuve. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CHEMINS_NEUFS = [
  "../../lib/nutrition/periode-courses.ts",
  "../../lib/nutrition/liste-de-courses.ts",
  "../../lib/nutrition/repas-de-la-periode.ts",
  "../../lib/supabase/repas-planifies.ts",
  "../../hooks/useListeDeCourses.ts",
  "../../components/student/ListeDeCoursesHighlightLink.tsx",
  "../../components/student/ListeDeCoursesParcours.tsx",
  "../../app/(student)/nutrition/courses/page.tsx",
] as const;

const CODE_NEUF: ReadonlyMap<string, string> = new Map(
  CHEMINS_NEUFS.map((c) => [c, sansProse(lire(c))] as const),
);

const CODE_PAGE_NUTRITION = sansProse(lire("../../app/(student)/nutrition/page.tsx"));
const CODE_BOUTON = sansProse(lire("../../components/student/ListeDeCoursesHighlightLink.tsx"));
const CODE_BOUTON_RECETTES = sansProse(lire("../../components/student/RecipesHighlightLink.tsx"));
const CODE_PARCOURS = sansProse(lire("../../components/student/ListeDeCoursesParcours.tsx"));
const CODE_AGREGATION = sansProse(lire("../../lib/nutrition/liste-de-courses.ts"));
const CODE_READER = sansProse(lire("../../lib/supabase/repas-planifies.ts"));
const CODE_HOOK = sansProse(lire("../../hooks/useListeDeCourses.ts"));
const CODE_PERIODE = sansProse(lire("../../lib/nutrition/periode-courses.ts"));
const CSS = lire("../../app/globals.css");

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE — deux jours, deux repas, deux occurrences, identités explicites
   ══════════════════════════════════════════════════════════════════════════ */

const OCC_PROTEINE: MealChoiceSlot = {
  id: "slot-proteine",
  label: "Ta protéine",
  sourceListId: "liste-p",
  colorKey: "red",
  options: [
    { type: "aliment", id: "food-poulet", optionId: "opt-poulet", displayName: "Poulet" },
    { type: "produit", id: "prod-poulet", optionId: "opt-poulet-marque", displayName: "MarqueX — Poulet" },
  ],
};
const OCC_FECULENT: MealChoiceSlot = {
  id: "slot-feculent",
  label: "Ton féculent",
  sourceListId: "liste-f",
  colorKey: "yellow",
  options: [{ type: "aliment", id: "food-riz", optionId: "opt-riz", displayName: "Riz" }],
};

const SEMAINE: PlanV2Week = {
  planId: "plan-1",
  profiles: [],
  days: [
    {
      id: "jour-lundi",
      day: "monday",
      profileKey: "default",
      status: "non-commence",
      meals: [
        {
          id: "repas-pdj-lundi",
          slot: "breakfast",
          name: "Petit-déjeuner",
          items: [],
          calories: 500,
          protein: 30,
          carbs: 50,
          fat: 15,
          coachNotes: "",
          choiceSlots: [OCC_PROTEINE, OCC_FECULENT],
        },
        {
          id: "repas-libre-lundi",
          slot: "lunch",
          name: "Déjeuner libre",
          items: [],
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          coachNotes: "",
          choiceSlots: [],
        },
      ],
    },
    {
      id: "jour-mardi",
      day: "tuesday",
      profileKey: "default",
      status: "non-commence",
      meals: [
        {
          id: "repas-pdj-mardi",
          slot: "breakfast",
          name: "Petit-déjeuner",
          items: [],
          calories: 500,
          protein: 30,
          carbs: 50,
          fat: 15,
          coachNotes: "",
          choiceSlots: [OCC_PROTEINE],
        },
      ],
    },
  ],
};

/** Le 17 août 2026 est un LUNDI — vérifié par C1-06 lui-même. */
const LUNDI = "2026-08-17";

function item(p: Partial<ItemPourAgregation>): ItemPourAgregation {
  return {
    identityType: "catalog_food",
    identityId: "food-poulet",
    quantity: 100,
    unit: "g",
    displayName: "Poulet",
    colorKey: null,
    plannedOn: LUNDI,
    mealId: "repas-pdj-lundi",
    plannedMealId: "pm-1",
    choiceSlotId: "slot-proteine",
    ...p,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   C1-01 → C1-04 — LE POINT D'ENTRÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-01. le bouton « GÉNÉRER MA LISTE DE COURSE » est monté IMMÉDIATEMENT sous RECETTES", () => {
  assert.ok(
    CODE_BOUTON.includes("GÉNÉRER MA LISTE DE COURSE"),
    "le libellé EXACT est dans le composant",
  );
  const iRecettes = CODE_PAGE_NUTRITION.indexOf("<RecipesHighlightLink");
  const iCourses = CODE_PAGE_NUTRITION.indexOf("<ListeDeCoursesHighlightLink");
  assert.ok(iRecettes !== -1, "l'entrée Recettes est toujours là");
  assert.ok(iCourses !== -1, "l'entrée Courses est montée");
  assert.ok(iCourses > iRecettes, "elle est SOUS Recettes, jamais au-dessus");

  // « Immédiatement » : rien d'autre ne s'intercale entre les deux.
  const entreDeux = CODE_PAGE_NUTRITION.slice(iRecettes, iCourses);
  assert.equal(
    (entreDeux.match(/<[A-Z][A-Za-z]*/g) ?? []).length,
    1,
    "aucun composant ne s'intercale entre Recettes et Courses",
  );
  assert.ok(!/<Link\b/.test(entreDeux), "aucun lien ne s'intercale non plus");
});

await test("C1-02. le bouton est BLEU, et le bleu vient du thème", () => {
  assert.ok(CODE_BOUTON.includes("border-info/50"), "bordure bleue");
  assert.ok(CODE_BOUTON.includes("bg-info/10"), "fond bleu léger");
  assert.ok(CODE_BOUTON.includes("text-info"), "icône et flèche bleues");
  // ⚠️ AUCUNE COULEUR CODÉE EN DUR — même exigence que pour Recettes.
  assert.ok(
    !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(CODE_BOUTON),
    "aucune couleur littérale dans le composant",
  );
  // Le token existe dans les DEUX thèmes, et il est exposé à Tailwind.
  assert.ok(/--info:\s*#60a5fa/.test(CSS), "teinte sombre déclarée");
  assert.ok(/--info:\s*#2563eb/.test(CSS), "teinte claire déclarée");
  assert.ok(CSS.includes("--color-info: var(--info)"), "token exposé en utilitaire Tailwind");
});

await test("C1-03. c'est la MÊME animation que RECETTES, pas une copie", () => {
  assert.ok(CODE_BOUTON_RECETTES.includes("recettes-halo"), "Recettes porte la classe");
  assert.ok(CODE_BOUTON.includes("recettes-halo"), "Courses porte la MÊME classe");
  assert.ok(CODE_BOUTON.includes("halo-info"), "seule la teinte est substituée");

  // Une seule règle d'animation dans tout le projet.
  assert.equal(
    (CSS.match(/@keyframes recettes-halo-tour/g) ?? []).length,
    1,
    "une seule keyframes : dupliquer l'animation créerait deux réglages",
  );
  assert.equal(
    (CSS.match(/animation: recettes-halo-tour/g) ?? []).length,
    1,
    "une seule déclaration d'animation",
  );
  assert.ok(CSS.includes(".recettes-halo.halo-info"), "la variante est un simple modificateur");
  assert.ok(/--halo-teinte:\s*var\(--info\)/.test(CSS), "la variante ne change QUE la teinte");
  // Le repli sous prefers-reduced-motion vaut donc pour les DEUX entrées.
  assert.ok(CSS.includes("prefers-reduced-motion: reduce"), "le mouvement reste réductible");

  // Même structure visuelle : hauteur, halo, flèche, interaction.
  for (const marqueur of ["min-h-[44px]", "rounded-card", "pressable", "group", "ArrowRight", "transition-colors"]) {
    assert.ok(CODE_BOUTON.includes(marqueur), `structure commune : ${marqueur}`);
    assert.ok(CODE_BOUTON_RECETTES.includes(marqueur), `Recettes porte aussi ${marqueur}`);
  }
});

await test("C1-04. la route est /nutrition/courses, et aucune autre", () => {
  assert.ok(CODE_BOUTON.includes('href="/nutrition/courses"'));
  const fichiers = readdirSync(new URL("../../app/(student)/nutrition/courses/", import.meta.url));
  assert.ok(fichiers.includes("page.tsx"), "la page existe à l'adresse annoncée");

  // Ni /courses, ni /nutrition/[planId]/courses.
  for (const [chemin, code] of CODE_NEUF) {
    assert.ok(!/href="\/courses"/.test(code), `${chemin} ne pointe pas vers /courses`);
    assert.ok(!/\[planId\]\/courses/.test(code), `${chemin} n'introduit pas de route par plan`);
  }
  assert.ok(
    !/href="\/courses"/.test(CODE_PAGE_NUTRITION),
    "l'ancienne entrée sobre vers /courses a disparu de l'écran nutrition",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-05 → C1-08 — LA PÉRIODE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-05. la durée est limitée à 1..7, sans troncature silencieuse", () => {
  assert.deepEqual([...DUREES_COURSES], [1, 2, 3, 4, 5, 6, 7]);
  for (const bonne of DUREES_COURSES) {
    assert.ok(estDureeCourses(bonne), `${bonne} est acceptée`);
    assert.notEqual(construirePeriode(LUNDI, bonne), null);
  }
  for (const mauvaise of [0, -1, 8, 30, 3.5, NaN, Infinity, "3", null, undefined]) {
    assert.equal(estDureeCourses(mauvaise), false, `${String(mauvaise)} est refusée`);
    assert.equal(
      construirePeriode(LUNDI, mauvaise as number),
      null,
      `${String(mauvaise)} ne produit AUCUNE période — jamais un repli sur 7`,
    );
  }
  // ⚠️ ET IL N'EXISTE AUCUNE VALEUR PAR DÉFAUT À VALIDER : la constante a été
  // RETIRÉE du module, pour qu'aucun appelant ne puisse la réimporter « pour
  // initialiser proprement ». C1-DUREE-01 le mesure sur le texte du fichier.
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-DUREE-01 → 05 — AUCUNE DURÉE PAR DÉFAUT

   ⚠️ « AUCUN CHOIX » ET « LE CHOIX 3 » SONT DEUX ÉTATS DIFFÉRENTS. Une case
   pré-cochée est une réponse que l'élève n'a pas donnée : il avance sans lire
   la question, et repart avec une liste pour une période que personne n'a
   choisie. Ces cinq tests existent pour que ce défaut ne puisse pas revenir.
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-DUREE-01. aucune durée n'est sélectionnée à l'ouverture", () => {
  // 1. L'ÉTAT INITIAL est `null`, et son type l'autorise.
  assert.ok(
    CODE_PARCOURS.includes("useState<DureeCourses | null>(null)"),
    "la durée s'initialise à null, jamais à un nombre",
  );
  assert.ok(
    !/useState<DureeCourses[^>]*>\((?!null)/.test(CODE_PARCOURS),
    "aucune initialisation par une valeur",
  );

  // 2. LA CONSTANTE DE DÉFAUT N'EXISTE PLUS NULLE PART.
  assert.ok(
    !CODE_PERIODE.includes("export const DUREE_COURSES_PAR_DEFAUT"),
    "la constante a été retirée du module, pas seulement mise à null",
  );
  for (const [chemin, code] of CODE_NEUF) {
    assert.ok(!code.includes("DUREE_COURSES_PAR_DEFAUT"), `${chemin} ne l'importe pas`);
  }
  // Et aucun `useState(3)` ni équivalent n'a survécu.
  assert.ok(!/useState\(\s*[1-7]\s*\)/.test(CODE_PARCOURS), "aucun useState(n) sur la durée");

  // 3. LE RENDU RÉEL : sept radios, AUCUN coché.
  const html = renderToString(
    createElement(EcranDuree, { duree: null, onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.equal((html.match(/type="radio"/g) ?? []).length, 7, "les sept durées sont proposées");
  assert.equal((html.match(/checked=""/g) ?? []).length, 0, "aucune n'est cochée");
  assert.ok(!html.includes('checked="checked"'), "aucune n'est cochée (forme longue)");

  // Contre-épreuve : avec une durée choisie, il y en a exactement UNE.
  const choisi = renderToString(
    createElement(EcranDuree, { duree: 5, onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.equal(
    (choisi.match(/checked=""/g) ?? []).length,
    1,
    "une durée choisie coche exactement une case — le test sait donc voir une coche",
  );
});

await test("C1-DUREE-02. impossible de continuer tant que la durée est null", () => {
  // 1. LE BOUTON EST DÉSACTIVÉ, et il dit pourquoi.
  const vide = renderToString(
    createElement(EcranDuree, { duree: null, onChoisir: () => {}, onSuivant: () => {} }),
  );
  // ⚠️ ON CHERCHE L'ATTRIBUT, PAS LA SOUS-CHAÎNE. Les classes utilitaires du
  // bouton contiennent déjà « disabled: » — s'en contenter rendrait ce test
  // vrai quoi qu'il arrive.
  assert.ok(/<button[^>]*\sdisabled=""/.test(vide), "le bouton de continuation est désactivé");
  assert.ok(vide.includes("Choisis une durée"), "et il indique ce qui manque");
  assert.ok(!vide.includes(">Continuer<"), "il ne promet pas de continuer");

  // 2. IL SE RÉACTIVE dès qu'une durée est choisie — sinon le test ci-dessus
  //    serait vrai pour une raison qui n'a rien à voir.
  const rempli = renderToString(
    createElement(EcranDuree, { duree: 2, onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.ok(!/<button[^>]*\sdisabled=""/.test(rempli), "avec une durée, le bouton est actif");
  assert.ok(rempli.includes("Continuer"));

  // 3. LE VERROU N'EST PAS SEULEMENT VISUEL. Sans durée il n'existe AUCUNE
  //    période : pas de dates, donc aucune lecture, aucun repas, aucune liste.
  assert.equal(construirePeriode(LUNDI, null), null);
  assert.deepEqual(repasDeLaPeriode(SEMAINE, null, new Map()), []);
  assert.equal(
    CODE_PARCOURS.includes("desactive={duree === null}"),
    true,
    "le bouton est gouverné par l'état, pas par une variable parallèle",
  );
});

await test("C1-DUREE-03. les durées 1 à 7 sont acceptées", () => {
  for (const valeur of [1, 2, 3, 4, 5, 6, 7]) {
    assert.ok(estDureeCourses(valeur), `${valeur} est acceptée`);
    const periode = construirePeriode(LUNDI, valeur);
    assert.notEqual(periode, null, `${valeur} produit une période`);
    assert.equal(periode!.duree, valeur);
    assert.equal(periode!.jours.length, valeur, `${valeur} jours, pas un de plus`);
    assert.equal(periode!.debut, LUNDI);
  }
});

await test("C1-DUREE-04. 0 et les valeurs supérieures à 7 sont refusées", () => {
  for (const valeur of [0, -1, -7, 8, 9, 30, 365]) {
    assert.equal(estDureeCourses(valeur), false, `${valeur} est refusée`);
    assert.equal(
      construirePeriode(LUNDI, valeur),
      null,
      `${valeur} ne produit AUCUNE période — jamais un repli sur 7`,
    );
  }
  // Et ce qui n'est pas un entier non plus.
  for (const valeur of [3.5, NaN, Infinity, -Infinity]) {
    assert.equal(estDureeCourses(valeur), false, `${String(valeur)} est refusée`);
    assert.equal(construirePeriode(LUNDI, valeur), null);
  }
  // L'écran ne propose jamais autre chose que les sept.
  assert.deepEqual([...DUREES_COURSES], [1, 2, 3, 4, 5, 6, 7]);
  const html = renderToString(
    createElement(EcranDuree, { duree: null, onChoisir: () => {}, onSuivant: () => {} }),
  );
  assert.equal((html.match(/type="radio"/g) ?? []).length, 7);
  assert.ok(!/value="0"|value="8"/.test(html), "ni 0 ni 8 ne sont rendus");
});

await test("C1-DUREE-05. le choix de durée survit à un retour dans le parcours", () => {
  // ⚠️ CE N'EST PAS UNE QUESTION DE PERSISTANCE, MAIS DE PLACE DE L'ÉTAT. La
  // durée vit dans `ListeDeCoursesParcours`, au-dessus des quatre écrans :
  // reculer ne démonte pas ce composant, donc ne peut pas perdre la valeur.
  assert.ok(CODE_PARCOURS.includes("useState<DureeCourses | null>(null)"));

  // Les deux fonctions de navigation ne touchent QUE l'étape.
  const source = lire("../../components/student/ListeDeCoursesParcours.tsx");
  const reculer = source.slice(source.indexOf("const reculer"), source.indexOf("const avancer"));
  const avancer = source.slice(source.indexOf("const avancer"), source.indexOf("return (", source.indexOf("const avancer")));
  for (const [nom, bloc] of [["reculer", reculer], ["avancer", avancer]] as const) {
    assert.ok(bloc.includes("setEtape("), `${nom} change l'étape`);
    assert.ok(!bloc.includes("setDuree"), `${nom} ne touche JAMAIS la durée`);
  }

  // `setDuree` n'est appelé QUE par le choix de l'élève, et nulle part ailleurs.
  assert.equal(
    (CODE_PARCOURS.match(/setDuree/g) ?? []).length,
    2,
    "setDuree : sa déclaration, et le seul onChoisir — rien d'autre",
  );
  assert.ok(CODE_PARCOURS.includes("onChoisir={setDuree}"));

  // Et l'écran de durée n'est pas remonté avec une clé qui le recréerait.
  assert.ok(
    !/EcranDuree[^>]*key=/.test(CODE_PARCOURS),
    "aucune `key` ne force le remontage de l'écran de durée",
  );
});

await test("C1-06. la période est faite de DATES RÉELLES, bornes incluses", () => {
  assert.equal(jourDeLaDate(LUNDI), "monday", "le 17 août 2026 est bien un lundi");

  // L'exemple du cahier des charges : départ lundi + 4 jours.
  const quatre = construirePeriode(LUNDI, 4);
  assert.notEqual(quatre, null);
  assert.deepEqual(datesDeLaPeriode(quatre!), ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"]);
  assert.deepEqual(
    quatre!.jours.map((j) => j.jour),
    ["monday", "tuesday", "wednesday", "thursday"],
  );
  assert.equal(quatre!.debut, "2026-08-17");
  assert.equal(quatre!.fin, "2026-08-20", "la borne de fin est INCLUSE : debut + duree - 1");

  // Un jour : début et fin confondus.
  const un = construirePeriode(LUNDI, 1)!;
  assert.equal(un.debut, un.fin);

  // Sept jours enjambent la semaine sans trou ni doublon.
  const sept = construirePeriode("2026-08-20", 7)!;
  assert.deepEqual(datesDeLaPeriode(sept), [
    "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
  ]);
  assert.equal(new Set(datesDeLaPeriode(sept)).size, 7);

  // Changement de mois, et d'année.
  assert.deepEqual(datesDeLaPeriode(construirePeriode("2026-08-30", 3)!), [
    "2026-08-30", "2026-08-31", "2026-09-01",
  ]);
  assert.deepEqual(datesDeLaPeriode(construirePeriode("2026-12-31", 2)!), ["2026-12-31", "2027-01-01"]);

  // Le libellé nomme les jours ET les dates réelles.
  assert.equal(libellePeriode(quatre!), "Du lundi 17 au jeudi 20 août");
  assert.equal(libellePeriode(un), "Le lundi 17 août");
  assert.equal(libellePeriode(construirePeriode("2026-08-30", 3)!), "Du dimanche 30 août au mardi 1 septembre");
  assert.equal(
    libellePeriode(construirePeriode("2026-12-31", 2)!),
    "Du jeudi 31 décembre 2026 au vendredi 1 janvier 2027",
  );
});

await test("C1-07 / C1-08. seuls les repas de la période entrent, et tous y entrent", () => {
  const periode = construirePeriode(LUNDI, 2)!; // lundi + mardi
  const repas = repasDeLaPeriode(SEMAINE, periode, new Map());

  // C1-08 — les deux jours du plan sont représentés, par leurs DATES.
  assert.deepEqual(
    repas.map((r) => r.cle),
    ["repas-pdj-lundi|2026-08-17", "repas-pdj-mardi|2026-08-18"],
  );

  // C1-07 — mercredi n'est pas dans la période : rien de mercredi n'apparaît.
  const unSeulJour = repasDeLaPeriode(SEMAINE, construirePeriode(LUNDI, 1)!, new Map());
  assert.deepEqual(unSeulJour.map((r) => r.date), ["2026-08-17"]);

  // Un repas SANS occurrence de liste ne peut produire aucun planned_meal_item :
  // il est écarté du parcours plutôt que compté « à composer » à tort.
  assert.ok(!repas.some((r) => r.mealId === "repas-libre-lundi"));

  // Une composition datée d'un AUTRE jour ne rend pas le repas prêt.
  const ailleurs = new Map<string, CompositionConnue>([
    ["repas-pdj-lundi|2026-08-24", { items: [{ slotId: "slot-proteine", catalogFoodId: "food-poulet", productId: null, quantity: 100, unit: "g" }], consomme: false }],
  ]);
  assert.equal(repasDeLaPeriode(SEMAINE, periode, ailleurs)[0].pret, false);
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-09 / C1-10 — LE REPAS NON VALIDÉ
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-09 / C1-10. un repas non validé est SIGNALÉ, et n'invente aucun aliment", () => {
  const periode = construirePeriode(LUNDI, 2)!;
  const compositions = new Map<string, CompositionConnue>([
    [
      "repas-pdj-lundi|2026-08-17",
      {
        items: [
          { slotId: "slot-proteine", catalogFoodId: "food-poulet", productId: null, quantity: 120, unit: "g" },
          { slotId: "slot-feculent", catalogFoodId: "food-riz", productId: null, quantity: 80, unit: "g" },
        ],
        consomme: false,
      },
    ],
  ]);
  const repas = repasDeLaPeriode(SEMAINE, periode, compositions);
  assert.equal(repas[0].pret, true, "lundi est composé");
  assert.equal(repas[1].pret, false, "mardi ne l'est pas");

  // C1-10 — le repas non validé n'a AUCUNE composition, même partielle.
  assert.equal(repas[1].composition, null);
  assert.deepEqual(repasAComposer(repas).map((r) => r.cle), ["repas-pdj-mardi|2026-08-18"]);

  // L'écran le dit en toutes lettres, et il compte.
  assert.ok(CODE_PARCOURS.includes("restent à composer") || CODE_PARCOURS.includes("rest{restants > 1"));
  // ⚠️ MIS À JOUR PAR C1.1 : le statut de la carte s'écrit désormais en
  // capitales (« À COMPOSER » / « PRÊT »), comme le demande le nouveau
  // gabarit. L'intention est INCHANGÉE — l'état est ÉCRIT, pas seulement
  // coloré — et le test reste falsifiable : retirer le libellé le rougit.
  assert.ok(CODE_PARCOURS.includes("À COMPOSER"), "l'état est ÉCRIT, pas seulement coloré");
  assert.ok(CODE_PARCOURS.includes("PRÊT"), "et son opposé aussi");
  // Le bouton de génération est bloqué tant qu'il reste des repas.
  assert.ok(CODE_PARCOURS.includes("desactive={restants > 0"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-11 → C1-18 — LA LISTE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-11. la liste ne se calcule QUE depuis les items planifiés", () => {
  // Le hook n'agrège que ce que le lecteur du planifié lui a rendu.
  assert.ok(CODE_HOOK.includes("lireRepasPlanifiesSurPeriode"));
  assert.ok(CODE_HOOK.includes("agregerListeDeCourses"));
  // Le lecteur ne lit que les deux tables du planifié.
  assert.ok(CODE_READER.includes('from("planned_meals")'));
  assert.ok(CODE_READER.includes('from("planned_meal_items")'));
  for (const interdite of ["consumed_meals", "meal_entries", "meal_choice_options", "nutrition_days"]) {
    assert.ok(!CODE_READER.includes(`from("${interdite}")`), `le lecteur ne lit pas ${interdite}`);
  }
  // Les seules autres requêtes sont l'hydratation des NOMS.
  const tables = [...CODE_READER.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(tables)], ["food_catalog", "food_products", "planned_meal_items", "planned_meals"]);
  // ⚠️ AUCUNE ÉCRITURE DANS LE LECTEUR.
  for (const ecriture of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
    assert.ok(!CODE_READER.includes(ecriture), `le lecteur n'écrit pas (${ecriture})`);
  }
  // Pas de N+1 : aucune requête à l'intérieur d'une boucle.
  const corpsDeBoucles = [...CODE_READER.matchAll(/for \([^)]*\) \{[\s\S]*?\n  \}/g)].map((m) => m[0]);
  for (const boucle of corpsDeBoucles) {
    assert.ok(!boucle.includes("supabase."), "aucune requête dans une boucle");
  }
});

await test("C1-12. aucun solveur, aucune macro, aucune portion préférée dans les courses", () => {
  for (const [chemin, code] of CODE_NEUF) {
    for (const interdit of [
      "solveMealChoices",
      "meal-choice-solver",
      "recipe-solver",
      "preferredQuantity",
      "preferred_quantity",
      "minimumQuantity",
      "minimum_quantity",
      "proteinPer100",
      "computeDailyMacroTargets",
    ]) {
      // `repas-de-la-periode` importe le TYPE de la cible (pour la passer telle
      // quelle à StudentMealChoices) ; il n'appelle aucun solveur.
      if (chemin.includes("repas-de-la-periode") && interdit === "meal-choice-solver") continue;
      assert.ok(!code.includes(interdit), `${chemin} ne contient pas ${interdit}`);
    }
  }
  assert.ok(
    !CODE_AGREGATION.includes("import { solve") && !CODE_AGREGATION.includes("solver"),
    "le moteur d'agrégation ignore jusqu'à l'existence d'un solveur",
  );
});

await test("C1-13 / C1-14. les identités catalogue ET produit traversent intactes", () => {
  const lignes = agregerListeDeCourses([
    item({ identityType: "catalog_food", identityId: "food-poulet", displayName: "Poulet" }),
    item({ identityType: "product", identityId: "prod-poulet", displayName: "MarqueX — Poulet", quantity: 50 }),
  ]);
  assert.equal(lignes.length, 2, "un aliment et un produit ne se confondent pas");

  const catalogue = lignes.find((l) => l.identityType === "catalog_food")!;
  const produit = lignes.find((l) => l.identityType === "product")!;
  assert.equal(catalogue.identityId, "food-poulet");
  assert.equal(produit.identityId, "prod-poulet");
  assert.equal(catalogue.cle, "catalog_food:food-poulet|g");
  assert.equal(produit.cle, "product:prod-poulet|g");
  assert.equal(cleDeLigne("catalog_food", "abc", "g"), "catalog_food:abc|g");
  assert.equal(cleDeLigne("product", "abc", "ml"), "product:abc|ml");

  // Le lecteur préserve AUSSI les colonnes brutes, pas seulement le couple dérivé.
  assert.ok(CODE_READER.includes("catalogFoodId: brut.catalog_food_id"));
  assert.ok(CODE_READER.includes("productId: brut.product_id"));
  for (const champ of ["choiceSlotId", "plannedMealId", "plannedOn", "mealId", "slotKey", "label", "unit", "quantity"]) {
    assert.ok(CODE_READER.includes(champ), `le lecteur préserve ${champ}`);
  }
});

await test("C1-15. même identité + même unité : les quantités s'additionnent", () => {
  const lignes = agregerListeDeCourses([
    item({ quantity: 120, plannedOn: "2026-08-17", plannedMealId: "pm-1" }),
    item({ quantity: 90, plannedOn: "2026-08-18", plannedMealId: "pm-2" }),
    item({ quantity: 120, plannedOn: "2026-08-19", plannedMealId: "pm-3" }),
  ]);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].quantite, 330);
  assert.equal(lignes[0].sources.length, 3);
});

await test("C1-16. deux identités différentes ne fusionnent JAMAIS, même à nom identique", () => {
  const lignes = agregerListeDeCourses([
    item({ identityId: "food-poulet-a", displayName: "Poulet", quantity: 100 }),
    item({ identityId: "food-poulet-b", displayName: "Poulet", quantity: 200 }),
  ]);
  assert.equal(lignes.length, 2, "le nom identique ne les rapproche pas");
  assert.deepEqual(lignes.map((l) => l.quantite).sort((a, b) => a - b), [100, 200]);

  // Et un aliment du catalogue ne fusionne pas avec un produit de même id.
  const croises = agregerListeDeCourses([
    item({ identityType: "catalog_food", identityId: "meme-uuid" }),
    item({ identityType: "product", identityId: "meme-uuid" }),
  ]);
  assert.equal(croises.length, 2);
});

await test("C1-17. deux unités différentes ne fusionnent JAMAIS, et rien n'est converti", () => {
  const lignes = agregerListeDeCourses([
    item({ unit: "g", quantity: 100 }),
    item({ unit: "ml", quantity: 100 }),
    item({ unit: "piece", quantity: 2 }),
  ]);
  assert.equal(lignes.length, 3, "trois unités, trois lignes");
  assert.deepEqual(
    lignes.map((l) => `${l.unit}:${l.quantite}`).sort(),
    ["g:100", "ml:100", "piece:2"],
  );
  // Aucune table de densité, aucun facteur de conversion nulle part.
  for (const [chemin, code] of CODE_NEUF) {
    assert.ok(!/densit[ée]/i.test(code), `${chemin} ne porte aucune densité`);
    assert.ok(!/convert(ir)?Unit|toGrams|enGrammes/i.test(code), `${chemin} ne convertit pas d'unité`);
  }
});

await test("C1-18. la provenance de chaque ligne est conservée, en mémoire seulement", () => {
  const lignes = agregerListeDeCourses([
    item({ quantity: 120, plannedOn: "2026-08-17", mealId: "m1", plannedMealId: "pm-1", choiceSlotId: "slot-proteine" }),
    item({ quantity: 90, plannedOn: "2026-08-18", mealId: "m2", plannedMealId: "pm-2", choiceSlotId: "slot-proteine" }),
  ]);
  assert.equal(lignes.length, 1);
  assert.deepEqual(lignes[0].sources, [
    { plannedOn: "2026-08-17", mealId: "m1", plannedMealId: "pm-1", choiceSlotId: "slot-proteine", quantity: 120, unit: "g" },
    { plannedOn: "2026-08-18", mealId: "m2", plannedMealId: "pm-2", choiceSlotId: "slot-proteine", quantity: 90, unit: "g" },
  ]);
  // La somme des sources EST la quantité affichée — aucune arithmétique cachée.
  assert.equal(
    lignes[0].sources.reduce((t, s) => t + s.quantity, 0),
    lignes[0].quantite,
  );
  // ⚠️ ELLE N'EST PAS PERSISTÉE : aucune écriture ne part du parcours hormis C0.
  assert.ok(!CODE_HOOK.includes("provenance"), "aucune table de provenance");
});

await test("C1-15 bis. la couleur n'est un accent que si TOUTES les sources sont d'accord", () => {
  const unanime = agregerListeDeCourses([item({ colorKey: "red" }), item({ colorKey: "red" })]);
  assert.equal(unanime[0].colorKey, "red");

  const divergent = agregerListeDeCourses([item({ colorKey: "red" }), item({ colorKey: "blue" })]);
  assert.equal(divergent[0].colorKey, null, "deux couleurs ne se moyennent pas : l'accent disparaît");

  const partiel = agregerListeDeCourses([item({ colorKey: "red" }), item({ colorKey: null })]);
  assert.equal(partiel[0].colorKey, null);

  assert.equal(agregerListeDeCourses([item({ colorKey: null })])[0].colorKey, null);

  // La couleur ne classe rien : elle ne participe pas à la clé.
  assert.equal(
    agregerListeDeCourses([item({ colorKey: "red" }), item({ colorKey: "blue" })]).length,
    1,
    "deux couleurs, une seule ligne : la couleur n'agrège pas",
  );
  // Les couleurs viennent de la semaine déjà chargée, pas d'une 5e requête.
  const couleurs = couleursParOccurrence(SEMAINE);
  assert.equal(couleurs.get("slot-proteine"), "red");
  assert.equal(couleurs.get("slot-feculent"), "yellow");
  assert.ok(!CODE_READER.includes("meal_choice_slots"), "aucune requête de couleur");
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-19 — LES PRÉFÉRENCES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-19. une préférence n'invente aucun aliment", () => {
  const repas = repasDeLaPeriode(SEMAINE, construirePeriode(LUNDI, 2)!, new Map());
  const options = optionsAutoriseesDeLaPeriode(repas);

  // La liste des préférences sort EXCLUSIVEMENT du snapshot du coach.
  assert.deepEqual(
    options.map((o) => o.cle).sort(),
    ["aliment:food-poulet", "aliment:food-riz", "produit:prod-poulet"],
  );
  // Le riz n'est proposé que le lundi, le poulet les deux jours.
  assert.equal(options.find((o) => o.cle === "aliment:food-riz")!.occurrences, 1);
  assert.equal(options.find((o) => o.cle === "aliment:food-poulet")!.occurrences, 2);

  // Aucune option ne peut naître ailleurs : la fonction ne lit QUE `occurrences`.
  const sansOccurrence = optionsAutoriseesDeLaPeriode([]);
  assert.deepEqual(sansOccurrence, []);

  // La mise en avant est un PRÉDICAT : elle rend un booléen, elle n'ajoute rien.
  const CODE_CHOIX = sansProse(lire("../../components/student/StudentMealChoices.tsx"));
  assert.ok(CODE_CHOIX.includes("export type MiseEnAvantDOption"));
  assert.ok(CODE_CHOIX.includes("=> boolean"), "le contrat rend un booléen");
  assert.ok(
    CODE_CHOIX.includes("misEnAvant?.({ type: option.type, id: option.id }) === true"),
    "elle est INTERROGÉE avec une option déjà présente dans le snapshot",
  );
  // Elle ne filtre ni ne réordonne : `occurrence.options.map` est intact.
  assert.ok(CODE_CHOIX.includes("occurrence.options.map((option)"));
  assert.ok(
    !/occurrence\.options\s*\.(filter|sort)/.test(CODE_CHOIX),
    "aucune option n'est retirée ni réordonnée par une préférence",
  );

  // Les préférences réutilisent les favoris A5 — aucun système parallèle.
  assert.ok(CODE_PARCOURS.includes("useRaccourcisAliments"));
  assert.ok(!CODE_PARCOURS.includes("food_favorites"), "le parcours ne réécrit pas la table");
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-20 → C1-22 — CE QUI N'EXISTE PAS
   ══════════════════════════════════════════════════════════════════════════ */

const IMPORTS_INTERDITS = [
  "lib/courses/",
  "@/lib/courses",
  "hooks/useCourses",
  "components/student/Courses",
  "(student)/courses",
] as const;

await test("C1-20 / NC-01. aucun fichier neuf n'importe l'ancien chantier Courses", () => {
  for (const [chemin, code] of CODE_NEUF) {
    for (const interdit of IMPORTS_INTERDITS) {
      assert.ok(!code.includes(interdit), `${chemin} n'importe pas ${interdit}`);
    }
  }
  // La page nutrition non plus.
  for (const interdit of IMPORTS_INTERDITS) {
    assert.ok(!CODE_PAGE_NUTRITION.includes(interdit), `l'écran nutrition n'importe pas ${interdit}`);
  }
  // Et le vocabulaire de l'ancien parcours n'a pas ressuscité.
  for (const [chemin, code] of CODE_NEUF) {
    for (const mot of ["plan_envies", "plan_habitudes", "plan_seul", "rayon", "SUGGESTIONS", "besoins"]) {
      assert.ok(!code.includes(mot), `${chemin} ne réintroduit pas « ${mot} »`);
    }
  }
});

await test("C1-21. le contrat des migrations : C0.1 puis C2, et rien d'autre", () => {
  // ⚠️ CETTE ASSERTION A ÉTÉ RENFORCÉE, PAS ASSOUPLIE. Elle disait « la
  // dernière migration reste C0.1, et il y en a 80 ». C2 en ajoute une : le
  // compte devient faux. Le remonter à 81 aurait DÉTRUIT la garantie — « 81 »
  // est satisfait par n'importe quelle 81ᵉ migration, y compris une migration
  // étrangère glissée au passage.
  //
  // Le contrat partagé vérifie désormais l'IDENTITÉ EXACTE de la migration
  // autorisée, l'ORDRE du couple final, l'horodatage, l'unicité de la
  // migration de courses, et une EMPREINTE de tout l'historique antérieur.
  // Il rougit sur une seconde migration C2, sur une migration étrangère, et
  // sur un antidatage — trois cas que l'ancien compte laissait passer.
  verifierContratDesMigrations(assert);

  // ⚠️ ET C1 LUI-MÊME N'EN A TOUJOURS ÉCRIT AUCUNE. C'est la garantie propre à
  // ce lot-ci : la migration autorisée appartient à C2, pas à C1.
  for (const [chemin, code] of CODE_NEUF) {
    assert.ok(!code.includes("supabase/migrations"), `${chemin} ne touche pas aux migrations`);
  }
});

await test("C1-22. C1 lui-même ne persiste AUCUN état de liste", () => {
  // ⚠️ CE TEST ÉTAIT UN FAUX VERT, ET C'EST C2 QUI L'A RÉVÉLÉ.
  //
  // Il cherchait `shopping_lists` dans les NOMS DE FICHIERS de migration. La
  // migration C2 s'appelle `…_c2_liste_de_courses_persistante.sql` : elle CRÉE
  // `shopping_lists`, et le test restait vert parce que le mot n'est pas dans
  // son nom. Il aurait continué à affirmer « aucun état n'est persisté » alors
  // que c'était devenu faux.
  //
  // On cherche donc dans le CONTENU, et on dit la vérité : la persistance
  // existe, elle appartient à C2, et elle n'appartient qu'à C2.
  const dossier = new URL("../../supabase/migrations/", import.meta.url);
  const creatrices = readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) =>
      /create table[^;]*public\.(shopping_lists|shopping_list_items|shopping_list_state)/i.test(
        readFileSync(new URL(f, dossier), "utf8"),
      ),
    )
    .sort();
  assert.deepEqual(
    creatrices,
    [MIGRATION_C2],
    "les tables de liste persistante n'appartiennent qu'à la migration C2",
  );

  // ⚠️ ET AUCUN FICHIER DE C1 NE LES CONNAÎT. C'est la garantie propre à ce
  // lot : le parcours C1 ne lit ni n'écrit la persistance de C2.
  for (const table of ["shopping_lists", "shopping_list_items", "shopping_list_state"]) {
    for (const [chemin, code] of CODE_NEUF) {
      assert.ok(!code.includes(table), `${chemin} ne connaît pas ${table}`);
    }
  }

  // `EcranListe` — l'écran LOCAL de C1 — existe toujours, et coche toujours en
  // mémoire. Il n'est plus monté par le parcours depuis C2 (voir UX-20), mais
  // il reste exporté et mesuré : le supprimer obligerait à réécrire des tests
  // hors périmètre pour retrouver du vert.
  assert.ok(CODE_PARCOURS.includes("useState<ReadonlySet<string>>(new Set())"));
  assert.ok(lire("../../components/student/ListeDeCoursesParcours.tsx").includes("n&apos;est pas enregistré"));

  // La SEULE écriture du parcours est celle de C0.
  const rpcs = [...CODE_HOOK.matchAll(/validerChoixRepas|enregistrer_repas_planifie/g)].length;
  assert.ok(rpcs >= 1, "le geste C0 est bien branché");
  for (const ecriture of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(!CODE_HOOK.includes(ecriture), `le hook n'écrit pas directement (${ecriture})`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-23 / C1-24 — RESPONSIVE ET ACCESSIBILITÉ (les invariants de code)
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-23. rien ne peut déborder : tout texte long est contraint", () => {
  // Les mesures en navigateur vivent dans /root/banc-c1 ; ici on vérifie les
  // invariants sans lesquels aucune mesure ne peut être bonne.
  const source = lire("../../components/student/ListeDeCoursesParcours.tsx");
  assert.ok(source.includes("min-w-0"), "les conteneurs flex peuvent rétrécir");
  assert.ok(source.includes("truncate"), "les noms Ciqual très longs sont coupés");
  assert.ok(source.includes("flex-shrink-0"), "les quantités ne sont jamais écrasées");
  assert.ok(source.includes("whitespace-nowrap"), "la quantité ne se coupe pas de son unité");
  assert.ok(source.includes("tabular-nums"), "les chiffres s'alignent");
  // Le sélecteur 1..7 se replie sur téléphone.
  assert.ok(source.includes("grid-cols-4") && source.includes("sm:grid-cols-7"));
  // Quantités à quatre chiffres : l'espace de milliers est insécable en fr-FR.
  // ⚠️ LE SÉPARATEUR DE MILLIERS EST INSÉCABLE, quel qu'il soit selon l'ICU du
  // runtime (espace fine U+202F ou insécable U+00A0) : on vérifie la PROPRIÉTÉ
  // — le nombre ne se coupe pas — pas un octet précis.
  const mille = formatQuantite(1500, "g");
  assert.match(mille, /^1\u202f500\u00a0g$/, `séparateur insécable attendu, reçu ${JSON.stringify(mille)}`);
  assert.equal(formatQuantite(2, "piece"), `2${NBSP}pièces`);
  assert.equal(formatQuantite(1, "piece"), `1${NBSP}pièce`);
  assert.equal(formatQuantite(329.6, "ml"), `330${NBSP}ml`);
});

await test("C1-24. accessibilité : cibles, sémantique, clavier, jamais la couleur seule", () => {
  const source = lire("../../components/student/ListeDeCoursesParcours.tsx");
  // Toute cible tactile fait au moins 44 px.
  const boutons = source.match(/className="[^"]*pressable[^"]*"/g) ?? [];
  assert.ok(boutons.length >= 5, "le parcours a bien plusieurs cibles");
  for (const b of boutons) {
    assert.ok(b.includes("min-h-[44px]"), `cible trop petite : ${b.slice(0, 70)}`);
  }
  // La durée : de VRAIS radios, donc flèches et lecteur d'écran gratuits.
  assert.ok(source.includes('type="radio"'), "sémantique radio native");
  assert.ok(source.includes("<fieldset") && source.includes("<legend"), "le groupe est nommé");
  // Les bascules disent leur état.
  // ⚠️ MIS À JOUR PAR C1.1. L'écran « marque chaque aliment en favori » a été
  // retiré (il était le défaut UX corrigé) ; la bascule qui reste est celle
  // des préférences courtes. Le contrat d'accessibilité est identique : toute
  // bascule dit son état par `aria-pressed`, tout dépliant par `aria-expanded`.
  assert.ok(source.includes("aria-pressed={choisie}"), "la préférence dit son état");
  assert.ok(source.includes("aria-pressed={coche}"), "le cochage de la liste aussi");
  assert.ok(source.includes("aria-expanded={ouverte}"), "la carte repas dit si elle est dépliée");
  // Aucune bascule ne peut être muette : les TROIS contrôles à état du
  // parcours sont annotés, et ce sont les seuls. En ajouter un quatrième sans
  // `aria-*` fera diverger ce compte.
  assert.equal((source.match(/aria-pressed=/g) ?? []).length, 2, "deux bascules à deux états");
  assert.equal((source.match(/aria-expanded=/g) ?? []).length, 1, "un dépliant");
  // Et les groupes de choix exclusifs passent par des radios natifs, donc
  // n'ont besoin d'aucun ARIA : le navigateur s'en charge.
  assert.equal((source.match(/type="radio"/g) ?? []).length, 2, "durée et mode : radios natifs");
  // Focus visible partout.
  assert.equal(
    boutons.filter((b) => !b.includes("focus-visible:ring")).length,
    0,
    "chaque cible porte un anneau de focus",
  );
  // L'état ne tient jamais qu'à la couleur : il est écrit ou porte une icône.
  // ⚠️ MIS À JOUR PAR C1.1 : le statut est calculé en amont (« PRÊT »,
  // « À COMPOSER », « À RECOMPOSER ») puis ÉCRIT dans la carte. Ce qui compte
  // n'a pas bougé : il est lisible en niveaux de gris.
  assert.ok(source.includes('carte.aRecomposer ? "À RECOMPOSER" : carte.pret ? "PRÊT" : "À COMPOSER"'));
  assert.ok(source.includes("{statut}"), "et il est bien rendu");
  assert.ok(source.includes("Aliment préféré") || source.includes("sr-only"));
});

/* ══════════════════════════════════════════════════════════════════════════
   CONTRÔLES NÉGATIFS — ce qui doit rougir
   ══════════════════════════════════════════════════════════════════════════ */

await test("NC-02. agréger par NOM est impossible : la clé ne contient pas le nom", () => {
  assert.ok(!CODE_AGREGATION.includes("displayName}|"), "le nom n'entre pas dans la clé");
  const source = lire("../../lib/nutrition/liste-de-courses.ts");
  const corpsCle = source.slice(source.indexOf("export function cleDeLigne"), source.indexOf("/* ═", source.indexOf("export function cleDeLigne")));
  assert.ok(!corpsCle.includes("displayName") && !corpsCle.includes("name"), "cleDeLigne ignore le nom");
  // Preuve comportementale : même nom, identités différentes → deux lignes.
  assert.equal(
    agregerListeDeCourses([item({ identityId: "a", displayName: "X" }), item({ identityId: "b", displayName: "X" })]).length,
    2,
  );
});

await test("NC-04 / NC-05. ni somme d'options, ni portion préférée", () => {
  // Une occurrence propose 2 options ; la liste n'en retient que la validée.
  const compositions = new Map<string, CompositionConnue>([
    [
      "repas-pdj-lundi|2026-08-17",
      { items: [{ slotId: "slot-proteine", catalogFoodId: "food-poulet", productId: null, quantity: 120, unit: "g" }], consomme: false },
    ],
  ]);
  const repas = repasDeLaPeriode(SEMAINE, construirePeriode(LUNDI, 1)!, compositions);
  assert.equal(repas[0].occurrences[0].options.length, 2, "le snapshot propose bien deux options");
  assert.equal(repas[0].composition!.length, 1, "une seule est retenue — jamais les deux additionnées");

  // NC-05 — `preferred_quantity` n'existe nulle part dans les fichiers neufs
  // (déjà couvert par C1-12), et la quantité vient de `planned_meal_items`.
  assert.ok(CODE_READER.includes("quantity: quantite"));
  assert.ok(CODE_READER.includes("Number(brut.quantity)"));
});

await test("NC-07. une durée hors 1..7 ne produit aucune période", () => {
  assert.equal(construirePeriode(LUNDI, 8), null);
  assert.equal(construirePeriode(LUNDI, 0), null);
  // Et le sélecteur ne propose pas autre chose que les sept.
  assert.equal((CODE_PARCOURS.match(/DUREES_COURSES\.map/g) ?? []).length, 1);
  assert.ok(!CODE_PARCOURS.includes("[1, 2, 3"), "aucune liste de durées recopiée dans l'écran");
});

await test("NC-08. `nutrition_days.day` n'est jamais traité comme une date", () => {
  for (const [chemin, code] of CODE_NEUF) {
    assert.ok(!code.includes("week_start_date"), `${chemin} n'invente pas de date de semaine`);
    assert.ok(!/new Date\(\s*[a-zA-Z_.]*day/.test(code), `${chemin} ne fabrique pas de date depuis un jour`);
  }
  // Le croisement se fait dans ce sens : DATE → nom de jour, jamais l'inverse.
  const source = lire("../../lib/nutrition/repas-de-la-periode.ts");
  assert.ok(source.includes("week.days.find((d) => d.day === jour.jour)"));
  // Et l'arithmétique de dates ne passe que par les helpers existants.
  assert.ok(!CODE_PERIODE.includes("new Date("), "aucune convention de fuseau nouvelle");
  assert.ok(CODE_PERIODE.includes('from "@/lib/nutrition/historique"'));
});

await test("NC-09 / NC-10. le bouton reste sous Recettes, et partage son animation", () => {
  // Ces deux invariants sont ceux de C1-01 et C1-03 ; on les rejoue ici comme
  // contrôles négatifs pour qu'un déplacement ou une animation recopiée
  // rougisse sous un nom qui dit POURQUOI.
  const iRecettes = CODE_PAGE_NUTRITION.indexOf("<RecipesHighlightLink");
  const iCourses = CODE_PAGE_NUTRITION.indexOf("<ListeDeCoursesHighlightLink");
  assert.ok(iCourses > iRecettes && iRecettes !== -1, "NC-09 : l'ordre est celui demandé");
  assert.ok(CODE_BOUTON.includes("recettes-halo"), "NC-10 : l'animation est PARTAGÉE");
  assert.equal(
    (CSS.match(/@property --[a-z-]*halo[a-z-]*angle/g) ?? []).length,
    1,
    "NC-10 : une seule propriété d'angle — une copie en créerait une seconde",
  );
});

await test("NC-06. le verrou C0.1 remonte à l'écran, il n'est pas avalé", () => {
  assert.match(messageDeRefus(new Error("REPAS_DEJA_CONSOMME")), /déjà été enregistré comme consommé/);
  assert.match(messageDeRefus(new Error("IDENTITE_INVALIDE: x")), /n'appartient plus aux options/);
  assert.match(messageDeRefus(new Error("boom")), /Réessaie/);
  assert.ok(CODE_PARCOURS.includes('role="alert"'), "le refus est annoncé");
});

await test("C1-FUTUR. « Reprendre ma semaine passée » est DOCUMENTÉ, pas implémenté", () => {
  // ⚠️ CE TEST EXISTE POUR EMPÊCHER LE GLISSEMENT. Une extension « prévue dans
  // l'architecture » se met à exister par petits bouts si personne ne mesure
  // son absence. Tant qu'elle n'est pas arbitrée, elle ne doit pas commencer.
  for (const [chemin, code] of CODE_NEUF) {
    for (const amorce of [
      "reprendreSemaine",
      "semainePassee",
      "semainePrecedente",
      "periodePrecedente",
      "projeterSemaine",
      "REPRENDRE_MA_SEMAINE",
    ]) {
      assert.ok(!code.includes(amorce), `${chemin} ne commence pas à implémenter « ${amorce} »`);
    }
  }
  // Aucun écran supplémentaire : le parcours a toujours QUATRE étapes.
  // ⚠️ MIS À JOUR PAR C1.1 : le parcours compte désormais six étapes (le choix
  // de mode et les deux écrans du mode Rapide). Ce qui ne change pas — et qui
  // est le SEUL objet de ce test — c'est qu'aucune d'elles ne concerne la
  // semaine passée.
  assert.ok(
    CODE_PARCOURS.includes(
      'type Etape = "duree" | "mode" | "preferences" | "proposition" | "repas" | "liste";',
    ),
    "le type Etape est exhaustif, et ne porte aucune étape de semaine passée",
  );
  assert.ok(!/["']semaine-passee["']|["']semainePassee["']/.test(CODE_PARCOURS));
  // Le vocabulaire des modes ne porte que les deux modes réels.
  const CODE_MODES = sansProse(lire("../../lib/nutrition/mode-courses.ts"));
  assert.ok(CODE_MODES.includes('export type ModeCoursesChoisi = "rapide" | "personnalise";'));
  assert.equal((CODE_MODES.match(/cle: "/g) ?? []).length, 2, "deux modes, pas trois");

  // La documentation, elle, existe et porte les interdits ET la règle du
  // snapshot actuel : c'est ce que le lot C1 devait livrer.
  const doc = lire("../../docs/courses-reprendre-semaine-passee.md");
  assert.ok(doc.includes("NON IMPLÉMENTÉ"));
  for (const interdit of ["consumed_meals", "meal_entries", "preferred_quantity", "par nom"]) {
    assert.ok(doc.includes(interdit), `la doc nomme l'interdit « ${interdit} »`);
  }
  assert.ok(doc.includes("planned_meals") && doc.includes("planned_meal_items"), "la doc nomme la source");
  assert.ok(
    doc.includes("ne doit pas être réinjecté silencieusement"),
    "la doc porte la règle du snapshot actuel",
  );

  // Et le lecteur porte le même avertissement, là où on écrirait le code.
  const lecteur = lire("../../lib/supabase/repas-planifies.ts");
  assert.ok(lecteur.includes("REPRENDRE MA SEMAINE PASSÉE"));
  assert.ok(lecteur.includes("RIEN DE CE QUI SUIT N'EXISTE"));
});

await test("C1-SUP. les identités envoyées à la RPC sortent du seul snapshot", () => {
  const resolus = identitesDeChoix(SEMAINE.days[0].meals[0].choiceSlots, [
    { slotId: "slot-proteine", optionId: "opt-poulet", quantity: 120, unit: "g" },
    { slotId: "slot-feculent", optionId: "opt-riz", quantity: 80, unit: "g" },
  ]);
  assert.deepEqual(resolus, [
    { slotId: "slot-proteine", catalogFoodId: "food-poulet", productId: null, quantity: 120, unit: "g" },
    { slotId: "slot-feculent", catalogFoodId: "food-riz", productId: null, quantity: 80, unit: "g" },
  ]);
  // Une option HORS snapshot laisse les deux identités nulles : la RPC refuse,
  // plutôt que d'écrire une entrée fantôme.
  assert.deepEqual(
    identitesDeChoix(SEMAINE.days[0].meals[0].choiceSlots, [
      { slotId: "slot-proteine", optionId: "opt-inconnue", quantity: 10, unit: "g" },
    ]),
    [{ slotId: "slot-proteine", catalogFoodId: null, productId: null, quantity: 10, unit: "g" }],
  );
  // Un produit reste un produit.
  assert.deepEqual(
    identitesDeChoix(SEMAINE.days[0].meals[0].choiceSlots, [
      { slotId: "slot-proteine", optionId: "opt-poulet-marque", quantity: 90, unit: "g" },
    ]),
    [{ slotId: "slot-proteine", catalogFoodId: null, productId: "prod-poulet", quantity: 90, unit: "g" }],
  );
});
