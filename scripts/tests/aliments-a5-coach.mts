/**
 * Harnais — ALIMENTS A5.8 : L'HISTORIQUE D'UN ÉLÈVE, VU PAR SON COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Trois niveaux, et chacun prouve une chose que les autres ne peuvent pas :
 *
 * 1. `readConsumedMeals` est APPELÉE POUR DE VRAI contre un double de Supabase
 *    qui applique réellement `.in()` et `.eq()`. On observe donc la requête
 *    ÉMISE et ce que la fonction fait de la réponse — pas une intention lue
 *    dans le code.
 * 2. Le RENDU passe par `renderToString` sur les composants exportés.
 * 3. La RLS — « le coach X ne voit pas l'élève du coach Y » — ne se prouve
 *    QU'EN BASE, et l'est dans
 *    `supabase/tests/aliments_a5_7_historique_checklist.sql`, exécuté sur un
 *    PostgreSQL reconstruit.
 *
 * ⚠️ CE QUE LE DOUBLE NE PROUVE PAS. Il ne remplace pas la RLS : il montre que
 * l'application NOMME l'élève, pas que la base l'aurait protégé sans ça. Les
 * deux sont nécessaires, et confondre l'un avec l'autre serait le piège.
 *
 * Lancement : npm run test:aliments-a5-coach
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import {
  AlimentConsomme,
  JourConsomme,
  RepasConsomme,
} from "../../components/admin/CoachNutritionHistory";
import { formatIntegerFr } from "../../lib/nutrition/basis-points";
import type { ConsumedEntry, ConsumedMeal } from "../../lib/nutrition/consumed";
import { readConsumedMeals } from "../../lib/supabase/consumed-meals";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
function sansCommentairesSql(source: string): string {
  return source.replace(/^\s*--.*$/gm, " ");
}

const SOURCE_HOOK = lire("../../hooks/useHistoriqueEleve.ts");
const CODE_HOOK = sansProse(SOURCE_HOOK);
const SOURCE_ECRAN = lire("../../components/admin/CoachNutritionHistory.tsx");
const CODE_ECRAN = sansProse(SOURCE_ECRAN);
const CODE_LECTURE = sansProse(lire("../../lib/supabase/consumed-meals.ts"));
const CODE_FICHE = sansProse(lire("../../app/admin/eleves/[studentId]/page.tsx"));
const CHECKLIST = lire("../../supabase/tests/aliments_a5_7_historique_checklist.sql");

const nombre = (n: number) => formatIntegerFr(n);
const texteRendu = (html: string) => html.replace(/<!-- -->/g, "");

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE DE SUPABASE — il applique VRAIMENT `.in()` et `.eq()`
   ══════════════════════════════════════════════════════════════════════════ */

interface Appel {
  readonly table: string;
  readonly filtres: Record<string, unknown>;
}

/**
 * Reproduit exactement la chaîne que `readConsumedMeals` construit :
 * `from().select().in().eq?().order().order?()`, et qui s'attend en fin de
 * course. Les filtres sont APPLIQUÉS sur les lignes — c'est ce qui permet à
 * COACH-HIST2 de constater une séparation plutôt que de la supposer.
 */
function fauxSupabase(tables: Record<string, readonly Record<string, unknown>[]>) {
  const appels: Appel[] = [];

  function constructeur(table: string) {
    let lignes = [...(tables[table] ?? [])];
    const filtres: Record<string, unknown> = {};
    const chaîne = {
      select() {
        return chaîne;
      },
      in(colonne: string, valeurs: readonly unknown[]) {
        filtres[`in:${colonne}`] = [...valeurs];
        lignes = lignes.filter((l) => valeurs.includes(l[colonne]));
        return chaîne;
      },
      eq(colonne: string, valeur: unknown) {
        filtres[`eq:${colonne}`] = valeur;
        lignes = lignes.filter((l) => l[colonne] === valeur);
        return chaîne;
      },
      order() {
        return chaîne;
      },
      // `await` sur la chaîne : c'est ainsi que PostgREST se termine.
      then(résoudre: (r: { data: unknown; error: null }) => void) {
        appels.push({ table, filtres: { ...filtres } });
        résoudre({ data: lignes, error: null });
      },
    };
    return chaîne;
  }

  return {
    client: { from: (table: string) => constructeur(table) } as never,
    appels,
  };
}

