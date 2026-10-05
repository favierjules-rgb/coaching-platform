/**
 * Harnais — P8 : LE PROFIL ÉLÈVE LIT LA MÊME SOURCE QUE LE COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Trois niveaux, et chacun prouve une chose que les autres ne peuvent pas :
 *
 * 1. `vuesProfilOnboarding` est EXÉCUTÉE sur des fiches fabriquées : la règle
 *    « on ne lit que les colonnes vivantes » et « on ne fabrique aucun champ
 *    absent du schéma » sont observées, pas lues dans le code.
 * 2. Le CROISEMENT des deux sources : les champs de `SupabaseStudentProfile`
 *    que lit le module élève sont comparés à ceux que lit la page coach. C'est
 *    la seule façon de prouver « même source » sans monter les deux écrans.
 * 3. Les règles d'ARCHITECTURE — « aucune fixture n'atteint le rendu réel »,
 *    « rien n'est rendu pendant le chargement », « aucune écriture ajoutée »,
 *    « aucune souscription temps réel » — sont vérifiées sur le texte des
 *    fichiers : une absence ne s'observe pas à l'exécution.
 *
 * ⚠️ CE QUE CE HARNAIS NE PROUVE PAS. Il ne monte pas `/profil` dans un
 * navigateur : `scripts/tests/profil-push-render.mts` le fait déjà, avec un
 * vrai Chromium, et vérifie que le prénom de démonstration n'apparaît jamais.
 * Les deux sont nécessaires.
 *
 * Lancement : npm run test:profil-eleve-sync
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VUES_PROFIL_VIDES,
  vuesProfilOnboarding,
  type VuesProfilOnboarding,
} from "../../lib/profil-eleve-onboarding";
import type { SupabaseStudentProfile } from "../../types";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_VUES = lire("../../lib/profil-eleve-onboarding.ts");
const CODE_VUES = sansProse(SOURCE_VUES);
const SOURCE_CONTENU = lire("../../components/student/ProfilPageContent.tsx");
const CODE_CONTENU = sansProse(SOURCE_CONTENU);
const SOURCE_PAGE = lire("../../app/(student)/profil/page.tsx");
const CODE_PAGE = sansProse(SOURCE_PAGE);
const SOURCE_HOOK = lire("../../hooks/useSupabaseStudentProfile.ts");
const CODE_HOOK = sansProse(SOURCE_HOOK);
const CODE_COACH = sansProse(lire("../../app/admin/eleves/[studentId]/page.tsx"));
const SOURCE_ECRITURE = lire("../../lib/supabase/onboarding.ts");

/* ══════════════════════════════════════════════════════════════════════════
   LE BANC — une fiche PLEINE, une fiche VIDE, et l'absence de fiche
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Une fiche `student_profiles` complète.
 *
 * ⚠️ LES TROIS JSONB MORTS SONT REMPLIS ICI, ET C'EST LE PIÈGE TENDU AU CODE.
 * `sportPreferences` et `injuryNote` portent des valeurs reconnaissables : si
 * une vue les lisait, elles apparaîtraient dans le résultat. En production
 * elles sont vides sur 32/32, donc un test qui les laisserait vides ne
 * prouverait rien.
 */
const PIEGE_SPORT = "PIEGE-SPORT-PREFERENCES-JSONB";
const PIEGE_BLESSURE = "PIEGE-INJURY-NOTE-JSONB";
const PIEGE_FOOD = "PIEGE-FOOD-PREFERENCES-CLE-MORTE";

