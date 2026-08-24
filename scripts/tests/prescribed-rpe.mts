/**
 * Harnais — feat/student-previous-set-performance, volet builder :
 * prescription « RPE CIBLE » par exercice (workout_exercises.recommended_rpe,
 * migration 20260803190000).
 *
 * Couvre : parsing (valeur unique / séquence / bornes / invalide), builder
 * (champ, défauts, message d'erreur, payload), sauvegarde/rechargement (RPC
 * SQL + mapping lecture), copie individuelle et rejeu (provision_program_copy),
 * snapshot (inclusion + immutabilité), priorité placeholder (prescription >
 * jamais l'historique), cardio intact, anciens programmes, mobile/clavier.
 *
 * Lancement : npx tsx scripts/tests/prescribed-rpe.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  formatPreviousSetLabel,
  hasRealizedSetInput,
  parsePrescribedRpe,
  prescribedRpeForSet,
  resolveSetPlaceholders,
} from "../../lib/previous-performance";
import { buildPrescribedSnapshot, isPrescribedSnapshot, resolvePrescription } from "../../lib/workout-history";
import { blankExercise, exerciseFromLibrary } from "../../components/admin/ProgramBuilder";
import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import type { Exercise, ExerciseFeedback, ExerciseLibraryItem } from "../../types";
import { verifierLeFiltreDeSaisieReelle } from "./helpers/filtre-saisie-reelle";

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

const sourceMigration = readFileSync(
  new URL("../../supabase/migrations/20260803190000_add_recommended_rpe_to_workout_exercises.sql", import.meta.url),
  "utf8",
);
const migrationSql = sourceMigration.replace(/--[^\n]*/g, "");
const sourceBuilder = readFileSync(new URL("../../components/admin/ProgramBuilder.tsx", import.meta.url), "utf8");
const sourcePayload = readFileSync(new URL("../../lib/supabase/training-session-blocks.ts", import.meta.url), "utf8");
const sourcePrograms = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
const sourceSchedule = readFileSync(new URL("../../lib/training-schedule.ts", import.meta.url), "utf8");
const sourceCardioLib = readFileSync(new URL("../../lib/cardio-feedback.ts", import.meta.url), "utf8");

function carteHtml(options: { recommendedRpe?: string; rpeSaisi?: string; previousRpe?: number | null }): string {
  const exercice: Exercise = {
    id: "ex-1", name: "Squat", sets: 3, reps: "13", restSeconds: 90, tempo: "",
    recommendedLoad: "30", videoUrl: "", recommendedRpe: options.recommendedRpe ?? "",
  };
  const saisie: ExerciseFeedback = {
    studentId: "e", sessionId: "s", exerciseId: "ex-1", exerciseName: "Squat",
    sets: [1, 2, 3].map((n) => ({
      studentId: "e", sessionId: "s", exerciseId: "ex-1", setNumber: n,
      loadUsed: "", repsDone: "", rpe: n === 1 ? (options.rpeSaisi ?? "") : "",
    })),
    rpe: null, comment: "",
  };
  return renderToString(createElement(ExerciseFeedbackCard, {
    exercise: exercice, index: 0, feedback: saisie,
    previous: options.previousRpe !== undefined
      ? { sets: { 1: { loadUsed: "32 kg", repsDone: "10", rpe: options.previousRpe } }, exerciseRpe: null, performedAt: "2026-07-20", matchedBy: "name" as const }
      : null,
    onSetChange: () => {}, onCommentChange: () => {},
  }));
}