/* ── Le banc : DEUX élèves du MÊME coach, la même semaine ───────────────── */

const ELEVE_A = "11111111-1111-4111-8111-111111111111";
const ELEVE_B = "22222222-2222-4222-8222-222222222222";
const SEMAINE = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];

function ligneRepas(id: string, studentId: string, date: string, label: string) {
  return {
    id,
    student_id: studentId,
    consumed_on: date,
    kind: "student",
    prescribed_meal_id: null,
    slot_key: null,
    label,
    position: 0,
    target_kcal: null,
    target_protein_g: null,
    target_carb_g: null,
    target_fat_g: null,
  };
}

function ligneEntree(
  id: string,
  studentId: string,
  repasId: string,
  label: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    student_id: studentId,
    consumed_meal_id: repasId,
    source_type: "catalog_food",
    food_id: "food-1",
    product_id: null,
    label,
    quantity: 100,
    unit: "g",
    protein_g: 10,
    carb_g: 20,
    fat_g: 5,
    note: null,
    created_at: "2026-08-13T08:00:00.000Z",
    ...extra,
  };
}

/** La « base » : A et B ont tous deux mangé le 13, avec des chiffres distincts. */
const BASE = {
  consumed_meals: [
    ligneRepas("cm-a1", ELEVE_A, "2026-08-10", "Lundi de A"),
    ligneRepas("cm-a2", ELEVE_A, "2026-08-13", "Jeudi de A"),
    ligneRepas("cm-b1", ELEVE_B, "2026-08-13", "Jeudi de B"),
  ],
  meal_entries: [
    ligneEntree("e-a1", ELEVE_A, "cm-a1", "Banane de A"),
    ligneEntree("e-a2", ELEVE_A, "cm-a2", "Riz de A"),
    ligneEntree("e-b1", ELEVE_B, "cm-b1", "Poulet de B", { protein_g: 777 }),
  ],
};

/* ── Fabriques ──────────────────────────────────────────────────────────── */

let compteur = 0;
function entrée(partiel: Partial<ConsumedEntry> = {}): ConsumedEntry {
  compteur += 1;
  return {
    id: `e${compteur}`,
    consumedMealId: "cm-1",
    sourceType: "catalog_food",
    foodId: "food-1",
    productId: null,
    label: "Banane",
    quantity: 100,
    unit: "g",
    proteinG: 10,
    carbG: 20,
    fatG: 5,
    note: "",
    createdAt: "2026-08-13T08:00:00.000Z",
    ...partiel,
  };
}