function fiche(partiel: Partial<SupabaseStudentProfile> = {}): SupabaseStudentProfile {
  return {
    id: "pp-1",
    studentId: "11111111-1111-4111-8111-111111111111",
    age: 29,
    heightCm: 171,
    currentWeightKg: 63.4,
    startWeightKg: 66,
    targetWeightKg: 61,
    goal: "Prise de force",
    level: "Intermédiaire",
    trainingFrequencyPerWeek: 4,
    trainingLocation: "Salle",
    // ⚠️ `liked` est la SEULE clé vivante ; les trois autres sont des pièges.
    foodPreferences: {
      liked: ["Poulet", "Riz"],
      disliked: [PIEGE_FOOD],
      intolerances: [PIEGE_FOOD],
      diet: PIEGE_FOOD,
    },
    sportPreferences: {
      sports: [PIEGE_SPORT],
      equipment: [PIEGE_SPORT],
      preferredExercises: [PIEGE_SPORT],
      exercisesToAvoid: [PIEGE_SPORT],
    },
    injuryNote: PIEGE_BLESSURE,
    mainGoal: "Prendre de la force",
    secondaryGoals: ["Mieux dormir"],
    targetDate: "2026-12-01",
    priority: null,
    trackedIndicators: [],
    onboardingCompleted: true,
    onboardingCompletedAt: "2026-07-30T10:00:00.000Z",
    targetTimeframe: "6 mois",
    activityLevel: "Modéré",
    neatLevel: "Actif",
    sportsPracticed: ["Musculation", "Course"],
    otherActivities: ["Vélo"],
    availableEquipment: ["Haltères", "Barre"],
    favoriteExercises: ["Tractions"],
    favoriteGymExercises: ["Développé couché"],
    avoidedExercises: ["Squat lourd"],
    onboardingInjuries: "Épaule droite sensible",
    trainingNotes: "Préfère le matin",
    medicalTreatments: "Aucun",
    medications: "Aucun",
    healthNotes: "Rien à signaler",
    hydrationLevel: "Bonne",
    dailyWaterIntake: "2 L",
    sleepDuration: "7 h",
    sleepQuality: "Bonne",
    recoveryNotes: "",
    lifestyleNotes: "",
    motivationSource: "",
    recentLifeEvents: "",
    mentalWellbeingGoal: "",
    emotionalWellbeingNotes: "",
    dislikedFoods: ["Brocoli"],
    allergies: ["Arachide"],
    intolerances: ["Lactose"],
    dietType: "Omnivore",
    preferredMealCount: 4,
    mealTimingNotes: "12h / 19h",
    hungerNotes: "",
    snackingNotes: "",
    workScheduleNotes: "Horaires décalés",
    nutritionNotes: "Aime cuisiner",
    billingAccessMode: "manual_allowed",
    assignedStripePlan: null,
    assignedStripePriceId: null,
    accessNote: "",
    accessUpdatedAt: null,
    accessUpdatedBy: null,
    assignedSubscriptionTemplateId: null,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
    ...partiel,
  };
}

/** Une fiche EXISTANTE mais entièrement non renseignée. */
function ficheVide(): SupabaseStudentProfile {
  return fiche({
    foodPreferences: { liked: [], disliked: [], intolerances: [], diet: "" },
    sportPreferences: { sports: [], equipment: [], preferredExercises: [], exercisesToAvoid: [] },
    injuryNote: "",
    mainGoal: "",
    secondaryGoals: [],
    targetDate: null,
    targetTimeframe: "",
    trackedIndicators: [],
    neatLevel: "",
    sportsPracticed: [],
    otherActivities: [],
    availableEquipment: [],
    favoriteExercises: [],
    favoriteGymExercises: [],
    avoidedExercises: [],
    onboardingInjuries: "",
    trainingNotes: "",
    medicalTreatments: "",
    medications: "",
    healthNotes: "",
    dislikedFoods: [],
    allergies: [],
    intolerances: [],
    dietType: "",
    preferredMealCount: null,
    mealTimingNotes: "",
    workScheduleNotes: "",
    nutritionNotes: "",
    trainingLocation: "",
    trainingFrequencyPerWeek: null,
  });
}

/** Toutes les chaînes d'une vue, à plat — pour chercher un piège. */
function toutesLesValeurs(vues: VuesProfilOnboarding): string[] {
  const plat: string[] = [];
  for (const bloc of [vues.alimentaire, vues.sportive, vues.blessures, vues.objectifs]) {
    for (const valeur of Object.values(bloc as unknown as Record<string, unknown>)) {
      if (typeof valeur === "string") plat.push(valeur);
      else if (Array.isArray(valeur)) plat.push(...valeur.filter((v): v is string => typeof v === "string"));
    }
  }
  return plat;
}