await (async () => {
  await test("1. builder sans RPE prescrit : champ vide accepté, aucune prescription appliquée", () => {
    assert.deepEqual(parsePrescribedRpe(""), { ok: true, values: null });
    assert.deepEqual(parsePrescribedRpe(null), { ok: true, values: null });
    assert.equal(prescribedRpeForSet("", 1), null);
    assert.equal(blankExercise(1).recommendedRpe, "", "nouvel exercice sans prescription");
    const depuisBanque = exerciseFromLibrary(1, {
      id: "lib-1", name: "Squat", category: "", muscleGroup: "jambes", videoUrl: "", alternativeVideoUrl: "",
      technicalNote: "", defaultTempo: "", defaultRestSeconds: 60,
    } as unknown as ExerciseLibraryItem);
    assert.equal(depuisBanque.recommendedRpe, "", "exercice de la banque sans prescription");
  });

  await test("2. RPE unique « 8 » appliqué à TOUTES les séries", () => {
    for (const série of [1, 2, 3, 4, 5]) {
      assert.equal(prescribedRpeForSet("8", série), 8);
    }
  });

  await test("3. séquence « 8-8-9 » appliquée par index de série", () => {
    assert.equal(prescribedRpeForSet("8-8-9", 1), 8);
    assert.equal(prescribedRpeForSet("8-8-9", 2), 8);
    assert.equal(prescribedRpeForSet("8-8-9", 3), 9);
    assert.equal(prescribedRpeForSet(" 8 - 8 - 9 ", 3), 9, "espaces tolérés");
  });

  await test("4. séquence plus courte que le nombre de séries : les séries au-delà restent sans prescription", () => {
    assert.equal(prescribedRpeForSet("8-8", 3), null);
    assert.equal(prescribedRpeForSet("8-8", 4), null);
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "", reps: "", recommendedRpe: "8-8" }, null, 3).rpe, "RPE");
  });

  await test("5. valeurs 1 et 10 acceptées (bornes)", () => {
    assert.deepEqual(parsePrescribedRpe("1"), { ok: true, values: [1] });
    assert.deepEqual(parsePrescribedRpe("10"), { ok: true, values: [10] });
    assert.deepEqual(parsePrescribedRpe("1-10"), { ok: true, values: [1, 10] });
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "", reps: "", recommendedRpe: "10" }, null, 2).rpe, "RPE 10");
  });

  await test("6. 0 et 11 refusés — jamais appliqués, jamais écrêtés", () => {
    assert.deepEqual(parsePrescribedRpe("0"), { ok: false });
    assert.deepEqual(parsePrescribedRpe("11"), { ok: false });
    assert.deepEqual(parsePrescribedRpe("8-11"), { ok: false });
    assert.equal(prescribedRpeForSet("0", 1), null);
    assert.equal(prescribedRpeForSet("8-11", 1), null, "séquence invalide : AUCUNE valeur appliquée, même les bonnes");
  });

  await test("7. texte invalide refusé + message clair côté builder", () => {
    // « 9,5 » a QUITTÉ cette liste : le demi-point est valide depuis
    // feat/nutrition-linebreaks-rpe-halves. « 9,2 » et « 9,55 » le
    // remplacent — ce qui est refusé, c'est le hors-grille, pas la virgule.
    for (const invalide of ["abc", "8-x", "8/9", "9,2", "9,55", "8--9", "-8"]) {
      assert.deepEqual(parsePrescribedRpe(invalide), { ok: false }, `« ${invalide} » doit être refusé`);
      assert.equal(prescribedRpeForSet(invalide, 1), null);
    }
    const builder = sansCommentaires(sourceBuilder);
    assert.ok(builder.includes("RPE cible (ex : 8, 8,5 ou 8-8,5-9)"), "champ visible avec son format");
    // Et le demi-point passe réellement, seul comme en séquence.
    assert.deepEqual(parsePrescribedRpe("8,5"), { ok: true, values: [8.5] });
    assert.deepEqual(parsePrescribedRpe("8-8,5-9"), { ok: true, values: [8, 8.5, 9] });
    assert.ok(builder.includes("parsePrescribedRpe(exercise.recommendedRpe"), "validation branchée sur la saisie");
    assert.ok(builder.includes("RPE cible invalide"), "message d'erreur clair");
  });

  await test("8. sauvegarde et rechargement du builder sans perte (payload → RPC → lecture)", () => {
    // Payload du builder : la clé part vers la RPC.
    assert.ok(sansCommentaires(sourcePayload).includes("recommended_rpe: ex.recommendedRpe ?? \"\""));
    // RPC : écrite à l'UPDATE et à l'INSERT ('' normalisé en NULL), relue
    // dans le modèle canonique retourné.
    assert.ok(migrationSql.includes("recommended_rpe = nullif(v_exercise->>'recommended_rpe', '')"));
    assert.ok(/insert into public\.workout_exercises \(\s*session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo,\s*recommended_load, recommended_rpe,/.test(migrationSql), "INSERT de la RPC avec la colonne");
    assert.ok(migrationSql.includes("'recommendedRpe', we.recommended_rpe"), "modèle canonique retourné");
    // Lecture app : mapExerciseRow + bord élève.
    assert.ok(sansCommentaires(sourcePrograms).includes("recommendedRpe: row.recommended_rpe ?? \"\""));
    assert.ok(sansCommentaires(sourceSchedule).includes("recommendedRpe: exercise.recommendedRpe ?? \"\""));
  });

  await test("9. copie individuelle : provision_program_copy copie recommended_rpe (liste explicite complétée)", () => {
    assert.ok(
      /insert into public\.workout_exercises \(\s*session_id, block_id, order_index, name, sets, reps, rest_seconds,\s*tempo, recommended_load, recommended_rpe,/.test(migrationSql),
      "colonne dans la liste d'insertion de la copie",
    );
    assert.ok(migrationSql.includes("v_exercise.recommended_load, v_exercise.recommended_rpe"), "valeur copiée depuis le modèle");
  });

  await test("10. rejeu de provision_program_copy sans doublon : échelle d'idempotence et verrou conservés", () => {
    assert.ok(migrationSql.includes("pg_advisory_xact_lock"), "verrou advisory conservé");
    assert.ok(migrationSql.includes("owner_student_id = p_student_id and source_template_id = p_program_id"), "réutilisation de la copie existante (pas de recopie)");
    assert.ok(migrationSql.includes("source_checkout_session_id = p_checkout_session_id"), "idempotence par session Checkout conservée");
    assert.ok(migrationSql.includes("p.user_id = auth.uid()"), "garde staff par user_id conservée");
    assert.ok(migrationSql.includes("REVOKE EXECUTE ON FUNCTION public.provision_program_copy(uuid, uuid, text) FROM anon"), "anon toujours exclu");
  });

  await test("11. le snapshot contient le RPE prescrit au moment de la soumission", () => {
    const snapshot = buildPrescribedSnapshot(
      { id: "sess-1", name: "Séance A", day: "lundi" },
      [{ id: "bloc-1", title: null, block_type: "strength", position: 0 }],
      [{
        block_id: "bloc-1", exercise_library_id: null, name: "Squat", order_index: 0,
        sets: 3, reps: "13", recommended_load: "30", recommended_rpe: "8-8-9",
        rest_seconds: 90, tempo: null, notes: null,
      }],
      "2026-08-03T10:00:00Z",
    );
    assert.equal(snapshot.blocks[0].exercises[0].recommendedRpe, "8-8-9");
    assert.ok(isPrescribedSnapshot(snapshot));
  });

  await test("12. un ANCIEN snapshot reste inchangé après modification du programme", () => {
    // Snapshot pré-chantier (sans recommendedRpe), gelé : toujours valide,
    // jamais réécrit ni complété — le RPE cible modifié ensuite par le coach
    // ne s'y propage pas (le snapshot n'est construit qu'à la soumission).
    const ancien = Object.freeze({
      version: 1, sessionId: "s", sessionName: "S", day: null, weekNumber: null,
      capturedAt: "2026-07-01T10:00:00Z",
      blocks: Object.freeze([]),
    });
    const empreinte = JSON.stringify(ancien);
    assert.ok(isPrescribedSnapshot(ancien), "l'ancienne forme (sans recommendedRpe) reste un snapshot valide");
    const résolu = resolvePrescription(ancien, true);
    assert.equal(résolu.source, "snapshot");
    assert.equal(JSON.stringify(résolu.snapshot), empreinte, "résolution en lecture seule");
    assert.equal(JSON.stringify(ancien), empreinte, "aucune mutation");
  });

  await test("13. RPE PRESCRIT prioritaire sur RPE historique dans le placeholder", () => {
    const placeholders = resolveSetPlaceholders(
      { recommendedLoad: "30", reps: "13", recommendedRpe: "7" },
      { loadUsed: "32 kg", repsDone: "10", rpe: 8 },
      1,
    );
    assert.equal(placeholders.load, "Charge (30)");
    assert.equal(placeholders.reps, "Reps (13)");
    assert.equal(placeholders.rpe, "RPE 7", "prescription — jamais le 8 historique");
  });

  await test("14. sans prescription, placeholder EXACTEMENT « RPE » (même avec un RPE passé)", () => {
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "30", reps: "13" }, { loadUsed: "32 kg", repsDone: "10", rpe: 8 }, 1).rpe, "RPE");
    const html = carteHtml({ previousRpe: 8 });
    assert.ok(html.includes('placeholder="RPE"'), "libellé neutre exact");
    assert.ok(!html.includes('placeholder="RPE 8"'), "le RPE passé jamais en placeholder");
  });

  await test("15. le RPE historique reste affiché dans la ligne « Dernières perfs »", () => {
    assert.equal(formatPreviousSetLabel({ loadUsed: "32 kg", repsDone: "10", rpe: 8 }), "32 kg × 10 · RPE 8");
    const html = carteHtml({ recommendedRpe: "7", previousRpe: 8 });
    assert.ok(html.includes("32 kg × 10 · RPE 8"), "ligne repère complète, RPE passé inclus");
    assert.ok(html.includes('placeholder="RPE 7"'), "et le champ porte la PRESCRIPTION");
  });

  await test("16. les placeholders (prescription incluse) ne partent jamais dans le payload", () => {
    assert.equal(hasRealizedSetInput({ loadUsed: "", repsDone: "", rpe: "" }), false, "série vide malgré tous ses placeholders → exclue");
    verifierLeFiltreDeSaisieReelle();
    const carte = sansCommentaires(readFileSync(new URL("../../components/student/ExerciseFeedbackCard.tsx", import.meta.url), "utf8"));
    assert.ok(!/value=\{[^}]*placeholders/.test(carte), "un placeholder ne devient jamais une value");
  });

  await test("17. la saisie de l'élève est prioritaire sur la prescription (value masque le placeholder)", () => {
    const html = carteHtml({ recommendedRpe: "7", rpeSaisi: "9" });
    assert.ok(html.includes('value="9"'), "saisie rendue dans value");
    assert.ok(html.includes('placeholder="RPE 7"'), "placeholder toujours présent dans le DOM — masqué par la saisie (sémantique navigateur)");
  });

  await test("18. cardio inchangé : ni payload cardio ni contrat cardio ne portent recommended_rpe", () => {
    const payload = sansCommentaires(sourcePayload);
    const brancheCardio = payload.split("cardio_type: block.cardioType")[1] ?? "";
    assert.ok(!brancheCardio.split("export")[0].includes("recommended_rpe"), "la branche cardio du payload est intacte");
    assert.ok(!sansCommentaires(sourceCardioLib).includes("recommended_rpe"), "lib cardio intacte");
    assert.ok(!/recommended_rpe/.test(migrationSql.split("-- ── 3.")[0].split("training_prescriptions")[1] ?? ""), "prescriptions cardio de la RPC intactes");
  });

  await test("19. anciens programmes (colonne non renseignée) toujours fonctionnels", () => {
    // Lecture : NULL → "" partout, aucune prescription appliquée.
    assert.equal(prescribedRpeForSet(undefined, 1), null);
    assert.equal(resolveSetPlaceholders({ recommendedLoad: "30", reps: "13" }, null, 1).rpe, "RPE");
    // Rendu : pas de mention « RPE cible » sans prescription.
    const html = carteHtml({});
    assert.ok(!html.includes("RPE cible"), "aucune mention fantôme");
    assert.ok(html.includes('placeholder="Charge (30)"') && html.includes('placeholder="Reps (13)"'), "les autres prescriptions vivent normalement");
    // Migration : aucune ligne existante modifiée (ni défaut ni backfill).
    const sqlSansLitteraux = migrationSql.replace(/'(?:[^']|'')*'/g, "''");
    assert.ok(/add column if not exists recommended_rpe text\s*;/.test(sqlSansLitteraux), "colonne nullable sans défaut");
    assert.ok(!/\balter table[^;]*default\b/i.test(sqlSansLitteraux), "aucun défaut");
    assert.ok(!/backfill/i.test(sqlSansLitteraux), "aucun backfill");
  });

  await test("20. mobile et clavier non régressés (grille, champs, mention RPE cible unique)", () => {
    const html = carteHtml({ recommendedRpe: "8-8-9", previousRpe: 8 });
    assert.equal(html.split("sm:grid-cols-[72px_1fr_1fr_84px]").length - 1, 3, "une grille responsive par série");
    // `decimal` et non `numeric` depuis feat/nutrition-linebreaks-rpe-halves :
    // le clavier `numeric` d'iOS n'expose ni point ni virgule, ce qui rendait
    // le demi-point insaisissable au doigt.
    assert.equal(html.split('inputMode="decimal"').length - 1, 3, "clavier décimal sur chaque RPE de série");
    assert.equal(html.split("RPE cible").length - 1, 1, "mention « RPE cible : 8-8-9 » affichée une fois dans l'en-tête");
    // Séquence appliquée par index dans les placeholders.
    assert.ok(html.includes('placeholder="RPE 8"') && html.includes('placeholder="RPE 9"'));
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
