/**
 * Harnais — feat/student-previous-set-performance, OPTION B : RPE par série.
 *
 * Couvre le cycle complet : schéma zod strict de la route (protections
 * PR #53 conservées), écriture exercise_set_feedback.rpe via
 * saveWorkoutFeedback (base factice), relecture par série SANS jamais
 * recopier le RPE global d'exercice, compatibilité des anciens retours
 * (mention honnête « RPE global de l'exercice : N » affichée une fois),
 * placeholders par série, édition, cardio intact, mobile/clavier.
 *
 * Lancement : npx tsx scripts/tests/set-rpe-feedback.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";
import {
  CARDIO_BLOCK_RESULT_VERSION,
  CARDIO_RESULT_ENTRY_NAME,
  parseCardioResults,
  serializeCardioBlockResult,
} from "../../lib/cardio-feedback";
import {
  exerciseGlobalRpeMentions,
  hasRealizedSetInput,
  parseRpeInput,
  resolveSetPlaceholders,
} from "../../lib/previous-performance";
import { getWorkoutFeedbackForStudent, saveWorkoutFeedback } from "../../lib/supabase/workout-feedback";
import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import type { Exercise, ExerciseFeedback, WorkoutFeedbackPayload } from "../../types";

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

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const sourceCarte = readFileSync(new URL("../../components/student/ExerciseFeedbackCard.tsx", import.meta.url), "utf8");
const sourceSection = readFileSync(new URL("../../components/student/SessionFeedbackSection.tsx", import.meta.url), "utf8");
const sourceModaleCoach = readFileSync(new URL("../../components/admin/FeedbackDetailModal.tsx", import.meta.url), "utf8");
const sourceHistorique = readFileSync(new URL("../../app/(student)/entrainement/historique/page.tsx", import.meta.url), "utf8");
const sourceLibPerf = readFileSync(new URL("../../lib/previous-performance.ts", import.meta.url), "utf8");
const sourceMigration = readFileSync(
  new URL("../../supabase/migrations/20260803120000_add_rpe_to_exercise_set_feedback.sql", import.meta.url),
  "utf8",
);

/* ─── Base factice (pattern maison, avec update et défauts de table) ─── */
type Ligne = Record<string, unknown>;
function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  const défauts: Record<string, Ligne> = {
    workout_feedback: {
      session_id: null, program_id: null, completed: false, global_rpe: null, global_comment: "",
      pain: "", status: "a-traiter", coach_reply: "", prescribed_snapshot: null, performed_at: null,
      duration_minutes: null, session_status: null,
      submitted_at: "2026-08-03T10:00:00Z", created_at: "2026-08-03T10:00:00Z", updated_at: "2026-08-03T10:00:00Z",
    },
    exercise_feedback: { exercise_id: null, rpe: null, comment: "", created_at: "2026-08-03T10:00:00Z", updated_at: "2026-08-03T10:00:00Z" },
    exercise_set_feedback: { load_used: "", reps_done: "", rpe: null, created_at: "2026-08-03T10:00:00Z", updated_at: "2026-08-03T10:00:00Z" },
  };
  let compteur = 0;
  function from(nom: string) {
    const état: {
      op: "select" | "insert" | "update" | "delete";
      valeurs?: Ligne | Ligne[];
      filtres: [string, unknown][];
      dans: [string, unknown[]][];
    } = { op: "select", filtres: [], dans: [] };
    const correspond = (l: Ligne) =>
      état.filtres.every(([c, v]) => l[c] === v) && état.dans.every(([c, vs]) => vs.includes(l[c]));
    const exécuter = (): Ligne[] => {
      const lignes = table(nom);
      if (état.op === "select") return lignes.filter(correspond).map((l) => ({ ...l }));
      if (état.op === "insert") {
        const valeurs = Array.isArray(état.valeurs) ? état.valeurs : [état.valeurs ?? {}];
        return valeurs.map((v) => {
          const ligne = { id: `${nom}-${(compteur += 1)}`, ...(défauts[nom] ?? {}), ...v };
          lignes.push(ligne);
          return { ...ligne };
        });
      }
      if (état.op === "update") {
        const touchées = lignes.filter(correspond);
        for (const l of touchées) Object.assign(l, état.valeurs);
        return touchées.map((l) => ({ ...l }));
      }
      const retirées = lignes.filter(correspond);
      const gardées = lignes.filter((l) => !correspond(l));
      tables.set(nom, gardées);
      // CASCADE réelle du schéma : exercise_set_feedback suit son
      // exercise_feedback (FK ON DELETE CASCADE, baseline l. 2267).
      if (nom === "exercise_feedback" && retirées.length > 0) {
        const ids = new Set(retirées.map((l) => l.id));
        tables.set("exercise_set_feedback", table("exercise_set_feedback").filter((l) => !ids.has(l.exercise_feedback_id)));
      }
      return new Array(retirées.length).fill({});
    };
    const chaîne: Record<string, unknown> = {
      select: () => chaîne,
      insert(v: Ligne | Ligne[]) { état.op = "insert"; état.valeurs = v; return chaîne; },
      update(v: Ligne) { état.op = "update"; état.valeurs = v; return chaîne; },
      delete() { état.op = "delete"; return chaîne; },
      eq(c: string, v: unknown) { état.filtres.push([c, v]); return chaîne; },
      in(c: string, vs: unknown[]) { état.dans.push([c, vs]); return chaîne; },
      order: () => chaîne,
      limit: () => chaîne,
      maybeSingle: () => Promise.resolve({ data: exécuter()[0] ?? null, error: null }),
      single: () => {
        const [première] = exécuter();
        return Promise.resolve({ data: première ?? null, error: première ? null : { message: "aucune ligne" } });
      },
      then: (résoudre: (v: { data: Ligne[]; error: null }) => void) => résoudre({ data: exécuter(), error: null }),
    };
    return chaîne;
  }
  return { client: { from } as never, table };
}

