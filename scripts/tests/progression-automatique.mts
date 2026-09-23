/**
 * Harnais — feat/progression-automatique-lot-a.
 *
 * Progressive overload automatique : référence = EXERCICE IDENTIQUE + MÊME
 * OCCURRENCE PROGRAMMÉE (semaine, jour) + SEMAINE PRÉCÉDENTE — jamais « la
 * performance la plus proche chronologiquement ». Progression calculée sur la
 * MOYENNE des séries enregistrées, arrondie commercialement, jamais une
 * demi-répétition.
 *
 * Périmètre : lot A (logique pure). Les indicateurs visuels (lot B), le
 * bouton ON/OFF persisté (lot C) et la détection de stagnation (lot D) ne
 * sont PAS couverts ici — les cas 15 et 16 du cahier des charges portent sur
 * la stagnation et attendent le lot D.
 *
 * Lancement : npx tsx scripts/tests/progression-automatique.mts
 */
import assert from "node:assert/strict";

import {
  cleOccurrence,
  memeOccurrence,
  normaliserJour,
  occurrenceDuRetour,
  occurrencePrecedente,
  type OccurrenceProgrammee,
} from "../../lib/occurrence-programmee";
import {
  arrondirReps,
  chargeDeReference,
  lirePlageReps,
  moyenneRepsRealisees,
  referenceDeProgression,
  type SerieRealisee,
} from "../../lib/reference-progression";
import {
  BAISSE_KG,
  PLANCHER_KG,
  conseilPremiereSerie,
  incrementDeMontee,
  normaliserChargeKg,
  recommanderProchaineCible,
} from "../../lib/progression-automatique";
import {
  buildPreviousPerformanceIndex,
  findPreviousPerformance,
  type PreviousExercisePerf,
} from "../../lib/previous-performance";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import type { AdminStudentFeedback, MuscleGroup } from "../../types";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

/* ─── Fabriques de données ─── */

const ELEVE_A = "11111111-1111-4111-8111-111111111111";
const AUJOURDHUI = "2026-08-31";
const LIB_DC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface EntréeBrève {
  exerciseName: string;
  setNumber: number;
  loadUsed?: string;
  repsDone?: string;
}

/**
 * Un retour de séance PORTANT SON OCCURRENCE — c'est tout l'objet du lot A.
 * `day` et `weekNumber` sont posés dans le `prescribed_snapshot`, exactement
 * là où la production les écrit à la soumission.
 */
function retour(options: {
  id: string;
  weekNumber: number | null;
  day: string | null;
  performedAt: string;
  entrées: EntréeBrève[];
  /** Identités de banque, par nom d'exercice — pour le repli par nom, omettre. */
  banque?: Record<string, string>;
  studentId?: string;
  completed?: boolean;
  avecSnapshot?: boolean;
}): AdminStudentFeedback {
  const sessionId = `session-${options.id}`;
  const noms = [...new Set(options.entrées.map((e) => e.exerciseName))];
  return {
    id: options.id,
    studentId: options.studentId ?? ELEVE_A,
    type: "entrainement",
    sessionId,
    programId: null,
    refLabel: `Séance ${options.id}`,
    date: options.performedAt,
    completed: options.completed ?? true,
    rpe: null,
    pain: "",
    comment: "",
    exerciseEntries: options.entrées.map((e) => ({
      exerciseName: e.exerciseName,
      setNumber: e.setNumber,
      loadUsed: e.loadUsed ?? "",
      repsDone: e.repsDone ?? "",
      rpe: null,
      exerciseRpe: null,
      comment: "",
    })),
    status: "a-traiter",
    coachReply: "",
    createdAt: `${options.performedAt}T10:00:00Z`,
    updatedAt: `${options.performedAt}T10:00:00Z`,
    performedAt: options.performedAt,
    prescribedSnapshot:
      options.avecSnapshot === false
        ? undefined
        : {
            version: PRESCRIBED_SNAPSHOT_VERSION,
            sessionId,
            sessionName: `Séance ${options.id}`,
            day: options.day,
            weekNumber: options.weekNumber,
            capturedAt: `${options.performedAt}T10:00:00Z`,
            blocks: [
              {
                title: null,
                category: "strength",
                position: 0,
                exercises: noms.map((nom, i) => ({
                  exerciseLibraryId: options.banque?.[nom] ?? null,
                  name: nom,
                  order: i,
                  sets: null,
                  reps: null,
                  recommendedLoad: null,
                  restSeconds: null,
                  tempo: null,
                  notes: null,
                })),
              },
            ],
          },
  };
}

