/**
 * Harnais — COURSES C1 : LE PARCOURS ÉLÈVE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS NIVEAUX, ET CHACUN PROUVE CE QUE LES AUTRES NE PEUVENT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * 1. La LOGIQUE d'état du parcours est extraite dans des fonctions pures de
 *    `hooks/useCourses.ts` (`datesRecentes`, `habitudesDepuis`,
 *    `libelleFavori`) : elles sont appelées pour de vrai.
 * 2. Le RENDU passe par `renderToString` — le dépôt n'a ni jsdom ni moteur de
 *    layout, donc aucun effet ne s'exécute et aucun doigt ne tape. Prétendre
 *    « simuler un clic » ici serait mentir sur ce qui est mesuré.
 * 3. Le RESPONSIVE ne se prouve que dans un moteur de rendu : la mesure a été
 *    faite dans Chromium et les chiffres sont dans le livrable. Ce fichier
 *    garde les invariants dont cette mesure a montré qu'ils étaient la cause.
 *
 * Lancement : npm run test:courses-c1-ui
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { CoursesListe, afficherUnite } from "../../components/student/CoursesListe";
import { Pastille } from "../../components/student/CoursesParcours";
import {
  FENETRE_HABITUDES_JOURS,
  FENETRE_HABITUDES_LONGUE_JOURS,
  datesRecentes,
  habitudesDepuis,
  libelleFavori,
} from "../../hooks/useCourses";
import { modeRecommande } from "../../lib/courses/besoins";
import { PREFERENCES_VIDES, type PreferencesCourses } from "../../lib/courses/preferences";
import type { LigneCourses } from "../../lib/courses/agregation";
import { agregerConsommation } from "../../lib/nutrition/historique";
import type { ConsumedMeal, ConsumedEntry } from "../../lib/nutrition/consumed";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Commentaires de LIGNE d'abord — leçon `app/admin/**` d'A5.9. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const SOURCE_PARCOURS = lire("../../components/student/CoursesParcours.tsx");
const CODE_PARCOURS = sansProse(SOURCE_PARCOURS);
const SOURCE_HOOK = lire("../../hooks/useCourses.ts");
const CODE_HOOK = sansProse(SOURCE_HOOK);
const CODE_PAGE = sansProse(lire("../../app/(student)/courses/page.tsx"));
const CODE_LISTE = sansProse(lire("../../components/student/CoursesListe.tsx"));
const CODE_NUTRITION = sansProse(lire("../../app/(student)/nutrition/page.tsx"));

const texteRendu = (html: string) => html.replace(/<!-- -->/g, "");

/* ══════════════════════════════════════════════════════════════════════════
   C1-UI-01..03 — ÉTAPE 1, LA DURÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-UI-01. les sept durées sont proposées", () => {
  // ⚠️ UNE PAGE SANS PORTE D'ENTRÉE N'EST PAS INTÉGRÉE. `/courses` ne serait
  // atteignable qu'en tapant l'URL : l'écran Nutrition doit y conduire.
  assert.ok(CODE_NUTRITION.includes('href="/courses"'), "aucun lien vers les courses");
  assert.ok(CODE_NUTRITION.includes("Mes courses"));
  // Et l'anneau animé des recettes n'est pas dupliqué.
  assert.equal((CODE_NUTRITION.match(/recettes-halo/g) ?? []).length, 0);

  assert.ok(CODE_PARCOURS.includes("const DUREES = [1, 2, 3, 4, 5, 6, 7] as const"));
  assert.ok(CODE_PARCOURS.includes("Pour combien de jours fais-tu tes courses"));
  // Chaque durée est un bouton, pas une saisie libre : 0 et 8 sont
  // inatteignables depuis l'écran, en plus d'être refusés par le moteur.
  assert.ok(CODE_PARCOURS.includes("DUREES.map((n) => ("));
  assert.ok(!CODE_PARCOURS.includes('type="number"'), "pas de champ numérique libre");

  const html = renderToString(
    createElement(Pastille, { texte: "3", actif: true, onClick: () => {} }),
  );
  assert.ok(html.includes('aria-pressed="true"'), "l'état sélectionné est annoncé");
  assert.ok(html.includes("min-h-[44px]"), "cible tactile de 44 px");
});

await test("C1-UI-02. choisir 3 jours construit une période de 3 jours", () => {
  // L'état du parcours part à 3 jours et délègue la période au moteur.
  assert.ok(CODE_HOOK.includes("useState(3)"));
  assert.ok(CODE_HOOK.includes("construirePeriode(debut, nbJours)"));
  // ⚠️ AUCUNE ARITHMÉTIQUE DE DATE DANS L'ÉTAT DU PARCOURS : la période est
  // construite par `lib/courses/periode.ts`, testé à part.
  assert.ok(!CODE_HOOK.includes("setDate(d.getDate() + "), "aucun calcul de période local");
});

await test("C1-UI-03. la date de départ est modifiable", () => {
  assert.ok(CODE_PARCOURS.includes("Changer la date de départ"));
  assert.ok(CODE_PARCOURS.includes('type="date"'));
  assert.ok(CODE_PARCOURS.includes('aria-label="Date de départ"'));
  assert.ok(CODE_PARCOURS.includes("c.setDebut(e.target.value)"));
  // Par défaut, aujourd'hui — injecté, jamais lu depuis l'horloge au rendu.
  assert.ok(CODE_HOOK.includes("useState(aujourdHui)"));
  assert.ok(CODE_PAGE.includes("const aujourdHui = useMemo("));
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-UI-04..06 — ÉTAPES 2 ET 3
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-UI-04. les envies sont facultatives", () => {
  assert.ok(CODE_PARCOURS.includes("Qu&apos;aimerais-tu manger ces prochains jours"));
  assert.ok(SOURCE_PARCOURS.includes("Facultatif"));
  // « Peu importe » = ne rien cocher, et l'écran le DIT plutôt que d'ajouter un
  // bouton de plus à comprendre.
  assert.ok(SOURCE_PARCOURS.includes("peu importe"));
  // Rien n'oblige à remplir : aucune validation ne bloque la génération.
  assert.ok(!CODE_PARCOURS.includes("required"));
  assert.ok(CODE_PARCOURS.includes("disabled={chargement || c.periode === null}"));
  assert.equal(modeRecommande(PREFERENCES_VIDES), "plan_habitudes");
});

await test("C1-UI-05. plusieurs envies sont sélectionnables, dans plusieurs catégories", () => {
  // Le basculement est un TOGGLE : recliquer retire.
  assert.ok(CODE_HOOK.includes("présente"));
  assert.ok(CODE_HOOK.includes("actuelles.filter((v) => normaliserLibelle(v) !== normaliserLibelle(valeur))"));
  // Les neuf catégories sont rendues, chacune avec ses suggestions.
  assert.ok(CODE_PARCOURS.includes("CATEGORIES_ENVIES.map((cat) => ("));
  assert.ok(CODE_PARCOURS.includes("SUGGESTIONS[categorie].map((s) => ("));
  // Et un ajout libre par catégorie.
  assert.ok(CODE_PARCOURS.includes("Ajouter une envie"));
  assert.ok(CODE_HOOK.includes("export interface EtatCourses"));
  assert.ok(CODE_HOOK.includes("readonly ajouterEnvie:"));
});

await test("C1-UI-06. les exclusions temporaires n'écrivent aucun profil", () => {
  assert.ok(CODE_PARCOURS.includes("Je préfère éviter cette fois-ci"));
  assert.ok(SOURCE_PARCOURS.includes("Ton profil n&apos;est pas modifié"));

  // ⚠️ STRUCTUREL. Ni l'écran ni l'état ne nomment le profil, les allergies ou
  // une restriction durable — et n'ont aucun moyen d'écrire.
  for (const [nom, code] of [
    ["le parcours", CODE_PARCOURS],
    ["l'état", CODE_HOOK],
  ] as const) {
    for (const interdit of [
      "student_profiles",
      "allergie",
      "restriction",
      "createSupabaseBrowserClient",
      "rpc(",
      "insert",
      "update(",
      "delete(",
    ]) {
      assert.ok(!code.includes(interdit), `« ${interdit} » dans ${nom}`);
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-UI-07..09 — ÉTAPE 4, LE MODE
   ══════════════════════════════════════════════════════════════════════════ */

