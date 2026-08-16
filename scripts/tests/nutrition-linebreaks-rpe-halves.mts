/**
 * Harnais — feat/nutrition-linebreaks-rpe-halves.
 *
 * Deux corrections fonctionnelles, et rien d'autre :
 *   A. les retours à la ligne d'un plan alimentaire survivent à
 *      l'enregistrement puis à l'affichage élève (NUT-LINE1…5) ;
 *   B. le RPE avance par pas de 0,5 sur toutes les surfaces (RPE-HALF1…9).
 *
 * Ce fichier prouve le comportement des MODULES et du RENDU (React rendu
 * côté serveur, comme scripts/tests/training-movement-patterns.mts). Le
 * comportement RÉEL de PostgreSQL — types de colonnes, contraintes,
 * arrondis — est prouvé séparément par
 * supabase/tests/rpe_half_points_checklist.sql, qui tourne sur une vraie
 * base : un test statique ne peut pas décider si `7.5` survit à un INSERT.
 *
 * Lancement : npx tsx scripts/tests/nutrition-linebreaks-rpe-halves.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { PlannedMealCard } from "../../components/student/PlannedMealCard";
import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";
import { itemsToText, textToItems } from "../../lib/nutrition/plan-v2-week-form";
import {
  parsePrescribedRpe,
  parseRpeInput,
  prescribedRpeForSet,
} from "../../lib/previous-performance";
import { estRpeSurLaGrille, formatRpeFr, grilleRpe, lireRpe } from "../../lib/rpe";
import type { PlannedMeal } from "../../types";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/* ═════════════════════ A — SAUTS DE LIGNE ═════════════════════ */

// La saisie exacte de l'énoncé, respiration comprise.
const SAISIE_COACH = [
  "PROTÉINES",
  "150 g fromage blanc 0 %",
  "2 œufs",
  "",
  "GLUCIDES",
  "100 g riz",
  "200 g pommes de terre",
].join("\n");

await test("NUT-LINE1. un texte multi-lignes est enregistré sans être aplati", () => {
  const items = textToItems(SAISIE_COACH);
  assert.equal(items.length, 7, "sept lignes saisies, sept entrées conservées");
  assert.deepEqual(
    items.map((i) => i.name),
    ["PROTÉINES", "150 g fromage blanc 0 %", "2 œufs", "", "GLUCIDES", "100 g riz", "200 g pommes de terre"],
  );
  // Aucun retour à la ligne n'a été remplacé par un espace : les lignes
  // restent des entrées distinctes, et aucun `name` ne contient de \n.
  assert.ok(items.every((i) => !i.name.includes("\n")));
  // L'aller-retour est stable — c'est ce qui garantit qu'une relecture puis
  // une nouvelle sauvegarde ne rognent pas le bloc petit à petit.
  assert.equal(itemsToText(items), SAISIE_COACH);
  assert.equal(itemsToText(textToItems(itemsToText(items))), SAISIE_COACH);
});

await test("NUT-LINE2. une ligne vide volontaire entre deux groupes est conservée", () => {
  const items = textToItems(SAISIE_COACH);
  const vides = items.filter((i) => i.name === "" && i.quantity === "");
  assert.equal(vides.length, 1, "la respiration entre PROTÉINES et GLUCIDES survit");
  assert.equal(items[3]?.name, "", "elle est à sa place exacte, en quatrième position");

  // Plusieurs respirations d'affilée sont conservées telles quelles.
  assert.equal(textToItems("A\n\n\nB").length, 4);

  // Les lignes vides de BORD, elles, viennent de la frappe : elles partent.
  assert.deepEqual(textToItems("\n\nA\nB\n\n").map((i) => i.name), ["A", "B"]);

  // Une ligne d'espaces est une ligne vide, pas un aliment nommé « ».
  assert.deepEqual(textToItems("A\n   \nB").map((i) => i.name), ["A", "", "B"]);
});