/** Les champs de `SupabaseStudentProfile` lus par un source donné. */
function champsLus(code: string, receveur: string): Set<string> {
  const champs = new Set<string>();
  const motif = new RegExp(`\\b${receveur}(?:\\?)?\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
  for (const trouve of code.matchAll(motif)) champs.add(trouve[1]);
  return champs;
}

/* ══════════════════════════════════════════════════════════════════════════
   LES DOUZE CONTRÔLES EXIGÉS
   ══════════════════════════════════════════════════════════════════════════ */

await test("P8-1. aucune fixture n'atteint le rendu Supabase", () => {
  // (a) La page ne passe plus quatre props anonymes : un objet NOMMÉ.
  assert.ok(
    CODE_PAGE.includes("demonstration={{"),
    "les fixtures doivent voyager sous un objet `demonstration`",
  );
  for (const anonyme of [
    "foodPreferences={foodPreferences}",
    "sportPreferences={sportPreferences}",
    "injuryNote={injuryNote}",
    "studentGoal={studentGoal}",
  ]) {
    assert.ok(!CODE_PAGE.includes(anonyme), `la prop anonyme « ${anonyme} » ne doit plus exister`);
  }

  /*
   * (b) Dans le composant, les fixtures ne sont lues QUE via `demonstration.`.
   *
   * ⚠️ LA DÉCLARATION DU TYPE EST RETIRÉE AVANT LE CONTRÔLE, et c'est tout
   * l'intérêt : `interface ProfilDemonstration { foodPreferences: … }` nomme
   * légitimement les quatre champs. Ce qui est interdit, c'est de les LIRE
   * autrement qu'à travers l'objet — un `const { foodPreferences } =
   * demonstration` serait signalé, alors qu'une fenêtre de contexte autour de
   * l'occurrence le laissait passer.
   */
  const debutInterface = CODE_CONTENU.indexOf("export interface ProfilDemonstration");
  assert.ok(debutInterface > 0, "le type nommé des fixtures doit exister");
  const finInterface = CODE_CONTENU.indexOf("}", debutInterface) + 1;
  const corpsSansType = CODE_CONTENU.slice(0, debutInterface) + CODE_CONTENU.slice(finInterface);

  for (const champ of ["foodPreferences", "sportPreferences", "injuryNote", "studentGoal"]) {
    const motif = new RegExp(`\\b${champ}\\b`, "g");
    const occurrences = [...corpsSansType.matchAll(motif)];
    assert.ok(occurrences.length > 0, `contrôle négatif : ${champ} doit bien être rendu quelque part`);
    for (const trouve of occurrences) {
      const prefixe = corpsSansType.slice(Math.max(0, trouve.index - 14), trouve.index);
      assert.equal(
        prefixe,
        "demonstration.",
        `« ${champ} » doit être lu via \`demonstration.\`, trouvé après ${JSON.stringify(prefixe)}`,
      );
    }
  }

  // (c) Et la branche Supabase ne nomme AUCUNE fixture.
  const indexTernaire = CODE_CONTENU.indexOf("{useSupabase ? (");
  assert.ok(indexTernaire > 0, "le rendu des quatre blocs doit être un ternaire sur `useSupabase`");
  const brancheSupabase = CODE_CONTENU.slice(indexTernaire, CODE_CONTENU.indexOf(") : ("));
  assert.ok(brancheSupabase.length > 500, "contrôle négatif : la branche Supabase n'est pas vide");
  assert.ok(
    !brancheSupabase.includes("demonstration"),
    "la branche Supabase ne doit jamais lire une fixture",
  );
  assert.ok(
    !brancheSupabase.includes("InjurySection") && !brancheSupabase.includes("GoalsSection"),
    "les composants de démonstration n'ont rien à faire dans la branche Supabase",
  );
});

await test("P8-2. les quatre sections existent dans LES DEUX branches", () => {
  const indexTernaire = CODE_CONTENU.indexOf("{useSupabase ? (");
  const separateur = CODE_CONTENU.indexOf(") : (", indexTernaire);
  const brancheSupabase = CODE_CONTENU.slice(indexTernaire, separateur);
  const brancheDemo = CODE_CONTENU.slice(separateur);

  const titres = [
    'title="Préférences alimentaires"',
    'title="Préférences sportives"',
  ];
  for (const titre of titres) {
    assert.ok(brancheSupabase.includes(titre), `branche Supabase : ${titre} manquant`);
    assert.ok(brancheDemo.includes(titre), `branche démonstration : ${titre} manquant`);
  }
  // Blessures et Objectifs : composant dédié côté démonstration, section
  // explicite côté Supabase — les deux titres doivent exister des deux côtés.
  assert.ok(brancheSupabase.includes('title="Blessures et contraintes"'));
  assert.ok(brancheSupabase.includes('title="Objectifs"'));
  assert.ok(brancheDemo.includes("<InjurySection"), "la démonstration garde InjurySection");
  assert.ok(brancheDemo.includes("<GoalsSection"), "la démonstration garde GoalsSection");
});

