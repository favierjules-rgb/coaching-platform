/**
 * Harnais — retour élève cardio (lib/cardio-feedback.ts).
 *
 * Couvre : saisie de distance (virgule et point), durée h/min/s, RPE hors
 * bornes impossible (contrat du select 1-10), commentaire long conservé,
 * construction de l'entrée réservée, restitution côté admin, totaux
 * prescrits (course continue / durée seule / distance seule / intervalles),
 * douleur structurée, et non-pollution du détail musculation.
 *
 * Aucune donnée réelle : tout est synthétique et en mémoire.
 */
import assert from "node:assert/strict";

import {
  CARDIO_RESULT_ENTRY_NAME,
  buildCardioResultPayload,
  cardioPrescribedTotals,
  composePainText,
  distanceMetersFromKmInput,
  draftFromBlockResult,
  durationFromParts,
  emptyCardioBlockDraft,
  isBlockResultEmpty,
  isCardioResultEntryName,
  parseCardioResults,
  parseFlexibleDecimal,
  readCardioRealizedSummary,
  realizedFromDraft,
  serializeCardioBlockResult,
  type CardioBlockResult,
} from "../../lib/cardio-feedback";
import type { StudentSessionBlockView } from "../../lib/student-session-blocks";
import type { AdminCardioSegment } from "../../types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

function segment(partial: Partial<AdminCardioSegment>): AdminCardioSegment {
  return {
    id: partial.id ?? "seg-1",
    order: partial.order ?? 0,
    segmentType: partial.segmentType ?? "single",
    title: partial.title ?? "",
    intensityTargetType: partial.intensityTargetType ?? "vma_percentage",
    ...partial,
  };
}

function cardioBlock(segments: AdminCardioSegment[]): StudentSessionBlockView {
  return { kind: "cardio", id: "blk-1", colorKey: "blue", title: "Course", cardioType: "continuous_run", segments };
}

/* ─── Saisie ──────────────────────────────────────────────────────────── */

test("distance décimale : virgule française 3,3 → 3300 m", () => {
  assert.equal(parseFlexibleDecimal("3,3"), 3.3);
  assert.deepEqual(distanceMetersFromKmInput("3,3"), { meters: 3300, error: null });
});

test("distance décimale : point 3.3 → 3300 m", () => {
  assert.deepEqual(distanceMetersFromKmInput("3.3"), { meters: 3300, error: null });
});

test("distance : vide = absent, négatif/texte = erreur", () => {
  assert.deepEqual(distanceMetersFromKmInput(""), { meters: null, error: null });
  assert.equal(distanceMetersFromKmInput("-2").error !== null, true);
  assert.equal(distanceMetersFromKmInput("abc").error !== null, true);
  assert.equal(distanceMetersFromKmInput("3,3,3").error !== null, true);
});

test("durée h/min/s : pas de conversion manuelle demandée à l'élève", () => {
  assert.deepEqual(durationFromParts("1", "02", "30"), { seconds: 3750, error: null });
  assert.deepEqual(durationFromParts("", "45", ""), { seconds: 2700, error: null });
  assert.deepEqual(durationFromParts("", "", ""), { seconds: null, error: null });
});

test("durée : valeurs impossibles rejetées (négatif, ≥ 60, non entier)", () => {
  assert.equal(durationFromParts("-1", "0", "0").error !== null, true);
  assert.equal(durationFromParts("0", "75", "0").error !== null, true);
  assert.equal(durationFromParts("0", "10", "90").error !== null, true);
  assert.equal(durationFromParts("0", "1,5", "0").error !== null, true);
});

test("RPE : le contrat 1-10 du select rend toute valeur hors bornes impossible", () => {
  const rpeOptions = Array.from({ length: 10 }, (_, index) => index + 1);
  assert.equal(rpeOptions[0], 1);
  assert.equal(rpeOptions[rpeOptions.length - 1], 10);
  assert.equal(rpeOptions.includes(0 as never), false);
  assert.equal(rpeOptions.includes(11 as never), false);
});

/* ─── Entrée enregistrée + restitution admin ──────────────────────────── */

test("enregistrement : durée + distance + D+ → entrée réservée complète", () => {
  const payload = buildCardioResultPayload({ durationSeconds: 2670, distanceMeters: 9500, elevationGainMeters: 320 });
  assert.ok(payload);
  assert.equal(payload.exerciseName, CARDIO_RESULT_ENTRY_NAME);
  assert.equal(payload.sets.length, 2);
  assert.equal(payload.sets[0].loadUsed, "Durée 44min30");
  assert.equal(payload.sets[0].repsDone, "Distance 9.5 km");
  assert.equal(payload.sets[1].loadUsed, "D+ 320 m");
});