await test("NUT-LINE3. le rendu élève affiche les retours à la ligne", () => {
  const repas: PlannedMeal = {
    id: "m1",
    planId: "p1",
    dayId: "d1",
    slot: "Midi",
    name: "Déjeuner",
    items: [...textToItems(SAISIE_COACH)],
    macros: { calories: 700, protein: 50, carbs: 80, fat: 15 },
    coachNotes: "",
  };
  const html = renderToString(createElement(PlannedMealCard, { meal: repas }));

  // Sept lignes rendues : six aliments/titres + la respiration.
  const lignes = html.match(/<li/g) ?? [];
  assert.equal(lignes.length, 7, "chaque ligne saisie produit une ligne rendue");

  // La respiration est un espace, pas une puce vide qui afficherait « — ».
  assert.ok(html.includes('aria-hidden="true"'), "la respiration est retirée de l'arbre d'accessibilité");
  assert.ok(!/<li[^>]*>\s*—\s*<\/li>/.test(html), "aucune puce ne rend un tiret orphelin");

  // Un titre sans quantité ne traîne plus de tiret : « PROTÉINES », pas
  // « PROTÉINES — ». C'était le défaut du rendu inconditionnel précédent.
  assert.ok(html.includes("PROTÉINES"));
  assert.ok(!html.includes("PROTÉINES —"), "aucun séparateur ajouté à un titre sans quantité");

  // Et l'ordre de la mise en page du coach est respecté.
  assert.ok(html.indexOf("PROTÉINES") < html.indexOf("GLUCIDES"));
  assert.ok(html.indexOf("2 œufs") < html.indexOf("GLUCIDES"));

  // La préservation des espaces internes est portée par le CSS, pas par du
  // balisage injecté.
  assert.ok(html.includes("whitespace-pre-wrap"));
});

await test("NUT-LINE4. les anciens plans sans ligne vide restent identiques", () => {
  // Forme historique : « Nom — quantité », aucune respiration.
  const ancien = "Blanc de poulet — 150 g\nRiz basmati — 200 g";
  const items = textToItems(ancien);
  assert.deepEqual(
    [...items],
    [
      { name: "Blanc de poulet", quantity: "150 g" },
      { name: "Riz basmati", quantity: "200 g" },
    ],
  );
  assert.equal(itemsToText(items), ancien);

  // Le séparateur court « - » reste reconnu (constructeur historique).
  assert.deepEqual([...textToItems("Riz - 100 g")], [{ name: "Riz", quantity: "100 g" }]);

  // Un plan déjà en base, relu tel quel, rend exactement ce qu'il rendait :
  // deux lignes « Nom — quantité », aucune ligne fantôme.
  const repas: PlannedMeal = {
    id: "m2", planId: "p1", dayId: "d1", slot: "Dîner", name: "Dîner",
    items: [...items],
    macros: { calories: 600, protein: 45, carbs: 70, fat: 12 },
    coachNotes: "",
  };
  const html = renderToString(createElement(PlannedMealCard, { meal: repas }));
  assert.equal((html.match(/<li/g) ?? []).length, 2);
  assert.ok(html.includes("Blanc de poulet — 150 g"));
  assert.ok(!html.includes('aria-hidden="true"'), "aucune respiration inventée dans un ancien plan");
});

await test("NUT-LINE5. aucun dangerouslySetInnerHTML, aucun <br> fabriqué", () => {
  for (const fichier of [
    "../../components/student/PlannedMealCard.tsx",
    "../../components/student/StudentPrescribedWeek.tsx",
    "../../components/admin/NutritionPlanBuilder.tsx",
    "../../components/admin/NutritionDayManualMeals.tsx",
    "../../lib/nutrition/plan-v2-week-form.ts",
  ]) {
    const source = sansCommentairesTs(lire(fichier));
    assert.ok(!/dangerouslySetInnerHTML/.test(source), `${fichier} : innerHTML brut`);
    assert.ok(!/<br\s*\/?>/i.test(source), `${fichier} : <br> injecté`);
    assert.ok(!/replace\([^)]*\\n[^)]*<br/i.test(source), `${fichier} : \\n converti en balise`);
  }
  // La règle vaut aussi pour la persistance : rien ne doit écrire de balise
  // dans meals.items.
  const rpc = lire("../../supabase/migrations/20260812090000_save_nutrition_plan_v2_full.sql");
  assert.ok(!/<br/i.test(rpc), "la RPC n'injecte aucune balise dans les aliments");
});

