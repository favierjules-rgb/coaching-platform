// Tests PURS du view-model des cartes de blocs (Lot 4.2). Aucun rendu React :
// on teste les helpers de libellé/couleur/état qui alimentent les composants,
// ce que le harnais peut prouver sans bibliothèque de test de composants.

import assert from "node:assert/strict";

import { BLOCK_COLOR_KEYS, type BlockColorKey } from "@/lib/training-block-editing";
import {
  BLOCK_COLOR_STYLES,
  blockActionAriaLabel,
  blockCategoryLabel,
  blockColorLabel,
  blockDisplayTitle,
  blockOrderLabel,
  canMoveBlockDown,
  canMoveBlockUp,
  describeBlockMove,
  describeBlockMoveBlocked,
  describeExerciseMovedToBlock,
  describeExerciseReorder,
  dragHandleAriaLabel,
  dropIndicatorPlacement,
  isBlockEmpty,
} from "@/components/admin/blocks/block-view-model";
import type { CardioTrainingBlock, StrengthTrainingBlock } from "@/types";

function strength(colorKey: string, title: string | null, exercises = 0): StrengthTrainingBlock {
  return {
    id: "b1",
    category: "strength",
    position: 0,
    title,
    colorKey,
    exercises: Array.from({ length: exercises }, (_, i) => ({
      id: `e${i}`,
      order: i,
      name: "Ex",
      sets: 3,
      reps: "8-10",
      restSeconds: 60,
      tempo: "2-0-1-0",
      recommendedLoad: "",
      videoUrl: "",
      notes: "",
    })),
  };
}
function cardio(colorKey: string, title: string | null): CardioTrainingBlock {
  return { id: "c1", category: "cardio", position: 0, title, colorKey, cardioType: "easy_run", prescriptions: [] };
}

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
    console.error(error);
  }
}

test("couleurs — table exhaustive (une entrée par colorKey autorisée)", () => {
  for (const key of BLOCK_COLOR_KEYS) {
    const style = BLOCK_COLOR_STYLES[key as BlockColorKey];
    assert.ok(style, `style manquant pour ${key}`);
    assert.ok(style.dot && style.borderLeft && style.softBg && style.label, `champs manquants pour ${key}`);
  }
  assert.equal(Object.keys(BLOCK_COLOR_STYLES).length, BLOCK_COLOR_KEYS.length);
});

test("couleurs — classes statiques (aucune interpolation dynamique)", () => {
  for (const key of BLOCK_COLOR_KEYS) {
    const style = BLOCK_COLOR_STYLES[key as BlockColorKey];
    for (const cls of [style.dot, style.borderLeft, style.softBg]) {
      assert.ok(!cls.includes("${") && !cls.includes("`"), `classe dynamique interdite : ${cls}`);
      assert.ok(cls.includes(key === "gray" ? "neutral" : key), `classe ne cible pas la couleur : ${cls}`);
    }
  }
});

test("catégorie — libellé INDÉPENDANT de la couleur", () => {
  // Même catégorie, couleurs différentes → même libellé ; la catégorie reste lisible sans couleur.
  assert.equal(blockCategoryLabel("strength"), "Musculation");
  assert.equal(blockCategoryLabel("cardio"), "Cardio");
  assert.equal(blockCategoryLabel(strength("red", null).category), "Musculation");
  assert.equal(blockCategoryLabel(strength("blue", null).category), "Musculation");
  assert.equal(blockCategoryLabel(cardio("gray", null).category), "Cardio");
});

test("couleur — libellé humain par clé", () => {
  assert.equal(blockColorLabel("gray"), "Gris");
  assert.equal(blockColorLabel("purple"), "Violet");
});

test("numéro d'ordre — 01, 02, 10 (1-based, padding)", () => {
  assert.equal(blockOrderLabel(0), "01");
  assert.equal(blockOrderLabel(1), "02");
  assert.equal(blockOrderLabel(9), "10");
});