await test("P8-3. élève et coach lisent les MÊMES champs Supabase", () => {
  const champsEleve = champsLus(CODE_VUES, "profile");
  const champsCoach = champsLus(CODE_COACH, "onboardingProfile");

  assert.ok(champsEleve.size >= 15, `contrôle négatif : ${champsEleve.size} champs lus côté élève`);
  assert.ok(champsCoach.size >= 15, `contrôle négatif : ${champsCoach.size} champs lus côté coach`);

  // Les champs de contenu que les deux écrans doivent partager.
  const partages = [
    "dislikedFoods",
    "allergies",
    "intolerances",
    "dietType",
    "preferredMealCount",
    "mealTimingNotes",
    "workScheduleNotes",
    "nutritionNotes",
    "sportsPracticed",
    "availableEquipment",
    "avoidedExercises",
    "onboardingInjuries",
    "healthNotes",
    "medicalTreatments",
    "medications",
    "trainingNotes",
    "mainGoal",
    "secondaryGoals",
    "targetDate",
    "targetTimeframe",
    "trackedIndicators",
  ];
  for (const champ of partages) {
    assert.ok(champsEleve.has(champ), `l'élève doit lire ${champ}`);
    assert.ok(champsCoach.has(champ), `le coach lit déjà ${champ} — contrôle de la référence`);
  }
  // `foodPreferences` : la seule clé vivante du JSONB, lue des deux côtés.
  assert.ok(champsEleve.has("foodPreferences") && champsCoach.has("foodPreferences"));
  assert.match(CODE_VUES, /profile\.foodPreferences\?\.liked/, "seule la clé `liked` est lue");

  // Le composant importe bien le module partagé, pas une copie locale.
  assert.ok(
    CODE_CONTENU.includes('from "@/lib/profil-eleve-onboarding"'),
    "ProfilPageContent doit importer la dérivation partagée",
  );
  assert.ok(
    !/function\s+\w*[Vv]ue[A-Z]/.test(CODE_CONTENU),
    "ProfilPageContent ne doit pas réimplémenter les vues",
  );
});

await test("P8-4. aucun champ absent du schéma n'est fabriqué", () => {
  const vues = vuesProfilOnboarding(fiche());
  const cles = new Set<string>();
  for (const bloc of [vues.alimentaire, vues.sportive, vues.blessures, vues.objectifs]) {
    for (const cle of Object.keys(bloc as unknown as Record<string, unknown>)) cles.add(cle);
  }
  for (const interdit of ["pastInjuries", "recurringPain", "movementsToAvoid", "coachRemarks", "priority"]) {
    assert.ok(!cles.has(interdit), `« ${interdit} » n'a aucune colonne : il ne doit pas être produit`);
    assert.ok(
      !CODE_VUES.includes(interdit),
      `le module ne doit même pas nommer « ${interdit} »`,
    );
    assert.ok(
      !CODE_CONTENU.includes(`vues.objectifs.${interdit}`) &&
        !CODE_CONTENU.includes(`vues.blessures.${interdit}`),
      `la branche Supabase ne doit pas lire « ${interdit} »`,
    );
  }
  // Contrôle négatif : les champs qui EXISTENT, eux, sont bien produits.
  assert.ok(cles.has("douleursEtBlessures") && cles.has("objectifPrincipal"));
});