function avecEnvie(): PreferencesCourses {
  return { envies: { ...PREFERENCES_VIDES.envies, viandes: ["Poulet"] }, exclusions: [] };
}

await test("C1-UI-07. avec des envies, le mode recommandé est plan_envies", () => {
  assert.equal(modeRecommande(avecEnvie()), "plan_envies");
  assert.ok(CODE_HOOK.includes("modeChoisi ?? modeRecommande(preferences)"));
});

await test("C1-UI-08. sans envie, le mode recommandé est plan_habitudes", () => {
  assert.equal(modeRecommande(PREFERENCES_VIDES), "plan_habitudes");
  // Une exclusion seule n'est PAS une envie : elle ne bascule pas le mode.
  assert.equal(
    modeRecommande({ envies: PREFERENCES_VIDES.envies, exclusions: ["Poulet"] }),
    "plan_habitudes",
  );
});

await test("C1-UI-09. l'élève peut changer de mode manuellement", () => {
  assert.ok(CODE_PARCOURS.includes("Comment veux-tu construire tes courses"));
  assert.ok(CODE_PARCOURS.includes("onClick={() => c.setMode(m)}"));
  assert.ok(CODE_PARCOURS.includes("LIBELLES_MODES"));
  for (const libellé of ["Mon plan + mes envies", "Mon plan + mes habitudes", "Mon plan uniquement"]) {
    assert.ok(CODE_PARCOURS.includes(libellé), `mode « ${libellé} » absent`);
  }

  // ⚠️ UNE FOIS CHOISI, LE MODE TIENT. `modeChoisi` est un état distinct de la
  // recommandation : sans cette séparation, cocher une envie après avoir choisi
  // « mon plan uniquement » ramènerait l'écran à « mes envies » sous les doigts
  // de l'élève.
  assert.ok(CODE_HOOK.includes("readonly modeChoisi: ModeGeneration | null"));
  assert.ok(CODE_PARCOURS.includes("c.modeChoisi === null &&"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-UI-10..12 — GÉNÉRATION, AFFICHAGE, INNOCUITÉ
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-UI-10. la génération appelle le moteur existant, sans le dupliquer", () => {
  assert.ok(CODE_HOOK.includes("genererCourses({"));
  assert.ok(CODE_HOOK.includes('from "@/lib/courses/besoins"'));
  assert.equal((CODE_HOOK.match(/genererCourses\(/g) ?? []).length, 1, "un seul appel");
  // ⚠️ ET LE RÉSULTAT DU MOTEUR VA DIRECTEMENT DANS L'ÉTAT. Vérifier la seule
  // PRÉSENCE de `genererCourses(` ne suffit pas : un contrôle négatif l'a
  // montré, en glissant `(… as never) ?? genererCourses({…})` — l'appel restait
  // écrit, son résultat était jeté, et le test restait vert. Il n'y a donc rien
  // entre `setResultat(` et `genererCourses({`.
  assert.match(CODE_HOOK, /setResultat\(\s*genererCourses\(\{/);

  // ⚠️ AUCUNE RÈGLE DU MOTEUR N'EST RECOPIÉE EN REACT. Une sélection ou une
  // agrégation réécrite ici échapperait aux 35 tests du moteur.
  for (const [nom, code] of [
    ["l'état", CODE_HOOK],
    ["le parcours", CODE_PARCOURS],
  ] as const) {
    for (const interdit of ["solveRecipe", "recipesForSlot", "scorerRecette", "cleAgregation", "* 4", "* 9"]) {
      assert.ok(!code.includes(interdit), `« ${interdit} » recopié dans ${nom}`);
    }
  }
  // L'écran ne fait qu'appeler ce que l'état lui donne.
  assert.ok(CODE_PARCOURS.includes("onClick={c.generer}"));
  assert.ok(CODE_PARCOURS.includes("Générer mes courses"));
});

await test("C1-UI-11. la liste produite est visible", () => {
  const lignes: LigneCourses[] = [
    {
      identity: "recipe_ingredient:poulet",
      source: "recipe_ingredient",
      label: "Poulet",
      quantite: 600,
      unite: "g",
      categorie: "proteines",
      provenance: [],
    },
    {
      identity: "recipe_ingredient:wrap",
      source: "recipe_ingredient",
      label: "Wrap fin",
      quantite: 6,
      unite: "wrap",
      categorie: "feculents",
      provenance: [],
    },
  ];
  const html = texteRendu(
    renderToString(
      createElement(CoursesListe, {
        titre: "Courses · 3 jours",
        periode: "du 14 au 16 août",
        lignes,
        avertissements: [],
      }),
    ),
  );
  assert.ok(html.includes("Courses · 3 jours"));
  assert.ok(html.includes("du 14 au 16 août"));
  assert.ok(html.includes("Poulet") && html.includes("600"));
  assert.ok(html.includes("PROTÉINES") || html.includes("Protéines"));
  assert.ok(html.includes("Féculents"));
  // Les unités s'affichent telles qu'elles ont été décidées — pas de grammes
  // inventés pour les wraps.
  assert.ok(html.includes("6") && html.includes("wraps"));
  assert.equal(afficherUnite(6, "wrap"), "wraps");
  assert.equal(afficherUnite(1, "wrap"), "wrap");
  assert.equal(afficherUnite(2, "piece"), "pièces");
  assert.equal(afficherUnite(250, "ml"), "ml");

  // Ce que C1 n'affiche PAS — le §10 renvoie tout cela aux lots suivants.
  for (const interdit of ["prix", "€", "magasin", "budget", "placard", "PDF"]) {
    assert.ok(!CODE_LISTE.includes(interdit), `« ${interdit} » dans la liste`);
  }
});

await test("C1-UI-12. aucune écriture Supabase dans tout le parcours", () => {
  // La page CÂBLE des lecteurs existants ; elle n'ouvre aucun accès nouveau.
  assert.ok(CODE_PAGE.includes("useStudentNutritionPlanV2"));
  assert.ok(CODE_PAGE.includes("useRaccourcisAliments"));
  assert.ok(CODE_PAGE.includes("useConsumedMeals"));
  assert.ok(!CODE_PAGE.includes("createSupabaseBrowserClient"), "aucun client direct");
  assert.ok(!CODE_PAGE.includes("readConsumedMeals"), "aucun accès concurrent aux mêmes tables");

  // ⚠️ `useConsumedMeals` EXPOSE DES ÉCRITURES — la page ne lit que `.meals`.
  for (const interdit of [
    "ajouterCatalogue",
    "ajouterProduit",
    "ajouterManuel",
    "creerRepas",
    "supprimerRepas",
    "corrigerQuantité",
    "ouvrirPrescrit",
  ]) {
    assert.ok(!CODE_PAGE.includes(interdit), `« ${interdit} » appelé par la page`);
  }
  assert.ok(CODE_PAGE.includes("recents.meals"));
  assert.ok(CODE_PAGE.includes("longs.meals"));

  // Les deux fenêtres d'habitudes du §8, et la longue qui ne fait que compléter.
  assert.equal(FENETRE_HABITUDES_JOURS, 7);
  assert.equal(FENETRE_HABITUDES_LONGUE_JOURS, 28);
  assert.equal(datesRecentes("2026-08-14", 7).length, 7);
  assert.equal(datesRecentes("2026-08-14", 7)[6], "2026-08-14", "aujourd'hui est inclus");
  assert.equal(datesRecentes("2026-08-14", 7)[0], "2026-08-08");
  // Une fenêtre de 28 jours traverse le mois sans arithmétique maison.
  assert.equal(datesRecentes("2026-08-14", 28)[0], "2026-07-18");

  // Les habitudes passent par l'agrégateur d'A5.7, jamais par un comptage local.
  assert.ok(CODE_HOOK.includes("agregerConsommation"));
  const repas = (label: string): ConsumedMeal => ({
    id: `cm-${label}`,
    studentId: "st",
    consumedOn: "2026-08-14",
    kind: "student",
    prescribedMealId: null,
    slotKey: null,
    label: "R",
    position: 0,
    target: null,
    entries: [
      {
        id: `e-${label}`,
        consumedMealId: `cm-${label}`,
        sourceType: "catalog_food",
        foodId: `f-${label}`,
        productId: null,
        label,
        quantity: 100,
        unit: "g",
        proteinG: 1,
        carbG: 1,
        fatG: 1,
        note: "",
        createdAt: "2026-08-14T08:00:00.000Z",
      } satisfies ConsumedEntry,
    ],
  });
  const h = habitudesDepuis([repas("Poulet")], [repas("Saumon")]);
  assert.equal(h["poulet"], 1, "la fenêtre courte compte");
  assert.equal(h["saumon"], 1, "la longue complète");
  // ⚠️ ET NE L'ÉCRASE PAS : un aliment déjà vu sur 7 jours garde son compte.
  const h2 = habitudesDepuis([repas("Poulet"), repas("Poulet")], [repas("Poulet")]);
  assert.equal(h2["poulet"], 2, "la fenêtre longue n'écrase pas la courte");

  // ⚠️ CE QUE COMPTE UNE HABITUDE : DES REPAS, PAS DES LIGNES AGRÉGÉES.
  // `agregerConsommation` appelé une seule fois sur toute la fenêtre fond les
  // deux poulets ci-dessus en UNE ligne et rend 1 — la fréquence disparaît, et
  // `habitudes` ne peut plus valoir que 0 ou 1. C'est le défaut que cette
  // assertion a trouvé.
  assert.equal(agregerConsommation([repas("Poulet"), repas("Poulet")]).length, 1);
  assert.equal(habitudesDepuis([repas("P"), repas("P"), repas("P")])["p"], 3);
  // Deux entrées du même aliment DANS LE MÊME REPAS restent une consommation.
  const deuxFois = repas("Riz");
  const memeRepas: ConsumedMeal = {
    ...deuxFois,
    entries: [
      deuxFois.entries[0]!,
      { ...deuxFois.entries[0]!, id: "e-riz-2", unit: "piece" } satisfies ConsumedEntry,
    ],
  };
  assert.equal(agregerConsommation([memeRepas]).length, 2, "deux unités, deux lignes");
  assert.equal(habitudesDepuis([memeRepas])["riz"], 1, "un repas = une consommation");

  assert.equal(libelleFavori({ type: "aliment", aliment: { name: "Banane" } as never }), "Banane");
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-UI-13..15 — CAS VIDES ET RESPONSIVE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-UI-13. l'absence de plan est gérée proprement", () => {
  const html = renderToString(
    createElement(CoursesListe, {
      titre: "Courses · 3 jours",
      periode: "du 14 au 16 août",
      lignes: [],
      avertissements: [{ code: "aucun_plan" }],
    }),
  );
  assert.ok(html.includes("Aucun plan alimentaire"));
  assert.ok(html.includes("Aucun article à acheter"));
  // Le titre et la période restent affichés : l'écran ne se vide pas.
  assert.ok(html.includes("du 14 au 16 août"));
  // La page affiche aussi l'erreur de chargement du plan si elle survient.
  assert.ok(CODE_PAGE.includes("plan.error !== null"));

  // ⚠️ HORS LIGNE, PAS DE LISTE FABRIQUÉE. Sans réseau, le plan et l'historique
  // manquent : générer quand même donnerait une liste vide ou fausse, et
  // l'élève ferait ses courses avec. Même traitement qu'/nutrition.
  assert.ok(CODE_PAGE.includes("useEtatOfflineEleve"));
  assert.ok(CODE_PAGE.includes("SectionIndisponible"));
  assert.ok(CODE_PAGE.includes('local.etat === "mock"'), "le mode démonstration est distingué");
  // Et la coquille de /courses est mise en cache : sinon l'écran s'ouvrirait
  // sur « Pas de connexion » du navigateur (pwa-coquille C5 le garde aussi).
  assert.ok(sansProse(lire("../../public/sw.js")).includes("/^\\/courses$/"));
});

await test("C1-UI-14. l'absence de recette est gérée proprement", () => {
  const html = renderToString(
    createElement(CoursesListe, {
      titre: "Courses · 1 jour",
      periode: "le 14 août",
      lignes: [],
      avertissements: [
        { code: "aucune_recette", date: "2026-08-14", slot: "lunch" },
        { code: "aucune_recette", date: "2026-08-14", slot: "dinner" },
      ],
    }),
  );
  assert.ok(html.includes("Aucune recette disponible"));
  // ⚠️ UN MESSAGE PAR CODE, PAS UN PAR OCCURRENCE. Sept jours sans recette
  // produiraient sinon quatorze fois la même phrase.
  assert.equal((html.match(/Aucune recette disponible/g) ?? []).length, 1);
  assert.ok(CODE_LISTE.includes("new Set(avertissements.map((a) => a.code))"));
});

await test("C1-UI-15. le parcours ne peut pas déborder horizontalement", () => {
  // ⚠️ MESURÉ DANS CHROMIUM, pas déduit : 375 / 390 / 430 / 768 / 1280 / 1440,
  // écart 0 px — les chiffres sont dans `docs/courses-c1-ui-livrable.md`. Ce
  // test garde les invariants dont cette mesure a montré qu'ils tenaient.
  for (const [nom, code] of [
    ["le parcours", CODE_PARCOURS],
    ["la liste", CODE_LISTE],
    ["la page", CODE_PAGE],
  ] as const) {
    assert.ok(!code.includes("w-screen"), `« w-screen » dans ${nom}`);
    assert.ok(!code.includes("100vw"), `« 100vw » dans ${nom}`);
    assert.ok(!/\bw-\[\d+px\]/.test(code), `largeur en pixels dans ${nom}`);
    assert.ok(!code.includes("min-w-max"), `« min-w-max » dans ${nom}`);
    assert.ok(!code.includes("whitespace-nowrap"), `« whitespace-nowrap » dans ${nom}`);
  }

  // Les sept durées et les pastilles d'envies passent à la ligne — une grille à
  // colonnes fixes couperait « Beurre de cacahuète » sur 375 px.
  assert.ok(CODE_PARCOURS.includes('<div className="flex flex-wrap gap-2">'));
  assert.ok(!/grid-cols-\d/.test(CODE_PARCOURS), "aucune grille à colonnes fixes");

  // Les champs de saisie peuvent RÉTRÉCIR : `min-w-0` sur un enfant flex, sans
  // quoi un `<input>` impose sa largeur par défaut et pousse la ligne.
  assert.ok(CODE_PARCOURS.includes("min-h-[44px] min-w-0 flex-1"));
  // Et les conteneurs racines aussi.
  assert.ok(CODE_PARCOURS.includes('className="flex min-w-0 flex-col gap-6"'));
  assert.ok(CODE_PAGE.includes('className="flex min-w-0 flex-col"'));
  // Les libellés longs se tronquent au lieu de pousser.
  assert.ok(CODE_LISTE.includes("min-w-0 flex-1 truncate"));
});

/* ── Cohérence ────────────────────────────────────────────────────────── */

await test("C1-UI-SUP. le dépouillement n'a rien vidé", () => {
  assert.ok(CODE_PARCOURS.includes("export function CoursesParcours"));
  assert.ok(CODE_PARCOURS.length > 3000, `dépouillement suspect : ${CODE_PARCOURS.length}`);
  assert.ok(CODE_HOOK.includes("export function useCourses"));
  assert.ok(CODE_HOOK.length > 2000);

  // La prose nomme bien les mots interdits ailleurs, et le dépouillement les a
  // retirés — sans quoi les interdictions ci-dessus seraient vertes sur du vide.
  assert.ok(SOURCE_PARCOURS.includes("client Supabase"));
  assert.ok(!CODE_PARCOURS.includes("client Supabase"));
  assert.ok(SOURCE_HOOK.includes("agregation"));
});
