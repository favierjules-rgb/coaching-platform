/**
 * Harnais — LOT NUTRITION P6 + P7 : LE STATUT DE JOURNÉE EST DÉRIVÉ, PAS STOCKÉ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Trois niveaux, et chacun prouve une chose que les autres ne peuvent pas :
 *
 * 1. Les fonctions PURES de `lib/nutrition/statut-journee.ts` sont exécutées
 *    sur des repas fabriqués : la règle de statut, les totaux et la fusion
 *    avec l'historique sont observés, pas lus dans le code.
 * 2. `lireJournalNutrition` et `derniereJourneeConsommee` sont appelées POUR DE
 *    VRAI contre un double de Supabase qui applique réellement `.in()`,
 *    `.eq()`, `.order()` et `.limit()`. On observe donc les requêtes ÉMISES.
 * 3. Les règles qui portent sur l'ARCHITECTURE — « cet écran ne dépend plus
 *    exclusivement de telle table », « ce hook n'écrit plus quand Supabase est
 *    là » — sont vérifiées sur le texte des fichiers, parce qu'une absence ne
 *    s'observe pas à l'exécution.
 *
 * ⚠️ CE QUE CE HARNAIS NE PROUVE PAS. Il ne remplace pas la RLS : il montre que
 * le chemin coach NOMME l'élève, pas que la base l'aurait protégé sans ça.
 * La séparation réelle est éprouvée en base, dans
 * `supabase/tests/aliments_a5_7_historique_checklist.sql`.
 *
 * Lancement : npm run test:nutrition-journal
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { kcalFromMacros, type ConsumedEntry, type ConsumedMeal } from "../../lib/nutrition/consumed";
import {
  dateLaPlusRecente,
  fusionnerJournalEtHistorique,
  journeeRemplie,
  journeesDuJournal,
  logsDepuisJournal,
  statutDeLaJournee,
} from "../../lib/nutrition/statut-journee";
import { computeWeeklyNutritionAdjustment } from "../../lib/nutrition-weekly";
import { derniereJourneeConsommee, lireJournalNutrition } from "../../lib/supabase/nutrition-journal";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_STATUT = lire("../../lib/nutrition/statut-journee.ts");
const CODE_STATUT = sansProse(SOURCE_STATUT);
const SOURCE_JOURNAL = lire("../../lib/supabase/nutrition-journal.ts");
const CODE_JOURNAL = sansProse(SOURCE_JOURNAL);
const SOURCE_TRACKING = lire("../../hooks/useNutritionTracking.ts");
const CODE_TRACKING = sansProse(SOURCE_TRACKING);
const SOURCE_CARTE = lire("../../components/admin/NutritionWeekSummaryCard.tsx");
const CODE_CARTE = sansProse(SOURCE_CARTE);
const SOURCE_PROGRESSION = lire("../../lib/supabase/progress.ts");
const CODE_PROGRESSION = sansProse(SOURCE_PROGRESSION);
const CODE_SECTION = sansProse(lire("../../components/shared/ProgressNutritionSection.tsx"));
const SQL_CONSUMED = lire("../../supabase/migrations/20260901090000_consumed_meals.sql");

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE DE SUPABASE — il applique VRAIMENT `.in()`, `.eq()` et `.limit()`
   ══════════════════════════════════════════════════════════════════════════ */

interface Appel {
  readonly table: string;
  readonly colonnes: string;
  readonly filtres: Record<string, unknown>;
}

/**
 * Reproduit les chaînes que `readConsumedMeals` et `derniereJourneeConsommee`
 * construisent : `from().select().in?().eq?().order?().limit?()`, terminée par
 * un `await`. Les filtres sont APPLIQUÉS sur les lignes — c'est ce qui permet
 * de constater une séparation plutôt que de la supposer.
 */