await test("P8-5. aucun JSONB mort n'est lu", () => {
  const vues = vuesProfilOnboarding(fiche());
  const valeurs = toutesLesValeurs(vues);
  for (const piege of [PIEGE_SPORT, PIEGE_BLESSURE, PIEGE_FOOD]) {
    assert.ok(
      !valeurs.includes(piege),
      `une colonne morte a été lue : « ${piege} » est apparu dans les vues`,
    );
  }
  // Et la règle est aussi dans le code : ni `sportPreferences` ni `injuryNote`.
  const champsEleve = champsLus(CODE_VUES, "profile");
  assert.ok(!champsEleve.has("sportPreferences"), "`sport_preferences` est vide sur 32/32");
  assert.ok(!champsEleve.has("injuryNote"), "`injury_note` est vide sur 32/32");
  // Les clés mortes du JSONB alimentaire ne sont pas lues non plus.
  for (const morte of ["foodPreferences.disliked", "foodPreferences.intolerances", "foodPreferences.diet"]) {
    assert.ok(!CODE_VUES.includes(morte), `${morte} est absente de 32/32 profils`);
  }
  // Contrôle négatif : les pièges sont BIEN dans la fiche d'entrée.
  const entree = fiche();
  assert.equal(entree.injuryNote, PIEGE_BLESSURE);
  assert.ok(entree.sportPreferences.sports.includes(PIEGE_SPORT));
  assert.ok(entree.foodPreferences.disliked.includes(PIEGE_FOOD));
  // …et la vraie clé vivante, elle, est bien remontée.
  assert.deepEqual([...vues.alimentaire.alimentsAimes], ["Poulet", "Riz"]);
});

await test("P8-6. aucune écriture n'est ajoutée", () => {
  for (const [nom, code] of [
    ["lib/profil-eleve-onboarding.ts", CODE_VUES],
    ["components/student/ProfilPageContent.tsx", CODE_CONTENU],
  ] as const) {
    for (const interdit of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "from(\""]) {
      assert.ok(!code.includes(interdit), `${nom} ne doit pas contenir ${interdit}`);
    }
  }
  // Le module de vues ne connaît ni React, ni Supabase, ni réseau.
  for (const interdit of ["react", "@supabase", "createSupabaseBrowserClient", "fetch("]) {
    assert.ok(!CODE_VUES.includes(interdit), `le module doit rester une feuille : ${interdit}`);
  }
  // Le hook n'ajoute qu'une LECTURE.
  assert.ok(
    CODE_HOOK.includes("getStudentOnboardingDetails("),
    "le hook doit lire la fiche onboarding",
  );
  const indexLecture = CODE_HOOK.indexOf("getStudentOnboardingDetails(");
  assert.ok(
    !/\.(insert|upsert)\(/.test(CODE_HOOK.slice(indexLecture, indexLecture + 400)),
    "aucune écriture autour de la nouvelle lecture",
  );
});

await test("P8-7. profil Supabase vide ≠ fixture", () => {
  // Fiche ABSENTE : tout est vide, et la fiche est déclarée indisponible.
  const absente = vuesProfilOnboarding(null);
  assert.deepEqual(absente, VUES_PROFIL_VIDES);
  assert.equal(absente.ficheDisponible, false);
  assert.deepEqual(toutesLesValeurs(absente).filter((v) => v !== ""), []);
  assert.equal(vuesProfilOnboarding(undefined).ficheDisponible, false);

  // Fiche PRÉSENTE mais non renseignée : disponible, et pourtant tout vide.
  const vide = vuesProfilOnboarding(ficheVide());
  assert.equal(vide.ficheDisponible, true, "la fiche existe : on ne doit pas dire le contraire");
  assert.deepEqual(toutesLesValeurs(vide).filter((v) => v !== ""), []);
  // ⚠️ JAMAIS « 0 » : une colonne entière non renseignée vaut 0 dans ce projet.
  assert.equal(vide.alimentaire.repasParJour, "");
  assert.equal(vide.sportive.seancesParSemaine, "");
  assert.equal(vuesProfilOnboarding(fiche({ preferredMealCount: 0 })).alimentaire.repasParJour, "");
  assert.equal(
    vuesProfilOnboarding(fiche({ trainingFrequencyPerWeek: 0 })).sportive.seancesParSemaine,
    "",
  );

  // L'écran DIT qu'il n'a pas la fiche, au lieu d'afficher huit tirets muets.
  assert.ok(
    CODE_CONTENU.includes("!vues.ficheDisponible"),
    "l'absence de fiche doit être rendue explicitement",
  );
  // Et il ne retombe jamais sur la démonstration pour autant.
  const indexMention = CODE_CONTENU.indexOf("!vues.ficheDisponible");
  assert.ok(
    !CODE_CONTENU.slice(indexMention, indexMention + 600).includes("demonstration"),
    "une fiche absente ne doit pas faire apparaître une fixture",
  );
});

