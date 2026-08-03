/**
 * Harnais — feat/student-previous-set-performance.
 *
 * « Dernières perfs » par série dans le retour de séance élève : recherche de
 * la dernière performance passée du même exercice (exercise_library_id via le
 * prescribed_snapshot, fallback nom normalisé), correspondance série par
 * INDEX, priorité saisie > prescription coach > historique > vide appliquée
 * champ par champ, et garantie que les placeholders ne sont jamais
 * sauvegardés ni considérés comme une saisie.
 *
 * Lancement : npx tsx scripts/tests/previous-performance.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  buildPreviousPerformanceIndex,
  findPreviousPerformance,
  formatPreviousSetLabel,
  hasRealizedSetInput,
  normalizeExerciseName,
  resolveSetPlaceholders,
} from "../../lib/previous-performance";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import type { AdminStudentFeedback, Exercise, ExerciseFeedback } from "../../types";

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

/** Retire les commentaires avant les gardes textuelles (pattern maison). */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const sourceCarte = readFileSync(new URL("../../components/student/ExerciseFeedbackCard.tsx", import.meta.url), "utf8");
const sourceSection = readFileSync(new URL("../../components/student/SessionFeedbackSection.tsx", import.meta.url), "utf8");
const sourceHook = readFileSync(new URL("../../hooks/useSupabaseWorkoutFeedback.ts", import.meta.url), "utf8");

/* ─── Fabriques de données ─── */

const ELEVE_A = "11111111-1111-4111-8111-111111111111";
const ELEVE_B = "22222222-2222-4222-8222-222222222222";
const AUJOURDHUI = "2026-08-03";

interface EntréeBrève {
  exerciseName: string;
  setNumber: number;
  loadUsed?: string;
  repsDone?: string;
  /** RPE de LA série (option B) — null/absent pour un retour ancien. */
  rpe?: number | null;
  /** RPE global d'exercice (exercise_feedback.rpe) — anciens retours. */
  exerciseRpe?: number | null;
}