function fauxSupabase(tables: Record<string, readonly Record<string, unknown>[]>) {
  const appels: Appel[] = [];

  function constructeur(table: string) {
    let lignes = [...(tables[table] ?? [])];
    let colonnes = "";
    const filtres: Record<string, unknown> = {};
    const chaîne = {
      select(liste?: string) {
        colonnes = liste ?? "";
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
      order(colonne: string, options?: { ascending?: boolean }) {
        const croissant = options?.ascending !== false;
        lignes = [...lignes].sort((a, b) => {
          const x = String(a[colonne] ?? "");
          const y = String(b[colonne] ?? "");
          return croissant ? x.localeCompare(y) : y.localeCompare(x);
        });
        filtres[`order:${colonne}`] = croissant ? "asc" : "desc";
        return chaîne;
      },
      limit(n: number) {
        filtres["limit"] = n;
        lignes = lignes.slice(0, n);
        return chaîne;
      },
      then(résoudre: (r: { data: unknown; error: null }) => void) {
        appels.push({ table, colonnes, filtres: { ...filtres } });
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

/* ── Le banc : deux élèves, la même semaine ─────────────────────────────── */

const ELEVE_A = "11111111-1111-4111-8111-111111111111";
const ELEVE_B = "22222222-2222-4222-8222-222222222222";
const SEMAINE = [
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
];

function ligneRepas(
  id: string,
  studentId: string,
  date: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    student_id: studentId,
    consumed_on: date,
    kind: "student",
    prescribed_meal_id: null,
    slot_key: null,
    label: "Déjeuner",
    position: 0,
    target_kcal: null,
    target_protein_g: null,
    target_carb_g: null,
    target_fat_g: null,
    ...extra,
  };
}

function ligneEntree(
  id: string,
  studentId: string,
  repasId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    student_id: studentId,
    consumed_meal_id: repasId,
    source_type: "catalog_food",
    food_id: "food-1",
    product_id: null,
    label: "Riz",
    quantity: 100,
    unit: "g",
    protein_g: 10,
    carb_g: 20,
    fat_g: 5,
    note: null,
    created_at: "2026-09-29T08:00:00.000Z",
    ...extra,
  };
}

/**
 * La « base » :
 *  · A a mangé le 29/09 (un repas avec aliment) et le 01/10 (deux repas) ;
 *  · A a un conteneur OUVERT le 30/09 mais SANS aucun aliment ;
 *  · A a un second conteneur VIDE le 03/10, donc PLUS RÉCENT que son dernier
 *    vrai repas. ⚠️ C'est ce qui donne du mordant à P7-14 : avec un conteneur
 *    vide placé AVANT, retirer le filtre « au moins un aliment » de
 *    `derniereJourneeConsommee` restait invisible. Mesuré.
 *  · B a mangé le 29/09, avec des chiffres volontairement distincts.
 */
const BASE = {
  consumed_meals: [
    ligneRepas("cm-a1", ELEVE_A, "2026-09-29"),
    ligneRepas("cm-a-vide", ELEVE_A, "2026-09-30"),
    ligneRepas("cm-a-vide-tard", ELEVE_A, "2026-10-03"),
    ligneRepas("cm-a2", ELEVE_A, "2026-10-01", { position: 0 }),
    ligneRepas("cm-a3", ELEVE_A, "2026-10-01", { position: 1 }),
    ligneRepas("cm-b1", ELEVE_B, "2026-09-29"),
  ],
  meal_entries: [
    ligneEntree("e-a1", ELEVE_A, "cm-a1"),
    ligneEntree("e-a2", ELEVE_A, "cm-a2"),
    ligneEntree("e-a3", ELEVE_A, "cm-a3", { protein_g: 30, carb_g: 0, fat_g: 0 }),
    ligneEntree("e-b1", ELEVE_B, "cm-b1", { protein_g: 777, carb_g: 0, fat_g: 0 }),
  ],
};

/* ── Fabriques pour les fonctions pures ─────────────────────────────────── */

let compteur = 0;
function entrée(partiel: Partial<ConsumedEntry> = {}): ConsumedEntry {
  compteur += 1;
  return {
    id: `e${compteur}`,
    consumedMealId: "cm-1",
    sourceType: "catalog_food",
    foodId: "food-1",
    productId: null,
    label: "Riz",
    quantity: 100,
    unit: "g",
    proteinG: 10,
    carbG: 20,
    fatG: 5,
    note: "",
    createdAt: "2026-09-29T08:00:00.000Z",
    ...partiel,
  };
}

function repas(
  date: string,
  entrées: readonly ConsumedEntry[],
  partiel: Partial<ConsumedMeal> = {},
): ConsumedMeal {
  compteur += 1;
  return {
    id: `cm${compteur}`,
    studentId: ELEVE_A,
    consumedOn: date,
    kind: "student",
    prescribedMealId: null,
    slotKey: null,
    label: "Déjeuner",
    position: 0,
    target: null,
    entries: entrées,
    ...partiel,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   LES DIX RÈGLES EXIGÉES PAR LE LOT
   ══════════════════════════════════════════════════════════════════════════ */

await test("P6-1. une validation de journée ne reste pas uniquement dans localStorage", async () => {
  // (a) Le hook localStorage est INERTE dès que Supabase est configuré : la
  //     garde est dans le code, et elle protège la lecture ET les écritures.
  assert.ok(
    CODE_TRACKING.includes("isSupabaseConfigured"),
    "useNutritionTracking doit interroger la configuration Supabase",
  );
  assert.match(
    CODE_TRACKING,
    /const supabaseActif = isSupabaseConfigured\(\)/,
    "la garde doit être nommée et lue à chaque rendu",
  );
  /*
   * `validateDay` et `resetWeek` sortent avant toute écriture.
   *
   * ⚠️ LA PRÉSENCE EST VÉRIFIÉE AVANT L'ORDRE, ET CE N'EST PAS DU ZÈLE. Un
   * `indexOf(...) < indexOf(...)` seul rend `true` quand la garde a DISPARU,
   * parce que `-1` est inférieur à tout. Mesuré : retirer la ligne de
   * `validateDay` laissait cette assertion verte.
   */
  function gardeAvantEcriture(corps: string, nom: string): void {
    const garde = corps.indexOf("if (supabaseActif) return;");
    const ecriture = corps.indexOf("writeOverrides");
    assert.ok(garde >= 0, `${nom} doit porter la garde \`if (supabaseActif) return;\``);
    assert.ok(ecriture >= 0, `${nom} doit bien écrire quelque part (contrôle négatif)`);
    assert.ok(garde < ecriture, `${nom} doit sortir AVANT d'écrire dans localStorage`);
  }
  const validate = CODE_TRACKING.slice(CODE_TRACKING.indexOf("const validateDay"));
  gardeAvantEcriture(validate.slice(0, validate.indexOf("const resetWeek")), "validateDay");
  gardeAvantEcriture(CODE_TRACKING.slice(CODE_TRACKING.indexOf("const resetWeek")), "resetWeek");
  // La lecture aussi : le snapshot rend le plan tel quel sous Supabase.
  assert.match(
    CODE_TRACKING,
    /\(\) => \(supabaseActif \? plan\.days : getSnapshot\(plan\)\)/,
    "le snapshot ne doit pas lire localStorage sous Supabase",
  );

  // (b) Et l'état réel EST en base : la même semaine relue depuis Supabase
  //     rend des statuts, sans qu'aucun localStorage n'intervienne.
  const { client } = fauxSupabase(BASE);
  const journal = await lireJournalNutrition(client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  assert.equal(journal.journees.length, 7);
  assert.deepEqual(
    journal.journees.map((j) => j.statut),
    ["non-commence", "en-cours", "non-commence", "en-cours", "non-commence", "non-commence", "non-commence"],
  );
  assert.ok(
    !CODE_JOURNAL.includes("localStorage") && !CODE_STATUT.includes("localStorage"),
    "ni la dérivation ni la couche d'accès ne doivent connaître localStorage",
  );
});

await test("P6-2. après validation, une nouvelle lecture retrouve le même état", async () => {
  // Une seconde lecture, client neuf, même base : octet pour octet le même état.
  const premier = await lireJournalNutrition(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  const second = await lireJournalNutrition(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  assert.deepEqual(second.journees, premier.journees, "la dérivation doit être idempotente");
  assert.deepEqual(second.logs, premier.logs);

  // Et la dérivation pure est stable sur les mêmes repas.
  const duJour = [repas("2026-09-29", [entrée(), entrée()])];
  const a = journeesDuJournal(duJour, ["2026-09-29"]);
  const b = journeesDuJournal(duJour, ["2026-09-29"]);
  assert.deepEqual(b, a);
});

await test("P6-3. le coach lit l'état par la MÊME source que l'élève", async () => {
  const bancEleve = fauxSupabase(BASE);
  const bancCoach = fauxSupabase(BASE);

  // Côté élève : la RLS tranche, aucun identifiant n'est nommé.
  const vuEleve = await lireJournalNutrition(bancEleve.client, SEMAINE, {
    portee: "eleve-connecte",
  });
  // Côté coach : l'élève est NOMMÉ.
  const vuCoach = await lireJournalNutrition(bancCoach.client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });

  // Le coach ne voit QUE A — B et ses 777 g de protéines n'entrent pas.
  assert.deepEqual(
    vuCoach.journees.map((j) => Math.round(j.totaux.proteinG)),
    [0, 10, 0, 40, 0, 0, 0],
  );
  assert.ok(
    !vuCoach.repas.some((r) => r.studentId === ELEVE_B),
    "la lecture coach doit être bornée à l'élève nommé",
  );
  const repasCoach = bancCoach.appels.find((a) => a.table === "consumed_meals");
  assert.equal(repasCoach?.filtres["eq:student_id"], ELEVE_A, "le coach nomme l'élève");
  const repasEleve = bancEleve.appels.find((a) => a.table === "consumed_meals");
  assert.ok(
    !("eq:student_id" in (repasEleve?.filtres ?? {})),
    "le chemin élève ne nomme personne : la RLS tranche",
  );

  // MÊME MODULE : le coach n'a pas sa propre arithmétique. On le prouve en
  // dérivant les repas de A, lus par le chemin élève, avec la même fonction.
  const duCoach = journeesDuJournal(
    vuEleve.repas.filter((r) => r.studentId === ELEVE_A),
    SEMAINE,
  );
  assert.deepEqual(
    duCoach.map((j) => j.statut),
    vuCoach.journees.map((j) => j.statut),
  );
  // Et la carte admin importe bien cette fonction, pas une copie locale.
  assert.ok(
    CODE_CARTE.includes('from "@/lib/nutrition/statut-journee"'),
    "la carte admin doit importer la dérivation partagée",
  );
  assert.ok(
    !/function\s+\w*[Ss]tatut/.test(CODE_CARTE),
    "la carte admin ne doit pas réimplémenter le statut",
  );
});

await test("P6-4. un jour sans repas ne devient JAMAIS « rempli »", () => {
  // Aucun repas du tout.
  assert.equal(statutDeLaJournee({ repasDuJour: [] }), "non-commence");
  // Un conteneur OUVERT mais vide : ouvrir un repas n'est pas manger.
  assert.equal(
    statutDeLaJournee({ repasDuJour: [repas("2026-09-30", [])] }),
    "non-commence",
  );
  // Même avec une prescription attendue, un conteneur vide ne valide rien.
  assert.equal(
    statutDeLaJournee({
      repasDuJour: [repas("2026-09-30", [], { kind: "prescribed", prescribedMealId: "m1" })],
      repasPrescritsDuJour: 1,
    }),
    "non-commence",
  );
  // Et une journée `non-commence` n'émet AUCUN log : pas de `calories: 0`,
  // que les consommateurs liraient comme « 0 kcal mangées ».
  const journees = journeesDuJournal([repas("2026-09-30", [])], ["2026-09-29", "2026-09-30"]);
  assert.deepEqual(logsDepuisJournal(journees), []);
  assert.equal(journees.filter(journeeRemplie).length, 0);

  // Conséquence mesurée sur le calcul hebdomadaire réellement utilisé :
  // zéro jour rempli, donc sept jours restants.
  const ajustement = computeWeeklyNutritionAdjustment(
    { calories: 2000, protein: 150, carbs: 200, fat: 60, weeklyTargetCalories: 14000 },
    logsDepuisJournal(journees),
    ["2026-09-29", "2026-09-30"],
  );
  assert.equal(ajustement.daysFilled, 0);
});

await test("P6-5. un repas consommé reste visible après changement de navigateur", async () => {
  // « Changement de navigateur » = aucun état local ne participe. On le prouve
  // en deux temps : le chemin réel ne touche pas localStorage, et une lecture
  // sur un client neuf (donc sans aucun stockage) rend le même état.
  for (const [nom, code] of [
    ["lib/supabase/nutrition-journal.ts", CODE_JOURNAL],
    ["lib/nutrition/statut-journee.ts", CODE_STATUT],
    ["lib/supabase/progress.ts", CODE_PROGRESSION],
    ["components/admin/NutritionWeekSummaryCard.tsx", CODE_CARTE],
    ["components/shared/ProgressNutritionSection.tsx", CODE_SECTION],
  ] as const) {
    for (const interdit of ["localStorage", "sessionStorage", "seth-nutrition-tracking"]) {
      assert.ok(!code.includes(interdit), `${nom} ne doit pas connaître ${interdit}`);
    }
  }
  const neuf = await lireJournalNutrition(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  assert.equal(neuf.logs.length, 2, "les deux journées réellement mangées reviennent");
  assert.deepEqual(
    neuf.logs.map((l) => l.logDate),
    ["2026-09-29", "2026-10-01"],
  );
});

await test("P6-6. les données A5 ne sont ni écrites ni altérées", () => {
  // Aucune écriture ajoutée : ni dans la dérivation, ni dans la couche d'accès.
  for (const [nom, code] of [
    ["lib/nutrition/statut-journee.ts", CODE_STATUT],
    ["lib/supabase/nutrition-journal.ts", CODE_JOURNAL],
    ["components/admin/NutritionWeekSummaryCard.tsx", CODE_CARTE],
  ] as const) {
    for (const interdit of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      assert.ok(!code.includes(interdit), `${nom} ne doit pas contenir ${interdit}`);
    }
  }
  // La couche d'accès ne fait que `select` sur les deux tables A5.
  for (const table of ["consumed_meals", "meal_entries"]) {
    const index = CODE_JOURNAL.indexOf(`from("${table}")`);
    assert.ok(index > 0, `${table} doit être lue`);
    assert.match(
      CODE_JOURNAL.slice(index, index + 200),
      /\.select\(/,
      `la lecture de ${table} doit être un select`,
    );
  }
  // Et les kcal restent le 4/4/9 du produit, jamais une quatrième formule :
  // la dérivation passe par `totalsForDay`, dont la fonction SQL miroir
  // `consommation_du_jour` applique exactement les mêmes coefficients.
  assert.ok(CODE_STATUT.includes("totalsForDay"), "les totaux viennent de totalsForDay");
  assert.ok(
    !/\*\s*9\b/.test(CODE_STATUT) && !/\*\s*4\b/.test(CODE_STATUT),
    "aucun coefficient énergétique ne doit être réécrit dans la dérivation",
  );
  assert.match(SQL_CONSUMED, /protein_g \* 4 \+ e\.carb_g \* 4 \+ e\.fat_g \* 9/);
  assert.equal(kcalFromMacros(10, 20, 5), 10 * 4 + 20 * 4 + 5 * 9);
});

await test("P7-7. aucun écran ne dépend EXCLUSIVEMENT de nutrition_daily_logs", () => {
  // La carte admin : le consommé et les jours remplis viennent du journal.
  assert.ok(CODE_CARTE.includes("useHistoriqueEleve("), "la carte lit le journal");
  assert.ok(CODE_CARTE.includes("journeesDuJournal("), "la carte dérive les journées");
  assert.ok(
    !/\bcalories\.consumed\b/.test(CODE_CARTE),
    "le consommé ne doit plus venir de l'ajustement nourri par nutrition_daily_logs",
  );
  assert.ok(
    !/adjustment\.daysFilled/.test(CODE_CARTE),
    "les jours remplis ne doivent plus venir de nutrition_daily_logs",
  );
  // L'objectif PRESCRIT, lui, reste là où il a toujours été.
  assert.ok(
    CODE_CARTE.includes("useSupabaseNutritionWeek("),
    "l'objectif hebdomadaire prescrit reste calculé par le hook existant",
  );
  assert.ok(CODE_CARTE.includes("calories.weeklyTarget"), "l'objectif vient du plan");

  // La progression : la source primaire est le journal, l'historique est fusionné.
  assert.ok(CODE_PROGRESSION.includes("lireJournalNutrition("), "la progression lit le journal");
  assert.ok(
    CODE_PROGRESSION.includes("fusionnerJournalEtHistorique("),
    "la progression fusionne le journal et l'historique",
  );
  const indexFusion = CODE_PROGRESSION.indexOf("fusionnerJournalEtHistorique(");
  assert.match(
    CODE_PROGRESSION.slice(indexFusion, indexFusion + 120),
    /journal\.logs,\s*historique/,
    "le journal doit être l'argument PRIMAIRE de la fusion",
  );

  // ⚠️ LA TABLE N'EST NI SUPPRIMÉE NI OUBLIÉE. Elle reste lue, en lecture seule.
  assert.ok(
    CODE_PROGRESSION.includes("getNutritionLogsForDates"),
    "l'historique doit rester lu",
  );
  assert.ok(
    CODE_CARTE.includes("getLatestNutritionLog"),
    "la carte garde l'historique en dernier recours",
  );
  const indexTable = CODE_PROGRESSION.indexOf('from("nutrition_daily_logs")');
  assert.ok(indexTable > 0);
  assert.match(
    CODE_PROGRESSION.slice(indexTable, indexTable + 200),
    /\.select\(/,
    "progress.ts ne fait que LIRE nutrition_daily_logs",
  );

  // La fusion est bien à sens unique : le journal prime à date égale.
  const journal = [
    { logDate: "2026-09-29", calories: 1800, proteinG: 120, carbsG: 180, fatG: 50, note: "" },
  ];
  const historique = [
    { logDate: "2026-09-29", calories: 9999, proteinG: 1, carbsG: 1, fatG: 1, note: "ancien" },
    { logDate: "2026-08-22", calories: 2100, proteinG: 130, carbsG: 190, fatG: 55, note: "août" },
  ];
  const fusion = fusionnerJournalEtHistorique(
    ["2026-08-22", "2026-09-29", "2026-09-30"],
    journal,
    historique,
  );
  assert.deepEqual(
    fusion.map((l) => [l.logDate, l.calories]),
    [
      ["2026-08-22", 2100],
      ["2026-09-29", 1800],
    ],
    "le journal prime ; l'historique survit là où le journal n'a rien ; une date vide n'est pas émise",
  );
});

await test("P7-8. NÉGATIF — Supabase configuré + zéro donnée = état vide, jamais de fixture", async () => {
  const { client, appels } = fauxSupabase({ consumed_meals: [], meal_entries: [] });
  const journal = await lireJournalNutrition(client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  assert.equal(journal.repas.length, 0);
  assert.equal(journal.logs.length, 0, "aucun log inventé");
  assert.equal(journal.journees.length, 7, "les sept jours existent…");
  assert.ok(
    journal.journees.every((j) => j.statut === "non-commence"),
    "…et sont tous `non-commence`",
  );
  assert.ok(
    journal.journees.every((j) => j.totaux.kcal === 0 && j.repasAvecAliments === 0),
    "des totaux à zéro, pas des totaux fabriqués",
  );
  assert.equal(
    await derniereJourneeConsommee(client, { portee: "eleve", studentId: ELEVE_A }),
    null,
    "aucune date inventée",
  );
  // La lecture a bien eu lieu : l'état vide n'est pas un court-circuit muet.
  assert.ok(appels.some((a) => a.table === "consumed_meals"));

  // CONTRÔLE NÉGATIF du contrôle : aucune des deux couches ne connaît les mocks.
  for (const [nom, code] of [
    ["lib/supabase/nutrition-journal.ts", CODE_JOURNAL],
    ["lib/nutrition/statut-journee.ts", CODE_STATUT],
  ] as const) {
    assert.ok(!code.includes("data/student"), `${nom} ne doit pas connaître les fixtures élève`);
    assert.ok(!code.includes("data/admin"), `${nom} ne doit pas connaître les fixtures admin`);
  }
});

await test("P7-9. NÉGATIF — aucune validation fictive pendant le chargement", () => {
  // La carte attend que LES DEUX lectures aient répondu avant de rendre un
  // chiffre. Sans cette garde, « 0 kcal · 0 / 7 » s'affiche une seconde, et
  // c'est exactement le défaut que ce lot corrige.
  const index = CODE_CARTE.indexOf("if (loading");
  assert.ok(index > 0, "la carte doit avoir une garde de chargement");
  const garde = CODE_CARTE.slice(index, index + 200);
  for (const attendu of ["loading", "journal.loading", "!adjustment"]) {
    assert.ok(garde.includes(attendu), `la garde doit couvrir ${attendu}`);
  }
  assert.ok(garde.includes("Loader"), "elle doit rendre un Loader");
  // Et la garde précède TOUT calcul affiché.
  assert.ok(
    index < CODE_CARTE.indexOf("const joursRemplis"),
    "aucun chiffre ne doit être calculé avant la garde",
  );
  assert.ok(
    index < CODE_CARTE.indexOf("const consomme"),
    "aucun total ne doit être calculé avant la garde",
  );
  // Une lecture en échec se DIT, elle ne se présente pas comme une semaine vide.
  assert.ok(CODE_CARTE.includes("journal.error"), "l'erreur de lecture doit être rendue");
});

await test("P7-10. NÉGATIF — les anciens mocks ne sont pas réintroduits", () => {
  // Le hook localStorage garde son chemin de démonstration INTACT — on ne l'a
  // pas vidé, on l'a borné. Les deux doivent rester vrais en même temps.
  assert.ok(CODE_TRACKING.includes("writeOverrides"), "le chemin démonstration existe toujours");
  assert.ok(CODE_TRACKING.includes("useSyncExternalStore"), "l'implémentation est préservée");
  assert.ok(SOURCE_TRACKING.length > 4000, "le fichier n'a pas été dépouillé");
  // Et aucun écran réel ne se branche sur un plan de démonstration.
  for (const [nom, code] of [
    ["components/admin/NutritionWeekSummaryCard.tsx", CODE_CARTE],
    ["lib/supabase/progress.ts", CODE_PROGRESSION],
    ["lib/supabase/nutrition-journal.ts", CODE_JOURNAL],
  ] as const) {
    assert.ok(
      !code.includes("activeNutritionPlan") && !code.includes("nutritionPlans"),
      `${nom} ne doit pas importer les plans de démonstration`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   RENFORCEMENTS — la règle de statut, les totaux, la date la plus récente
   ══════════════════════════════════════════════════════════════════════════ */

await test("P6-11. `valide` exige la prescription, et reste inatteignable sans elle", () => {
  const prescrits = [
    repas("2026-09-29", [entrée()], { kind: "prescribed", prescribedMealId: "m1" }),
    repas("2026-09-29", [entrée()], { kind: "prescribed", prescribedMealId: "m2" }),
  ];
  // Sans le nombre attendu : on ne suppose aucune complétude.
  assert.equal(statutDeLaJournee({ repasDuJour: prescrits }), "en-cours");
  assert.equal(statutDeLaJournee({ repasDuJour: prescrits, repasPrescritsDuJour: null }), "en-cours");
  // Avec le nombre attendu : deux sur deux ⇒ validé.
  assert.equal(
    statutDeLaJournee({ repasDuJour: prescrits, repasPrescritsDuJour: 2 }),
    "valide",
  );
  // Un seul sur trois ⇒ en cours.
  assert.equal(
    statutDeLaJournee({ repasDuJour: prescrits, repasPrescritsDuJour: 3 }),
    "en-cours",
  );
  // Deux conteneurs sur le MÊME repas prescrit ne comptent qu'une fois.
  const doublon = [
    repas("2026-09-29", [entrée()], { kind: "prescribed", prescribedMealId: "m1" }),
    repas("2026-09-29", [entrée()], { kind: "prescribed", prescribedMealId: "m1" }),
  ];
  assert.equal(
    statutDeLaJournee({ repasDuJour: doublon, repasPrescritsDuJour: 2 }),
    "en-cours",
    "deux conteneurs du même repas prescrit ne valident pas deux repas",
  );
  // Un repas LIBRE ne valide pas une prescription.
  assert.equal(
    statutDeLaJournee({
      repasDuJour: [repas("2026-09-29", [entrée()])],
      repasPrescritsDuJour: 1,
    }),
    "en-cours",
  );
  // Et la table par date est bien consultée par `journeesDuJournal`.
  const journees = journeesDuJournal(prescrits, ["2026-09-29"], { "2026-09-29": 2 });
  assert.equal(journees[0].statut, "valide");
  assert.equal(journees[0].repasPrescritsDuJour, 2);
  assert.equal(journees[0].repasPrescritsConsommes, 2);
});

await test("P6-12. les totaux du journal sont ceux des instantanés, arrondis une seule fois", () => {
  const journees = journeesDuJournal(
    [repas("2026-09-29", [entrée({ proteinG: 10.4, carbG: 20.4, fatG: 5.4 })])],
    ["2026-09-29"],
  );
  const attenduKcal = kcalFromMacros(10.4, 20.4, 5.4);
  assert.equal(journees[0].totaux.kcal, attenduKcal, "le total brut n'est pas arrondi");
  const [log] = logsDepuisJournal(journees);
  assert.equal(log.calories, Math.round(attenduKcal), "la projection arrondit, une fois");
  assert.equal(log.proteinG, 10);
  assert.equal(log.carbsG, 20);
  assert.equal(log.fatG, 5);
  assert.equal(log.note, "", "aucune note n'est inventée");
});

await test("P6-13. `dateLaPlusRecente` compare des chaînes, jamais des `Date`", () => {
  assert.equal(dateLaPlusRecente("2026-08-22", "2026-10-04"), "2026-10-04");
  assert.equal(dateLaPlusRecente("2026-10-04", "2026-08-22"), "2026-10-04");
  assert.equal(dateLaPlusRecente(null, "2026-08-22"), "2026-08-22");
  assert.equal(dateLaPlusRecente("2026-08-22", null), "2026-08-22");
  assert.equal(dateLaPlusRecente(null, null), null);
  assert.ok(
    !/new Date\(/.test(CODE_STATUT),
    "la dérivation ne doit construire aucun `Date` : le fuseau n'a rien à faire ici",
  );
});

await test("P7-14. `derniereJourneeConsommee` ignore les conteneurs vides, sans jointure", async () => {
  const { client, appels } = fauxSupabase(BASE);
  /*
   * Le dernier repas RÉELLEMENT mangé par A est le 01/10. Le 03/10 porte un
   * conteneur OUVERT et VIDE, donc plus récent : c'est lui qui rend cette
   * assertion mordante. Sans le filtre « au moins un aliment », la fonction
   * rendrait 2026-10-03, et le coach lirait une journée renseignée qui ne
   * l'est pas.
   */
  assert.equal(
    await derniereJourneeConsommee(client, { portee: "eleve", studentId: ELEVE_A }),
    "2026-10-01",
    "un conteneur vide plus récent ne doit pas devenir la dernière journée",
  );
  // Et le conteneur vide tardif est bien dans le banc (contrôle négatif).
  assert.ok(
    BASE.consumed_meals.some((r) => r.consumed_on === "2026-10-03" && r.student_id === ELEVE_A),
    "le banc doit porter un conteneur vide POSTÉRIEUR au dernier vrai repas",
  );
  assert.ok(
    !BASE.meal_entries.some((e) => e.consumed_meal_id === "cm-a-vide-tard"),
    "…et ce conteneur doit rester sans aucun aliment",
  );
  // Deux requêtes, bornées, NOMMANT l'élève — et aucun embed PostgREST.
  const repasAppel = appels.find((a) => a.table === "consumed_meals");
  assert.equal(repasAppel?.filtres["eq:student_id"], ELEVE_A);
  assert.equal(repasAppel?.filtres["order:consumed_on"], "desc");
  assert.equal(repasAppel?.filtres["limit"], 60, "la lecture est bornée");
  const entréesAppel = appels.find((a) => a.table === "meal_entries");
  assert.ok(Array.isArray(entréesAppel?.filtres["in:consumed_meal_id"]));
  assert.ok(
    !CODE_JOURNAL.includes("!inner") && !CODE_JOURNAL.includes("!left"),
    "aucun embed PostgREST : la clé étrangère de meal_entries est COMPOSITE",
  );

  // Un élève dont tous les conteneurs sont vides n'a aucune dernière journée.
  const vide = fauxSupabase({
    consumed_meals: [ligneRepas("cm-x", ELEVE_A, "2026-10-02")],
    meal_entries: [],
  });
  assert.equal(
    await derniereJourneeConsommee(vide.client, { portee: "eleve", studentId: ELEVE_A }),
    null,
  );
});

await test("P7-15. le journal nourrit le calcul hebdomadaire EXISTANT, sans le modifier", async () => {
  const journal = await lireJournalNutrition(fauxSupabase(BASE).client, SEMAINE, {
    portee: "eleve",
    studentId: ELEVE_A,
  });
  const ajustement = computeWeeklyNutritionAdjustment(
    { calories: 2000, protein: 150, carbs: 200, fat: 60, weeklyTargetCalories: 14000 },
    journal.logs,
    SEMAINE,
  );
  // Deux journées mangées (29/09 et 01/10) ⇒ deux jours remplis, cinq restants.
  assert.equal(ajustement.daysFilled, 2);
  assert.equal(ajustement.daysRemaining, 5);
  // Le consommé est la somme des deux journées, pas une moyenne.
  const attendu = Math.round(kcalFromMacros(10, 20, 5)) + Math.round(kcalFromMacros(40, 20, 5));
  assert.equal(ajustement.calories.consumed, attendu);
  // Le 30/09 (conteneur vide) n'est pas rempli.
  assert.equal(ajustement.days[2].filled, false);
  assert.equal(ajustement.days[1].filled, true);
});