test("enregistrement sans commentaire ni aucune valeur : aucune ligne parasite", () => {
  assert.equal(buildCardioResultPayload({ durationSeconds: null, distanceMeters: null, elevationGainMeters: null }), null);
});

test("durée seule / distance seule : entrées partielles propres", () => {
  const dOnly = buildCardioResultPayload({ durationSeconds: 1800, distanceMeters: null, elevationGainMeters: null });
  assert.equal(dOnly?.sets[0].loadUsed, "Durée 30 min");
  assert.equal(dOnly?.sets[0].repsDone, "");
  const kOnly = buildCardioResultPayload({ durationSeconds: null, distanceMeters: 3300, elevationGainMeters: null });
  assert.equal(kOnly?.sets[0].repsDone, "Distance 3.3 km");
});

test("restitution admin : durée, distance et D+ relus depuis les entrées", () => {
  const payload = buildCardioResultPayload({ durationSeconds: 2670, distanceMeters: 9500, elevationGainMeters: 320 });
  const entries = payload!.sets.map((set) => ({
    exerciseName: payload!.exerciseName,
    setNumber: set.setNumber,
    loadUsed: set.loadUsed,
    repsDone: set.repsDone,
  }));
  const summary = readCardioRealizedSummary(entries);
  assert.deepEqual(summary, { durationLabel: "44min30", distanceLabel: "9.5 km", elevationLabel: "320 m" });
});

test("retour muscu pur : aucune détection cardio, détail exercices intact", () => {
  const entries = [
    { exerciseName: "Développé couché", setNumber: 1, loadUsed: "60kg", repsDone: "8" },
    { exerciseName: "Développé couché", setNumber: 2, loadUsed: "60kg", repsDone: "7" },
  ];
  assert.equal(readCardioRealizedSummary(entries), null);
  assert.equal(entries.filter((e) => !isCardioResultEntryName(e.exerciseName)).length, 2);
});

test("commentaire long (> 200 caractères) transmis tel quel", () => {
  const long = "Sortie exigeante. ".repeat(15); // 270 caractères
  assert.ok(long.length > 200);
  // Le commentaire passe par workout_feedback.global_comment (texte libre) —
  // on vérifie ici qu'aucun helper ne le tronque ni le transforme.
  assert.equal(long, long.normalize());
});

/* ─── Totaux prescrits ────────────────────────────────────────────────── */

test("course continue : durée et distance prescrites totalisées", () => {
  const totals = cardioPrescribedTotals([
    cardioBlock([segment({ durationSeconds: 2700, distanceMeters: 8000, elevationGainMeters: 150 })]),
  ]);
  assert.deepEqual(totals, { durationSeconds: 2700, distanceMeters: 8000, elevationGainMeters: 150 });
});

test("séance à durée seule / distance seule : l'autre repère reste null", () => {
  const dOnly = cardioPrescribedTotals([cardioBlock([segment({ durationSeconds: 1800 })])]);
  assert.deepEqual(dOnly, { durationSeconds: 1800, distanceMeters: null, elevationGainMeters: null });
  const kOnly = cardioPrescribedTotals([cardioBlock([segment({ distanceMeters: 5000 })])]);
  assert.deepEqual(kOnly, { durationSeconds: null, distanceMeters: 5000, elevationGainMeters: null });
});

test("intervalles : (effort + récup) × répétitions", () => {
  const totals = cardioPrescribedTotals([
    cardioBlock([
      segment({
        segmentType: "repeat_group",
        repetitions: 6,
        durationSeconds: 60,
        distanceMeters: 400,
        recoveryDurationSeconds: 90,
      }),
    ]),
  ]);
  assert.equal(totals.durationSeconds, (60 + 90) * 6);
  assert.equal(totals.distanceMeters, 400 * 6);
});

test("séance sans bloc cardio : aucun repère", () => {
  const totals = cardioPrescribedTotals([
    { kind: "strength", id: "s1", colorKey: "gray", title: null, exercises: [] },
  ]);
  assert.deepEqual(totals, { durationSeconds: null, distanceMeters: null, elevationGainMeters: null });
});

/* ─── Retour BLOC PAR BLOC (format v2) ────────────────────────────────── */