await test("P8-8. rien n'est affiché pendant le chargement", () => {
  const garde = "if (!supabaseProfile.ready) {";
  const indexGarde = CODE_CONTENU.indexOf(garde);
  assert.ok(indexGarde > 0, "la garde de chargement doit exister");
  assert.ok(
    CODE_CONTENU.slice(indexGarde, indexGarde + 200).includes("Loader"),
    "elle doit rendre un Loader",
  );
  // La garde précède TOUT rendu des quatre blocs.
  const indexBlocs = CODE_CONTENU.indexOf("{useSupabase ? (");
  assert.ok(indexGarde < indexBlocs, "aucun bloc ne doit être rendu avant la garde");
  assert.ok(
    indexGarde < CODE_CONTENU.indexOf('title="Préférences alimentaires"'),
    "aucune section ne doit être rendue avant la garde",
  );
  // Et `ready` n'est pas contourné par une valeur par défaut optimiste.
  assert.match(CODE_HOOK, /useState\(false\)/, "`ready` doit démarrer à false");
  assert.ok(
    CODE_HOOK.indexOf("const [ready, setReady] = useState(false)") >= 0,
    "contrôle négatif : c'est bien `ready` qui démarre à false",
  );
});

await test("P8-9. le parcours démonstration est INCHANGÉ", () => {
  const separateur = CODE_CONTENU.indexOf(") : (");
  const brancheDemo = CODE_CONTENU.slice(separateur);
  // Les huit champs de la fixture alimentaire, les huit de la sportive.
  for (const champ of [
    "demonstration.foodPreferences.liked",
    "demonstration.foodPreferences.disliked",
    "demonstration.foodPreferences.intolerances",
    "demonstration.foodPreferences.allergies",
    "demonstration.foodPreferences.diet",
    "demonstration.foodPreferences.mealsPerDay",
    "demonstration.foodPreferences.mealTimes",
    "demonstration.foodPreferences.socialConstraints",
    "demonstration.sportPreferences.mainGoal",
    "demonstration.sportPreferences.sports",
    "demonstration.sportPreferences.equipment",
    "demonstration.sportPreferences.location",
    "demonstration.sportPreferences.sessionsPerWeek",
    "demonstration.sportPreferences.preferredExercises",
    "demonstration.sportPreferences.exercisesToAvoid",
    "demonstration.sportPreferences.weeklyAvailability",
    "demonstration.injuryNote",
    "demonstration.studentGoal",
  ]) {
    assert.ok(brancheDemo.includes(champ), `la démonstration doit toujours rendre ${champ}`);
  }
  // Les fixtures existent toujours, et la page les importe toujours.
  assert.ok(CODE_PAGE.includes('from "@/data/student"'));
  for (const fixture of ["foodPreferences", "sportPreferences", "injuryNote", "studentGoal"]) {
    assert.ok(CODE_PAGE.includes(fixture), `la fixture ${fixture} ne doit pas être supprimée`);
  }
  assert.ok(SOURCE_CONTENU.length > 8000, "contrôle négatif : le composant n'a pas été dépouillé");
});

await test("P8-10. `priority = null` ne produit jamais `undefined`", () => {
  // La base : 0/32 profils ont une priorité. On éprouve les trois formes.
  for (const p of [null, "haute", undefined as unknown as null]) {
    const vues = vuesProfilOnboarding(fiche({ priority: p as never }));
    const valeurs = toutesLesValeurs(vues);
    assert.ok(
      valeurs.every((v) => typeof v === "string"),
      "aucune valeur non textuelle ne doit sortir des vues",
    );
    assert.ok(!valeurs.includes("undefined"), "« undefined » ne doit jamais être rendu");
    assert.ok(!("priority" in (vues.objectifs as unknown as Record<string, unknown>)));
  }
  // Et aucune table de libellés n'est indexée par une priorité côté Supabase.
  const indexTernaire = CODE_CONTENU.indexOf("{useSupabase ? (");
  const brancheSupabase = CODE_CONTENU.slice(indexTernaire, CODE_CONTENU.indexOf(") : ("));
  assert.ok(!brancheSupabase.includes("priorityLabels"));
  assert.ok(!brancheSupabase.includes("Priorité"));
});

