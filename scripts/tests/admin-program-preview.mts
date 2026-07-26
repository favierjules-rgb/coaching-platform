// Tests PURS du view-model de l'aperçu de séance sur la page de DÉTAIL ADMIN
// d'un programme (Lot D — polish Apple admin). On prouve que
// `orderedAdminSessionBlocks` privilégie `blocks[]`, ne retombe sur le legacy
// que pour une vraie ancienne séance, préserve l'ordre/les identités et ne mute
// jamais l'entrée. Aucune logique n'est dupliquée : le repli passe par
// `toOrderedBlocks` (lib/training-blocks.ts).

import assert from "node:assert/strict";

import { orderedAdminSessionBlocks, type AdminSessionPreviewSource } from "@/lib/admin-program-preview";
import { isLegacyStrengthBlockId } from "@/lib/training-blocks";
import type {
  AdminCardioBlock,
  AdminExercise,
  CardioTrainingBlock,
  StrengthTrainingBlock,
} from "@/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

function ex(id: string, order: number): AdminExercise {
  return { id, order, name: `Ex ${order}`, sets: 3, reps: "8-10", restSeconds: 60, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" };
}

function strength(id: string, position: number, colorKey: string, title: string | null): StrengthTrainingBlock {
  return { id, category: "strength", position, title, colorKey, exercises: [ex(`${id}-e0`, 0), ex(`${id}-e1`, 1)] };
}

function cardio(id: string, position: number, colorKey: string, title: string | null): CardioTrainingBlock {
  return { id, category: "cardio", position, title, colorKey, cardioType: "easy_run", prescriptions: [] };
}

function adminCardio(id: string, order: number): AdminCardioBlock {
  return { id, order, title: "Cardio legacy", cardioType: "easy_run", segments: [] };
}

/** Séance canonique (blocks[] présents). */
function sessionWithBlocks(blocks: (StrengthTrainingBlock | CardioTrainingBlock)[]): AdminSessionPreviewSource {
  return { id: SESSION_UUID, exercises: [], cardioBlocks: [], blocks };
}

function categories(blocks: { category: string }[]): string[] {
  return blocks.map((b) => b.category);
}

// ── Ordre canonique préservé ────────────────────────────────────────────
test("S → C → S : ordre et catégories préservés depuis blocks[]", () => {
  const out = orderedAdminSessionBlocks(
    sessionWithBlocks([strength("s0", 0, "gray", "A"), cardio("c1", 1, "green", "B"), strength("s2", 2, "orange", "C")]),
  );
  assert.deepEqual(categories(out), ["strength", "cardio", "strength"]);
  assert.deepEqual(out.map((b) => b.id), ["s0", "c1", "s2"]);
});

test("C → S → C : ordre et catégories préservés depuis blocks[]", () => {
  const out = orderedAdminSessionBlocks(
    sessionWithBlocks([cardio("c0", 0, "blue", null), strength("s1", 1, "gray", null), cardio("c2", 2, "red", null)]),
  );
  assert.deepEqual(categories(out), ["cardio", "strength", "cardio"]);
  assert.deepEqual(out.map((b) => b.id), ["c0", "s1", "c2"]);
});

test("S → S : deux blocs strength conservés, pas de fusion ni tri par catégorie", () => {
  const out = orderedAdminSessionBlocks(sessionWithBlocks([strength("s0", 0, "gray", "Haut"), strength("s1", 1, "orange", "Bas")]));
  assert.deepEqual(categories(out), ["strength", "strength"]);
  assert.deepEqual(out.map((b) => b.id), ["s0", "s1"]);
});

test("C → C : deux blocs cardio conservés", () => {
  const out = orderedAdminSessionBlocks(sessionWithBlocks([cardio("c0", 0, "green", "Warm"), cardio("c1", 1, "blue", "Main")]));
  assert.deepEqual(categories(out), ["cardio", "cardio"]);
  assert.deepEqual(out.map((b) => b.id), ["c0", "c1"]);
});

// ── blocks[] VIDE = canonique, jamais de fallback legacy ─────────────────
test("blocks[] vide est canonique — aucun fallback legacy (legacy rempli mais sortie vide)", () => {
  // Séance canonique dont tous les blocs ont été supprimés : blocks = []. Des
  // valeurs legacy résiduelles subsistent dans exercises[]/cardioBlocks[] mais
  // NE doivent JAMAIS réapparaître dans l'aperçu.
  const out = orderedAdminSessionBlocks({
    id: SESSION_UUID,
    blocks: [],
    exercises: [ex("legacy-ex", 0)],
    cardioBlocks: [adminCardio("legacy-cardio", 0)],
  });
  assert.deepEqual(out, []);
});

test("blocks[] vide + séance repos (aucun contenu) → []", () => {
  const out = orderedAdminSessionBlocks({ id: SESSION_UUID, exercises: [], cardioBlocks: [], blocks: [] });
  assert.deepEqual(out, []);
});

test("blocks[] vide n'est PAS muté par le helper", () => {
  const source: AdminSessionPreviewSource = { id: SESSION_UUID, exercises: [ex("x", 0)], cardioBlocks: [], blocks: [] };
  const out = orderedAdminSessionBlocks(source);
  assert.deepEqual(out, []);
  assert.deepEqual(source.blocks, []);
  assert.notEqual(out, source.blocks); // nouveau tableau
});

test("blocks undefined + legacy rempli → adaptation legacy (contraste avec blocks=[])", () => {
  const out = orderedAdminSessionBlocks({
    id: SESSION_UUID,
    exercises: [ex("a", 0)],
    cardioBlocks: [adminCardio("c", 0)],
  });
  // Ici (blocks ABSENT), le legacy est bien lu : un bloc strength + un cardio.
  assert.deepEqual(categories(out), ["strength", "cardio"]);
  assert.ok(out.length > 0);
});

// ── Tri par position ────────────────────────────────────────────────────
test("blocs fournis dans un ordre non trié → triés par position (pas par catégorie)", () => {
  const out = orderedAdminSessionBlocks(
    sessionWithBlocks([cardio("c2", 2, "red", null), strength("s0", 0, "gray", null), cardio("c1", 1, "green", null)]),
  );
  assert.deepEqual(out.map((b) => b.position), [0, 1, 2]);
  assert.deepEqual(out.map((b) => b.id), ["s0", "c1", "c2"]);
  // Catégories dans l'ordre des positions, PAS regroupées par type.
  assert.deepEqual(categories(out), ["strength", "cardio", "cardio"]);
});

// ── Identités conservées ────────────────────────────────────────────────
test("UUID (id) et colorKey conservés à l'identique", () => {
  const out = orderedAdminSessionBlocks(
    sessionWithBlocks([strength("s0", 0, "gray", "T"), cardio("c1", 1, "green", "U")]),
  );
  assert.equal(out[0].id, "s0");
  assert.equal(out[0].colorKey, "gray");
  assert.equal(out[0].title, "T");
  assert.equal(out[1].id, "c1");
  assert.equal(out[1].colorKey, "green");
  assert.equal(out[1].title, "U");
});

test("contenu conservé : exercices d'un bloc strength intacts", () => {
  const [block] = orderedAdminSessionBlocks(sessionWithBlocks([strength("s0", 0, "gray", "T")]));
  assert.equal(block.category, "strength");
  if (block.category === "strength") {
    assert.deepEqual(block.exercises.map((e) => e.id), ["s0-e0", "s0-e1"]);
  }
});

test("aucun bloc perdu ni dupliqué", () => {
  const out = orderedAdminSessionBlocks(
    sessionWithBlocks([strength("s0", 0, "gray", null), cardio("c1", 1, "green", null), strength("s2", 2, "orange", null)]),
  );
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map((b) => b.id)).size, 3);
});