/* ═════════════════════ B — RPE PAR DEMI-POINT ═════════════════════ */

await test("RPE-HALF1. 7,5 est accepté dans la prescription coach", () => {
  assert.deepEqual(parsePrescribedRpe("7.5"), { ok: true, values: [7.5] });
  // La virgule française est acceptée À LA SAISIE, la valeur reste numérique.
  assert.deepEqual(parsePrescribedRpe("7,5"), { ok: true, values: [7.5] });
  // Séquence par série : le tiret sépare, la virgule décime — aucun conflit.
  assert.deepEqual(parsePrescribedRpe("8-8,5-9"), { ok: true, values: [8, 8.5, 9] });
  assert.deepEqual(parsePrescribedRpe("8-8.5-9"), { ok: true, values: [8, 8.5, 9] });
  // Et la prescription arrive bien jusqu'à LA série visée.
  assert.equal(prescribedRpeForSet("8-8,5-9", 2), 8.5);
  assert.equal(prescribedRpeForSet("7,5", 3), 7.5, "une valeur unique vaut pour toutes les séries");
});

await test("RPE-HALF2. 7,5 est accepté dans la saisie élève", () => {
  assert.deepEqual(parseRpeInput("7.5"), { ok: true, rpe: 7.5 });
  assert.deepEqual(parseRpeInput("7,5"), { ok: true, rpe: 7.5 });
  assert.deepEqual(parseRpeInput(" 9,5 "), { ok: true, rpe: 9.5 });
  assert.deepEqual(parseRpeInput(""), { ok: true, rpe: null }, "vide = non saisi, jamais 0");

  // Le schéma d'API, dernière porte avant la base.
  const payload = {
    sessionKey: "s1", sessionRefLabel: "Séance 1", completed: true,
    globalRpe: 7.5, globalComment: "", pain: "",
    exercises: [{
      exerciseName: "Développé couché", exerciseOrder: 0, rpe: 6.5, comment: "",
      sets: [{ setNumber: 1, loadUsed: "60", repsDone: "10", rpe: 8.5 }],
    }],
  };
  assert.equal(workoutFeedbackPayloadSchema.safeParse(payload).success, true);
});

await test("RPE-HALF4. 7,2 est refusé, partout", () => {
  assert.deepEqual(parseRpeInput("7.2"), { ok: false });
  assert.deepEqual(parseRpeInput("7,2"), { ok: false });
  assert.deepEqual(parseRpeInput("8.7"), { ok: false });
  assert.deepEqual(parsePrescribedRpe("7,2"), { ok: false });
  assert.deepEqual(parsePrescribedRpe("8-7,2"), { ok: false }, "une seule valeur fautive invalide la séquence");

  // Texte arbitraire et NaN.
  for (const absurde of ["abc", "7.5.5", "--", "7,", ",5", "e5", "Infinity", "NaN", "0x7"]) {
    assert.deepEqual(parseRpeInput(absurde), { ok: false }, `« ${absurde} » doit être refusé`);
  }

  // Le schéma refuse aussi — et pour la bonne raison : le pas, pas la borne.
  const base = {
    sessionKey: "s1", sessionRefLabel: "S", completed: true,
    globalRpe: 7.2, globalComment: "", pain: "", exercises: [],
  };
  const r = workoutFeedbackPayloadSchema.safeParse(base);
  assert.equal(r.success, false);
  assert.ok(JSON.stringify(r.error?.issues ?? []).includes("pas de 0,5"));
});