await test("P8-11. `food_preferences` reste inchangé", () => {
  // Le chemin d'écriture n'a pas été touché par ce lot : il écrit toujours la
  // seule clé `liked`, et c'est volontairement HORS PÉRIMÈTRE.
  assert.ok(
    SOURCE_ECRITURE.includes("update.food_preferences = { liked: partial.likedFoods };"),
    "lib/supabase/onboarding.ts ne doit pas avoir été modifié par ce lot",
  );
  // Et rien de ce lot n'écrit cette colonne.
  for (const [nom, code] of [
    ["lib/profil-eleve-onboarding.ts", CODE_VUES],
    ["components/student/ProfilPageContent.tsx", CODE_CONTENU],
    ["hooks/useSupabaseStudentProfile.ts", CODE_HOOK],
  ] as const) {
    assert.ok(!code.includes("food_preferences"), `${nom} ne doit pas nommer la colonne`);
  }
});

await test("P8-12. aucune souscription temps réel n'est ajoutée", () => {
  // `students` et `student_profiles` ne sont PAS dans la publication
  // `supabase_realtime` (seules `programs` et `workout_sessions` y sont) :
  // s'y abonner donnerait l'illusion du direct sans jamais se déclencher.
  for (const [nom, code] of [
    ["hooks/useSupabaseStudentProfile.ts", CODE_HOOK],
    ["components/student/ProfilPageContent.tsx", CODE_CONTENU],
    ["lib/profil-eleve-onboarding.ts", CODE_VUES],
  ] as const) {
    for (const interdit of ["postgres_changes", ".channel(", "removeChannel", "subscribe("]) {
      assert.ok(!code.includes(interdit), `${nom} ne doit pas contenir ${interdit}`);
    }
  }
  // La synchronisation est au prochain chargement : le hook expose `refetch`.
  assert.ok(CODE_HOOK.includes("refetch"), "la mise à jour reste explicite");
});

/* ══════════════════════════════════════════════════════════════════════════
   RENFORCEMENTS — la dérivation elle-même
   ══════════════════════════════════════════════════════════════════════════ */

await test("P8-13. une fiche pleine remonte exactement ce que la base contient", () => {
  const v = vuesProfilOnboarding(fiche());
  assert.equal(v.ficheDisponible, true);
  assert.deepEqual([...v.alimentaire.alimentsEvites], ["Brocoli"]);
  assert.deepEqual([...v.alimentaire.allergies], ["Arachide"]);
  assert.deepEqual([...v.alimentaire.intolerances], ["Lactose"]);
  assert.equal(v.alimentaire.regime, "Omnivore");
  assert.equal(v.alimentaire.repasParJour, "4");
  assert.deepEqual([...v.sportive.sportsPratiques], ["Musculation", "Course"]);
  assert.deepEqual([...v.sportive.materielDisponible], ["Haltères", "Barre"]);
  assert.equal(v.sportive.seancesParSemaine, "4x / semaine");
  assert.equal(v.sportive.lieuDEntrainement, "Salle");
  assert.equal(v.blessures.douleursEtBlessures, "Épaule droite sensible");
  assert.deepEqual([...v.blessures.exercicesAEviter], ["Squat lourd"]);
  assert.equal(v.objectifs.objectifPrincipal, "Prendre de la force");
  assert.deepEqual([...v.objectifs.objectifsSecondaires], ["Mieux dormir"]);
  assert.equal(v.objectifs.dateCible, "2026-12-01");
  assert.equal(v.objectifs.delaiSouhaite, "6 mois");
});

await test("P8-14. la dérivation est défensive, sans jamais inventer", () => {
  // Valeurs non conformes au type (données héritées, JSON libre) : écartées.
  const sale = fiche({
    sportsPracticed: ["Course", "", "   ", 42 as unknown as string],
    secondaryGoals: null as unknown as string[],
    dietType: "   ",
    onboardingInjuries: null as unknown as string,
    preferredMealCount: Number.NaN,
  });
  const v = vuesProfilOnboarding(sale);
  assert.deepEqual([...v.sportive.sportsPratiques], ["Course"], "vides et non-chaînes écartés");
  assert.deepEqual([...v.objectifs.objectifsSecondaires], []);
  assert.equal(v.alimentaire.regime, "", "une chaîne d'espaces n'est pas une réponse");
  assert.equal(v.blessures.douleursEtBlessures, "");
  assert.equal(v.alimentaire.repasParJour, "", "NaN n'est pas un nombre de repas");
  // Idempotence : deux appels, même résultat.
  assert.deepEqual(vuesProfilOnboarding(fiche()), vuesProfilOnboarding(fiche()));
});