// ── blocks[] présent → aucun fallback legacy ────────────────────────────
test("séance AVEC blocks[] : le legacy (exercises/cardioBlocks) est ignoré", () => {
  // exercises[] et cardioBlocks[] sont renseignés mais NE doivent pas être lus
  // tant que blocks[] existe : la sortie ne contient que le bloc canonique.
  const source: AdminSessionPreviewSource = {
    id: SESSION_UUID,
    exercises: [ex("legacy-ex", 0)],
    cardioBlocks: [adminCardio("legacy-cardio", 0)],
    blocks: [strength("canonical", 0, "gray", "Canon")],
  };
  const out = orderedAdminSessionBlocks(source);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "canonical");
  assert.ok(!out.some((b) => b.id === "legacy-cardio"));
});

// ── blocks[] absent → adaptation legacy une seule fois ──────────────────
test("séance SANS blocks[] : adaptation legacy (bloc strength en tête, id conventionnel) + cardio", () => {
  const out = orderedAdminSessionBlocks({
    id: SESSION_UUID,
    exercises: [ex("a", 0), ex("b", 1)],
    cardioBlocks: [adminCardio("cardio-legacy", 0)],
  });
  assert.deepEqual(categories(out), ["strength", "cardio"]);
  // Le bloc strength legacy porte l'id conventionnel dérivé de la séance.
  assert.ok(isLegacyStrengthBlockId(out[0].id));
  // Positions renormalisées 0..n par toOrderedBlocks.
  assert.deepEqual(out.map((b) => b.position), [0, 1]);
});

test("séance SANS blocks[] et sans contenu → aucun bloc (rest legacy)", () => {
  const out = orderedAdminSessionBlocks({ id: SESSION_UUID, exercises: [], cardioBlocks: [] });
  assert.equal(out.length, 0);
});

// ── Immutabilité de l'entrée ────────────────────────────────────────────
test("immutabilité : la séance source et son tableau blocks[] ne sont pas mutés", () => {
  const b0 = cardio("c2", 2, "red", null);
  const b1 = strength("s0", 0, "gray", null);
  const b2 = cardio("c1", 1, "green", null);
  const source = sessionWithBlocks([b0, b1, b2]);
  const snapshotOrder = source.blocks!.map((b) => b.id);

  const out = orderedAdminSessionBlocks(source);

  // L'entrée conserve son ordre d'origine (non trié) : aucune mutation en place.
  assert.deepEqual(source.blocks!.map((b) => b.id), snapshotOrder);
  // La sortie est un nouveau tableau (référence différente).
  assert.notEqual(out, source.blocks);
  // Les positions d'origine des objets blocs sont inchangées.
  assert.equal(b0.position, 2);
  assert.equal(b1.position, 0);
  assert.equal(b2.position, 1);
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