const ELEVE = "e0000000-0000-4000-8000-00000000000e";

function payloadMuscu(rpes: (number | null)[]): WorkoutFeedbackPayload {
  return {
    studentId: ELEVE,
    sessionKey: "sess-rpe",
    sessionRefLabel: "Séance RPE",
    completed: true,
    globalRpe: 7,
    globalComment: "",
    pain: "",
    exercises: [
      {
        exerciseName: "Développé couché",
        exerciseOrder: 0,
        rpe: null, // option B : plus de RPE de saisie au niveau exercice (muscu)
        comment: "",
        sets: rpes.map((rpe, i) => ({ setNumber: i + 1, loadUsed: "45 kg", repsDone: i === 2 ? "9" : "10", rpe })),
      },
    ],
  };
}

await (async () => {
  await test("1. trois séries avec RPE 5 / 9 / 9 : le payload est valide et chaque série garde SA valeur", () => {
    const analyse = workoutFeedbackPayloadSchema.safeParse({
      sessionKey: "sess-rpe",
      sessionRefLabel: "Séance RPE",
      completed: true,
      globalRpe: 7,
      globalComment: "",
      pain: "",
      exercises: payloadMuscu([5, 9, 9]).exercises,
    });
    assert.ok(analyse.success, analyse.success ? "" : JSON.stringify(analyse.error.issues));
    assert.deepEqual(analyse.data!.exercises[0].sets.map((s) => s.rpe), [5, 9, 9]);
  });

  await test("2. sauvegarde puis RELECTURE des trois valeurs 5/9/9 par série (exercise_set_feedback.rpe)", async () => {
    const { client, table } = creerBase();
    const sauvé = await saveWorkoutFeedback(client, payloadMuscu([5, 9, 9]));
    assert.ok(sauvé, "écriture réussie");
    assert.deepEqual(
      table("exercise_set_feedback").map((l) => [l.set_number, l.rpe]),
      [[1, 5], [2, 9], [3, 9]],
      "chaque série porte SON rpe en base",
    );
    assert.equal(table("exercise_feedback")[0].rpe, null, "aucun RPE global inventé pour la muscu");
    // Relecture par le chemin réel (élève ET coach lisent via ces fonctions).
    const [relu] = await getWorkoutFeedbackForStudent(client, ELEVE);
    assert.deepEqual(relu.exerciseEntries.map((e) => [e.setNumber, e.rpe]), [[1, 5], [2, 9], [3, 9]]);
    assert.ok(relu.exerciseEntries.every((e) => e.exerciseRpe === null), "pas de global fantôme");
  });

  await test("3. placeholder RPE par série — la PRESCRIPTION du coach seulement (volet builder), jamais l'historique", () => {
    // RPE CIBLE prescrit → placeholder par série.
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "", reps: "", recommendedRpe: "7" }, { loadUsed: "45 kg", repsDone: "10", rpe: 5 }, 1).rpe, "RPE 7");
    // Sans prescription : neutre — même quand un RPE passé de série existe
    // (il reste dans la ligne « Dernières perfs », jamais dans le champ).
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "", reps: "" }, { loadUsed: "45 kg", repsDone: "10", rpe: 5 }, 1).rpe, "RPE");
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "", reps: "" }, { loadUsed: "45 kg", repsDone: "10", rpe: null }, 1).rpe, "RPE");
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "", reps: "" }, null, 1).rpe, "RPE");
  });

  await test("4. les placeholders ne partent jamais dans le payload (champ RPE inclus)", () => {
    assert.equal(hasRealizedSetInput({ loadUsed: "", repsDone: "", rpe: "" }), false, "série vide → exclue du payload");
    assert.equal(hasRealizedSetInput({ loadUsed: "", repsDone: "", rpe: "7" }), true, "un RPE saisi seul est une saisie réelle");
    const carte = sansCommentaires(sourceCarte);
    assert.ok(!/value=\{[^}]*previous/.test(carte), "previous jamais dans value=");
    assert.ok(carte.includes("placeholder={placeholders.rpe}"), "le RPE passé ne vit que dans placeholder");
    const section = sansCommentaires(sourceSection);
    assert.equal(section.split(".filter(hasRealizedSetInput)").length - 1, 2, "les deux chemins d'envoi filtrent la saisie réelle");
  });

  await test("5. ancien retour : RPE global affiché UNE seule fois, libellé honnête", () => {
    const entrées = [
      { exerciseName: "Squat", setNumber: 1, exerciseRpe: 9 },
      { exerciseName: "Squat", setNumber: 2, exerciseRpe: 9 },
      { exerciseName: "Squat", setNumber: 3, exerciseRpe: 9 },
    ];
    const mentions = exerciseGlobalRpeMentions(entrées);
    assert.deepEqual(mentions, [{ exerciseName: "Squat", rpe: 9 }], "une mention par exercice, pas par série");
    assert.ok(sourceCarte.includes("RPE global de l&apos;exercice"), "libellé honnête côté formulaire");
    assert.ok(sourceHistorique.includes("RPE global de l&apos;exercice"), "libellé honnête côté historique élève");
    assert.ok(sourceModaleCoach.includes("RPE global de l&apos;exercice"), "libellé honnête côté coach");
  });

  await test("6. l'ancien RPE global n'est JAMAIS répété par série (lecture réelle d'un ancien feedback)", async () => {
    const { client, table } = creerBase();
    // Ancien retour en base : rpe global 7 sur l'exercice, séries SANS rpe.
    table("workout_feedback").push({
      id: "fb-ancien", student_id: ELEVE, session_key: "sess-ancienne", session_ref_label: "Ancienne",
      completed: true, global_rpe: 7, global_comment: "", pain: "", status: "a-traiter", coach_reply: "",
      submitted_at: "2026-07-01T10:00:00Z", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-01T10:00:00Z",
      session_id: null, program_id: null, prescribed_snapshot: null, performed_at: "2026-07-01",
      duration_minutes: null, session_status: "done",
    });
    table("exercise_feedback").push({ id: "ef-ancien", workout_feedback_id: "fb-ancien", student_id: ELEVE, exercise_name: "Squat", exercise_order: 0, rpe: 7, comment: "", exercise_id: null, created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-01T10:00:00Z" });
    table("exercise_set_feedback").push(
      { id: "esf-1", exercise_feedback_id: "ef-ancien", student_id: ELEVE, set_number: 1, load_used: "80 kg", reps_done: "8", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-01T10:00:00Z" },
      { id: "esf-2", exercise_feedback_id: "ef-ancien", student_id: ELEVE, set_number: 2, load_used: "80 kg", reps_done: "7", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-01T10:00:00Z" },
    );
    const [relu] = await getWorkoutFeedbackForStudent(client, ELEVE);
    assert.ok(relu.exerciseEntries.every((e) => e.rpe === null), "aucune série ne reçoit le global recopié");
    assert.ok(relu.exerciseEntries.every((e) => e.exerciseRpe === 7), "le global reste disponible, à part");
    assert.deepEqual(exerciseGlobalRpeMentions(relu.exerciseEntries), [{ exerciseName: "Squat", rpe: 7 }]);
  });

  await test("7. série sans RPE acceptée (payload, écriture, relecture)", async () => {
    const analyse = workoutFeedbackPayloadSchema.safeParse({
      sessionKey: "s", sessionRefLabel: "", completed: true, globalRpe: null, globalComment: "", pain: "",
      exercises: [{ exerciseName: "Squat", exerciseOrder: 0, rpe: null, comment: "", sets: [{ setNumber: 1, loadUsed: "80", repsDone: "8" }] }],
    });
    assert.ok(analyse.success, "clé rpe absente d'une série : acceptée");
    const { client, table } = creerBase();
    await saveWorkoutFeedback(client, payloadMuscu([5, null, 9]));
    assert.deepEqual(table("exercise_set_feedback").map((l) => l.rpe), [5, null, 9], "null conservé tel quel, jamais inventé");
  });

  await test("8. validation 1-10 : bornes du schéma, du parseur de champ, et de la migration", () => {
    const base = {
      sessionKey: "s", sessionRefLabel: "", completed: true, globalRpe: null, globalComment: "", pain: "",
    };
    const avecRpe = (rpe: number) => ({
      ...base,
      exercises: [{ exerciseName: "Squat", exerciseOrder: 0, rpe: null, comment: "", sets: [{ setNumber: 1, loadUsed: "80", repsDone: "8", rpe }] }],
    });
    assert.ok(workoutFeedbackPayloadSchema.safeParse(avecRpe(1)).success);
    assert.ok(workoutFeedbackPayloadSchema.safeParse(avecRpe(10)).success);
    assert.equal(workoutFeedbackPayloadSchema.safeParse(avecRpe(0)).success, false, "0 refusé");
    assert.equal(workoutFeedbackPayloadSchema.safeParse(avecRpe(11)).success, false, "11 refusé");
    // Parseur du champ formulaire : mêmes bornes, "" = null, jamais d'écrêtage.
    assert.deepEqual(parseRpeInput(""), { ok: true, rpe: null });
    assert.deepEqual(parseRpeInput(" 10 "), { ok: true, rpe: 10 });
    assert.deepEqual(parseRpeInput("0"), { ok: false });
    assert.deepEqual(parseRpeInput("11"), { ok: false });
    // Depuis feat/nutrition-linebreaks-rpe-halves, le RPE avance par pas de
    // 0,5 : « 9,5 » est désormais VALIDE, et la virgule française est
    // acceptée à la saisie. Ce qui reste refusé, c'est le hors-grille.
    assert.deepEqual(parseRpeInput("9,5"), { ok: true, rpe: 9.5 });
    assert.deepEqual(parseRpeInput("9.5"), { ok: true, rpe: 9.5 });
    assert.deepEqual(parseRpeInput("9,2"), { ok: false });
    assert.equal(workoutFeedbackPayloadSchema.safeParse(avecRpe(7.5)).success, true, "7,5 accepté");
    assert.equal(workoutFeedbackPayloadSchema.safeParse(avecRpe(7.2)).success, false, "7,2 refusé");
    // Migration : contrainte SQL avec les bornes exactes, colonne nullable.
    // Les commentaires SQL (--) et littéraux ('…') sont retirés AVANT les
    // gardes négatives — mes propres commentaires documentent justement
    // « aucun backfill » (pattern maison anti-faux-positif).
    const migrationSql = sourceMigration.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
    assert.ok(/rpe is null or \(rpe >= 1 and rpe <= 10\)/.test(migrationSql));
    // La migration d'ORIGINE créait bien la colonne en `integer` : elle n'est
    // pas réécrite, c'est 20260830090000 qui la passe en `numeric` par la
    // suite. Ce test décrit l'histoire, il ne la corrige pas.
    assert.ok(/add column if not exists rpe integer/.test(migrationSql));
    assert.ok(!/default/i.test(migrationSql), "aucun défaut : les lignes existantes restent intactes");
    assert.ok(!/\bupdate\b|backfill/i.test(migrationSql), "aucun backfill");
  });

  await test("9. cardio non régressé : le payload réel du sérialiseur passe et s'écrit à l'identique", async () => {
    const entreeCardio = serializeCardioBlockResult({
      version: CARDIO_BLOCK_RESULT_VERSION,
      blockId: "bloc-1", order: 1, title: "Effort continu", completed: true,
      durationSeconds: 1800, distanceMeters: 4000, elevationGainMeters: null, repetitionsDone: null,
      rpe: 8, pain: "", comment: "Bonnes sensations", prescribed: { durationSeconds: 1800, distanceMeters: null, elevationGainMeters: null, repetitions: null },
    });
    assert.equal(entreeCardio.exerciseName, CARDIO_RESULT_ENTRY_NAME);
    assert.ok(entreeCardio.sets.every((s) => !("rpe" in s)), "le contrat cardio n'émet aucun rpe de série");
    const corps = {
      sessionKey: "sess-cardio", sessionRefLabel: "Cardio", completed: true, globalRpe: 8, globalComment: "", pain: "",
      exercises: [entreeCardio],
    };
    assert.ok(workoutFeedbackPayloadSchema.safeParse(corps).success, "payload cardio réel accepté (protections PR #53)");
    const { client, table } = creerBase();
    await saveWorkoutFeedback(client, { studentId: ELEVE, ...corps });
    assert.equal(table("exercise_feedback")[0].rpe, 8, "rpe de BLOC cardio conservé au niveau exercice");
    assert.ok(table("exercise_set_feedback").every((l) => l.rpe === null), "aucun rpe de série inventé pour le cardio");
  });

  await test("10. commentaire cardio non régressé : l'enveloppe JSON se relit avec le commentaire libre", async () => {
    const entreeCardio = serializeCardioBlockResult({
      version: CARDIO_BLOCK_RESULT_VERSION,
      blockId: "bloc-2", order: 1, title: "EMOM", completed: false,
      durationSeconds: 900, distanceMeters: null, elevationGainMeters: null, repetitionsDone: 8,
      rpe: null, pain: "", comment: "Mollet droit sensible", prescribed: { durationSeconds: 1200, distanceMeters: null, elevationGainMeters: null, repetitions: 10 },
    });
    const { client } = creerBase();
    await saveWorkoutFeedback(client, {
      studentId: ELEVE, sessionKey: "sess-cardio2", sessionRefLabel: "Cardio", completed: false,
      globalRpe: null, globalComment: "", pain: "", exercises: [entreeCardio],
    });
    const [relu] = await getWorkoutFeedbackForStudent(client, ELEVE);
    const parsed = parseCardioResults(relu.exerciseEntries);
    assert.equal(parsed.blocks.length, 1);
    assert.equal(parsed.blocks[0].comment, "Mollet droit sensible", "commentaire libre intact dans l'enveloppe");
    assert.equal(parsed.blocks[0].repetitionsDone, 8);
  });

  await test("11. édition d'un retour existant : remplacement idempotent, RPE par série réécrits, snapshot intact", async () => {
    const { client, table } = creerBase();
    await saveWorkoutFeedback(client, payloadMuscu([5, 9, 9]));
    // Photographie posée par un cycle antérieur : elle doit rester intacte.
    table("workout_feedback")[0].prescribed_snapshot = { version: 1, sessionId: "s", sessionName: "S", blocks: [] };
    const empreinte = JSON.stringify(table("workout_feedback")[0].prescribed_snapshot);
    await saveWorkoutFeedback(client, payloadMuscu([6, null, 10]));
    assert.equal(table("workout_feedback").length, 1, "toujours UN retour par élève+séance (idempotence inchangée)");
    assert.deepEqual(table("exercise_set_feedback").map((l) => [l.set_number, l.rpe]), [[1, 6], [2, null], [3, 10]], "anciennes séries remplacées, pas dupliquées");
    assert.equal(JSON.stringify(table("workout_feedback")[0].prescribed_snapshot), empreinte, "prescribed_snapshot jamais réécrit");
    // Côté formulaire : l'édition restaure les valeurs réellement enregistrées
    // et ne réinjecte JAMAIS un RPE global dans les champs de série.
    const section = sansCommentaires(sourceSection);
    assert.ok(section.includes("rpe: entrée.rpe != null ? String(entrée.rpe) : \"\""), "restauration du RPE de série tel qu'enregistré");
  });

  await test("12. affichage coach : RPE de série sur la ligne, mention globale unique (jamais recopiée)", () => {
    const coach = sansCommentaires(sourceModaleCoach);
    assert.ok(coach.includes("entry.rpe !== null") && coach.includes("RPE {formatRpeFr(entry.rpe)}"),
      "RPE affiché par série seulement s'il existe, et francisé (7,5 et non 7.5)");
    assert.ok(coach.includes("exerciseGlobalRpeMentions(feedback.exerciseEntries)"), "mention globale calculée une fois par exercice");
    assert.ok(!/entry\.exerciseRpe[^=]*RPE \{/.test(coach), "le global n'est jamais rendu sur une ligne de série");
  });

  await test("13. affichage élève (formulaire) : repères par série + mention globale honnête pour l'ancien format", () => {
    const exercice: Exercise = { id: "ex-1", name: "Squat", sets: 2, reps: "8", restSeconds: 90, tempo: "", recommendedLoad: "50 kg", videoUrl: "" };
    const saisie: ExerciseFeedback = {
      studentId: ELEVE, sessionId: "s", exerciseId: "ex-1", exerciseName: "Squat",
      sets: [1, 2].map((n) => ({ studentId: ELEVE, sessionId: "s", exerciseId: "ex-1", setNumber: n, loadUsed: "", repsDone: "", rpe: "" })),
      rpe: null, comment: "",
    };
    // Historique ANCIEN format : séries sans rpe propre + RPE global 9.
    const html = renderToString(createElement(ExerciseFeedbackCard, {
      exercise: exercice, index: 0, feedback: saisie,
      previous: { sets: { 1: { loadUsed: "45 kg", repsDone: "10", rpe: null } }, exerciseRpe: 9, performedAt: "2026-07-20", matchedBy: "name" },
      onSetChange: () => {}, onCommentChange: () => {},
    }));
    // SSR React : apostrophe encodée (&#x27;) et nœud-commentaire entre le
    // texte et l'expression — on vérifie le libellé et la valeur séparément.
    assert.ok(/RPE global de l&#x27;exercice/.test(html), "libellé honnête rendu");
    assert.ok(/RPE global de l&#x27;exercice[^<]*(<!-- -->)?9/.test(html), "valeur 9 rendue avec la mention");
    assert.equal(html.split("RPE global de").length - 1, 1, "mention affichée UNE fois");
    assert.ok(!html.includes('placeholder="RPE 9"'), "le global n'apparaît JAMAIS en placeholder de série");
    assert.ok(html.includes("45 kg × 10"), "charge/reps de la série restent des repères");
    assert.ok(!html.includes("45 kg × 10 · RPE"), "la ligne de série n'affiche pas de RPE inventé");
  });

  await test("14. historique élève : RPE par série réel + mention globale unique", () => {
    const histo = sansCommentaires(sourceHistorique);
    assert.ok(histo.includes("entree.rpe != null") && histo.includes("RPE ${formatRpeFr(entree.rpe)}"),
      "RPE de série seulement s'il existe, et francisé");
    assert.ok(histo.includes("exerciseGlobalRpeMentions(feedback.exerciseEntries)"), "mention globale unique par exercice");
  });

  await test("15. prescribed_snapshot : aucune modification possible depuis ce chantier", () => {
    assert.ok(!/prescribed_snapshot/.test(sansCommentaires(sourceCarte)));
    assert.ok(!/prescribed_snapshot\s*[:=]/.test(sansCommentaires(sourceLibPerf)), "la lib de repères ne l'écrit jamais");
    assert.ok(!/prescribed_snapshot/i.test(sansCommentaires(sourceMigration).replace(/'[^']*'/g, "")), "la migration ne touche pas au snapshot");
  });

  await test("16. aucune création de feedback au simple AFFICHAGE des repères", () => {
    const lib = sansCommentaires(sourceLibPerf);
    assert.ok(!/\.insert\(|\.update\(|\.delete\(|fetch\(/.test(lib), "lib de repères 100 % lecture/pure");
    const carte = sansCommentaires(sourceCarte);
    assert.ok(!/fetch\(|\.insert\(|saveWorkoutFeedback/.test(carte), "la carte ne déclenche aucune écriture");
  });

  await test("17. mobile et clavier : champ RPE par série accessible (numérique, étiqueté), grille responsive", () => {
    const exercice: Exercise = { id: "ex-1", name: "Squat", sets: 3, reps: "", restSeconds: 90, tempo: "", recommendedLoad: "", videoUrl: "" };
    const saisie: ExerciseFeedback = {
      studentId: ELEVE, sessionId: "s", exerciseId: "ex-1", exerciseName: "Squat",
      sets: [1, 2, 3].map((n) => ({ studentId: ELEVE, sessionId: "s", exerciseId: "ex-1", setNumber: n, loadUsed: "", repsDone: "", rpe: n === 1 ? "5" : "" })),
      rpe: null, comment: "",
    };
    const html = renderToString(createElement(ExerciseFeedbackCard, {
      exercise: exercice, index: 0, feedback: saisie,
      onSetChange: () => {}, onCommentChange: () => {},
    }));
    // `decimal` et non `numeric` depuis feat/nutrition-linebreaks-rpe-halves :
    // le clavier `numeric` d'iOS n'expose ni point ni virgule, ce qui rendait
    // le demi-point insaisissable au doigt.
    assert.equal(html.split('inputMode="decimal"').length - 1, 3, "clavier décimal mobile sur chaque RPE");
    assert.equal(html.split('inputMode="numeric"').length - 1, 0, "plus aucun clavier entier sur un RPE");
    assert.equal(html.split("aria-label").length - 1, 3, "chaque RPE de série est étiqueté");
    assert.ok(html.includes('value="5"'), "la saisie RPE est un état contrôlé");
    assert.equal(html.split("grid-cols-2").length - 1, 3, "grille mobile charge+reps côte à côte, par série (refonte apple-ui)");
    assert.ok(!html.includes("<select"), "plus de sélecteur RPE d'exercice : la saisie vit par série");
  });

  await test("18. charge, répétitions et RPE indépendants champ par champ (priorité par champ)", () => {
    // Prescription charge + RPE cible, pas de reps prescrites, historique complet.
    const placeholders = resolveSetPlaceholders(
      { recommendedLoad: "50 kg", reps: "", recommendedRpe: "9" },
      { loadUsed: "45 kg", repsDone: "10", rpe: 8 },
      1,
    );
    assert.equal(placeholders.load, "Charge (50 kg)", "charge : prescription prioritaire");
    assert.equal(placeholders.reps, "10", "répétitions : historique (pas de prescription)");
    assert.equal(placeholders.rpe, "RPE 9", "RPE : la PRESCRIPTION (jamais le RPE passé 8)");
    // Historique partiel sans prescription : un champ absent reste neutre.
    const partiel = resolveSetPlaceholders({ recommendedLoad: "", reps: "" }, { loadUsed: "", repsDone: "9", rpe: null }, 1);
    assert.deepEqual(partiel, { load: "Charge", reps: "9", rpe: "RPE" });
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