await test("RPE-HALF5. les bornes existantes restent appliquées, sans élargissement", () => {
  // Saisie élève : 1 à 10 — la borne d'origine, pas celle d'à côté.
  assert.deepEqual(parseRpeInput("0"), { ok: false }, "0 n'a jamais été valide côté élève");
  assert.deepEqual(parseRpeInput("0,5"), { ok: false });
  assert.deepEqual(parseRpeInput("10,5"), { ok: false });
  assert.deepEqual(parseRpeInput("11"), { ok: false });
  assert.deepEqual(parseRpeInput("-7"), { ok: false });
  assert.deepEqual(parseRpeInput("1"), { ok: true, rpe: 1 });
  assert.deepEqual(parseRpeInput("10"), { ok: true, rpe: 10 });

  for (const hors of [0, 0.5, 10.5, 11, -1]) {
    const r = workoutFeedbackPayloadSchema.safeParse({
      sessionKey: "s", sessionRefLabel: "S", completed: true,
      globalRpe: hors, globalComment: "", pain: "", exercises: [],
    });
    assert.equal(r.success, false, `${hors} doit être refusé par le schéma`);
  }

  // La borne 0-10 de training_prescriptions.target_rpe, elle, N'A PAS été
  // remontée à 1 : le segment cardio « au repos » reste exprimable.
  const migration = lire("../../supabase/migrations/20260830090000_rpe_half_points.sql");
  assert.ok(/target_rpe >= 0 and target_rpe <= 10/.test(migration));
  assert.ok(/rpe >= 1 and rpe <= 10/.test(migration));
  assert.ok(/global_rpe >= 1 and global_rpe <= 10/.test(migration));
});

await test("RPE-HALF6. les entiers restent acceptés", () => {
  for (const entier of ["1", "5", "8", "10"]) {
    const r = parseRpeInput(entier);
    assert.ok(r.ok && r.rpe === Number(entier), `${entier} reste valide`);
  }
  assert.deepEqual(parsePrescribedRpe("8"), { ok: true, values: [8] });
  assert.deepEqual(parsePrescribedRpe("6-7-8-6"), { ok: true, values: [6, 7, 8, 6] },
    "la séquence historique de la base réelle reste lisible");
  // La forme « 7,0 » est tolérée et rend 7 — pas 7,0 ni une chaîne.
  assert.deepEqual(parseRpeInput("7,0"), { ok: true, rpe: 7 });
});

await test("RPE-HALF7. l'affichage francise le demi-point sans toucher à la donnée", () => {
  assert.equal(formatRpeFr(7.5), "7,5");
  assert.equal(formatRpeFr(8), "8");
  assert.equal(formatRpeFr(10), "10");
  assert.equal(formatRpeFr(1.5), "1,5");
  // La donnée reste un nombre : le formateur ne sert QUE à l'écran.
  assert.equal(typeof formatRpeFr(7.5), "string");
  assert.equal(parseRpeInput(formatRpeFr(7.5)).ok, true, "l'aller-retour affichage → saisie tient");

  // La grille elle-même : 19 valeurs de 1 à 10, pas une de plus.
  const grille = grilleRpe(1, 10);
  assert.equal(grille.length, 19);
  assert.equal(grille[0], 1);
  assert.equal(grille[1], 1.5);
  assert.equal(grille.at(-1), 10);
  assert.ok(grille.every(estRpeSurLaGrille));

  // Les deux sélecteurs proposent bien ces 19 valeurs.
  for (const fichier of [
    "../../components/student/SessionFeedbackSection.tsx",
    "../../components/student/CardioBlockFeedbackForm.tsx",
  ]) {
    const source = sansCommentairesTs(lire(fichier));
    assert.ok(/const rpeOptions = grilleRpe\(1, 10\);/.test(source),
      `${fichier} : le sélecteur n'offre pas les demi-points`);
    assert.ok(source.includes("formatRpeFr(value)"), `${fichier} : libellé non francisé`);
  }
});