function repasDe(
  studentId: string,
  date: string,
  entrées: readonly ConsumedEntry[],
  partiel: Partial<ConsumedMeal> = {},
): ConsumedMeal {
  return {
    id: `cm-${studentId}-${date}-${partiel.label ?? "pdj"}`,
    studentId,
    consumedOn: date,
    kind: "prescribed",
    prescribedMealId: "meal-pdj",
    slotKey: "breakfast",
    label: "Petit-déjeuner",
    position: 0,
    target: null,
    entries: entrées,
    ...partiel,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   COACH-HIST1..3 — QUI EST LU
   ══════════════════════════════════════════════════════════════════════════ */

await test("COACH-HIST1. le coach voit l'historique de l'élève explicitement sélectionné", async () => {
  const { client, appels } = fauxSupabase(BASE);
  const repas = await readConsumedMeals(client, SEMAINE, { portee: "eleve", studentId: ELEVE_A });

  assert.equal(repas.length, 2, "les deux repas de A, et eux seuls");
  assert.ok(repas.every((r) => r.studentId === ELEVE_A));
  assert.deepEqual(
    repas.map((r) => r.label).sort(),
    ["Jeudi de A", "Lundi de A"],
  );
  assert.equal(repas.flatMap((r) => r.entries).length, 2);

  // ⚠️ L'ÉLÈVE EST NOMMÉ DANS LA REQUÊTE — sur les DEUX tables. C'est observé
  // sur l'appel émis, pas lu dans le code.
  assert.equal(appels.length, 2);
  assert.equal(appels[0].table, "consumed_meals");
  assert.equal(appels[0].filtres["eq:student_id"], ELEVE_A);
  assert.deepEqual(appels[0].filtres["in:consumed_on"], SEMAINE);
  assert.equal(appels[1].table, "meal_entries");
  assert.equal(appels[1].filtres["eq:student_id"], ELEVE_A);

  // La semaine reste bornée à sept dates : jamais tout l'historique.
  assert.equal((appels[0].filtres["in:consumed_on"] as string[]).length, 7);
});

await test("COACH-HIST2. un coach de deux élèves ne mélange JAMAIS leurs repas", async () => {
  // ⚠️ LE CAS QUI MOTIVE TOUT LE LOT. A et B ont mangé LE MÊME JOUR. Sans
  // ciblage, la RLS du coach laisse passer les deux, et l'écran additionne
  // deux athlètes sans que rien ne le signale.
  const vueA = await readConsumedMeals(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  const vueB = await readConsumedMeals(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_B,
  });

  assert.equal(vueA.length, 2);
  assert.equal(vueB.length, 1);
  assert.ok(!vueA.some((r) => r.studentId === ELEVE_B), "aucun repas de B chez A");
  assert.ok(!vueB.some((r) => r.studentId === ELEVE_A), "aucun repas de A chez B");

  // Les 777 g de protéines de B sont introuvables dans la vue de A.
  const protéinesA = vueA.flatMap((r) => r.entries).reduce((n, e) => n + e.proteinG, 0);
  assert.equal(protéinesA, 20, "10 + 10, et surtout pas 797");
  assert.ok(!vueA.flatMap((r) => r.entries).some((e) => e.label.includes("de B")));

  // CONTRÔLE DISCRIMINANT : sans ciblage, le double rendrait bien les TROIS
  // repas. C'est la preuve que la séparation vient du ciblage, et non d'un
  // banc où B n'existerait pas.
  const sansCiblage = await readConsumedMeals(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve-connecte",
  });
  assert.equal(sansCiblage.length, 3, "le banc contient bien les deux élèves");
});

await test("COACH-HIST3. le coach A ne voit pas l'élève du coach B", () => {
  // Cette règle-ci ne se prouve QU'EN BASE : c'est la RLS qui tranche, pas le
  // filtre client. Un coach qui nommerait l'élève d'un confrère recevrait une
  // liste vide PARCE QUE la policy refuse — le `.eq` ne l'a jamais protégé.
  const SQL = sansCommentairesSql(
    lire("../../supabase/migrations/20260901090000_consumed_meals.sql"),
  );
  assert.ok(SQL.includes("using (public.is_coach_of_student(student_id))"));

  // Et la checklist l'EXÉCUTE, sur un banc à deux coachs.
  assert.ok(CHECKLIST.includes("HIST18"));
  // ⚠️ LES APOSTROPHES SONT DOUBLÉES DANS LE SQL — `d''un`, et non `d'un`.
  // Chercher la forme française naturelle rendrait ce contrôle rouge sur une
  // checklist parfaitement correcte.
  assert.ok(CHECKLIST.includes("et ne voit RIEN de l''élève d''un autre coach"));
  assert.ok(CHECKLIST.includes("hist-coach-2@test.invalid"), "le second coach existe au banc");

  // ⚠️ ET LE FILTRE CLIENT NE PRÉTEND PAS PROTÉGER. La prose du data layer le
  // dit explicitement : le contrôle ci-dessus serait trompeur si le code
  // laissait croire que `.eq` remplace une policy.
  assert.ok(
    lire("../../lib/supabase/consumed-meals.ts").includes(
      "LE FILTRE CLIENT NE PROTÈGE RIEN",
    ),
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   COACH-HIST4 — AUCUNE ÉCRITURE
   ══════════════════════════════════════════════════════════════════════════ */

await test("COACH-HIST4. aucune écriture n'est possible depuis l'écran coach", () => {
  // 1. LE HOOK n'expose rien à appeler. Ce n'est pas une promesse : c'est la
  //    liste de ce qu'il rend.
  assert.ok(CODE_HOOK.includes("readonly refetch: () => Promise<void>"));
  for (const interdit of [
    "ajouter",
    "supprimer",
    "corriger",
    "renommer",
    "creer",
    "ouvrir",
    "rpc(",
    "insert",
    "update(",
    "delete(",
  ]) {
    assert.ok(!CODE_HOOK.includes(interdit), `« ${interdit} » dans le hook coach`);
  }
  // Et il n'importe QUE la lecture.
  assert.ok(CODE_HOOK.includes("import { readConsumedMeals }"));
  assert.equal((CODE_HOOK.match(/from "@\/lib\/supabase\/consumed-meals"/g) ?? []).length, 1);

  // 2. L'ÉCRAN n'a ni client Supabase, ni rappel d'écriture.
  for (const interdit of [
    "createSupabaseBrowserClient",
    "rpc(",
    "onAjouter",
    "onSupprimer",
    "onCorriger",
    "onRenommer",
    "AddFoodSheet",
    "ConsumedMealSection",
    "ConsumedFoodBar",
  ]) {
    assert.ok(!CODE_ECRAN.includes(interdit), `« ${interdit} » dans l'écran coach`);
  }

  // 3. LE RENDU ne contient AUCUN bouton d'action sur les aliments. La version
  //    élève, elle, en est faite — c'est pourquoi elle n'est pas réutilisée.
  const html = renderToString(
    createElement(RepasConsomme, { repas: repasDe(ELEVE_A, "2026-08-13", [entrée()]) }),
  );
  assert.ok(!html.includes("<button"), "aucun bouton dans le détail d'un repas");
  assert.ok(!html.toLowerCase().includes("modifier"));
  assert.ok(!html.toLowerCase().includes("supprimer"));
  assert.ok(html.includes("<li"), "des éléments de liste, pas des commandes");

  // CONTRÔLE DISCRIMINANT : le composant ÉLÈVE équivalent, lui, est bien un
  // bouton qui s'annonce « modifier ». Sans cette comparaison, les assertions
  // ci-dessus seraient vertes même sur un rendu vide.
  const élève = lire("../../components/student/ConsumedFoodBar.tsx");
  assert.ok(élève.includes("<button"), "la version élève EST cliquable");
  assert.ok(élève.includes("modifier"), "et s'annonce comme telle");

  // 4. LA BASE refuse de toute façon — vérifié exécuté dans la checklist.
  assert.ok(CHECKLIST.includes("HIST19"));
  assert.ok(CHECKLIST.includes("le coach ne peut pas AJOUTER une entrée"));
});

/* ══════════════════════════════════════════════════════════════════════════
   COACH-HIST5..6 — CHANGER D'ÉLÈVE, CHANGER DE SEMAINE
   ══════════════════════════════════════════════════════════════════════════ */

await test("COACH-HIST5. changer d'élève recharge bien l'historique du nouvel élève", async () => {
  // Deux lectures successives, comme lorsque le coach ouvre une autre fiche.
  const { client, appels } = fauxSupabase(BASE);
  const premier = await readConsumedMeals(client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  const second = await readConsumedMeals(client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_B,
  });

  assert.notDeepEqual(premier, second, "le contenu a changé");
  assert.equal(appels[0].filtres["eq:student_id"], ELEVE_A);
  assert.equal(appels[2].filtres["eq:student_id"], ELEVE_B, "la seconde lecture nomme B");
  assert.ok(second.every((r) => r.studentId === ELEVE_B));

  // ⚠️ ET LE RECHARGEMENT EST DÉCLENCHÉ PAR LE CHANGEMENT D'ÉLÈVE : `studentId`
  // est dans les dépendances du `useCallback` qui charge. Sans lui, ouvrir la
  // fiche de B afficherait les repas de A jusqu'au prochain changement de
  // semaine.
  assert.ok(CODE_HOOK.includes("}, [actif, clé, studentId]);"));

  // Et une lecture en vol ne peut pas écraser la suivante : le compteur de
  // requête est comparé AVANT chaque `setMeals`.
  assert.ok(CODE_HOOK.includes("const numéro = ++requête.current"));
  assert.ok(CODE_HOOK.includes("if (requête.current !== numéro) return"));
});

await test("COACH-HIST6. changer de semaine conserve l'élève sélectionné", async () => {
  // La semaine précédente, LE MÊME élève : le filtre ne bouge pas, seules les
  // dates changent.
  const { client, appels } = fauxSupabase(BASE);
  const semainePrécédente = SEMAINE.map((d) =>
    d.replace(/2026-08-(\d+)/, (_, j: string) => `2026-08-0${Number(j) - 7}`.slice(0, 10)),
  );
  await readConsumedMeals(client, SEMAINE, { portee: "eleve", studentId: ELEVE_A });
  await readConsumedMeals(client, semainePrécédente, { portee: "eleve", studentId: ELEVE_A });

  assert.equal(appels[0].filtres["eq:student_id"], ELEVE_A);
  assert.equal(appels[2].filtres["eq:student_id"], ELEVE_A, "toujours le même élève");
  assert.notDeepEqual(
    appels[0].filtres["in:consumed_on"],
    appels[2].filtres["in:consumed_on"],
    "mais pas les mêmes dates",
  );

  // ⚠️ STRUCTUREL, ET C'EST LA VRAIE GARANTIE : la semaine est un ÉTAT, l'élève
  // est une PROP. `setSemaine` ne peut pas toucher à `studentId`, parce que
  // `studentId` ne vit pas dans ce composant.
  assert.ok(CODE_ECRAN.includes("const [semaine, setSemaine] = useState<Semaine>"));
  assert.ok(!CODE_ECRAN.includes("setStudentId"), "l'élève n'est pas un état");
  assert.ok(!/useState[^;]*studentId/.test(CODE_ECRAN));
  const rappels = CODE_ECRAN.slice(
    CODE_ECRAN.indexOf("onPrecedente="),
    CODE_ECRAN.indexOf("/>", CODE_ECRAN.indexOf("onSuivante=")),
  );
  assert.equal((rappels.match(/setSemaine/g) ?? []).length, 2);
  assert.ok(!rappels.includes("studentId"), "aucun des deux rappels ne touche à l'élève");
});

/* ══════════════════════════════════════════════════════════════════════════
   COACH-HIST7..10 — CE QUE L'ÉCRAN AFFICHE
   ══════════════════════════════════════════════════════════════════════════ */

await test("COACH-HIST7. un jour sans suivi reste distinct de 0 kcal", () => {
  // Un jour où RIEN n'a été noté.
  const vide = renderToString(createElement(JourConsomme, { date: "2026-08-11", repas: [] }));
  assert.ok(vide.includes("Aucune consommation enregistrée ce jour-là."));

  // Un jour où un CONTENEUR existe mais reste vide : même message. Ouvrir un
  // repas n'est pas manger.
  const conteneurVide = renderToString(
    createElement(JourConsomme, {
      date: "2026-08-11",
      repas: [repasDe(ELEVE_A, "2026-08-11", [])],
    }),
  );
  assert.ok(conteneurVide.includes("Aucune consommation enregistrée ce jour-là."));

  // ⚠️ ET UN THÉ SANS SUCRE — 0 kcal, mais une SAISIE — n'affiche PAS ce
  // message. Les deux journées totalisent zéro ; une seule est vide.
  const thé = renderToString(
    createElement(JourConsomme, {
      date: "2026-08-11",
      repas: [
        repasDe(ELEVE_A, "2026-08-11", [
          entrée({ label: "Thé vert", unit: "ml", quantity: 250, proteinG: 0, carbG: 0, fatG: 0 }),
        ]),
      ],
    }),
  );
  assert.ok(!thé.includes("Aucune consommation enregistrée"), "une saisie à zéro reste une saisie");
  assert.ok(thé.includes("Thé vert"));
  assert.ok(thé.includes("250"));
});

await test("COACH-HIST8. les instantanés historiques sont affichés inchangés", () => {
  // Les macros viennent de l'ENTRÉE, figées par le serveur. Le coach voit ce
  // qui a été mangé au moment où ça a été mangé.
  const html = texteRendu(
    renderToString(
      createElement(AlimentConsomme, {
        entrée: entrée({
          label: "Riz blanc — fiche de 2026",
          quantity: 180,
          proteinG: 4.3,
          carbG: 49.5,
          fatG: 0.5,
        }),
      }),
    ),
  );
  assert.ok(html.includes("Riz blanc — fiche de 2026"), "le libellé FIGÉ");
  assert.ok(html.includes("180"));
  // 4,3×4 + 49,5×4 + 0,5×9 = 219,7 → 220. Mesuré, pas supposé : `formatIntegerFr`
  // arrondit, et poser 221 « à vue de nez » rendait ce test rouge sur un
  // affichage juste.
  assert.ok(html.includes(nombre(220)), "les kcal dérivées de l'instantané");

  // ⚠️ AUCUNE SOURCE VIVANTE n'est consultée par l'écran coach. Ce n'est pas
  // une promesse de commentaire : ces mots n'existent pas dans son code.
  for (const interdit of [
    "food_catalog",
    "food_products",
    "open_food_facts",
    "ciqual",
    "protein_per_100",
    "fetch(",
  ]) {
    assert.ok(!CODE_ECRAN.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} »`);
  }
  // Le calcul des kcal est celui du produit, importé — jamais réécrit ici.
  assert.ok(CODE_ECRAN.includes("entryKcal"));
  assert.ok(!CODE_ECRAN.includes("* 9"), "aucun 4/4/9 réécrit");
});

await test("COACH-HIST9. les repas personnels de l'élève sont visibles", () => {
  const collation = repasDe(ELEVE_A, "2026-08-13", [entrée({ label: "Amandes" })], {
    kind: "student",
    prescribedMealId: null,
    slotKey: null,
    label: "Collation du soir",
    target: null,
  });
  const prescrit = repasDe(ELEVE_A, "2026-08-13", [entrée({ label: "Banane" })], {
    label: "Petit-déjeuner",
  });

  const html = renderToString(
    createElement(JourConsomme, { date: "2026-08-13", repas: [prescrit, collation] }),
  );
  assert.ok(html.includes("Collation du soir"), "le repas libre est affiché…");
  assert.ok(html.includes("Amandes"));
  assert.ok(html.includes("Petit-déjeuner"), "…à égalité avec le prescrit");
  assert.ok(html.includes("Banane"));

  // L'écran ne filtre JAMAIS sur `kind` : rien à oublier de rebrancher.
  assert.ok(!CODE_ECRAN.includes('kind === "student"'));
  assert.ok(!CODE_ECRAN.includes('kind === "prescribed"'));
});

await test("COACH-HIST10. g et ml sont conservés, sans aucune conversion", () => {
  const html = texteRendu(
    renderToString(
      createElement(JourConsomme, {
        date: "2026-08-13",
        repas: [
          repasDe(ELEVE_A, "2026-08-13", [
            entrée({ label: "Riz", quantity: 150, unit: "g" }),
            entrée({ label: "Lait", quantity: 200, unit: "ml" }),
            entrée({ label: "Œuf", quantity: 2, unit: "piece" }),
          ]),
        ],
      }),
    ),
  );
  assert.ok(html.includes(`150 g`), "150 g reste en grammes");
  assert.ok(html.includes(`200 ml`), "200 ml reste en millilitres");
  assert.ok(html.includes(`2 pièce`), "et une pièce reste une pièce");

  // Aucune densité, aucun facteur, aucune conversion dans l'écran.
  for (const interdit of ["densite", "density", "convert", "mlVersG", "* 1.03"]) {
    assert.ok(!CODE_ECRAN.includes(interdit), `« ${interdit} » dans l'écran coach`);
  }
  // Les libellés d'unités viennent du vocabulaire partagé, pas d'une table locale.
  assert.ok(CODE_ECRAN.includes("CONSUMED_UNIT_LABELS_FR[entrée.unit]"));
});

/* ══════════════════════════════════════════════════════════════════════════
   COHÉRENCE DU LOT
   ══════════════════════════════════════════════════════════════════════════ */

await test("COACH-SUP. l'écran est branché, réutilise A5.7, et n'a coûté aucune migration", () => {
  // Coach → Élève → Nutrition → Historique : le bloc est dans la fiche élève.
  assert.ok(CODE_FICHE.includes("<CoachNutritionHistory"));
  assert.ok(CODE_FICHE.includes("studentId={student.id}"), "l'élève de la fiche, nommé");
  assert.ok(CODE_FICHE.includes("Historique alimentaire"));
  // ⚠️ PAS CONDITIONNÉ AU PLAN ASSIGNÉ : un élève peut avoir mangé sans plan.
  // La fenêtre part du `{isSupabaseStudent` LE PLUS PROCHE — pas d'un décalage
  // en caractères, qui attraperait le bloc « Suivi nutrition » d'à côté et
  // rendrait le contrôle rouge pour la mauvaise raison.
  const début = CODE_FICHE.lastIndexOf(
    "{isSupabaseStudent",
    CODE_FICHE.indexOf("<CoachNutritionHistory"),
  );
  const bloc = CODE_FICHE.slice(début, CODE_FICHE.indexOf("<CoachNutritionHistory"));
  assert.ok(début !== -1);
  assert.ok(!bloc.includes("assignedPlan"), "l'historique ne dépend pas d'un plan assigné");
  // CONTRÔLE DISCRIMINANT : le bloc VOISIN, lui, en dépend bel et bien.
  assert.ok(CODE_FICHE.includes("isSupabaseStudent && assignedPlan"));

  // RÉUTILISATION : les trois composants et le module d'A5.7, à l'identique.
  for (const partagé of [
    "@/components/student/NutritionWeekNav",
    "@/components/student/NutritionDayCarousel",
    "@/components/student/DailyNutritionProgress",
    "@/lib/nutrition/historique",
  ]) {
    assert.ok(CODE_ECRAN.includes(partagé), `« ${partagé} » n'est pas réutilisé`);
  }
  // Aucune arithmétique locale : ni semaine, ni total, ni moyenne recalculés.
  for (const interdit of ["getDay(", "setDate(", "reduce((", "/ 7"]) {
    assert.ok(!CODE_ECRAN.includes(interdit), `« ${interdit} » recalculé dans l'écran coach`);
  }

  // AUCUNE MIGRATION : le compte est inchangé depuis A5.
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter(
    (f) => f.endsWith(".sql"),
  );
  assert.equal(migrations.length, 80, "80 fichiers : A5.8 n'en a créé aucun, N1.1 en a créé un, N1.3 un second");
  // ⚠️ SIXIÈME OCCURRENCE DU MÊME MOTIF DANS CE PROJET, et la leçon est la
  // même qu'en A5 : « aucune migration postérieure » n'est vrai que tant
  // qu'aucun chantier ne suit. N1.1 en a créé une. Ce que ce contrôle doit
  // continuer de prouver, c'est que CE LOT-CI n'en a créé aucune — donc la
  // liste des migrations postérieures est EXACTEMENT celle de N1, nommée.
  assert.deepEqual(
    migrations.filter((f) => f.slice(0, 14) > "20260905090100"),
    [
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
      // ⚠️ C0.1 — LE VERROU SERVEUR, et rien d'autre. Courses C0 n'a créé
      // AUCUNE migration ; C0.1 en a créé UNE, qui interdit de réécrire un
      // repas déjà consommé. La nommer ici rend visible qu'aucun chantier
      // « liste de courses » n'a glissé de table au passage.
      "20260914090000_c0_1_verrou_repas_consomme.sql",
    ],
  );

  // Le paramètre de ciblage est OBLIGATOIRE : aucune valeur par défaut, donc
  // aucune lecture globale possible par omission.
  assert.ok(CODE_LECTURE.includes("cible: CibleLecture"));
  assert.ok(!CODE_LECTURE.includes("cible?: CibleLecture"));
  assert.ok(!CODE_LECTURE.includes("cible: CibleLecture = "));

  // CONTRÔLE NÉGATIF du dépouillement : les fichiers ne sont pas vides, et la
  // prose — elle — nomme bien les mots interdits ci-dessus.
  assert.ok(CODE_ECRAN.includes("export function CoachNutritionHistory"));
  assert.ok(CODE_ECRAN.length > 1500);
  assert.ok(CODE_HOOK.includes("export function useHistoriqueEleve"));
  for (const [source, code, mot] of [
    [SOURCE_ECRAN, CODE_ECRAN, "ConsumedFoodBar"], // interdit par COACH-HIST4
    [SOURCE_HOOK, CODE_HOOK, "supprimer"], // interdit par COACH-HIST4
  ] as const) {
    assert.ok(source.includes(mot), `la prose devrait mentionner « ${mot} »`);
    assert.ok(!code.includes(mot), `le dépouillement n'a pas retiré « ${mot} »`);
  }
});