function index(feedbacks: AdminStudentFeedback[]) {
  return buildPreviousPerformanceIndex({
    feedbacks,
    studentId: ELEVE_A,
    currentSessionId: "session-actuelle",
    today: AUJOURDHUI,
  });
}

/** Les séries d'une performance passée, ordonnées par numéro de série. */
function series(perf: PreviousExercisePerf): SerieRealisee[] {
  return Object.keys(perf.sets)
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => ({ loadUsed: perf.sets[n].loadUsed, repsDone: perf.sets[n].repsDone }));
}

/**
 * La chaîne complète telle que l'appellera l'interface : occurrence courante →
 * occurrence N-1 → performance de CETTE occurrence → référence chiffrée.
 * Aucun repli chronologique nulle part.
 */
function reference(
  feedbacks: AdminStudentFeedback[],
  exercice: { name: string; libraryExerciseId?: string | null },
  courante: OccurrenceProgrammee,
) {
  const precedente = occurrencePrecedente(courante);
  if (!precedente) return null;
  const perf = findPreviousPerformance(index(feedbacks), exercice, precedente);
  if (!perf) return null;
  const lue = referenceDeProgression(series(perf));
  return lue.ok ? lue.reference : null;
}

/* ─── Jeu d'essai lundi / mercredi / vendredi ─── */

const MER_S3: OccurrenceProgrammee = { weekNumber: 3, day: "Mercredi" };

/**
 * Trois séances par semaine, LE MÊME EXERCICE À CHAQUE FOIS, avec des charges
 * distinctes pour que toute confusion d'occurrence soit visible.
 *
 * Semaine 2 : lundi 40 kg, mercredi 50 kg, vendredi 60 kg.
 * Semaine 3 : lundi 45 kg (plus récent que tout la semaine 2).
 */
const SEMAINES: AdminStudentFeedback[] = [
  retour({
    id: "s2-lun",
    weekNumber: 2,
    day: "Lundi",
    performedAt: "2026-08-17",
    entrées: [{ exerciseName: "Développé couché", setNumber: 1, loadUsed: "40 kg", repsDone: "10" }],
  }),
  retour({
    id: "s2-mer",
    weekNumber: 2,
    day: "Mercredi",
    performedAt: "2026-08-19",
    entrées: [{ exerciseName: "Développé couché", setNumber: 1, loadUsed: "50 kg", repsDone: "10" }],
  }),
  retour({
    id: "s2-ven",
    weekNumber: 2,
    day: "Vendredi",
    performedAt: "2026-08-21",
    entrées: [{ exerciseName: "Développé couché", setNumber: 1, loadUsed: "60 kg", repsDone: "10" }],
  }),
  retour({
    id: "s3-lun",
    weekNumber: 3,
    day: "Lundi",
    performedAt: "2026-08-24",
    entrées: [{ exerciseName: "Développé couché", setNumber: 1, loadUsed: "45 kg", repsDone: "10" }],
  }),
];