await test("RPE-HALF8. aucun arrondi ne détruit les décimales sur le chemin RPE", () => {
  // Le schéma d'API n'a plus AUCUN `.int()` sur une clé RPE : c'était lui
  // qui rejetait 7.5 avant même d'atteindre PostgreSQL.
  const schema = sansCommentairesTs(lire("../../lib/api/schemas/workout-feedback.ts"));
  assert.ok(!/rpe[^\n]*z\.number\(\)\.int\(\)/i.test(schema), "un .int() traîne encore sur une clé RPE");
  assert.ok(!/globalRpe[^\n]*\.int\(\)/i.test(schema));
  assert.ok(schema.includes("estRpeSurLaGrille"), "le schéma délègue le pas à lib/rpe");
  const grilleSource = sansCommentairesTs(lire("../../lib/rpe.ts"));
  assert.ok(grilleSource.includes("Number.isInteger(valeur * RPE_PAS * 4)"),
    "le contrôle du pas est celui décidé — exact, sans epsilon");
  // lib/rpe est une FEUILLE : c'est ce qui empêche le cycle d'imports
  // previous-performance → cardio-feedback → cardio → previous-performance.
  assert.ok(!/^import /m.test(lire("../../lib/rpe.ts")), "lib/rpe n'importe rien");
  // Le parseur brut refuse la grille hors-pas indépendamment des bornes.
  assert.equal(lireRpe("7,5"), 7.5);
  assert.equal(lireRpe("7,2"), null);

  // Aucun parseInt / Math.round / trunc / floor sur les modules du chemin.
  for (const fichier of [
    "../../lib/previous-performance.ts",
    "../../lib/workout-feedback-payload.ts",
    "../../lib/cardio-feedback.ts",
    "../../lib/supabase/workout-feedback.ts",
  ]) {
    const source = sansCommentairesTs(lire(fichier));
    for (const ligne of source.split("\n")) {
      if (!/rpe/i.test(ligne)) continue;
      assert.ok(!/parseInt|Math\.round|Math\.trunc|Math\.floor|toFixed\(0\)|\|\s*0\b/.test(ligne),
        `arrondi sur une ligne RPE de ${fichier} : ${ligne.trim()}`);
    }
  }

  // Et la valeur traverse effectivement le schéma sans être altérée.
  const r = workoutFeedbackPayloadSchema.safeParse({
    sessionKey: "s", sessionRefLabel: "S", completed: true,
    globalRpe: 7.5, globalComment: "", pain: "",
    exercises: [{
      exerciseName: "Squat", exerciseOrder: 0, rpe: 9.5, comment: "",
      sets: [{ setNumber: 1, loadUsed: "100", repsDone: "5", rpe: 6.5 }],
    }],
  });
  assert.equal(r.success, true);
  assert.equal(r.data?.globalRpe, 7.5);
  assert.equal(r.data?.exercises[0]?.rpe, 9.5);
  assert.equal(r.data?.exercises[0]?.sets[0]?.rpe, 6.5);
});

