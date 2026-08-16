/**
 * Harnais — ALIMENTS A5.7 : HISTORIQUE ALIMENTAIRE HEBDOMADAIRE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET CE QUI NE PEUT PAS L'ÊTRE ICI
 * ────────────────────────────────────────────────────────────────────────────
 * L'historique est DÉRIVÉ : il n'a ni table, ni cache, ni agrégat persisté.
 * Toute sa logique vit donc dans un module feuille — `lib/nutrition/
 * historique.ts` — qui est appelé POUR DE VRAI dans ce fichier, sur les cas qui
 * cassent : une semaine à cheval sur deux mois, un jour sans saisie, un thé
 * sans sucre, deux GTIN voisins, 200 g et 200 ml du même produit.
 *
 * Le RENDU est vérifié par `renderToString` — le dépôt n'a ni jsdom ni
 * bibliothèque DOM, donc aucun effet ne s'exécute et aucun doigt ne glisse.
 * Prétendre « simuler un changement de semaine » ici serait mentir sur ce qui
 * est mesuré : ce qui est vérifié, c'est que les deux boutons appellent bien
 * les rappels reçus, et que ces rappels ne peuvent RIEN écrire.
 *
 * ⚠️ TROIS CONTRÔLES NE SE PROUVENT PAS EN JAVASCRIPT — HIST17, HIST18, HIST19
 * portent sur la RLS. Ils sont ici sous leur forme lisible sur les migrations,
 * et EXÉCUTÉS pour de vrai dans
 * `supabase/tests/aliments_a5_7_historique_checklist.sql`, sur une base
 * PostgreSQL reconstruite. Un test qui lirait une policy en se déclarant
 * satisfait ne prouverait rien : c'est la base qui tranche.
 *
 * Lancement : npm run test:aliments-a5-history
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { NutritionWeekNav } from "../../components/student/NutritionWeekNav";
import { StudentPrescribedWeek } from "../../components/student/StudentPrescribedWeek";
import type { SuiviConsommation } from "../../components/student/StudentPrescribedWeek";
import { formatIntegerFr } from "../../lib/nutrition/basis-points";
import type { ConsumedEntry, ConsumedMeal } from "../../lib/nutrition/consumed";
import { totalsForDay } from "../../lib/nutrition/consumed";
import {
  type Semaine,
  agregerConsommation,
  decalerSemaine,
  identiteDeLEntree,
  libelleSemaine,
  resumeDuJour,
  resumeSemaine,
  semaineContenant,
} from "../../lib/nutrition/historique";
import type { PlanV2Week } from "../../lib/nutrition/plan-v2-week";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire la PROSE d'un source JS/TS. Voir le contrôle de cohérence final. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
/** Retire les commentaires `--` d'un source SQL. Même raison. */
function sansCommentairesSql(source: string): string {
  return source.replace(/^\s*--.*$/gm, " ");
}

const SOURCE_HISTORIQUE = lire("../../lib/nutrition/historique.ts");
const CODE_HISTORIQUE = sansProse(SOURCE_HISTORIQUE);
const SOURCE_NAV = lire("../../components/student/NutritionWeekNav.tsx");
const CODE_NAV = sansProse(SOURCE_NAV);
const SOURCE_PAGE = lire("../../app/(student)/nutrition/[planId]/page.tsx");
const CODE_PAGE = sansProse(SOURCE_PAGE);
const CODE_SEMAINE = sansProse(lire("../../components/student/StudentPrescribedWeek.tsx"));
const CODE_LECTURE = sansProse(lire("../../lib/supabase/consumed-meals.ts"));

/** `formatIntegerFr(1420)` sépare avec une ESPACE INSÉCABLE. Voir A5-DAY. */
const nombre = (n: number) => formatIntegerFr(n);

/**
 * ⚠️ REACT DÉCOUPE SES TEXTES ADJACENTS AVEC `<!-- -->`.
 *
 * `{a}/{b}` ne rend PAS « 5/7 » mais « 5<!-- -->/<!-- -->7 » : les marqueurs
 * servent à l'hydratation. Une assertion écrite sur ce que l'utilisateur LIT
 * échouerait donc sur un affichage parfaitement correct. On les retire — et
 * seulement eux, pour ne rien masquer d'autre.
 */
const texteRendu = (html: string) => html.replace(/<!-- -->/g, "");

/* ══════════════════════════════════════════════════════════════════════════
   LE BANC — UNE SEMAINE RÉELLE, DU LUNDI 10 AU DIMANCHE 16 AOÛT 2026
   ══════════════════════════════════════════════════════════════════════════ */

const LUNDI = "2026-08-10";
const AUJOURDHUI = "2026-08-13"; // un jeudi
const SEMAINE_AOUT = semaineContenant(AUJOURDHUI) as Semaine;

let compteur = 0;
function entrée(partiel: Partial<ConsumedEntry> = {}): ConsumedEntry {
  compteur += 1;
  return {
    id: `e${compteur}`,
    consumedMealId: "cm-1",
    sourceType: "catalog_food",
    foodId: "food-banane",
    productId: null,
    label: "Banane",
    quantity: 120,
    unit: "g",
    proteinG: 1.32,
    carbG: 27.36,
    fatG: 0.36,
    note: "",
    createdAt: "2026-08-13T08:00:00.000Z",
    ...partiel,
  };
}

function repas(
  date: string,
  entrées: readonly ConsumedEntry[],
  partiel: Partial<ConsumedMeal> = {},
): ConsumedMeal {
  return {
    id: `cm-${date}-${partiel.label ?? "pdj"}`,
    studentId: "st-1",
    consumedOn: date,
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

/** Les noms des fichiers de migration, triés. */
function lireMigrations(): readonly string[] {
  return readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
/** L'horodatage qui préfixe un nom de migration. */
const horodatage = (fichier: string) => fichier.slice(0, 14);

const JOURS_SEMAINE = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** La prescription du banc : sept jours, deux profils — 2 000 le lundi, 2 600 les autres. */
const SEMAINE_PRESCRITE: PlanV2Week = {
  planId: "plan-1",
  profiles: [
    {
      profileKey: "repos",
      dailyCalories: 2000,
      proteinBp: 3000,
      carbBp: 4000,
      fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 10000, carbBp: 10000, fatBp: 10000, displayOrder: 0 },
      ],
    },
    {
      profileKey: "entrainement",
      dailyCalories: 2600,
      proteinBp: 3000,
      carbBp: 4000,
      fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 10000, carbBp: 10000, fatBp: 10000, displayOrder: 0 },
      ],
    },
  ],
  // ⚠️ SEPT JOURS, ET DEUX PROFILS. Une semaine tronquée ne prouverait rien :
  // « aujourd'hui est sélectionné » exige que le jeudi existe, et « chaque jour
  // garde SA cible » exige que deux jours n'aient pas la même.
  days: JOURS_SEMAINE.map((jour, index) => ({
    id: `day-${jour}`,
    day: jour,
    profileKey: index === 0 ? "repos" : "entrainement",
    status: "non-commence" as const,
    meals: [
      {
        id: `meal-pdj-${jour}`,
        slot: "breakfast" as const,
        name: "Petit-déjeuner",
        items: [{ name: "150 g fromage blanc", quantity: "" }],
        calories: 500,
        protein: 30,
        carbs: 50,
        fat: 15,
        coachNotes: "",
        choiceSlots: [],
      },
    ],
  })),
};