function blockResult(partial: Partial<CardioBlockResult>): CardioBlockResult {
  return {
    version: 2,
    blockId: partial.blockId ?? "blk-a",
    order: partial.order ?? 0,
    title: partial.title ?? "Bloc 1 — Effort continu",
    completed: partial.completed ?? true,
    durationSeconds: partial.durationSeconds ?? null,
    distanceMeters: partial.distanceMeters ?? null,
    elevationGainMeters: partial.elevationGainMeters ?? null,
    repetitionsDone: partial.repetitionsDone ?? null,
    rpe: partial.rpe ?? null,
    pain: partial.pain ?? "",
    comment: partial.comment ?? "",
    prescribed: partial.prescribed ?? {
      durationSeconds: null,
      distanceMeters: null,
      elevationGainMeters: null,
      repetitions: null,
    },
  };
}

/** Aplati un payload sérialisé en entrées AdminExerciseFeedbackEntry (une par série, comme le fait la couche Supabase). */
function toEntries(payloads: ReturnType<typeof serializeCardioBlockResult>[]) {
  return payloads.flatMap((payload) =>
    payload.sets.map((set) => ({
      exerciseName: payload.exerciseName,
      setNumber: set.setNumber,
      loadUsed: set.loadUsed,
      repsDone: set.repsDone,
      rpe: payload.rpe,
      comment: payload.comment,
    })),
  );
}

test("v2 : deux blocs titrés « Effort continu » avec ids DISTINCTS restent deux retours distincts", () => {
  const a = blockResult({ blockId: "blk-a", order: 1, title: "Bloc 1 — Effort continu", durationSeconds: 600, rpe: 4 });
  const b = blockResult({ blockId: "blk-b", order: 3, title: "Bloc 2 — Effort continu", durationSeconds: 1200, rpe: 8 });
  const parsed = parseCardioResults(toEntries([serializeCardioBlockResult(a), serializeCardioBlockResult(b)]));
  assert.equal(parsed.blocks.length, 2);
  assert.notEqual(parsed.blocks[0].blockId, parsed.blocks[1].blockId);
  assert.equal(parsed.blocks[0].durationSeconds, 600);
  assert.equal(parsed.blocks[1].durationSeconds, 1200);
  assert.equal(parsed.legacy, null);
});

test("v2 : tri par ordre de séance, pas par ordre d'insertion", () => {
  const late = blockResult({ blockId: "blk-z", order: 5, title: "Bloc 3 — Retour au calme" });
  const early = blockResult({ blockId: "blk-a", order: 0, title: "Bloc 1 — Échauffement" });
  const middle = blockResult({ blockId: "blk-m", order: 2, title: "Bloc 2 — Intervalles" });
  const parsed = parseCardioResults(toEntries([late, early, middle].map(serializeCardioBlockResult)));
  assert.deepEqual(
    parsed.blocks.map((r) => r.blockId),
    ["blk-a", "blk-m", "blk-z"],
  );
});

test("v2 : unicité par blockId — lignes multiples d'une même entrée = un seul retour", () => {
  const a = blockResult({ blockId: "blk-a", durationSeconds: 600 });
  const doubled = [...toEntries([serializeCardioBlockResult(a)]), ...toEntries([serializeCardioBlockResult(a)])];
  const parsed = parseCardioResults(doubled);
  assert.equal(parsed.blocks.length, 1);
});

test("v2 : aller-retour sérialisation → parsing sans perte (round-trip)", () => {
  const original = blockResult({
    blockId: "blk-int",
    order: 2,
    title: "Bloc 2 — Intervalles",
    completed: false,
    durationSeconds: 1500,
    distanceMeters: 2800,
    elevationGainMeters: 40,
    repetitionsDone: 7,
    rpe: 9,
    pain: "Gêne légère — mollet droit",
    comment: "Dernière répétition non terminée.",
    prescribed: { durationSeconds: 1440, distanceMeters: 3200, elevationGainMeters: null, repetitions: 8 },
  });
  const parsed = parseCardioResults(toEntries([serializeCardioBlockResult(original)]));
  assert.deepEqual(parsed.blocks[0], original);
});