test("titre affiché — repli explicite si vide, jamais vide", () => {
  assert.equal(blockDisplayTitle(strength("gray", "Force haut du corps")), "Force haut du corps");
  assert.equal(blockDisplayTitle(strength("gray", "   ")), "Bloc musculation");
  assert.equal(blockDisplayTitle(strength("gray", null)), "Bloc musculation");
  assert.equal(blockDisplayTitle(cardio("blue", null)), "Bloc cardio");
});

test("aria-label — contient le titre du bloc ou son repli, jamais vide", () => {
  const running = cardio("blue", "Running");
  assert.equal(blockActionAriaLabel("move-up", running), "Monter le bloc Running");
  assert.equal(blockActionAriaLabel("move-down", running), "Descendre le bloc Running");
  assert.equal(blockActionAriaLabel("duplicate", strength("gray", "Force haut du corps")), "Dupliquer le bloc Force haut du corps");
  assert.equal(blockActionAriaLabel("delete", cardio("gray", null)), "Supprimer le bloc Bloc cardio");
  assert.equal(blockActionAriaLabel("color", running), "Changer la couleur du bloc Running");
  for (const action of ["move-up", "move-down", "duplicate", "delete", "color", "toggle"] as const) {
    assert.ok(blockActionAriaLabel(action, strength("gray", null)).length > 0);
  }
});

test("accessibilité — Monter désactivé pour le premier, Descendre pour le dernier", () => {
  assert.equal(canMoveBlockUp(0), false, "premier : Monter désactivé");
  assert.equal(canMoveBlockUp(1), true);
  assert.equal(canMoveBlockDown(2, 3), false, "dernier : Descendre désactivé");
  assert.equal(canMoveBlockDown(1, 3), true);
});

test("bloc vide — suppression directe (pas de confirmation)", () => {
  assert.equal(isBlockEmpty(strength("gray", null, 0)), true);
  assert.equal(isBlockEmpty(strength("gray", null, 2)), false);
  assert.equal(isBlockEmpty(cardio("blue", null)), true);
});

// ─────────────────────── Drag & annonces (Lot 4.3) ──────────────────────
test("poignée — aria-label contextualisé, repli si titre vide", () => {
  assert.equal(dragHandleAriaLabel(cardio("blue", "Running")), "Réordonner le bloc Running");
  assert.equal(dragHandleAriaLabel(strength("gray", null)), "Réordonner le bloc Bloc musculation");
});

test("indicateur de drop — before / after uniquement sur la cible, sinon null", () => {
  assert.equal(dropIndicatorPlacement("b1", "b1", "before"), "before");
  assert.equal(dropIndicatorPlacement("b1", "b1", "after"), "after");
  assert.equal(dropIndicatorPlacement("b1", "b2", "before"), null, "autre cible → aucun indicateur");
  assert.equal(dropIndicatorPlacement("b1", null, null), null, "hors drag → aucun indicateur");
});

test("annonce — déplacement de bloc (position 1-based sur total)", () => {
  assert.equal(describeBlockMove(cardio("blue", "Running"), 1, 4), "Bloc Running déplacé en position 2 sur 4.");
  assert.equal(describeBlockMove(strength("gray", null), 0, 3), "Bloc Bloc musculation déplacé en position 1 sur 3.");
});

test("annonce — déplacement de bloc impossible (borne)", () => {
  assert.equal(describeBlockMoveBlocked("up"), "Impossible de monter le premier bloc.");
  assert.equal(describeBlockMoveBlocked("down"), "Impossible de descendre le dernier bloc.");
});

test("annonce — déplacement d'exercice (réordonnancement + vers un autre bloc)", () => {
  assert.equal(describeExerciseReorder("Squat", 1, 3), "Exercice Squat déplacé en position 2 sur 3.");
  assert.equal(describeExerciseReorder("", 0, 2), "Exercice (sans nom) déplacé en position 1 sur 2.");
  assert.equal(describeExerciseMovedToBlock("Rowing", strength("gray", "Core")), "Exercice Rowing déplacé vers le bloc Core.");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