function rendreSemaine(
  meals: readonly ConsumedMeal[],
  aujourdHui: string = AUJOURDHUI,
  semaine: Semaine = SEMAINE_AOUT,
): string {
  const [lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche] = semaine.dates;
  const suivi: SuiviConsommation = {
    datesParJour: {
      monday: lundi,
      tuesday: mardi,
      wednesday: mercredi,
      thursday: jeudi,
      friday: vendredi,
      saturday: samedi,
      sunday: dimanche,
    },
    meals,
    chargement: false,
    enCours: false,
    erreur: null,
    onEffacerErreur: () => {},
    onOuvrirPrescrit: async () => "cm-1",
    onCreerRepas: async () => "cm-2",
    onRenommerRepas: async () => true,
    onSupprimerRepas: async () => true,
    onAjouterCatalogue: async () => true,
    onAjouterManuel: async () => true,
    onCorriger: async () => true,
    onSupprimerAliment: async () => true,
    aujourdHui,
    onSemainePrecedente: () => {},
    onSemaineSuivante: () => {},
  };
  return renderToString(
    createElement(StudentPrescribedWeek, { week: SEMAINE_PRESCRITE, suivi } as never),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   HIST1..HIST4 — LA SEMAINE AFFICHÉE, ET LA NAVIGATION
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST1. la semaine actuelle est affichée par défaut", () => {
  // Le lundi qui contient aujourd'hui, quel que soit le jour de la semaine.
  assert.equal(SEMAINE_AOUT.debut, LUNDI);
  assert.equal(SEMAINE_AOUT.fin, "2026-08-16");
  assert.equal(SEMAINE_AOUT.dates.length, 7);

  // ⚠️ UN DIMANCHE APPARTIENT À LA SEMAINE QUI COMMENCE LE LUNDI D'AVANT.
  // `getDay()` rend 0 le dimanche : un `1 - 0` naïf ferait avancer d'un jour au
  // lieu de reculer de six, et l'écran afficherait la semaine SUIVANTE le
  // dimanche soir — le jour où l'élève regarde son bilan.
  assert.equal(semaineContenant("2026-08-16")?.debut, LUNDI);
  assert.equal(semaineContenant("2026-08-10")?.debut, LUNDI);
  assert.equal(semaineContenant("2026-08-17")?.debut, "2026-08-17");

  // Une date illisible ne fabrique pas une semaine imaginaire.
  assert.equal(semaineContenant(""), null);
  assert.equal(semaineContenant("13/08/2026"), null);

  // Et c'est bien ce qui pilote l'état de la page : la semaine par défaut est
  // celle qui contient la date du jour, pas un littéral.
  assert.ok(CODE_PAGE.includes("semaineContenant(datesAujourdHui)"));
  assert.ok(CODE_PAGE.includes("const datesSemaine = semaine.dates"));

  const html = renderToString(
    createElement(NutritionWeekNav, {
      libellé: libelleSemaine(SEMAINE_AOUT),
      resume: resumeSemaine([], SEMAINE_AOUT),
      estSemaineCourante: true,
      onPrecedente: () => {},
      onSuivante: () => {},
    }),
  );
  assert.ok(html.includes("du 10 au 16 août"), "le titre nomme la semaine affichée");
  assert.ok(html.includes("Semaine en cours"), "et dit que c'est celle d'aujourd'hui");
});

await test("HIST2. le jour actuel est sélectionné dans la semaine affichée", () => {
  const html = rendreSemaine([], AUJOURDHUI);
  assert.ok(html.includes("Aujourd"), "le jour courant est marqué");
  assert.ok(html.includes("Jeudi"), "et c'est bien le bon");

  // Sur une semaine PASSÉE, aucun jour n'est « aujourd'hui » — et l'écran ne
  // marque donc rien à tort, au lieu de désigner le lundi par défaut.
  const passée = rendreSemaine([], AUJOURDHUI, decalerSemaine(SEMAINE_AOUT, -3));
  assert.ok(!passée.includes("Aujourd"));
  assert.ok(passée.includes("du 20 au 26 juillet"), "et le titre suit la semaine visitée");
  assert.ok(!passée.includes("Semaine en cours"), "aucun badge trompeur");
});

await test("HIST3. la semaine précédente charge les bonnes dates", () => {
  const avant = decalerSemaine(SEMAINE_AOUT, -1);
  assert.deepEqual(
    [...avant.dates],
    [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ],
  );
  assert.equal(libelleSemaine(avant), "du 3 au 9 août");

  // ⚠️ LE CAS QUI CASSE LES ARITHMÉTIQUES NAÏVES : reculer d'une semaine à
  // travers un changement de mois, puis d'année. Un `-7` posé sur le seul
  // numéro de jour donnerait « 2026-08-(-4) ».
  assert.equal(decalerSemaine(semaineContenant("2026-09-02") as Semaine, -1).debut, "2026-08-24");
  const nouvelAn = decalerSemaine(semaineContenant("2027-01-06") as Semaine, -1);
  assert.equal(nouvelAn.debut, "2026-12-28");
  assert.equal(libelleSemaine(nouvelAn), "du 28 décembre 2026 au 3 janvier 2027");

  // Reculer de 52 semaines reste un lundi : aucune dérive accumulée.
  const unAn = decalerSemaine(SEMAINE_AOUT, -52);
  assert.equal(unAn.debut, "2025-08-11");
  assert.equal(unAn.dates.length, 7);
});