await test("RPE-HALF3. la migration est déclarée, comptée, et sa checklist couvre la persistance", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.ok(attendues.includes("20260830090000_rpe_half_points.sql"), "la migration RPE est au manifeste");
  // Ce que ce test protège vraiment : la migration RPE reste déclarée, et le
  // compteur suit le disque.
  //
  // Une garde « aucune migration food_catalog dans le manifeste » vivait ici.
  // Elle servait à isoler cette branche d'ALIMENTS A1 le temps de sa PR ; A1
  // est maintenant un chantier légitime posé PAR-DESSUS ce travail, et la
  // garde est devenue fausse. La retirer est le contraire d'un test affaibli
  // pour obtenir du vert : elle décrivait une situation temporaire qui n'a
  // plus lieu d'être.
  assert.equal(attendues.length, 53);
  // En revanche, l'ORDRE compte et reste vérifié : la migration RPE doit
  // précéder celle d'ALIMENTS A1, sinon un rejeu depuis le baseline verrait
  // A1 s'appliquer avant le RPE.
  const iRpe = attendues.indexOf("20260830090000_rpe_half_points.sql");
  const iA1 = attendues.findIndex((m) => /food_catalog/.test(m));
  assert.ok(iA1 === -1 || iRpe < iA1, "la migration RPE doit rester antérieure à ALIMENTS A1");
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 80,"));
  assert.ok(secu.includes("assert.equal(attendues.length, 53);"));

  // La checklist SQL est ce qui prouve RPE-HALF3 pour de vrai : 7,5 écrit,
  // 7,5 relu, sur une base réelle. Ce fichier-ci ne peut que le déléguer.
  const checklist = lire("../../supabase/tests/rpe_half_points_checklist.sql");
  for (const marqueur of ["RPE-HALF3", "RPE-HALF4", "RPE-HALF5", "RPE-HALF6", "rollback;"]) {
    assert.ok(checklist.includes(marqueur), `la checklist couvre ${marqueur}`);
  }
  assert.ok(/raise exception 'CHECKLIST EN ÉCHEC/.test(checklist));
  assert.ok(!/@gmail|favierjules/i.test(checklist), "aucune donnée réelle");

  // La migration ne touche QUE les colonnes RPE.
  const migration = lire("../../supabase/migrations/20260830090000_rpe_half_points.sql")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const tables = [...migration.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(),
    ["exercise_feedback", "exercise_set_feedback", "training_prescriptions", "workout_feedback"]);
  assert.ok(!/drop\s+(table|column)/i.test(migration), "aucune suppression");
  assert.ok(!/\binsert\s+into\b/i.test(migration), "aucune donnée réécrite");
  // La colonne de séquence reste du texte : « 6-7-8-6 » n'est pas un nombre.
  assert.ok(!/alter table public\.workout_exercises/i.test(migration));
});

await test("RPE-HALF9. un programme à RPE 6,5 est correctement rendu côté élève", async () => {
  const { ExerciseFeedbackCard } = await import("../../components/student/ExerciseFeedbackCard");
  const html = renderToString(
    createElement(ExerciseFeedbackCard, {
      exercise: {
        id: "e1",
        name: "Développé couché",
        sets: 3,
        reps: "8",
        restSeconds: 120,
        tempo: "3-0-1-0",
        recommendedLoad: "60 kg",
        recommendedRpe: "6,5-7-7,5",
        videoUrl: "",
      },
      index: 0,
      feedback: {
        studentId: "s1",
        sessionId: "sess1",
        exerciseId: "e1",
        exerciseName: "Développé couché",
        sets: [1, 2, 3].map((n) => ({
          studentId: "s1",
          sessionId: "sess1",
          exerciseId: "e1",
          setNumber: n,
          loadUsed: "",
          repsDone: "",
          rpe: "",
        })),
        rpe: null,
        comment: "",
      },
      onSetChange: () => {},
      onCommentChange: () => {},
      substitute: null,
    } as never),
  );

  // La prescription est affichée telle que le coach l'a écrite…
  assert.ok(html.includes("6,5-7-7,5"), "le RPE cible prescrit doit apparaître");
  // …et le RPE de chaque série est proposé en placeholder, série par série.
  // …et le RPE de chaque série est proposé en placeholder, série par série,
  // FRANCISÉ : « RPE 6,5 » et non « RPE 6.5 ».
  assert.ok(html.includes('placeholder="RPE 6,5"'), "la série 1 propose la prescription francisée");
  assert.ok(html.includes('placeholder="RPE 7"'), "la série 2 propose l'entier sans décimale inutile");
  assert.ok(html.includes('placeholder="RPE 7,5"'), "la série 3 propose son propre demi-point");
  assert.ok(!html.includes("RPE 6.5"), "aucun point décimal ne fuit dans l'interface française");

  // Le champ accepte un clavier décimal — sans quoi le demi-point serait
  // insaisissable au doigt sur iPhone. (React 19 rend l'attribut en
  // camelCase côté serveur : la recherche est insensible à la casse.)
  assert.match(html, /inputmode="decimal"/i);
  assert.ok(!/inputmode="numeric"/i.test(html), "plus aucun champ RPE en clavier entier");
});