function retour(options: {
  id: string;
  studentId?: string;
  sessionId?: string;
  performedAt?: string;
  completed?: boolean;
  entrées: EntréeBrève[];
  snapshotExercices?: { name: string; exerciseLibraryId: string | null }[];
  programId?: string | null;
}): AdminStudentFeedback {
  return {
    id: options.id,
    studentId: options.studentId ?? ELEVE_A,
    type: "entrainement",
    sessionId: options.sessionId ?? `session-${options.id}`,
    programId: options.programId ?? null,
    refLabel: `Séance ${options.id}`,
    date: options.performedAt ?? "2026-07-01",
    completed: options.completed ?? true,
    rpe: null,
    pain: "",
    comment: "",
    exerciseEntries: options.entrées.map((e) => ({
      exerciseName: e.exerciseName,
      setNumber: e.setNumber,
      loadUsed: e.loadUsed ?? "",
      repsDone: e.repsDone ?? "",
      rpe: e.rpe ?? null,
      exerciseRpe: e.exerciseRpe ?? null,
      comment: "",
    })),
    status: "a-traiter",
    coachReply: "",
    createdAt: `${options.performedAt ?? "2026-07-01"}T10:00:00Z`,
    updatedAt: `${options.performedAt ?? "2026-07-01"}T10:00:00Z`,
    performedAt: options.performedAt ?? "2026-07-01",
    prescribedSnapshot: options.snapshotExercices
      ? {
          version: PRESCRIBED_SNAPSHOT_VERSION,
          sessionId: options.sessionId ?? `session-${options.id}`,
          sessionName: `Séance ${options.id}`,
          day: null,
          weekNumber: null,
          capturedAt: `${options.performedAt ?? "2026-07-01"}T10:00:00Z`,
          blocks: [
            {
              title: null,
              category: "strength",
              position: 0,
              exercises: options.snapshotExercices.map((ex, i) => ({
                exerciseLibraryId: ex.exerciseLibraryId,
                name: ex.name,
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
        }
      : undefined,
  };
}

function index(feedbacks: AdminStudentFeedback[], currentSessionId = "session-actuelle") {
  return buildPreviousPerformanceIndex({ feedbacks, studentId: ELEVE_A, currentSessionId, today: AUJOURDHUI });
}

const LIB_DC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

await (async () => {
  await test("1. même exercice retrouvé par exercise_library_id (via le snapshot du retour passé)", () => {
    const idx = index([
      retour({
        id: "r1",
        performedAt: "2026-07-20",
        entrées: [{ exerciseName: "Développé couché barre", setNumber: 1, loadUsed: "45 kg", repsDone: "10", rpe: 9 }],
        snapshotExercices: [{ name: "Développé couché barre", exerciseLibraryId: LIB_DC }],
      }),
    ]);
    // L'exercice actuel porte un AUTRE nom (renommé par le coach) mais la
    // même identité de banque : la correspondance passe par la banque.
    const perf = findPreviousPerformance(idx, { name: "DC barre (variante)", libraryExerciseId: LIB_DC });
    assert.ok(perf, "trouvé via exercise_library_id");
    assert.equal(perf.matchedBy, "library");
    assert.equal(perf.sets[1].loadUsed, "45 kg");
  });

  await test("2. fallback par nom normalisé (accents, casse, espaces) quand l'identifiant est absent", () => {
    const idx = index([
      retour({ id: "r1", entrées: [{ exerciseName: "Développé   Couché", setNumber: 1, loadUsed: "40 kg", repsDone: "8" }] }),
    ]);
    const perf = findPreviousPerformance(idx, { name: "  developpe couche ", libraryExerciseId: null });
    assert.ok(perf, "retrouvé par nom normalisé");
    assert.equal(perf.matchedBy, "name");
    assert.equal(normalizeExerciseName("Développé   Couché"), "developpe couche");
  });

  await test("3. les performances d'un AUTRE élève sont exclues de l'index", () => {
    const idx = index([
      retour({ id: "r1", studentId: ELEVE_B, entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "100 kg", repsDone: "5" }] }),
    ]);
    assert.equal(findPreviousPerformance(idx, { name: "Squat" }), null);
  });

  await test("4. une séance datée dans le FUTUR est exclue (défensif)", () => {
    const idx = index([
      retour({ id: "r1", performedAt: "2026-08-04", entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "100 kg", repsDone: "5" }] }),
    ]);
    assert.equal(findPreviousPerformance(idx, { name: "Squat" }), null);
  });

  await test("5. une séance NON terminée est exclue", () => {
    const idx = index([
      retour({ id: "r1", completed: false, entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "100 kg", repsDone: "5" }] }),
    ]);
    assert.equal(findPreviousPerformance(idx, { name: "Squat" }), null);
    // Le retour de la séance ACTUELLE est lui aussi hors index (mode édition).
    const idx2 = index([
      retour({ id: "r2", sessionId: "session-actuelle", entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "90 kg", repsDone: "6" }] }),
    ]);
    assert.equal(findPreviousPerformance(idx2, { name: "Squat" }), null);
  });

  await test("6. la DERNIÈRE occurrence antérieure gagne — et la recherche remonte au-delà de la semaine précédente", () => {
    const idx = index([
      // Semaine 2 : dernière occurrence du soulevé de terre (absent en semaine 3).
      retour({ id: "s2", performedAt: "2026-07-13", entrées: [
        { exerciseName: "Soulevé de terre", setNumber: 1, loadUsed: "120 kg", repsDone: "5", rpe: 8 },
        { exerciseName: "Squat", setNumber: 1, loadUsed: "95 kg", repsDone: "6" },
      ] }),
      // Semaine 3 : squat plus récent, PAS de soulevé de terre.
      retour({ id: "s3", performedAt: "2026-07-20", entrées: [
        { exerciseName: "Squat", setNumber: 1, loadUsed: "100 kg", repsDone: "5" },
      ] }),
    ]);
    assert.equal(findPreviousPerformance(idx, { name: "Squat" })!.sets[1].loadUsed, "100 kg", "occurrence la plus récente");
    assert.equal(findPreviousPerformance(idx, { name: "Soulevé de terre" })!.sets[1].loadUsed, "120 kg", "remonte en semaine 2");
  });

  await test("7. correspondance par INDEX : ancienne série 1 → série actuelle 1 (jamais de fusion ni de moyenne)", () => {
    const idx = index([
      retour({ id: "r1", entrées: [
        { exerciseName: "Squat", setNumber: 1, loadUsed: "45 kg", repsDone: "10", rpe: 9 },
        { exerciseName: "Squat", setNumber: 2, loadUsed: "45 kg", repsDone: "10", rpe: 9 },
        { exerciseName: "Squat", setNumber: 3, loadUsed: "45 kg", repsDone: "9", rpe: 9 },
      ] }),
    ]);
    const perf = findPreviousPerformance(idx, { name: "Squat" })!;
    assert.equal(perf.sets[1].repsDone, "10");
    assert.equal(perf.sets[3].repsDone, "9", "chaque série garde SA valeur");
    assert.equal(formatPreviousSetLabel(perf.sets[3]), "45 kg × 9 · RPE 9");
  });

  await test("8. ancienne séance avec MOINS de séries : séries 1-3 renseignées, série 4 vide", () => {
    const idx = index([
      retour({ id: "r1", entrées: [1, 2, 3].map((n) => ({ exerciseName: "Squat", setNumber: n, loadUsed: "80 kg", repsDone: "8" })) }),
    ]);
    const perf = findPreviousPerformance(idx, { name: "Squat" })!;
    assert.ok(perf.sets[3]);
    assert.equal(perf.sets[4], undefined, "série 4 sans repère");
    assert.equal(formatPreviousSetLabel(perf.sets[4]), null, "aucune ligne « Dernières perfs » pour la série 4");
    const placeholders = resolveSetPlaceholders({ recommendedLoad: "", reps: "" }, perf.sets[4]);
    assert.deepEqual(placeholders, { load: "Charge", reps: "Reps", rpe: "RPE" }, "champ vide (libellés neutres)");
  });

  await test("9. ancienne séance avec PLUS de séries : seules les séries actuelles consomment leurs homologues", () => {
    const idx = index([
      retour({ id: "r1", entrées: [1, 2, 3, 4].map((n) => ({ exerciseName: "Squat", setNumber: n, loadUsed: `${60 + n} kg`, repsDone: "8" })) }),
    ]);
    const perf = findPreviousPerformance(idx, { name: "Squat" })!;
    // Séance actuelle à 3 séries : l'appelant interroge 1..3 — chacune reçoit
    // l'ancienne série de MÊME index ; l'ancienne série 4 n'est jamais lue.
    for (const n of [1, 2, 3]) {
      assert.equal(perf.sets[n].loadUsed, `${60 + n} kg`);
    }
  });

  await test("10. donnée historique PARTIELLE : seuls les champs réellement présents apparaissent", () => {
    const idx = index([
      retour({ id: "r1", entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "", repsDone: "9", rpe: null }] }),
    ]);
    const perf = findPreviousPerformance(idx, { name: "Squat" })!;
    assert.equal(formatPreviousSetLabel(perf.sets[1]), "9", "répétitions seules — rien d'inventé");
    const placeholders = resolveSetPlaceholders({ recommendedLoad: "", reps: "" }, perf.sets[1]);
    assert.equal(placeholders.load, "Charge", "pas de charge historique → libellé neutre");
    assert.equal(placeholders.reps, "9");
  });

  await test("11. une valeur PRESCRITE par le coach masque le placeholder historique du même champ", () => {
    const historique = { loadUsed: "45 kg", repsDone: "10", rpe: 9 };
    const placeholders = resolveSetPlaceholders({ recommendedLoad: "50 kg", reps: "8" }, historique);
    assert.equal(placeholders.load, "Charge (50 kg)", "prescription affichée normalement");
    assert.equal(placeholders.reps, "Reps (8)");
  });

  await test("12. priorité appliquée CHAMP PAR CHAMP (prescription partielle + historique)", () => {
    // Exemple du cahier des charges : programmation 50 kg × 8, aucun RPE
    // prescrit ; performance passée 45 kg × 10 · RPE 9.
    const historique = { loadUsed: "45 kg", repsDone: "10", rpe: 9 };
    const mixte = resolveSetPlaceholders({ recommendedLoad: "50 kg", reps: "" }, historique);
    assert.equal(mixte.load, "Charge (50 kg)", "charge : prescription");
    assert.equal(mixte.reps, "10", "répétitions : historique (aucune prescription)");
    assert.equal(formatPreviousSetLabel(historique), "45 kg × 10 · RPE 9", "RPE 9 visible comme repère (aucun RPE prescrit)");
  });

  await test("13. la SAISIE de l'élève est prioritaire sur tout (value masque le placeholder, rendu réel)", () => {
    const exercice: Exercise = { id: "ex-1", name: "Squat", sets: 1, reps: "8", restSeconds: 90, tempo: "", recommendedLoad: "50 kg", videoUrl: "" };
    const saisie: ExerciseFeedback = {
      studentId: ELEVE_A, sessionId: "s", exerciseId: "ex-1", exerciseName: "Squat",
      sets: [{ studentId: ELEVE_A, sessionId: "s", exerciseId: "ex-1", setNumber: 1, loadUsed: "52 kg", repsDone: "7", rpe: "8" }],
      rpe: null, comment: "",
    };
    const html = renderToString(createElement(ExerciseFeedbackCard, {
      exercise: exercice, index: 0, feedback: saisie,
      previous: { sets: { 1: { loadUsed: "45 kg", repsDone: "10", rpe: 9 } }, exerciseRpe: null, performedAt: "2026-07-20", matchedBy: "name" },
      onSetChange: () => {}, onCommentChange: () => {},
    }));
    assert.ok(html.includes('value="52 kg"'), "la valeur saisie est rendue dans value");
    assert.ok(html.includes("Dernières perfs"), "la ligne repère reste visible");
    // Sémantique DOM : un placeholder n'est visible QUE dans un champ vide —
    // la valeur saisie masque donc toujours le placeholder.
  });

  await test("14. les placeholders ne partent JAMAIS dans le payload (filtre de saisie réelle)", () => {
    assert.equal(hasRealizedSetInput({ loadUsed: "", repsDone: "" }), false, "série vide (placeholder seul) exclue");
    assert.equal(hasRealizedSetInput({ loadUsed: "  ", repsDone: "" }), false, "espaces ≠ saisie");
    assert.equal(hasRealizedSetInput({ loadUsed: "52 kg", repsDone: "" }), true);
    const section = sansCommentaires(sourceSection);
    assert.ok(section.includes(".filter(hasRealizedSetInput)"), "le payload Supabase filtre sur la saisie réelle");
    assert.equal(section.split(".filter(hasRealizedSetInput)").length - 1, 2, "les DEUX chemins (Supabase et mock) filtrent");
  });

  await test("15. un placeholder ne rend pas le formulaire « modifié » et ne satisfait aucune validation", () => {
    const carte = sansCommentaires(sourceCarte);
    // `previous` n'alimente QUE la ligne repère et les placeholders — jamais
    // value=, jamais l'état, jamais un défaut de champ.
    assert.ok(!/value=\{[^}]*previous/.test(carte), "previous jamais dans value=");
    assert.ok(!/onSetChange\([^)]*previous/.test(carte), "previous jamais écrit dans l'état");
    assert.ok(carte.includes("placeholder={placeholders.load}"));
    assert.ok(carte.includes("placeholder={placeholders.reps}"));
    const section = sansCommentaires(sourceSection);
    assert.ok(!/buildInitialFeedback\([^)]*previous/i.test(section), "l'état initial reste vierge");
    assert.ok(!section.includes("required"), "aucune validation de champ obligatoire introduite");
  });

  await test("16. désassignation/réassignation : l'historique est conservé (lecture par élève, jamais par assignation)", () => {
    // Retour d'un programme qui n'est PLUS assigné : toujours indexé.
    const idx = index([
      retour({ id: "r1", programId: "prog-desassigne", entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "100 kg", repsDone: "5" }] }),
    ]);
    assert.ok(findPreviousPerformance(idx, { name: "Squat" }), "aucun filtre par programme/assignation dans l'index");
    const hook = sansCommentaires(sourceHook);
    assert.ok(hook.includes("getWorkoutFeedbackForStudent(supabase, id)"), "lecture par student_id (comme /entrainement/historique)");
  });

  await test("17. copie individuelle prise en charge (ids de séance différents, même identité de banque — ou même nom)", () => {
    const idx = index([
      // Retour fait sur le MODÈLE avant individualisation, snapshot avec la banque.
      retour({
        id: "r1", sessionId: "session-du-modele",
        entrées: [{ exerciseName: "Développé couché", setNumber: 1, loadUsed: "45 kg", repsDone: "10", rpe: 9 }],
        snapshotExercices: [{ name: "Développé couché", exerciseLibraryId: LIB_DC }],
      }),
    ], "session-de-la-copie");
    // La séance actuelle vient de la COPIE : autres uuid partout, mais le même
    // exercice de banque (copié par provision_program_copy).
    assert.ok(findPreviousPerformance(idx, { name: "Développé couché", libraryExerciseId: LIB_DC }), "via la banque");
    assert.ok(findPreviousPerformance(idx, { name: "développé couché", libraryExerciseId: null }), "via le nom (copie sans banque)");
  });

  await test("18. aucun accès aux performances d'un autre élève (défense en profondeur + RLS)", () => {
    const idx = buildPreviousPerformanceIndex({
      feedbacks: [
        retour({ id: "rA", studentId: ELEVE_A, entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "80 kg", repsDone: "8" }] }),
        retour({ id: "rB", studentId: ELEVE_B, entrées: [{ exerciseName: "Curl", setNumber: 1, loadUsed: "20 kg", repsDone: "12" }] }),
      ],
      studentId: ELEVE_A,
      currentSessionId: null,
      today: AUJOURDHUI,
    });
    assert.ok(findPreviousPerformance(idx, { name: "Squat" }), "les siennes : oui");
    assert.equal(findPreviousPerformance(idx, { name: "Curl" }), null, "celles d'un autre : jamais");
    const hook = sansCommentaires(sourceHook);
    assert.ok(hook.includes("getCurrentStudentId(supabase)"), "identité dérivée du compte connecté, jamais d'id arbitraire");
  });

  await test("19. prescribed_snapshot jamais modifié (lecture seule, entrée gelée)", () => {
    const feedback = retour({
      id: "r1",
      entrées: [{ exerciseName: "Squat", setNumber: 1, loadUsed: "80 kg", repsDone: "8" }],
      snapshotExercices: [{ name: "Squat", exerciseLibraryId: LIB_DC }],
    });
    const avant = JSON.stringify(feedback.prescribedSnapshot);
    Object.freeze(feedback.prescribedSnapshot);
    const idx = index([feedback]);
    assert.ok(findPreviousPerformance(idx, { name: "Squat", libraryExerciseId: LIB_DC }));
    assert.equal(JSON.stringify(feedback.prescribedSnapshot), avant, "snapshot intact");
    const lib = sansCommentaires(readFileSync(new URL("../../lib/previous-performance.ts", import.meta.url), "utf8"));
    assert.ok(!lib.includes("prescribedSnapshot ="), "aucune écriture du snapshot dans la lib");
  });

  await test("20. affichage mobile et clavier non régressés (saisie par série, repère discret)", () => {
    const exercice: Exercise = { id: "ex-1", name: "Squat", sets: 2, reps: "", restSeconds: 90, tempo: "", recommendedLoad: "", videoUrl: "" };
    const saisie: ExerciseFeedback = {
      studentId: ELEVE_A, sessionId: "s", exerciseId: "ex-1", exerciseName: "Squat",
      sets: [1, 2].map((n) => ({ studentId: ELEVE_A, sessionId: "s", exerciseId: "ex-1", setNumber: n, loadUsed: "", repsDone: "", rpe: "" })),
      rpe: null, comment: "",
    };
    const html = renderToString(createElement(ExerciseFeedbackCard, {
      exercise: exercice, index: 0, feedback: saisie,
      previous: { sets: { 1: { loadUsed: "45 kg", repsDone: "10", rpe: 5 } }, exerciseRpe: null, performedAt: "2026-07-20", matchedBy: "name" },
      onSetChange: () => {}, onCommentChange: () => {},
    }));
    // Grille responsive (une colonne mobile, quatre colonnes ≥ sm avec le
    // champ RPE par série — option B) et toujours de vrais <input>.
    assert.equal(html.split("sm:grid-cols-[100px_1fr_1fr_88px]").length - 1, 2, "une grille par série");
    assert.equal(html.split("<input").length - 1, 7, "2 séries × 3 champs + commentaire");
    assert.equal(html.split('inputMode="numeric"').length - 1, 2, "clavier numérique mobile sur chaque RPE de série");
    // 3 aria-label : la ligne repère de la série 1 + les 2 champs RPE.
    assert.equal(html.split("aria-label").length - 1, 3, "repère et RPE de série étiquetés pour le lecteur d'écran");
    // Repère UNIQUEMENT sur la série 1 (série 2 sans historique), discret
    // (petite taille, gris translucide) — lisible dans les deux thèmes via
    // les tokens (muted-foreground) sans couleur codée en dur.
    assert.equal(html.split("Dernières perfs").length - 1, 1);
    assert.ok(html.includes("text-[11px]") && html.includes("text-muted-foreground/70"));
    assert.ok(html.includes("45 kg × 10 · RPE 5"));
    // Placeholders historiques dans les champs libres (aucune prescription) —
    // y compris le RPE de série 1, réellement enregistré par série.
    assert.ok(html.includes('placeholder="45 kg"'));
    assert.ok(html.includes('placeholder="10"'));
    assert.ok(html.includes('placeholder="RPE 5"'));
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