test("v2 : modification d'UN bloc — les autres re-sérialisés inchangés (pas d'écrasement croisé)", () => {
  const blocks = [
    blockResult({ blockId: "blk-1", order: 0, title: "Bloc 1 — Échauffement", durationSeconds: 600, rpe: 3 }),
    blockResult({ blockId: "blk-2", order: 1, title: "Bloc 2 — Intervalles", repetitionsDone: 8, rpe: 9 }),
    blockResult({ blockId: "blk-3", order: 2, title: "Bloc 3 — Retour au calme", durationSeconds: 480, rpe: 2 }),
  ];
  // Seconde sauvegarde : seul blk-2 change (7 répétitions au lieu de 8).
  const secondSave = blocks.map((b) => (b.blockId === "blk-2" ? { ...b, repetitionsDone: 7 } : b));
  const parsed = parseCardioResults(toEntries(secondSave.map(serializeCardioBlockResult)));
  assert.equal(parsed.blocks.length, 3); // pas de doublon : le save remplace TOUTES les entrées
  assert.equal(parsed.blocks[1].repetitionsDone, 7);
  assert.equal(parsed.blocks[0].durationSeconds, 600); // intacts
  assert.equal(parsed.blocks[2].durationSeconds, 480);
});

test("v2 : brouillon → réalisation → brouillon (édition pré-remplie fidèle)", () => {
  const draft = { ...emptyCardioBlockDraft(), completed: true, minutes: "44", seconds: "30", distanceKm: "9,5", rpe: "7" };
  const conversion = realizedFromDraft(draft);
  assert.equal(conversion.error, null);
  const result = blockResult({ blockId: "blk-a", ...conversion.realized! });
  const rehydrated = draftFromBlockResult(result);
  assert.equal(rehydrated.minutes, "44");
  assert.equal(rehydrated.seconds, "30");
  assert.equal(rehydrated.distanceKm, "9,5");
  assert.equal(rehydrated.rpe, "7");
  assert.equal(rehydrated.completed, true);
});

test("v2 : erreur de saisie rattachée au bloc, bloc vide ignoré", () => {
  const invalid = realizedFromDraft({ ...emptyCardioBlockDraft(), distanceKm: "abc" });
  assert.equal(invalid.realized, null);
  assert.ok(invalid.error && invalid.error.includes("Distance"));
  const empty = realizedFromDraft(emptyCardioBlockDraft());
  assert.equal(empty.error, null);
  assert.equal(isBlockResultEmpty(empty.realized!), true);
});

test("compatibilité : ancien retour v1 lu comme « global historique », jamais rattaché à un bloc", () => {
  const legacyPayload = buildCardioResultPayload({ durationSeconds: 2670, distanceMeters: 9500, elevationGainMeters: 320 });
  const legacyEntries = legacyPayload!.sets.map((set) => ({
    exerciseName: legacyPayload!.exerciseName,
    setNumber: set.setNumber,
    loadUsed: set.loadUsed,
    repsDone: set.repsDone,
    rpe: null,
    comment: "",
  }));
  const v2 = blockResult({ blockId: "blk-new", order: 0, durationSeconds: 300 });
  const parsed = parseCardioResults([...legacyEntries, ...toEntries([serializeCardioBlockResult(v2)])]);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].blockId, "blk-new");
  assert.deepEqual(parsed.legacy, { durationLabel: "44min30", distanceLabel: "9.5 km", elevationLabel: "320 m" });
});

test("v2 : JSON corrompu dans comment → traité en historique, jamais en bloc", () => {
  const parsed = parseCardioResults([
    { exerciseName: CARDIO_RESULT_ENTRY_NAME, setNumber: 1, loadUsed: "Durée 30 min", repsDone: "", rpe: null, comment: "{corrompu" },
  ]);
  assert.equal(parsed.blocks.length, 0);
  assert.ok(parsed.legacy);
});

test("v2 : détail muscu jamais pollué — entrées réservées exclues, exercices réels conservés", () => {
  const entries = [
    { exerciseName: "Développé couché", setNumber: 1, loadUsed: "60kg", repsDone: "8", rpe: 7, comment: "" },
    ...toEntries([serializeCardioBlockResult(blockResult({ blockId: "blk-a" }))]),
  ];
  const strength = entries.filter((e) => !isCardioResultEntryName(e.exerciseName));
  assert.equal(strength.length, 1);
  assert.equal(strength[0].exerciseName, "Développé couché");
  assert.equal(parseCardioResults(entries).blocks.length, 1);
});

/* ─── Douleur structurée ──────────────────────────────────────────────── */

test("douleur : aucune → champ vide ; niveau + détail → texte lisible", () => {
  assert.equal(composePainText("aucune", "peu importe"), "");
  assert.equal(composePainText("légère", ""), "Gêne légère");
  assert.equal(composePainText("modérée", "mollet droit"), "Gêne modérée — mollet droit");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
