/**
 * Harnais de RÉGRESSION — rendu réel des formulaires cardio bloc par bloc
 * (correction du « ReferenceError: prescribed is not defined »).
 *
 * Monte avec le vrai React (renderToString) :
 *  1. SessionFeedbackSection complet (séance multi-blocs) — tout le corps du
 *     composant s'exécute : une variable de repères non définie jetterait ici ;
 *  2. la composition exacte du formulaire : StudentSessionBlockList +
 *     renderCardioFooter → CardioBlockFeedbackForm alimenté par
 *     cardioBlockPrescribedSnapshot(block) — DEUX blocs portant le même titre
 *     « Effort continu » avec des prescriptions différentes, chacun devant
 *     afficher SES propres repères prévus.
 *
 * Lancement : npx tsx scripts/tests/cardio-block-form-render.mts
 * (sans la condition react-server — react-dom/server est requis).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { CardioBlockFeedbackForm } from "../../components/student/CardioBlockFeedbackForm";
import { SessionFeedbackSection } from "../../components/student/SessionFeedbackSection";
import { StudentSessionBlockList } from "../../components/student/StudentSessionBlockList";
import { cardioBlockPrescribedSnapshot, emptyCardioBlockDraft } from "../../lib/cardio-feedback";
import { orderedStudentSessionBlocks } from "../../lib/student-session-blocks";
import type { AdminCardioBlock, AdminCardioSegment } from "../../types";

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
    id: partial.id ?? "seg",
    order: partial.order ?? 0,
    segmentType: partial.segmentType ?? "single",
    title: partial.title ?? "",
    intensityTargetType: partial.intensityTargetType ?? "vma_percentage",
    ...partial,
  };
}

// Séance 4 blocs : échauffement, effort continu, intervalles, effort continu —
// les blocs 2 et 4 portent le MÊME titre mais des ids et prescriptions
// distincts (10 min/2 km vs 25 min/5.5 km).
const cardioBlocks: AdminCardioBlock[] = [
  {
    id: "blk-echauffement",
    order: 0,
    title: "Échauffement",
    cardioType: "warmup_run",
    segments: [segment({ id: "s1", durationSeconds: 600 })],
  },
  {
    id: "blk-continu-1",
    order: 1,
    title: "Effort continu",
    cardioType: "continuous_run",
    segments: [segment({ id: "s2", durationSeconds: 600, distanceMeters: 2000 })],
  },
  {
    id: "blk-intervalles",
    order: 2,
    title: "Intervalles",
    cardioType: "vma_intervals",
    segments: [
      segment({ id: "s3", segmentType: "repeat_group", repetitions: 8, durationSeconds: 60, distanceMeters: 400, recoveryDurationSeconds: 90 }),
    ],
  },
  {
    id: "blk-continu-2",
    order: 3,
    title: "Effort continu",
    cardioType: "continuous_run",
    segments: [segment({ id: "s4", durationSeconds: 1500, distanceMeters: 5500 })],
  },
];

const blockViews = orderedStudentSessionBlocks({ cardioBlocks });

test("SessionFeedbackSection multi-blocs : rendu SANS ReferenceError", () => {
  const html = renderToString(
    createElement(SessionFeedbackSection, {
      studentId: "fixture-eleve",
      sessionId: "fixture-session",
      programId: null,
      sessionRefLabel: "Séance course 4 blocs",
      cardioBlocks,
      sessionMuscleGroup: "Cardio",
    }),
  );
  assert.ok(html.length > 0);
});

test("composition réelle du formulaire : chaque bloc affiche SES repères prescrits", () => {
  const rawHtml = renderToString(
    createElement(StudentSessionBlockList, {
      blocks: blockViews,
      renderStrengthExercise: () => null,
      renderCardioFooter: (block) =>
        createElement(CardioBlockFeedbackForm, {
          blockId: block.id,
          blockLabel: block.title ?? "",
          prescribed: cardioBlockPrescribedSnapshot(block),
          draft: emptyCardioBlockDraft(),
          error: null,
          onChange: () => undefined,
        }),
    }),
  );
  // React sérialise chaque expression JSX en nœud séparé (« prévu : <!-- -->10 min ») —
  // on retire les commentaires pour asserter sur le texte réellement affiché.
  const html = rawHtml.replace(/<!--.*?-->/g, "");
  // 4 formulaires « Réalisation du bloc »
  assert.equal((html.match(/Réalisation du bloc/g) ?? []).length, 4);
  // Repères propres à chaque bloc (formatDurationSeconds/formatDistanceMeters)
  assert.ok(html.includes("prévu : 10 min"), "échauffement et 1er continu : 10 min");
  assert.ok(html.includes("prévu : 2 km"), "1er effort continu : 2 km");
  assert.ok(html.includes("prévu : 25 min"), "2e effort continu : 25 min");
  assert.ok(html.includes("prévu : 5.5 km"), "2e effort continu : 5.5 km");
  // Intervalles : (60+90)×8 = 20 min, 8×400 m = 3.2 km, 8 répétitions
  assert.ok(html.includes("prévu : 20 min"), "intervalles : durée totale");
  assert.ok(html.includes("prévu : 3.2 km"), "intervalles : distance totale");
  assert.ok(html.includes("Répétitions terminées"), "champ répétitions présent sur le bloc intervalles");
  assert.equal((html.match(/Répétitions terminées/g) ?? []).length, 1, "répétitions UNIQUEMENT sur le bloc à intervalles");
});

test("deux blocs homonymes → deux objets prescrits DISTINCTS", () => {
  const first = blockViews.find((v) => v.id === "blk-continu-1");
  const second = blockViews.find((v) => v.id === "blk-continu-2");
  assert.ok(first && second);
  const p1 = cardioBlockPrescribedSnapshot(first);
  const p2 = cardioBlockPrescribedSnapshot(second);
  assert.notEqual(p1, p2);
  assert.equal(p1.durationSeconds, 600);
  assert.equal(p2.durationSeconds, 1500);
  assert.equal(p1.distanceMeters, 2000);
  assert.equal(p2.distanceMeters, 5500);
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