await test("HIST4. la semaine suivante charge les bonnes dates", () => {
  const après = decalerSemaine(SEMAINE_AOUT, 1);
  assert.equal(après.debut, "2026-08-17");
  assert.equal(après.fin, "2026-08-23");
  assert.equal(libelleSemaine(après), "du 17 au 23 août");

  // Aller puis revenir redonne EXACTEMENT la semaine de départ : sinon la
  // navigation dériverait d'un jour à chaque aller-retour.
  assert.deepEqual(decalerSemaine(après, -1), SEMAINE_AOUT);
  assert.deepEqual(decalerSemaine(decalerSemaine(SEMAINE_AOUT, 5), -5), SEMAINE_AOUT);
  assert.deepEqual(decalerSemaine(SEMAINE_AOUT, 0), SEMAINE_AOUT);

  // Un changement de mois vers l'avant, et le libellé qui nomme alors DEUX mois.
  const àCheval = decalerSemaine(semaineContenant("2026-08-24") as Semaine, 1);
  assert.equal(àCheval.debut, "2026-08-31");
  assert.equal(libelleSemaine(àCheval), "du 31 août au 6 septembre");

  // Et les deux rappels sont bien câblés sur ces deux fonctions, dans la page.
  assert.ok(CODE_PAGE.includes("onSemainePrecedente: () => setSemaine((s) => decalerSemaine(s, -1))"));
  assert.ok(CODE_PAGE.includes("onSemaineSuivante: () => setSemaine((s) => decalerSemaine(s, 1))"));
  // La lecture SUIT la semaine : c'est `datesSemaine` — sept dates — qui est
  // passé au hook, jamais une plage ouverte.
  assert.ok(CODE_PAGE.includes("useConsumedMeals(datesSemaine"));
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST5..HIST7 — CE QUE L'HISTORIQUE CONTIENT, ET CE QU'IL NE CONTIENT PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST5. un jour ne voit que SES consumed_meals", () => {
  const semaine = [
    repas("2026-08-10", [entrée({ label: "Lundi banane" })]),
    repas("2026-08-11", [entrée({ label: "Mardi flocons", proteinG: 6, carbG: 30, fatG: 3.5 })]),
    repas("2026-08-12", [entrée({ label: "Mercredi riz", proteinG: 3, carbG: 28, fatG: 0.3 })]),
  ];

  const lundi = resumeDuJour(semaine, "2026-08-10");
  assert.equal(lundi.nbAliments, 1);
  assert.equal(Math.round(lundi.totaux.kcal), 118);

  const mardi = resumeDuJour(semaine, "2026-08-11");
  assert.equal(mardi.nbAliments, 1);
  assert.equal(Math.round(mardi.totaux.kcal), 176);

  // Un jour de la semaine sans aucun repas reste à zéro aliment.
  assert.equal(resumeDuJour(semaine, "2026-08-14").nbAliments, 0);

  // La sélection se fait sur `consumedOn`, jamais sur un index de carrousel :
  // c'est ce qui garantit qu'un glissement ne déplace pas une consommation.
  assert.ok(CODE_HISTORIQUE.includes("repas.filter((r) => r.consumedOn === date)"));
  assert.ok(CODE_SEMAINE.includes("suivi.meals.filter((r) => r.consumedOn === date)"));
});

await test("HIST6. aucune prescription non consommée n'entre dans l'historique", () => {
  // Un repas PRESCRIT ouvert mais VIDE : le conteneur existe, la cible du coach
  // est là — 500 kcal —, et pourtant l'historique ne compte rien.
  const ouvertMaisVide = repas("2026-08-10", [], {
    target: { kcal: 500, proteinG: 30, carbG: 50, fatG: 15 },
  });
  const jour = resumeDuJour([ouvertMaisVide], "2026-08-10");
  assert.equal(jour.totaux.kcal, 0, "la cible du coach n'est PAS une consommation");
  assert.equal(jour.nbAliments, 0);
  assert.equal(jour.aSaisie, false, "ouvrir un repas ne rend pas un jour « suivi »");

  const semaine = resumeSemaine([ouvertMaisVide], SEMAINE_AOUT);
  assert.equal(semaine.joursSuivis, 0);
  assert.equal(semaine.moyennes, null);
  assert.equal(agregerConsommation([ouvertMaisVide]).length, 0, "rien à mettre sur une liste");

  // ⚠️ STRUCTUREL : le module ne connaît même pas le vocabulaire de la
  // prescription. Il ne peut donc pas l'afficher par accident.
  for (const interdit of [
    "target",
    "prescribed",
    "nutrition_days",
    "plan-v2-week",
    "PlanV2",
    "dailyTargets",
  ]) {
    assert.ok(!CODE_HISTORIQUE.includes(interdit), `« ${interdit} » dans l'historique`);
  }
});

await test("HIST7. un repas personnel apparaît dans l'historique", () => {
  // Un repas créé par l'élève (`kind: "student"`), sans prescription ni cible.
  const collation = repas("2026-08-12", [entrée({ foodId: "f-amandes", label: "Amandes", proteinG: 21, carbG: 22, fatG: 53 })], {
    kind: "student",
    prescribedMealId: null,
    slotKey: null,
    label: "Collation du soir",
    target: null,
  });
  const prescrit = repas("2026-08-12", [entrée({ foodId: "f-banane", label: "Banane" })]);

  const jour = resumeDuJour([prescrit, collation], "2026-08-12");
  assert.equal(jour.nbAliments, 2, "les deux comptent, à égalité");
  assert.equal(Math.round(jour.totaux.kcal), 118 + Math.round(21 * 4 + 22 * 4 + 53 * 9));
  assert.equal(jour.aSaisie, true);

  // Et il entre dans l'agrégat Courses comme n'importe quel autre.
  const lignes = agregerConsommation([prescrit, collation]);
  assert.equal(lignes.length, 2, "deux aliments distincts, deux lignes");
  assert.ok(lignes.some((l) => l.nameSnapshot === "Amandes"));

  // Le module ne filtre JAMAIS sur `kind` : rien à oublier de rebrancher.
  assert.ok(!CODE_HISTORIQUE.includes('kind'), "aucune distinction prescrit / libre");
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST8..HIST10 — LES INSTANTANÉS, QUI NE SUIVENT PAS LEUR SOURCE
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST8. l'instantané d'un aliment du catalogue est conservé", () => {
  const e = entrée({
    sourceType: "catalog_food",
    foodId: "food-riz",
    label: "Riz blanc cuit — recette de 2026",
    quantity: 180,
    proteinG: 4.3,
    carbG: 49.5,
    fatG: 0.5,
  });
  const lignes = agregerConsommation([repas("2026-08-11", [e])]);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].nameSnapshot, "Riz blanc cuit — recette de 2026", "le libellé FIGÉ");
  assert.equal(lignes[0].catalogFoodId, "food-riz");
  assert.equal(lignes[0].quantityTotal, 180);
  assert.equal(lignes[0].unit, "g");

  // Les macros restent celles de l'entrée, pas celles d'un catalogue relu.
  assert.equal(Math.round(resumeDuJour([repas("2026-08-11", [e])], "2026-08-11").totaux.kcal), 220);
  assert.equal(identiteDeLEntree(e).identity, "catalog_food:food-riz");
});

await test("HIST9. l'instantané d'un produit est conservé", () => {
  const e = entrée({
    sourceType: "product",
    foodId: null,
    productId: "prod-nutella",
    label: "Nutella — Ferrero",
    quantity: 30,
    proteinG: 1.9,
    carbG: 17.3,
    fatG: 9.3,
  });
  const lignes = agregerConsommation([repas("2026-08-11", [e])]);
  assert.equal(lignes[0].nameSnapshot, "Nutella — Ferrero");
  assert.equal(lignes[0].productId, "prod-nutella");
  assert.equal(lignes[0].catalogFoodId, undefined, "un produit n'a pas d'aliment de catalogue");
  assert.equal(identiteDeLEntree(e).identity, "product:prod-nutella");

  // ⚠️ SANS `product_id` REMONTÉ, TOUT CECI RETOMBERAIT SUR LE LIBELLÉ — c'est
  // le seul manque trouvé à l'audit, et il était dans la LECTURE, pas en base :
  // la colonne existe depuis A3.
  assert.ok(CODE_LECTURE.includes("product_id"), "la requête la demande");
  assert.ok(CODE_LECTURE.includes("productId: row.product_id ?? null"), "et la couche la remonte");
});