await (async () => {
  /* ─── Occurrence de référence ─── */

  await test("1. mercredi semaine 3 prend pour référence le mercredi de la semaine 2", () => {
    const ref = reference(SEMAINES, { name: "Développé couché" }, MER_S3);
    assert.ok(ref, "référence trouvée");
    assert.equal(ref.chargeKg, 50, "la charge du MERCREDI de la semaine précédente");
    assert.equal(ref.reps, 10);
  });

  await test("2. NÉGATIF — le mercredi n'utilise PAS le lundi de sa propre semaine, pourtant plus récent", () => {
    const ref = reference(SEMAINES, { name: "Développé couché" }, MER_S3);
    assert.notEqual(ref?.chargeKg, 45, "45 kg est le lundi de la semaine 3 : jamais la référence du mercredi");
    // Et le chemin chronologique, lui, rend bien la plus récente : les deux
    // recherches répondent à deux questions différentes, volontairement.
    const chrono = findPreviousPerformance(index(SEMAINES), { name: "Développé couché" });
    assert.equal(chrono?.sets[1].loadUsed, "45 kg", "le chemin « Dernières perfs » reste chronologique");
  });

  await test("3. NÉGATIF — le mercredi n'utilise PAS le vendredi de la semaine précédente", () => {
    const ref = reference(SEMAINES, { name: "Développé couché" }, MER_S3);
    assert.notEqual(ref?.chargeKg, 60, "60 kg est le vendredi : autre occurrence");
    assert.notEqual(ref?.chargeKg, 40, "40 kg est le lundi de la semaine 2 : autre occurrence");
  });

  await test("4. l'occurrence est le couple (semaine, jour), insensible à la casse et aux accents", () => {
    assert.ok(memeOccurrence({ weekNumber: 3, day: "Mercredi" }, { weekNumber: 3, day: "  MERCREDI " }));
    assert.ok(!memeOccurrence({ weekNumber: 3, day: "Mercredi" }, { weekNumber: 2, day: "Mercredi" }));
    assert.ok(!memeOccurrence({ weekNumber: 3, day: "Mercredi" }, { weekNumber: 3, day: "Lundi" }));
    assert.equal(normaliserJour("  Mércredi  "), "mercredi");
    assert.equal(
      cleOccurrence("dev-couche", { weekNumber: 3, day: "Mercredi" }),
      cleOccurrence("dev-couche", { weekNumber: 3, day: "mercredi" }),
      "la clé d'index ne dépend pas de l'écriture du jour",
    );
  });

  await test("5. la recherche NE REMONTE PAS au-delà de la semaine précédente, et s'arrête en semaine 1", () => {
    assert.deepEqual(occurrencePrecedente({ weekNumber: 3, day: "Mercredi" }), { weekNumber: 2, day: "Mercredi" });
    assert.equal(occurrencePrecedente({ weekNumber: 1, day: "Mercredi" }), null, "il n'existe pas de semaine 0");
    // Mercredi semaine 4 : l'occurrence N-1 (semaine 3) n'a pas été réalisée.
    // La réponse est « aucune référence », PAS la semaine 2.
    const ref = reference(SEMAINES, { name: "Développé couché" }, { weekNumber: 4, day: "Mercredi" });
    assert.equal(ref, null, "occurrence N-1 absente : aucune référence, aucun repli sur N-2");
  });

  await test("6. un retour sans occurrence identifiable ne fournit AUCUNE référence", () => {
    const sansSnapshot = [
      retour({
        id: "brut",
        weekNumber: null,
        day: null,
        performedAt: "2026-08-19",
        avecSnapshot: false,
        entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "100 kg", repsDone: "8" }],
      }),
    ];
    assert.equal(occurrenceDuRetour({ sessionId: "session-brut", prescribedSnapshot: undefined }), null);
    assert.equal(reference(sansSnapshot, { name: "Squat" }, MER_S3), null);
    // Il reste malgré tout visible dans la ligne « Dernières perfs ».
    assert.ok(findPreviousPerformance(index(sansSnapshot), { name: "Squat" }), "l'affichage chronologique est conservé");
  });

  await test("7. l'identité de banque prime sur le nom, y compris par occurrence", () => {
    const renommé = [
      retour({
        id: "s2-mer-lib",
        weekNumber: 2,
        day: "Mercredi",
        performedAt: "2026-08-19",
        banque: { "Développé couché barre": LIB_DC },
        entrées: [{ exerciseName: "Développé couché barre", setNumber: 1, loadUsed: "52.5 kg", repsDone: "9" }],
      }),
    ];
    const ref = reference(renommé, { name: "DC (variante renommée)", libraryExerciseId: LIB_DC }, MER_S3);
    assert.ok(ref, "retrouvé via exercise_library_id malgré le renommage");
    assert.equal(ref.chargeKg, 52.5);
  });

  /* ─── Moyenne et arrondi ─── */

  await test("8. la référence est la MOYENNE des séries enregistrées, pas la dernière série", () => {
    const lue = referenceDeProgression([
      { loadUsed: "50 kg", repsDone: "12" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "8" },
    ]);
    assert.ok(lue.ok);
    assert.equal(lue.reference.reps, 10, "(12+10+8)/3 = 10 — et non 8, la dernière série");
    assert.equal(lue.reference.seriesRetenues, 3);
  });

  await test("9. arrondi commercial : 10,4 → 10 ; 10,5 → 11 ; 10,6 → 11", () => {
    assert.equal(arrondirReps(10.4), 10);
    assert.equal(arrondirReps(10.5), 11);
    assert.equal(arrondirReps(10.6), 11);
    // Par la moyenne réelle, pour que l'arrondi soit vérifié sur le chemin
    // effectivement emprunté et non seulement sur la fonction isolée.
    const dix = [
      { loadUsed: "50 kg", repsDone: "11" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "11" },
    ]; // 52 / 5 = 10,4
    assert.equal(moyenneRepsRealisees(dix)?.reps, 10);
    const onze = [
      { loadUsed: "50 kg", repsDone: "11" },
      { loadUsed: "50 kg", repsDone: "10" },
    ]; // 21 / 2 = 10,5
    assert.equal(moyenneRepsRealisees(onze)?.reps, 11);
    const onzeAussi = [
      { loadUsed: "50 kg", repsDone: "11" },
      { loadUsed: "50 kg", repsDone: "11" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "11" },
    ]; // 53 / 5 = 10,6
    assert.equal(moyenneRepsRealisees(onzeAussi)?.reps, 11);
  });

  await test("10. AUCUNE demi-répétition ne sort jamais, ni de la moyenne ni d'une recommandation", () => {
    for (let a = 1; a <= 20; a += 1) {
      for (let b = 1; b <= 20; b += 1) {
        const moyenne = moyenneRepsRealisees([
          { loadUsed: "50 kg", repsDone: String(a) },
          { loadUsed: "50 kg", repsDone: String(b) },
        ]);
        assert.ok(moyenne, `moyenne lisible pour ${a}/${b}`);
        assert.ok(Number.isInteger(moyenne.reps), `moyenne entière pour ${a}/${b} (${moyenne.reps})`);
        const reco = recommanderProchaineCible({
          progressionActive: true,
          groupe: "pectoraux",
          plage: { min: 8, max: 13 },
          reference: { chargeKg: 50, reps: moyenne.reps },
        });
        assert.ok(reco.ok);
        assert.ok(Number.isInteger(reco.recommandation.reps), `reps entières pour ${a}/${b}`);
      }
    }
  });

  await test("11. séries partiellement renseignées : les vides sont ignorées, les illisibles comptées séparément", () => {
    const partielle = moyenneRepsRealisees([
      { loadUsed: "50 kg", repsDone: "12" },
      { loadUsed: "50 kg", repsDone: "" },
      { loadUsed: "50 kg", repsDone: "10" },
    ]);
    assert.equal(partielle?.reps, 11, "moyenne sur les DEUX séries renseignées — la vide n'est pas un zéro");
    assert.equal(partielle?.seriesRetenues, 2);
    const illisible = moyenneRepsRealisees([
      { loadUsed: "50 kg", repsDone: "12" },
      { loadUsed: "50 kg", repsDone: "AMRAP" },
    ]);
    assert.equal(illisible?.reps, 12, "« AMRAP » écarté, pas compté à zéro");
    assert.equal(illisible?.seriesIgnorees, 1, "l'écart est remonté à l'appelant");
    assert.equal(moyenneRepsRealisees([{ loadUsed: "50 kg", repsDone: "" }]), null, "aucune série chiffrable");
  });

  /* ─── Les quatre cas de progression ─── */

  await test("12. DANS LA PLAGE : même charge, une répétition de plus", () => {
    const reco = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 10 },
    });
    assert.ok(reco.ok);
    assert.equal(reco.recommandation.chargeKg, 50, "charge inchangée");
    assert.equal(reco.recommandation.reps, 11);
    assert.equal(reco.recommandation.motif, "dans-la-plage");
    assert.equal(reco.recommandation.chargeModifiee, false);
  });

  await test("13. BORNE HAUTE ATTEINTE : charge augmentée de l'incrément du groupe, retour borne basse", () => {
    const pecs = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.ok(pecs.ok);
    assert.equal(pecs.recommandation.chargeKg, 52, "pectoraux : +2 kg");
    assert.equal(pecs.recommandation.reps, 8, "retour à la borne basse");
    assert.equal(pecs.recommandation.motif, "borne-haute-atteinte");
    assert.equal(pecs.recommandation.chargeModifiee, true);

    const dos = recommanderProchaineCible({
      progressionActive: true,
      groupe: "dos",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.ok(dos.ok);
    assert.equal(dos.recommandation.chargeKg, 52.5, "gros groupe : +2,5 kg");

    // PETITS GROUPES — tous à +1 kg, `avant-bras` compris depuis le 23/09/2026.
    for (const groupe of [
      "biceps",
      "mollets",
      "triceps",
      "épaules",
      "abdos",
      "lombaires",
      "autre",
      "avant-bras",
    ] as MuscleGroup[]) {
      assert.equal(incrementDeMontee(groupe), 1, `${groupe} : incrément de 1 kg`);
      const reco = recommanderProchaineCible({
        progressionActive: true,
        groupe,
        plage: { min: 8, max: 13 },
        reference: { chargeKg: 12, reps: 13 },
      });
      assert.ok(reco.ok, `recommandation pour ${groupe}`);
      assert.equal(reco.recommandation.chargeKg, 13, `${groupe} : petit groupe, +1 kg`);
      assert.equal(reco.recommandation.reps, 8, `${groupe} : retour borne basse`);
    }
  });

  await test("13bis. LE TABLEAU COMPLET des incréments — aucune régression, aucun groupe oublié", () => {
    // Les 15 valeurs canoniques de `MuscleGroup`, chacune avec son incrément
    // attendu ou `null`. Un groupe ajouté au type sans décision produit fera
    // échouer ce test, ce qui est le but : il ne doit pas hériter d'un
    // incrément par accident.
    const attendu: Record<MuscleGroup, number | null> = {
      dos: 2.5,
      quadriceps: 2.5,
      ischios: 2.5,
      fessiers: 2.5,
      pectoraux: 2,
      biceps: 1,
      mollets: 1,
      triceps: 1,
      "épaules": 1,
      abdos: 1,
      lombaires: 1,
      autre: 1,
      "avant-bras": 1,
      cardio: null,
      "full-body": null,
    };
    for (const [groupe, increment] of Object.entries(attendu) as [MuscleGroup, number | null][]) {
      assert.equal(incrementDeMontee(groupe), increment, `${groupe} : incrément ${increment}`);
    }
    assert.equal(Object.keys(attendu).length, 15, "les 15 groupes canoniques sont couverts");
  });

  await test("13ter. CARDIO n'a AUCUNE progression automatique de charge", () => {
    assert.equal(incrementDeMontee("cardio"), null, "aucun incrément défini");
    // Même avec une référence parfaitement exploitable : le refus vient du
    // groupe, pas d'un manque de données.
    const reco = recommanderProchaineCible({
      progressionActive: true,
      groupe: "cardio",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.equal(reco.ok, false, "aucune recommandation");
    assert.equal(reco.ok === false && reco.motif, "groupe-non-tarife");
    // Et dans les trois autres cas de figure du moteur, même refus.
    for (const reps of [6, 10, 18]) {
      const autre = recommanderProchaineCible({
        progressionActive: true,
        groupe: "cardio",
        plage: { min: 8, max: 13 },
        reference: { chargeKg: 50, reps },
      });
      assert.equal(autre.ok === false && autre.motif, "groupe-non-tarife", `cardio refusé aussi à ${reps} reps`);
    }
    // Sans historique non plus.
    const premiere = conseilPremiereSerie({
      progressionActive: true,
      groupe: "cardio",
      plage: { min: 8, max: 13 },
      chargeKg: 50,
      reps: 18,
    });
    assert.equal(premiere.ok === false && premiere.motif, "groupe-non-tarife");
  });

  await test("13quater. FULL-BODY n'a AUCUNE progression automatique de charge", () => {
    assert.equal(incrementDeMontee("full-body"), null, "aucun incrément défini");
    const reco = recommanderProchaineCible({
      progressionActive: true,
      groupe: "full-body",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.equal(reco.ok, false, "aucune recommandation");
    assert.equal(reco.ok === false && reco.motif, "groupe-non-tarife");
    for (const reps of [6, 10, 18]) {
      const autre = recommanderProchaineCible({
        progressionActive: true,
        groupe: "full-body",
        plage: { min: 8, max: 13 },
        reference: { chargeKg: 50, reps },
      });
      assert.equal(autre.ok === false && autre.motif, "groupe-non-tarife", `full-body refusé aussi à ${reps} reps`);
    }
    const premiere = conseilPremiereSerie({
      progressionActive: true,
      groupe: "full-body",
      plage: { min: 8, max: 13 },
      chargeKg: 50,
      reps: 18,
    });
    assert.equal(premiere.ok === false && premiere.motif, "groupe-non-tarife");
  });

  await test("14. AU-DESSUS DE LA BORNE HAUTE : traitement identique, le dépassement ne change rien", () => {
    const atteinte = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    const dépassée = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 18 },
    });
    assert.ok(atteinte.ok && dépassée.ok);
    assert.equal(dépassée.recommandation.chargeKg, atteinte.recommandation.chargeKg, "même charge conseillée");
    assert.equal(dépassée.recommandation.reps, atteinte.recommandation.reps, "même retour borne basse");
    assert.equal(dépassée.recommandation.motif, "au-dessus-de-la-borne", "motif distinct, conséquence identique");
  });

  await test("15. SOUS LA BORNE BASSE : −1 kg quel que soit le groupe, retour borne basse", () => {
    assert.equal(BAISSE_KG, 1, "la baisse est de 1 kg, jamais l'incrément de montée");
    for (const groupe of ["pectoraux", "dos", "biceps", "autre", "avant-bras"] as MuscleGroup[]) {
      const reco = recommanderProchaineCible({
        progressionActive: true,
        groupe,
        plage: { min: 8, max: 13 },
        reference: { chargeKg: 50, reps: 6 },
      });
      assert.ok(reco.ok, `recommandation pour ${groupe}`);
      assert.equal(reco.recommandation.chargeKg, 49, `${groupe} : 50 − 1 kg`);
      assert.equal(reco.recommandation.reps, 8, "retour à la borne basse");
      assert.equal(reco.recommandation.motif, "sous-la-borne-basse");
      assert.equal(reco.recommandation.chargeModifiee, true);
    }
  });

  await test("16. la baisse de 1 kg s'applique AUSSI sur une charge basse, jusqu'au plancher", () => {
    const basse = recommanderProchaineCible({
      progressionActive: true,
      groupe: "biceps",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 2, reps: 5 },
    });
    assert.ok(basse.ok);
    assert.equal(basse.recommandation.chargeKg, 1, "2 kg − 1 kg = 1 kg : la règle ne fait pas d'exception");

    const auPlancher = recommanderProchaineCible({
      progressionActive: true,
      groupe: "biceps",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 1, reps: 5 },
    });
    assert.ok(auPlancher.ok);
    assert.equal(auPlancher.recommandation.chargeKg, PLANCHER_KG, "plancher à 0,5 kg, jamais 0 ni négatif");

    const déjàAuPlancher = recommanderProchaineCible({
      progressionActive: true,
      groupe: "biceps",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: PLANCHER_KG, reps: 5 },
    });
    assert.ok(déjàAuPlancher.ok);
    assert.equal(déjàAuPlancher.recommandation.chargeKg, PLANCHER_KG);
    assert.equal(déjàAuPlancher.recommandation.chargeModifiee, false, "charge inchangée : l'indicateur doit le dire");
  });

  await test("17. les charges gardent leur décimale — aucun arrondi au pas de matériel", () => {
    assert.equal(normaliserChargeKg(12 + 2.5), 14.5, "14,5 kg et non 15 kg");
    const reco = recommanderProchaineCible({
      progressionActive: true,
      groupe: "dos",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 12, reps: 13 },
    });
    assert.ok(reco.ok);
    assert.equal(reco.recommandation.chargeKg, 14.5);
    assert.equal(normaliserChargeKg(0.1 + 0.2), 0.3, "pas de 0,30000000000000004");
  });

  /* ─── Interrupteur ON / OFF ─── */

  await test("18. progression DÉSACTIVÉE : aucune recommandation, aucun calcul", () => {
    const éteinte = recommanderProchaineCible({
      progressionActive: false,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.equal(éteinte.ok, false);
    assert.equal(éteinte.ok === false && éteinte.motif, "progression-desactivee");
    // Le OFF court-circuite même l'absence de référence et de tarif : un
    // exercice désactivé ne produit jamais un autre motif que le sien.
    const éteinteSansRien = recommanderProchaineCible({
      progressionActive: false,
      groupe: "cardio",
      plage: { min: 8, max: 13 },
      reference: null,
    });
    assert.equal(éteinteSansRien.ok === false && éteinteSansRien.motif, "progression-desactivee");
    const allumée = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.equal(allumée.ok, true, "le ON rétablit la recommandation à l'identique");
    assert.equal(allumée.ok === true && allumée.recommandation.chargeKg, 52);
  });

  /* ─── Refus nommés plutôt que valeurs inventées ─── */

  await test("19. chaque situation non tranchée est REFUSÉE avec son motif, jamais devinée", () => {
    // Aucune référence : première occurrence, ou occurrence N-1 non réalisée.
    const sansRef = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: null,
    });
    assert.equal(sansRef.ok === false && sansRef.motif, "aucune-reference");

    // Groupes canoniques sans incrément défini par la règle produit.
    // ⚠️ `avant-bras` N'EN FAIT PLUS PARTIE depuis le 23/09/2026 : il est
    // devenu un petit groupe à +1 kg (voir le test 13). Ce test verrouillait
    // l'ancienne règle, il a été adapté — pas supprimé — et `avant-bras` est
    // désormais vérifié du côté des groupes tarifés.
    for (const groupe of ["cardio", "full-body"] as MuscleGroup[]) {
      assert.equal(incrementDeMontee(groupe), null, `${groupe} n'a pas d'incrément`);
      const reco = recommanderProchaineCible({
        progressionActive: true,
        groupe,
        plage: { min: 8, max: 13 },
        reference: { chargeKg: 50, reps: 13 },
      });
      assert.equal(reco.ok === false && reco.motif, "groupe-non-tarife", `${groupe} refusé et nommé`);
    }

    // Plages prescrites ambiguës : refus, pas d'interprétation.
    const motifPlage = (texte: string) => {
      const lue = lirePlageReps(texte);
      return lue.ok ? "lue" : lue.motif;
    };
    assert.equal(motifPlage(""), "aucune-prescription");
    assert.equal(motifPlage("6-10, 8-13"), "plage-par-serie");
    assert.equal(motifPlage("11-10-9"), "sequence-de-series");
    assert.equal(motifPlage("13-8"), "bornes-inversees");
    assert.equal(motifPlage("AMRAP"), "illisible");
    const lue = lirePlageReps(" 8 - 13 ");
    assert.deepEqual(lue.ok === true && lue.plage, { min: 8, max: 13 }, "une plage propre reste lue");

    // Charges non constantes d'une série à l'autre : refus nommé.
    const variable = chargeDeReference([
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "52.5 kg", repsDone: "8" },
    ]);
    assert.equal(variable.ok === false && variable.motif, "charge-non-constante");
    const sansCharge = chargeDeReference([{ loadUsed: "poids du corps", repsDone: "12" }]);
    assert.equal(sansCharge.ok === false && sansCharge.motif, "charge-non-chiffrable");
  });

  await test("20. première performance SANS historique : conseil au STRICT dépassement de la borne haute", () => {
    const dépassée = conseilPremiereSerie({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      chargeKg: 50,
      reps: 15,
    });
    assert.ok(dépassée.ok);
    assert.equal(dépassée.recommandation.chargeKg, 52);
    assert.equal(dépassée.recommandation.reps, 8);

    const atteinte = conseilPremiereSerie({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      chargeKg: 50,
      reps: 13,
    });
    assert.equal(atteinte.ok, false, "atteindre exactement la borne haute ne déclenche rien sans historique");
    assert.equal(atteinte.ok === false && atteinte.motif, "aucune-reference");

    const dansLaPlage = conseilPremiereSerie({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      chargeKg: 50,
      reps: 10,
    });
    assert.equal(dansLaPlage.ok, false, "aucune règle sans historique dans la plage : on n'invente pas");
  });

  /* ─── Sabotages ─── */

  await test("21. SABOTAGE — une implémentation qui ne lirait que la DERNIÈRE série est prise en défaut", () => {
    const sériesDécroissantes: SerieRealisee[] = [
      { loadUsed: "50 kg", repsDone: "13" },
      { loadUsed: "50 kg", repsDone: "11" },
      { loadUsed: "50 kg", repsDone: "9" },
    ];
    // Moyenne = 11 → dans la plage 8–13 → 50 kg × 12.
    // Dernière série = 9 → dans la plage aussi, mais 50 kg × 10.
    // Première série = 13 → borne haute → 52 kg × 8.
    // Les trois lectures donnent trois résultats DIFFÉRENTS : le jeu d'essai
    // n'est pas dégénéré, il discrimine réellement.
    const lue = referenceDeProgression(sériesDécroissantes);
    assert.ok(lue.ok);
    assert.equal(lue.reference.reps, 11, "la moyenne, et non 9 (dernière) ni 13 (première)");
    const reco = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: { min: 8, max: 13 },
      reference: { chargeKg: lue.reference.chargeKg, reps: lue.reference.reps },
    });
    assert.ok(reco.ok);
    assert.equal(reco.recommandation.reps, 12);
    assert.equal(reco.recommandation.chargeKg, 50);
    assert.notEqual(reco.recommandation.reps, 10, "10 serait la lecture « dernière série »");
    assert.notEqual(reco.recommandation.chargeKg, 52, "52 serait la lecture « première série »");
  });

  await test("22. SABOTAGE — une implémentation chronologique est prise en défaut sur lundi/mercredi/vendredi", () => {
    const idx = index(SEMAINES);
    const chrono = findPreviousPerformance(idx, { name: "Développé couché" });
    const parOccurrence = findPreviousPerformance(idx, { name: "Développé couché" }, { weekNumber: 2, day: "Mercredi" });
    assert.equal(chrono?.sets[1].loadUsed, "45 kg", "le plus récent est le lundi de la semaine 3");
    assert.equal(parOccurrence?.sets[1].loadUsed, "50 kg", "la bonne occurrence est le mercredi de la semaine 2");
    assert.notEqual(
      parOccurrence?.sets[1].loadUsed,
      chrono?.sets[1].loadUsed,
      "les deux chemins divergent : un repli silencieux sur le chronologique serait visible",
    );
    // Et le repli est réellement interdit : une occurrence inexistante rend
    // `null`, pas la performance la plus proche.
    assert.equal(
      findPreviousPerformance(idx, { name: "Développé couché" }, { weekNumber: 9, day: "Mercredi" }),
      null,
      "occurrence absente : null, JAMAIS la plus proche",
    );
    assert.equal(
      findPreviousPerformance(idx, { name: "Développé couché" }, { weekNumber: 2, day: "Jeudi" }),
      null,
      "jour non programmé : null, JAMAIS le mercredi voisin",
    );
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