await test("HIST10. une modification ultérieure du catalogue ne change pas l'historique", () => {
  const journal = [repas("2026-08-11", [entrée({ label: "Banane", proteinG: 1.32, carbG: 27.36, fatG: 0.36 })])];
  const avant = resumeDuJour(journal, "2026-08-11");

  // On simule la correction de la fiche : rien à recalculer, rien à invalider,
  // parce que l'historique ne consulte JAMAIS le catalogue courant.
  const après = resumeDuJour(journal, "2026-08-11");
  assert.deepEqual(après, avant);
  assert.equal(Math.round(avant.totaux.kcal), 118);

  // ⚠️ STRUCTUREL, ET C'EST LE CŒUR DU CONTRAT : le module ne connaît aucune
  // source vivante. Aucune requête ne peut donc être ajoutée par inadvertance.
  for (const interdit of [
    "food_catalog",
    "food_products",
    "open_food_facts",
    "ciqual",
    "supabase",
    "fetch(",
    "protein_per_100",
    "per100",
  ]) {
    assert.ok(!CODE_HISTORIQUE.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} »`);
  }
  // Il n'importe que les types et la somme déjà existante — aucune 4/4/9 réécrite.
  assert.ok(CODE_HISTORIQUE.includes('from "@/lib/nutrition/consumed"'));
  assert.ok(!CODE_HISTORIQUE.includes("* 9"), "le 4/4/9 n'est pas réécrit ici");
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST11..HIST13 — LE RÉSUMÉ DE LA SEMAINE
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST11. un jour SANS SAISIE est distinct d'un jour à 0 kcal", () => {
  // ⚠️ LA RÈGLE LA PLUS IMPORTANTE DU LOT. Un thé sans sucre, c'est une saisie
  // qui vaut zéro. Un jour oublié, c'est l'absence de saisie. Les deux ont le
  // même total, et ne veulent absolument pas dire la même chose.
  const thé = entrée({ label: "Thé vert", quantity: 250, unit: "ml", proteinG: 0, carbG: 0, fatG: 0 });
  const journal = [repas("2026-08-10", [thé])];

  const avecThé = resumeDuJour(journal, "2026-08-10");
  const oublié = resumeDuJour(journal, "2026-08-11");
  assert.equal(avecThé.totaux.kcal, 0);
  assert.equal(oublié.totaux.kcal, 0, "les deux totaux sont identiques…");
  assert.equal(avecThé.aSaisie, true, "…et pourtant les deux jours diffèrent");
  assert.equal(oublié.aSaisie, false);
  assert.equal(avecThé.nbAliments, 1);
  assert.equal(oublié.nbAliments, 0);

  // `aSaisie` est POSÉ, jamais déduit d'un total : c'est ce qui rend la
  // distinction impossible à perdre lors d'un remaniement.
  assert.ok(CODE_HISTORIQUE.includes("aSaisie: entrées.length > 0"));
  assert.ok(!CODE_HISTORIQUE.includes("aSaisie: totaux.kcal"));

  // Et l'écran le dit avec des mots, sans afficher de zéros accusateurs.
  const vide = renderToString(
    createElement(NutritionWeekNav, {
      libellé: libelleSemaine(SEMAINE_AOUT),
      resume: resumeSemaine([], SEMAINE_AOUT),
      estSemaineCourante: false,
      onPrecedente: () => {},
      onSuivante: () => {},
    }),
  );
  assert.ok(vide.includes("Aucune consommation enregistrée cette semaine."));
  assert.ok(!vide.includes("0 kcal"), "aucun « 0 kcal » sur une semaine sans saisie");
  assert.ok(!vide.includes("Moyenne"), "et aucune moyenne inventée");
});

await test("HIST12. la moyenne hebdomadaire ignore les jours non suivis", () => {
  // Cinq jours notés à 2 000 kcal. La moyenne est 2 000, pas 1 428.
  const deuxMille = () =>
    entrée({ label: "Journée type", proteinG: 150, carbG: 200, fatG: 66.67 });
  const journal = SEMAINE_AOUT.dates.slice(0, 5).map((d) => repas(d, [deuxMille()]));

  const r = resumeSemaine(journal, SEMAINE_AOUT);
  assert.equal(r.joursSuivis, 5);
  assert.equal(r.joursTotal, 7);
  assert.equal(Math.round(r.moyennes?.kcal ?? 0), 2000, "divisé par 5, pas par 7");
  assert.equal(Math.round((r.totaux.kcal / 7) * 1) !== 2000, true, "la division par 7 donnerait autre chose");
  assert.equal(Math.round(r.moyennes?.proteinG ?? 0), 150);

  // Aucun jour suivi : `null`, et surtout pas zéro — « aucune donnée » n'est
  // pas « une moyenne de zéro ».
  assert.equal(resumeSemaine([], SEMAINE_AOUT).moyennes, null);
  // Aucune division par sept nulle part.
  assert.ok(!CODE_HISTORIQUE.includes("/ 7"));
  assert.ok(CODE_HISTORIQUE.includes("totaux.kcal / suivis.length"));

  const html = renderToString(
    createElement(NutritionWeekNav, {
      libellé: libelleSemaine(SEMAINE_AOUT),
      resume: r,
      estSemaineCourante: true,
      onPrecedente: () => {},
      onSuivante: () => {},
    }),
  );
  assert.ok(texteRendu(html).includes("5/7"), "l'écran dit sur combien de jours il compte");
  assert.ok(html.includes(nombre(2000)));
  assert.ok(html.includes("jour suivi"), "et le formule sans ambiguïté");
});

await test("HIST13. les totaux de la semaine sont exacts, et bornés à la semaine", () => {
  const dedans = [
    repas("2026-08-10", [entrée({ proteinG: 10, carbG: 20, fatG: 5 })]),
    repas("2026-08-13", [entrée({ proteinG: 30, carbG: 40, fatG: 10 })]),
    repas("2026-08-16", [entrée({ proteinG: 5, carbG: 5, fatG: 1 })]),
  ];
  // ⚠️ UNE DATE EXTÉRIEURE, glissée exprès : le dimanche PRÉCÉDENT et le lundi
  // SUIVANT sont les deux voisins qu'une borne mal fermée laisse entrer.
  const dehors = [
    repas("2026-08-09", [entrée({ proteinG: 999, carbG: 999, fatG: 999 })]),
    repas("2026-08-17", [entrée({ proteinG: 888, carbG: 888, fatG: 888 })]),
  ];

  const r = resumeSemaine([...dedans, ...dehors], SEMAINE_AOUT);
  assert.equal(r.totaux.proteinG, 45);
  assert.equal(r.totaux.carbG, 65);
  assert.equal(r.totaux.fatG, 16);
  assert.equal(Math.round(r.totaux.kcal), Math.round(45 * 4 + 65 * 4 + 16 * 9));
  assert.equal(r.joursSuivis, 3, "les voisins ne rendent pas un jour « suivi »");
  assert.equal(r.jours.length, 7);

  // Le total de la semaine est EXACTEMENT la somme de ses jours : deux chemins
  // de calcul qui divergeraient afficheraient deux vérités sur le même écran.
  const sommeDesJours = r.jours.reduce((n, j) => n + j.totaux.proteinG, 0);
  assert.equal(sommeDesJours, r.totaux.proteinG);
  // Et il coïncide avec le total « jour » d'A5.6, qui vient d'un autre appel.
  assert.equal(totalsForDay(dedans.filter((m) => m.consumedOn === "2026-08-13")).proteinG, 30);
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST14..HIST16 — LES UNITÉS, QUI NE SE CONVERTISSENT PAS
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST14. g reste g", () => {
  const lignes = agregerConsommation([
    repas("2026-08-10", [entrée({ foodId: "f-riz", label: "Riz", quantity: 150, unit: "g" })]),
    repas("2026-08-12", [entrée({ foodId: "f-riz", label: "Riz", quantity: 80, unit: "g" })]),
  ]);
  assert.equal(lignes.length, 1, "même aliment, même unité → une ligne");
  assert.equal(lignes[0].quantityTotal, 230);
  assert.equal(lignes[0].unit, "g");
});

await test("HIST15. ml reste ml", () => {
  const lignes = agregerConsommation([
    repas("2026-08-10", [entrée({ foodId: "f-lait", label: "Lait", quantity: 200, unit: "ml" })]),
    repas("2026-08-12", [entrée({ foodId: "f-lait", label: "Lait", quantity: 250, unit: "ml" })]),
  ]);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].quantityTotal, 450);
  assert.equal(lignes[0].unit, "ml");

  // `piece` aussi survit tel quel : trois unités, trois lignes, aucune fusion.
  const trois = agregerConsommation([
    repas("2026-08-10", [
      entrée({ foodId: "f-oeuf", label: "Œuf", quantity: 2, unit: "piece" }),
      entrée({ foodId: "f-oeuf", label: "Œuf", quantity: 120, unit: "g" }),
      entrée({ foodId: "f-oeuf", label: "Œuf", quantity: 1, unit: "portion" }),
    ]),
  ]);
  assert.equal(trois.length, 3);
  assert.deepEqual(
    trois.map((l) => l.unit).sort(),
    ["g", "piece", "portion"],
  );
});

await test("HIST16. aucune conversion implicite — 200 g et 200 ml font DEUX lignes", () => {
  const lignes = agregerConsommation([
    repas("2026-08-10", [
      entrée({ productId: "p-yaourt", sourceType: "product", foodId: null, label: "Yaourt", quantity: 200, unit: "g" }),
      entrée({ productId: "p-yaourt", sourceType: "product", foodId: null, label: "Yaourt", quantity: 200, unit: "ml" }),
    ]),
  ]);
  assert.equal(lignes.length, 2, "le MÊME produit, deux unités : deux lignes");
  assert.equal(lignes[0].quantityTotal, 200);
  assert.equal(lignes[1].quantityTotal, 200);
  assert.notEqual(lignes[0].unit, lignes[1].unit);
  assert.equal(lignes[0].identity, lignes[1].identity, "même identité, unités différentes");

  // L'unité fait partie de la CLÉ. Ce n'est pas une promesse : c'est la clé.
  assert.ok(CODE_HISTORIQUE.includes("`${identity}|${e.unit}`"));
  // Et aucune densité, aucun facteur, aucune table de conversion.
  for (const interdit of ["densite", "density", "* 1.03", "mlVersG", "convert", "1 ml"]) {
    assert.ok(!CODE_HISTORIQUE.includes(interdit), `« ${interdit} » dans l'historique`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST17..HIST19 — L'ISOLATION, QUI SE PROUVE EN BASE
   ══════════════════════════════════════════════════════════════════════════ */

const MIGRATION_A1 = lire("../../supabase/migrations/20260831090000_food_catalog_and_meal_entries.sql");
const MIGRATION_A2 = lire("../../supabase/migrations/20260901090000_consumed_meals.sql");
const SQL_A1 = sansCommentairesSql(MIGRATION_A1);
const SQL_A2 = sansCommentairesSql(MIGRATION_A2);
const CHECKLIST = lire("../../supabase/tests/aliments_a5_7_historique_checklist.sql");

await test("HIST17. l'élève A ne voit jamais l'élève B", () => {
  // La policy élève compare à `current_student_id()` — l'identité de l'ÉLÈVE —
  // et non au rattachement au coach : deux élèves d'un même coach doivent être
  // isolés l'un de l'autre, et c'est le cas le plus exigeant.
  assert.ok(SQL_A2.includes('create policy "consumed_meals_read_own_student"'));
  assert.ok(SQL_A2.includes("using (student_id = public.current_student_id())"));
  assert.ok(SQL_A1.includes('create policy "meal_entries_crud_own_student"'));

  // ⚠️ A5.7 N'A RIEN ÉLARGI. Aucune migration n'a été ajoutée pour l'historique,
  // donc aucune policy n'a pu l'être : la liste des migrations d'A5 s'arrête
  // aux deux fichiers d'A5.0.
  // ⚠️ SIXIÈME OCCURRENCE DU MÊME MOTIF DANS CE PROJET, et la leçon est la
  // même qu'en A5 : « aucune migration postérieure » n'est vrai que tant
  // qu'aucun chantier ne suit. N1.1 en a créé une. Ce que ce contrôle doit
  // continuer de prouver, c'est que CE LOT-CI n'en a créé aucune — donc la
  // liste des migrations postérieures est EXACTEMENT celle de N1, nommée.
  const tardives = lireMigrations().filter((f) => horodatage(f) > "20260905090100");
  assert.deepEqual(tardives, [
      "20260906090000_nutrition_listes_et_repas_planifies.sql",
      "20260907090000_n1_3_occurrences_de_listes_dans_les_repas.sql",
      "20260908090000_n1_5_1_portions_preferees.sql",
      "20260909090000_n1_5_2_quantite_minimale.sql",
      // ⚠️ N1.6 — TROIS MIGRATIONS DE PLUS, ET LA LISTE EST NOMINATIVE EXPRÈS.
      // Un compteur seul dirait « 79 » sans dire lesquelles : c'est le nom qui
      // rend visible qu'aucune migration étrangère ne s'est glissée dans le lot.
      "20260910090000_n1_6_a_couleurs_de_listes.sql",
      "20260912090000_n1_6_b_enregistrer_repas_structure.sql",
      "20260913090000_contract_preferred_unit.sql",
    ], `migrations postérieures inattendues : ${tardives.join(", ")}`);

  // Et c'est EXÉCUTÉ, pas relu : la checklist crée deux élèves du même coach,
  // se connecte comme B, et compte ce qu'il voit.
  assert.ok(CHECKLIST.includes("HIST17"));
  assert.ok(CHECKLIST.includes("pg_temp.connecte("));
});

await test("HIST18. le coach ne voit QUE ses propres élèves", () => {
  // Lecture seule, et bornée par `is_coach_of_student`.
  assert.ok(SQL_A2.includes('create policy "consumed_meals_select_own_coach"'));
  assert.ok(SQL_A2.includes("for select to authenticated"));
  assert.ok(SQL_A2.includes("using (public.is_coach_of_student(student_id))"));
  assert.ok(SQL_A1.includes('create policy "meal_entries_select_own_coach"'));
  assert.ok(SQL_A1.includes("using (public.is_coach_of_student(student_id))"));

  // ⚠️ CE GARDE A ÉTÉ RESSERRÉ, PAS SUPPRIMÉ (A5.8).
  //
  // Il disait : « A5.7 n'ouvre AUCUN écran coach ». C'était vrai, et A5.8 a
  // légitimement franchi cette frontière — l'écran existe désormais. Effacer le
  // garde aurait fait disparaître la règle avec la phase ; le laisser tel quel
  // aurait rendu rouge un travail demandé.
  //
  // Ce qu'il protège vraiment n'a pas changé et est reformulé ici : la RLS ne
  // doit PAS s'élargir sous prétexte qu'un écran coach existe. Aucune policy
  // coach supplémentaire, aucune policy d'écriture, aucune migration.
  // Borné aux DEUX TABLES DE L'HISTORIQUE : A1 crée aussi des policies coach
  // sur `food_catalog` et `food_aliases` — le catalogue privé du coach, qui
  // n'a rien à voir avec le journal d'un élève et existe depuis A1.
  const policiesCoach = (SQL_A1 + SQL_A2)
    .match(/create policy "[a-z_]*coach[a-z_]*" on public\.(consumed_meals|meal_entries)/g)
    ?.sort();
  assert.deepEqual(
    policiesCoach,
    [
      'create policy "consumed_meals_select_own_coach" on public.consumed_meals',
      'create policy "meal_entries_select_own_coach" on public.meal_entries',
    ],
    "exactement deux policies coach sur l'historique, toutes deux en SELECT",
  );
  // Et aucune n'est une policy d'écriture : `for select`, jamais `for all`.
  assert.ok(!/coach[a-z_]*" on public\.(consumed_meals|meal_entries)\s+for all/.test(SQL_A1 + SQL_A2));
  assert.ok(CHECKLIST.includes("HIST18"));
});

await test("HIST19. le coach ne peut pas écrire l'historique de son élève", () => {
  // ⚠️ CE N'EST PAS QU'UNE QUESTION DE POLICY. Une policy dit quelles LIGNES ;
  // c'est le PRIVILÈGE qui décide du verbe. Les deux tables retirent l'écriture
  // à `authenticated` tout entier — le coach comme l'élève —, et tout passe par
  // des fonctions `security definer` qui vérifient l'élève.
  assert.ok(SQL_A2.includes("revoke insert, update, delete on table public.meal_entries from authenticated"));
  assert.ok(SQL_A2.includes("grant select on table public.consumed_meals to authenticated"));
  assert.ok(!SQL_A2.includes("grant insert on table public.consumed_meals to authenticated"));

  // Aucune policy d'écriture coach n'existe sur l'une ou l'autre table.
  assert.ok(!SQL_A1.includes('"meal_entries_write_own_coach"'));
  assert.ok(!SQL_A2.includes('"consumed_meals_write_own_coach"'));

  // CONTRÔLE NÉGATIF du dépouillement SQL : le fichier n'a pas été vidé, et la
  // prose — elle — parle bien d'écriture coach pour expliquer son absence.
  assert.ok(SQL_A1.includes("create policy"), "le SQL dépouillé contient encore du SQL");
  assert.ok(SQL_A1.length > 5000);
  assert.ok(
    MIGRATION_A1.includes("Pas de policy d'écriture"),
    "la prose énonce la règle…",
  );
  assert.ok(
    !SQL_A1.includes("Pas de policy d'écriture"),
    "…et le dépouillement l'a bien retirée",
  );

  assert.ok(CHECKLIST.includes("HIST19"));
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST20..HIST22 — LE CONTRAT COURSES
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST20. l'agrégateur additionne les identités identiques", () => {
  const journal = [
    repas("2026-08-10", [entrée({ foodId: "f-riz", label: "Riz blanc", quantity: 150 })]),
    repas("2026-08-11", [entrée({ foodId: "f-riz", label: "Riz blanc", quantity: 200 })]),
    repas("2026-08-13", [entrée({ foodId: "f-riz", label: "Riz blanc", quantity: 100 })]),
    repas("2026-08-13", [entrée({ foodId: "f-poulet", label: "Poulet", quantity: 130 })], {
      label: "Déjeuner",
    }),
  ];
  const lignes = agregerConsommation(journal);
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].identity, "catalog_food:f-riz");
  assert.equal(lignes[0].quantityTotal, 450, "150 + 200 + 100");
  assert.equal(lignes[1].quantityTotal, 130);

  // Ordre déterministe : quantité décroissante, puis identité. Sans le second
  // critère, deux lignes égales sortiraient dans un ordre variable.
  const égales = agregerConsommation([
    repas("2026-08-10", [
      entrée({ foodId: "f-b", label: "B", quantity: 100 }),
      entrée({ foodId: "f-a", label: "A", quantity: 100 }),
    ]),
  ]);
  assert.deepEqual(
    égales.map((l) => l.identity),
    ["catalog_food:f-a", "catalog_food:f-b"],
  );

  // Les aliments SAISIS À LA MAIN se regroupent sur leur libellé normalisé —
  // la seule règle « souple » du fichier, et elle ne s'applique qu'à eux.
  const libres = agregerConsommation([
    repas("2026-08-10", [
      entrée({ sourceType: "free", foodId: null, label: "Sandwich maison", quantity: 1, unit: "portion" }),
      entrée({ sourceType: "free", foodId: null, label: "  SANDWICH   MAISON ", quantity: 1, unit: "portion" }),
    ]),
  ]);
  assert.equal(libres.length, 1, "casse et espaces ne créent pas deux lignes");
  assert.equal(libres[0].quantityTotal, 2);
  assert.equal(libres[0].identity, "free:sandwich maison");
});

await test("HIST21. deux GTIN différents ne sont JAMAIS fusionnés", () => {
  // Le pire cas : même marque, même libellé au mot près, deux fiches. Fusionner
  // sur le nom mettrait sur la liste un produit qui n'existe pas.
  const journal = [
    repas("2026-08-10", [
      entrée({
        sourceType: "product",
        foodId: null,
        productId: "prod-500g",
        label: "Yaourt nature",
        quantity: 500,
        unit: "g",
      }),
      entrée({
        sourceType: "product",
        foodId: null,
        productId: "prod-1kg",
        label: "Yaourt nature",
        quantity: 1000,
        unit: "g",
      }),
    ]),
  ];
  const lignes = agregerConsommation(journal);
  assert.equal(lignes.length, 2, "deux fiches, deux lignes — malgré le libellé identique");
  assert.deepEqual(
    lignes.map((l) => l.productId).sort(),
    ["prod-1kg", "prod-500g"],
  );

  // L'identité d'un produit est son identifiant, JAMAIS son nom.
  assert.equal(
    identiteDeLEntree({ sourceType: "product", foodId: null, productId: "p1", label: "X" }).identity,
    "product:p1",
  );
  assert.notEqual(
    identiteDeLEntree({ sourceType: "product", foodId: null, productId: "p1", label: "X" }).identity,
    identiteDeLEntree({ sourceType: "product", foodId: null, productId: "p2", label: "X" }).identity,
  );
  // Et la normalisation du libellé n'est appelée QUE sur la branche `free`.
  const bloc = CODE_HISTORIQUE.slice(
    CODE_HISTORIQUE.indexOf("export function identiteDeLEntree"),
    CODE_HISTORIQUE.indexOf("export function agregerConsommation"),
  );
  assert.equal((bloc.match(/normaliserLibelle/g) ?? []).length, 1);
  assert.ok(bloc.includes("return { identity: `free:${normaliserLibelle(entrée.label)}`"));
});

await test("HIST22. deux catalog_food différents ne sont JAMAIS fusionnés", () => {
  const lignes = agregerConsommation([
    repas("2026-08-10", [
      entrée({ foodId: "f-riz-blanc", label: "Riz", quantity: 100 }),
      entrée({ foodId: "f-riz-complet", label: "Riz", quantity: 100 }),
    ]),
  ]);
  assert.equal(lignes.length, 2, "deux aliments, deux lignes — même nom, peu importe");

  // Un aliment et un produit portant le même `uuid` ne se rejoignent pas non
  // plus : l'identité porte le TYPE en préfixe. Deux tables, deux espaces
  // d'identifiants, et rien ne garantit qu'ils ne se croisent jamais.
  const même = "00000000-0000-4000-8000-000000000001";
  const mélange = agregerConsommation([
    repas("2026-08-10", [
      entrée({ foodId: même, label: "Chose", quantity: 100 }),
      entrée({ sourceType: "product", foodId: null, productId: même, label: "Chose", quantity: 100 }),
    ]),
  ]);
  assert.equal(mélange.length, 2);
  assert.deepEqual(
    mélange.map((l) => l.identity).sort(),
    [`catalog_food:${même}`, `product:${même}`],
  );

  // Une entrée dont la source a été SUPPRIMÉE (`on delete set null`, invariant
  // d'A1) retombe sur le libellé : son instantané reste exact, c'est son
  // identité qui a disparu — et on ne l'invente pas.
  assert.equal(
    identiteDeLEntree({ sourceType: "catalog_food", foodId: null, label: "Riz blanc" }).identity,
    "free:riz blanc",
  );
  assert.equal(
    identiteDeLEntree({ sourceType: "catalog_food", foodId: null, label: "Riz blanc" }).sourceType,
    "free",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   HIST23..HIST25 — NAVIGUER NE MODIFIE RIEN
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST23. consulter une ancienne semaine n'altère jamais consumed_on", () => {
  // Le journal, avant et après un aller-retour de navigation : les objets sont
  // les MÊMES, et `resumeSemaine` ne les recopie pas.
  const journal = [repas("2026-08-03", [entrée()]), repas("2026-08-13", [entrée()])];
  const avant = journal.map((r) => r.consumedOn);

  resumeSemaine(journal, decalerSemaine(SEMAINE_AOUT, -1));
  resumeSemaine(journal, SEMAINE_AOUT);
  agregerConsommation(journal);

  assert.deepEqual(
    journal.map((r) => r.consumedOn),
    avant,
    "aucune date n'a bougé",
  );
  // Les objets sont intacts, pas seulement leurs dates.
  assert.equal(journal[0].entries[0].quantity, 120);

  // ⚠️ AUCUNE ÉCRITURE N'EST MÊME NOMMÉE dans le module ni dans la barre de
  // navigation : ce n'est pas une promesse de commentaire.
  for (const interdit of [
    "consumed_on",
    "consumedOn =",
    "rpc(",
    "insert",
    "update",
    "delete",
    "supabase",
  ]) {
    assert.ok(!CODE_NAV.includes(interdit), `« ${interdit} » dans la barre de semaine`);
  }
  // ⚠️ UNE AFFECTATION, PAS UNE COMPARAISON. `consumedOn === date` contient
  // littéralement « consumedOn = » : chercher cette chaîne rendrait le contrôle
  // rouge sur la lecture même qu'il est censé autoriser.
  assert.ok(!/consumedOn\s*=[^=]/.test(CODE_HISTORIQUE), "l'historique ne réaffecte aucune date");
  assert.ok(/consumedOn ===/.test(CODE_HISTORIQUE), "…mais il la COMPARE bien — le contrôle discrimine");
});

await test("HIST24. changer de semaine ne copie AUCUNE donnée", () => {
  // Les deux rappels de la page ne font qu'une chose : remplacer sept dates.
  const bloc = CODE_PAGE.slice(
    CODE_PAGE.indexOf("onSemainePrecedente:"),
    CODE_PAGE.indexOf("onAjouterManuel:"),
  );
  assert.ok(bloc.includes("setSemaine"), "ils posent un état…");
  for (const interdit of ["rpc(", "insert", "ajouter", "creer", "copier", "await"]) {
    assert.ok(!bloc.includes(interdit), `« ${interdit} » dans les rappels de semaine`);
  }
  // Une seule instruction chacun : pas de « et aussi ».
  assert.equal((bloc.match(/setSemaine/g) ?? []).length, 2);

  // La barre reçoit des RAPPELS, et les câble aux deux boutons — rien d'autre.
  let précédente = 0;
  let suivante = 0;
  const html = renderToString(
    createElement(NutritionWeekNav, {
      libellé: libelleSemaine(SEMAINE_AOUT),
      resume: resumeSemaine([], SEMAINE_AOUT),
      estSemaineCourante: true,
      onPrecedente: () => {
        précédente += 1;
      },
      onSuivante: () => {
        suivante += 1;
      },
    }),
  );
  assert.ok(html.includes('aria-label="Semaine précédente"'));
  assert.ok(html.includes('aria-label="Semaine suivante"'));
  // `renderToString` n'exécute aucun gestionnaire : les compteurs le prouvent,
  // et c'est justement pourquoi ce harnais ne prétend pas simuler un clic.
  assert.equal(précédente + suivante, 0);

  // La navigation change ce qu'on DEMANDE, pas ce que la base contient : le
  // hook de lecture est le seul appelé, et il est en LECTURE.
  assert.ok(CODE_PAGE.includes("useConsumedMeals(datesSemaine"));
  assert.ok(CODE_LECTURE.includes("export async function readConsumedMeals"));
});

await test("HIST25. A5.6 continue d'utiliser les cibles propres à chaque jour", () => {
  // Deux jours, deux profils, deux objectifs différents : le résumé visuel de
  // chaque jour doit montrer LE SIEN. Une cible hebdomadaire moyenne, ou celle
  // du premier jour recopiée, passerait inaperçue sur une semaine plate.
  const html = rendreSemaine([]);
  assert.ok(html.includes(nombre(2000)), "l'objectif du lundi");
  assert.ok(html.includes(nombre(2600)), "et celui du mardi, différent");

  // La cible vient toujours de `dailyTargetsForDay(week, jour)` — par JOUR.
  assert.ok(CODE_SEMAINE.includes("const cibles = dailyTargetsForDay(week, jour)"));
  assert.ok(CODE_SEMAINE.includes("kcal: cibles.calories.totalCalories"));
  // Et le consommé du jour vient de la DATE du jour, pas de la semaine.
  assert.ok(CODE_SEMAINE.includes("consommé={totalsForDay(repasDuJour)}"));
  assert.ok(CODE_SEMAINE.includes("suivi.meals.filter((r) => r.consumedOn === date)"));

  // ⚠️ LE RÉSUMÉ DE SEMAINE NE DÉBORDE PAS SUR CELUI DU JOUR : la barre de
  // navigation ne reçoit aucun objectif, et n'en affiche donc aucun.
  assert.ok(!CODE_NAV.includes("objectif"));
  assert.ok(!CODE_NAV.includes("dailyTargets"));
  assert.ok(!CODE_NAV.includes("CalorieRing"));

  // Le consommé du lundi ne déborde pas sur les six autres jours.
  const avecLundi = texteRendu(rendreSemaine([repas(LUNDI, [entrée({ proteinG: 10, carbG: 10, fatG: 10 })])]));
  assert.ok(avecLundi.includes(`>${nombre(170)}<`), "170 kcal, le lundi");
  // ⚠️ SUR LE TEXTE RENDU, PAS SUR LE HTML BRUT : « 170 » se retrouve dans les
  // décimales d'un `stroke-dashoffset`, et le compte serait faux pour une
  // raison qui n'a rien à voir avec la règle testée.
  assert.equal(
    (avecLundi.match(new RegExp(`>${nombre(170)}<`, "g")) ?? []).length,
    1,
    "et une seule fois : un seul jour l'affiche",
  );
  // Les six autres jours affichent zéro consommé — chacun avec SA cible.
  assert.equal((avecLundi.match(/>0</g) ?? []).length, 6);
});

/* ══════════════════════════════════════════════════════════════════════════
   COHÉRENCE DU HARNAIS
   ══════════════════════════════════════════════════════════════════════════ */

await test("HIST-SUP. le dépouillement des commentaires n'a rien vidé", () => {
  // Sans ce contrôle, tous les « le mot X n'apparaît pas » ci-dessus seraient
  // verts pour la pire des raisons : un fichier vide.
  for (const attendu of [
    "export function semaineContenant",
    "export function decalerSemaine",
    "export function libelleSemaine",
    "export function resumeDuJour",
    "export function resumeSemaine",
    "export function identiteDeLEntree",
    "export function agregerConsommation",
  ]) {
    assert.ok(CODE_HISTORIQUE.includes(attendu), `« ${attendu} » absent après dépouillement`);
  }
  assert.ok(CODE_HISTORIQUE.length > 2000);
  assert.ok(CODE_NAV.includes("export function NutritionWeekNav"));
  assert.ok(CODE_NAV.length > 800);

  // ⚠️ ET LA PROSE, ELLE, PARLE BIEN DES MOTS INTERDITS. Si le fichier ne les
  // mentionnait nulle part, les interdictions ci-dessus ne prouveraient rien.
  // Chaque mot de cette liste est INTERDIT dans le code par un test ci-dessus,
  // et PRÉSENT dans la prose du même fichier. C'est ce qui rend ces
  // interdictions probantes : sans cela, elles seraient vertes sur un fichier
  // qui ne parle jamais du sujet.
  for (const [source, code, mot] of [
    [SOURCE_HISTORIQUE, CODE_HISTORIQUE, "food_catalog"], // interdit par HIST10
    [SOURCE_HISTORIQUE, CODE_HISTORIQUE, "food_products"], // interdit par HIST10
    [SOURCE_HISTORIQUE, CODE_HISTORIQUE, "1 ml"], // interdit par HIST16
    [SOURCE_NAV, CODE_NAV, "consumed_on"], // interdit par HIST23
  ] as const) {
    assert.ok(source.includes(mot), `la prose devrait mentionner « ${mot} »`);
    assert.ok(!code.includes(mot), `le dépouillement n'a pas retiré « ${mot} »`);
  }

  // ⚠️ AUCUNE MIGRATION N'A ÉTÉ AJOUTÉE POUR A5.7 — c'est la conclusion de
  // l'audit, et elle se vérifie par comptage, pas par déclaration. Le compteur
  // vit aussi dans `supabase/baseline/manifest.json` : les deux doivent
  // s'accorder, sinon l'un des deux ment.
  const migrations = lireMigrations();
  assert.equal(migrations.length, 79, "79 fichiers : A5.7 n'en a créé aucun, N1.1 en a créé un, N1.3 un second");
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json")) as {
    migrations_post_baseline_attendues: readonly string[];
  };
  assert.equal(manifeste.migrations_post_baseline_attendues.length, 52);

  // Et rien qui ressemble à une table, une vue ou un agrégat d'historique.
  //
  // ⚠️ LA FENÊTRE EST BORNÉE DES DEUX CÔTÉS DEPUIS N1.1. Avec une borne
  // basse seule, la migration de N1 entrait dans le dépouillement, et son
  // `comment on table` — qui explique justement pourquoi un repas planifié ne
  // doit PAS peser sur l'historique A5.7 — faisait rougir un contrôle qui ne
  // parle que d'A5. Ce que la règle garde est inchangé : A5 n'a créé aucun
  // agrégat d'historique.
  const sqlA5 = migrations
    .filter((f) => horodatage(f) >= "20260905" && horodatage(f) < "20260906")
    .map((f) => sansCommentairesSql(lire(`../../supabase/migrations/${f}`)))
    .join("\n")
    .toLowerCase();
  for (const interdit of ["historique", "history", "materialized view", "weekly_", "hebdo"]) {
    assert.ok(!sqlA5.includes(interdit), `« ${interdit} » dans une migration d'A5`);
  }
  assert.ok(sqlA5.includes("create table"), "le dépouillement SQL n'a pas tout vidé");
});
