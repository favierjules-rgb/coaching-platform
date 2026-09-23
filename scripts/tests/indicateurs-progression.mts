/**
 * Harnais — LOT B : indicateurs visuels de progression.
 *
 * Deux indicateurs, tous deux dans le COIN SUPÉRIEUR GAUCHE de leur cellule :
 * l'écart de répétitions (+N vert / -N rouge, SANS AUCUN PLAFOND) dans la
 * cellule RÉPÉTITIONS, et la flèche de charge (↑ vert / ↓ rouge) dans la
 * cellule CHARGE.
 *
 * Ces tests valident la STRUCTURE rendue (SSR) et les invariants de code.
 * Ils ne mesurent aucun pixel et ne décident d'aucune règle métier : toute
 * décision de charge vient du moteur du lot A, et c'est précisément ce que
 * plusieurs tests vérifient.
 *
 * Lancement : npx tsx scripts/tests/indicateurs-progression.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import {
  contexteDeComparaison,
  ecartReps,
  formaterChargeKg,
  formaterChargeUtilisateur,
  formaterEcartReps,
  indicateursDExercice,
  libelleCharge,
  libelleEcartReps,
  seriesRealiseesDe,
  uniteDeCharge,
  uniteDeLaReference,
  versChargeEffective,
  versEspaceDeProgression,
  type ContexteComparaison,
  type Indicateurs,
} from "../../lib/indicateurs-progression";
import { referenceDeProgression } from "../../lib/reference-progression";
import { getEffectiveLoadKg, parseLoad } from "../../lib/training-metrics";
import { recommanderProchaineCible } from "../../lib/progression-automatique";
import {
  buildPreviousPerformanceIndex,
  type PreviousExercisePerf,
} from "../../lib/previous-performance";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import { referenceDeLOccurrencePrecedente } from "../../lib/indicateurs-progression";
import type { AdminStudentFeedback, Exercise, ExerciseFeedback, MuscleGroup } from "../../types";

const ELEVE = "11111111-1111-4111-8111-111111111111";

/**
 * Un index d'historique PORTANT LES OCCURRENCES — `day` et `weekNumber` sont
 * posés dans le `prescribed_snapshot`, exactement là où la production les
 * écrit à la soumission de la séance.
 */
function indexHistorique(
  seances: { id: string; weekNumber: number; day: string; performedAt: string; charge: string; nom?: string }[],
) {
  const feedbacks: AdminStudentFeedback[] = seances.map((s) => {
    const nom = s.nom ?? "Développé couché";
    return {
      id: s.id,
      studentId: ELEVE,
      type: "entrainement",
      sessionId: `session-${s.id}`,
      programId: null,
      refLabel: `Séance ${s.id}`,
      date: s.performedAt,
      completed: true,
      rpe: null,
      pain: "",
      comment: "",
      exerciseEntries: [
        { exerciseName: nom, setNumber: 1, loadUsed: s.charge, repsDone: "10", rpe: null, exerciseRpe: null, comment: "" },
      ],
      status: "a-traiter",
      coachReply: "",
      createdAt: `${s.performedAt}T10:00:00Z`,
      updatedAt: `${s.performedAt}T10:00:00Z`,
      performedAt: s.performedAt,
      prescribedSnapshot: {
        version: PRESCRIBED_SNAPSHOT_VERSION,
        sessionId: `session-${s.id}`,
        sessionName: `Séance ${s.id}`,
        day: s.day,
        weekNumber: s.weekNumber,
        capturedAt: `${s.performedAt}T10:00:00Z`,
        blocks: [
          {
            title: null,
            category: "strength",
            position: 0,
            exercises: [
              {
                exerciseLibraryId: null,
                name: nom,
                order: 0,
                sets: null,
                reps: null,
                recommendedLoad: null,
                restSeconds: null,
                tempo: null,
                notes: null,
              },
            ],
          },
        ],
      },
    };
  });
  return buildPreviousPerformanceIndex({
    feedbacks,
    studentId: ELEVE,
    currentSessionId: "session-actuelle",
    today: "2026-08-31",
  });
}

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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sourceCarte = lire("../../components/student/ExerciseFeedbackCard.tsx");
const sourceSection = lire("../../components/student/SessionFeedbackSection.tsx");
const sourceIndicateurs = lire("../../lib/indicateurs-progression.ts");

/* ─── Fabriques ─── */

const PLAGE = { min: 8, max: 13 } as const;

/** Les indicateurs tels que la section les calcule, sans passer par React. */
function indicateurs(options: {
  chargeKg?: number;
  reps?: number;
  groupe?: MuscleGroup;
  reps_prescrites?: string;
  active?: boolean;
}): Indicateurs {
  const lue = indicateursDExercice({
    progressionActive: options.active ?? true,
    groupe: options.groupe ?? "pectoraux",
    repsPrescrites: options.reps_prescrites ?? "8-13",
    reference: { chargeKg: options.chargeKg ?? 50, reps: options.reps ?? 10 },
  });
  assert.ok(lue.ok, `indicateurs attendus (${JSON.stringify(options)})`);
  return lue.indicateurs;
}

/**
 * LE CONTEXTE DE COMPARAISON IMMÉDIATE — indépendant du réglage ON/OFF.
 *
 * ⚠️ IL NE VIENT PAS DE `indicateurs()`. C'est tout l'objet du lot 2 : la
 * comparaison existe même quand la progression automatique est désactivée, et
 * même quand le groupe n'est pas tarifé. Un harnais qui la dériverait des
 * indicateurs ne pourrait pas tester cette indépendance.
 */
function comparaisonDe(options: {
  chargeKg?: number;
  reps?: number;
  reps_prescrites?: string;
  sansReference?: boolean;
  unite?: "totale" | "par-haltere";
}): ContexteComparaison {
  const contexte = contexteDeComparaison({
    repsPrescrites: options.reps_prescrites ?? "8-13",
    reference: options.sansReference
      ? null
      : { chargeKg: options.chargeKg ?? 50, reps: options.reps ?? 10, unite: options.unite ?? "totale" },
  });
  assert.ok(contexte, `contexte de comparaison attendu (${JSON.stringify(options)})`);
  return contexte;
}

function rendreCarte(options: {
  repsSaisies?: string[];
  /**
   * LES CHARGES SAISIES. Depuis le lot 2, l'écart de répétitions n'existe
   * QU'À CHARGE ÉGALE : sans charge saisie, la carte ne peut pas savoir que la
   * charge est égale, et n'affiche donc aucun écart. Par défaut, ce harnais
   * saisit la charge de référence sur chaque série — le cas nominal d'un écart
   * de répétitions.
   */
  chargesSaisies?: string[];
  indicateurs?: Indicateurs | null;
  comparaison?: ContexteComparaison | null;
  reps?: string;
}): string {
  const saisies = options.repsSaisies ?? ["", "", ""];
  const charges = options.chargesSaisies ?? saisies.map(() => "50 kg");
  const exercice: Exercise = {
    id: "ex-1",
    name: "Développé couché",
    sets: saisies.length,
    reps: options.reps ?? "8-13",
    restSeconds: 120,
    tempo: "",
    recommendedLoad: "",
    videoUrl: "",
    recommendedRpe: "",
  };
  const saisie: ExerciseFeedback = {
    studentId: "e",
    sessionId: "s",
    exerciseId: "ex-1",
    exerciseName: exercice.name,
    sets: saisies.map((reps, i) => ({
      studentId: "e",
      sessionId: "s",
      exerciseId: "ex-1",
      setNumber: i + 1,
      loadUsed: charges[i] ?? "",
      repsDone: reps,
      rpe: "",
    })),
    rpe: null,
    comment: "",
  };
  return renderToString(
    createElement(ExerciseFeedbackCard, {
      exercise: exercice,
      index: 1,
      feedback: saisie,
      previous: null,
      indicateurs: options.indicateurs ?? null,
      comparaison: options.comparaison ?? null,
      onSetChange: () => {},
      onCommentChange: () => {},
    }),
  );
}

await (async () => {
  /* ══════════════════════════════════════════════════════════════════════
   * A5 — ÉCART DE RÉPÉTITIONS, SANS PLAFOND
   * ══════════════════════════════════════════════════════════════════════ */

  await test("1. +1 : une répétition de plus que la référence", () => {
    assert.equal(ecartReps("11", 10), 1);
    assert.equal(formaterEcartReps(1), "+1");
  });

  await test("2. +3 : trois répétitions de plus", () => {
    assert.equal(ecartReps("13", 10), 3);
    assert.equal(formaterEcartReps(3), "+3");
  });

  await test("3. +10 : DIX répétitions de plus — aucun plafond à +3", () => {
    assert.equal(ecartReps("20", 10), 10, "référence 10, actuel 20 → +10");
    assert.equal(formaterEcartReps(10), "+10");
    const html = rendreCarte({
      repsSaisies: ["20"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(html.includes("+10"), "l'écart +10 est rendu");
    assert.ok(!html.includes("+3<"), "aucun +3 plafonné à l'écran");
  });

  await test("4. -1 : une répétition de moins", () => {
    assert.equal(ecartReps("9", 10), -1);
    assert.equal(formaterEcartReps(-1), "-1");
  });

  await test("5. -5 : cinq répétitions de moins — aucun plancher à -3", () => {
    assert.equal(ecartReps("5", 10), -5);
    assert.equal(formaterEcartReps(-5), "-5");
    const html = rendreCarte({
      repsSaisies: ["5"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(html.includes("-5"), "l'écart -5 est rendu");
    assert.ok(!html.includes(">-3<"), "aucun -3 plafonné à l'écran");
  });

  await test("6. AUCUN PLAFONNEMENT sur toute l'étendue : balayage de -30 à +30", () => {
    for (let ecart = -30; ecart <= 30; ecart += 1) {
      const reference = 40;
      const saisi = reference + ecart;
      if (saisi < 0) continue;
      const attendu = ecart === 0 ? null : ecart;
      assert.equal(ecartReps(String(saisi), reference), attendu, `écart ${ecart} rendu tel quel`);
    }
    // Et la garde qui compte vraiment : la valeur absolue n'est jamais bornée.
    assert.equal(ecartReps("100", 10), 90);
    assert.equal(ecartReps("0", 90), -90);
  });

  await test("7. un écart NUL n'affiche aucun badge — « 0 » n'apprend rien", () => {
    assert.equal(ecartReps("10", 10), null);
    const html = rendreCarte({
      repsSaisies: ["10"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(!/>[+-]?0</.test(html), "aucun badge « 0 » rendu");
  });

  await test("8. saisie vide ou illisible : aucun écart, aucun badge", () => {
    assert.equal(ecartReps("", 10), null);
    assert.equal(ecartReps("   ", 10), null);
    assert.equal(ecartReps("AMRAP", 10), null);
    assert.equal(ecartReps(null, 10), null);
    assert.equal(ecartReps(undefined, 10), null);
    const html = rendreCarte({
      repsSaisies: ["", "AMRAP"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(!/aria-label="Série \d+ : /.test(html), "aucun libellé d'écart sans saisie lisible");
  });

  await test("9. l'écart est calculé SÉRIE PAR SÉRIE, pas une fois pour l'exercice", () => {
    const html = rendreCarte({
      repsSaisies: ["13", "10", "7"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(html.includes("+3"), "série 1 : +3");
    assert.ok(html.includes("-3"), "série 3 : -3");
    assert.ok(html.includes("Série 1 : 3 répétitions de plus que la référence"));
    assert.ok(html.includes("Série 3 : 3 répétitions de moins que la référence"));
  });

  /* ══════════════════════════════════════════════════════════════════════
   * COULEURS ET POSITION
   * ══════════════════════════════════════════════════════════════════════ */

  await test("10. positif = vert, négatif = rouge", () => {
    const vert = rendreCarte({
      repsSaisies: ["13"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(/text-emerald-600[^"]*"[^>]*>\+3</.test(vert) || vert.includes("text-emerald-600"), "écart positif en vert");
    assert.ok(!vert.includes("text-red-600"), "aucun rouge quand tout est positif");
    const rouge = rendreCarte({
      repsSaisies: ["7"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    assert.ok(rouge.includes("text-red-600"), "écart négatif en rouge");
  });

  await test("11. les deux badges sont en HAUT À GAUCHE de leur cellule, hors du flux de saisie", () => {
    const code = sansCommentaires(sourceCarte);
    assert.ok(/absolute\s+-left-1\s+-top-1\.5/.test(code), "positionnement coin supérieur gauche");
    assert.ok(code.includes("pointer-events-none"), "le badge n'intercepte jamais le doigt");
    // Un badge en absolu n'a de sens que dans un conteneur positionné.
    assert.equal((code.match(/className="relative min-w-0"/g) ?? []).length, 2, "une enveloppe relative par cellule");
    // Invariant de zoom 150 % déjà imposé par student-training-ui (test 28).
    assert.ok(!/text-\[\d+px\]/.test(code), "aucune taille de texte en px figé");
    assert.ok(!/h-\[\d+px\]/.test(code), "aucune hauteur figée en px");
  });

  await test("12. les badges ne sont JAMAIS une valeur de champ ni une saisie", () => {
    const code = sansCommentaires(sourceCarte);
    assert.ok(!/value=\{[^}]*ecart/.test(code), "l'écart n'entre jamais dans value=");
    assert.ok(!/value=\{[^}]*indicateurs/.test(code), "les indicateurs n'entrent jamais dans value=");
    assert.ok(!/onSetChange\([^)]*ecart/.test(code), "l'écart n'est jamais écrit dans l'état");
    assert.ok(!/placeholder=\{[^}]*ecart/.test(code), "l'écart n'est pas un placeholder");
    // Les champs conservent EXACTEMENT leurs classes d'origine. Ils sont
    // TROIS à porter `champ` nu : charge, répétitions, et le commentaire
    // d'exercice — ce dernier existait avant ce chantier et n'est pas
    // concerné par les indicateurs. (Mon premier compte disait deux : c'est
    // le test qui était faux, pas la carte.) Le RPE, lui, porte
    // `${champ} col-span-2 …`, donc jamais la forme nue.
    assert.equal((code.match(/className=\{champ\}/g) ?? []).length, 3, "charge, reps et commentaire gardent `champ` nu");
    // La garde qui compte vraiment : les deux enveloppes relatives encadrent
    // bien un champ intact, sans classe ajoutée.
    const cellules = code.match(/className="relative min-w-0">[\s\S]*?className=\{champ\}/g) ?? [];
    assert.equal(cellules.length, 2, "les deux cellules à badge contiennent un champ aux classes inchangées");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * FLÈCHES DE CHARGE
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * ⚠️ CHANGEMENT DE MÉDIUM ASSUMÉ (lot 2/3, 23/09/2026) — SIGNALÉ.
   *
   * Jusqu'ici, la recommandation se lisait comme une FLÈCHE ↑/↓ dans la
   * cellule CHARGE, identique sur toutes les séries. La flèche de cette
   * cellule porte désormais le CONSEIL DE SÉRIE SUIVANTE, qui change d'une
   * série à l'autre — deux flèches du même glyphe au même endroit ne
   * voulaient plus rien dire.
   *
   * La recommandation n'a pas disparu : elle est passée DANS LE CHAMP, en
   * placeholder (« Reco 52 kg », « Reco 8 reps »), ce que le lot 3 demandait
   * explicitement, et son SENS reste lisible par un lecteur d'écran via le
   * libellé du champ. Ces tests vérifient donc le même fait — la
   * recommandation du moteur atteint l'écran — à l'endroit où elle est
   * désormais rendue. La RÈGLE de charge, elle, est strictement inchangée :
   * c'est ce que continuent d'affirmer les assertions sur `ind`.
   */
  await test("13. hausse de charge : la recommandation atteint le champ, sens compris", () => {
    const ind = indicateurs({ chargeKg: 50, reps: 13 }); // borne haute atteinte
    assert.equal(ind.sensCharge, "hausse");
    assert.equal(ind.recommandation.chargeKg, 52, "pectoraux : +2 kg");
    const html = rendreCarte({ indicateurs: ind });
    assert.ok(html.includes('placeholder="Reco 52 kg"'), "la charge recommandée est le placeholder du champ");
    assert.ok(html.includes('placeholder="Reco 8 reps"'), "et les répétitions cibles aussi");
    assert.ok(html.includes('aria-label="Charge recommandée en hausse : 52 kg"'), "le sens reste annoncé");
    // Aucune flèche : sans saisie, aucune série ne peut conseiller la suivante.
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche de conseil sans saisie");
  });

  await test("14. baisse de charge : la recommandation atteint le champ, sens compris", () => {
    const ind = indicateurs({ chargeKg: 50, reps: 6 }); // sous la borne basse
    assert.equal(ind.sensCharge, "baisse");
    assert.equal(ind.recommandation.chargeKg, 49, "−1 kg");
    const html = rendreCarte({ indicateurs: ind });
    assert.ok(html.includes('placeholder="Reco 49 kg"'));
    assert.ok(html.includes('aria-label="Charge recommandée en baisse : 49 kg"'), "le sens reste annoncé");
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche de conseil sans saisie");
  });

  await test("15. AUCUN sens annoncé quand la charge est maintenue (dans la plage)", () => {
    const ind = indicateurs({ chargeKg: 50, reps: 10 });
    assert.equal(ind.sensCharge, null, "dans la plage : charge inchangée");
    assert.equal(ind.recommandation.motif, "dans-la-plage");
    const html = rendreCarte({ indicateurs: ind });
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche");
    assert.ok(html.includes("Charge recommandée maintenue : 50 kg"), "maintien annoncé, jamais une hausse");
  });

  await test("16. la flèche suit les incréments du lot A, groupe par groupe", () => {
    assert.equal(indicateurs({ chargeKg: 50, reps: 13, groupe: "dos" }).recommandation.chargeKg, 52.5);
    assert.equal(indicateurs({ chargeKg: 50, reps: 13, groupe: "pectoraux" }).recommandation.chargeKg, 52);
    // PETITS GROUPES à +1 kg — `avant-bras` compris depuis le 23/09/2026.
    for (const groupe of ["biceps", "mollets", "triceps", "épaules", "abdos", "lombaires", "autre", "avant-bras"] as MuscleGroup[]) {
      const ind = indicateurs({ chargeKg: 12, reps: 13, groupe });
      assert.equal(ind.recommandation.chargeKg, 13, `${groupe} : +1 kg`);
      assert.equal(ind.sensCharge, "hausse", `${groupe} : flèche montante`);
    }
    // ⚠️ SEULS `cardio` et `full-body` ne produisent AUCUN indicateur.
    // `avant-bras` était ici avant le 23/09/2026 ; ce test verrouillait
    // l'ancienne règle et a été adapté, pas supprimé.
    for (const groupe of ["cardio", "full-body"] as MuscleGroup[]) {
      const lue = indicateursDExercice({
        progressionActive: true,
        groupe,
        repsPrescrites: "8-13",
        reference: { chargeKg: 50, reps: 13 },
      });
      assert.equal(lue.ok, false, `${groupe} : aucun indicateur`);
      assert.equal(lue.ok === false && lue.motif, "groupe-non-tarife");
    }
  });

  await test("16bis. AVANT-BRAS produit bien une flèche et un écart, comme tout petit groupe", () => {
    const ind = indicateurs({ chargeKg: 10, reps: 13, groupe: "avant-bras" });
    assert.equal(ind.recommandation.chargeKg, 11, "10 kg + 1 kg");
    assert.equal(ind.recommandation.reps, 8, "retour borne basse");
    assert.equal(ind.sensCharge, "hausse");
    const html = rendreCarte({
      repsSaisies: ["15"],
      chargesSaisies: ["10 kg"],
      indicateurs: ind,
      comparaison: comparaisonDe({ chargeKg: 10, reps: 13 }),
    });
    assert.ok(html.includes('placeholder="Reco 11 kg"'), "la charge recommandée atteint le champ");
    assert.ok(html.includes("Charge recommandée en hausse : 11 kg"));
    assert.ok(html.includes("+2"), "et l'écart de reps aussi (15 − 13), à charge égale");
    // Sous la borne basse, il baisse de 1 kg comme les autres.
    const baisse = indicateurs({ chargeKg: 10, reps: 5, groupe: "avant-bras" });
    assert.equal(baisse.recommandation.chargeKg, 9);
    assert.equal(baisse.sensCharge, "baisse");
  });

  await test("16ter. CARDIO et FULL-BODY n'affichent NI flèche NI écart", () => {
    for (const groupe of ["cardio", "full-body"] as MuscleGroup[]) {
      const lue = indicateursDExercice({
        progressionActive: true,
        groupe,
        repsPrescrites: "8-13",
        reference: { chargeKg: 50, reps: 13 },
      });
      assert.equal(lue.ok === false && lue.motif, "groupe-non-tarife", `${groupe} refusé`);
      // Refusé, donc `indicateurs` vaut null à l'écran : aucun badge, même
      // avec une saisie très éloignée de la référence.
      const html = rendreCarte({ repsSaisies: ["25"], indicateurs: null });
      assert.ok(!html.includes("↑") && !html.includes("↓"), `${groupe} : aucune flèche`);
      assert.ok(!html.includes("+12"), `${groupe} : aucun écart`);
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * HALTÈRES — CALCUL INTERNE EN TOTAL, AFFICHAGE EN UNITÉ DE SAISIE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("17bis. « 24 kg / haltère » vaut 48 kg pour tous les calculs INTERNES", () => {
    const series = [
      { loadUsed: "24 kg / haltère", repsDone: "13" },
      { loadUsed: "24 kg / haltère", repsDone: "13" },
    ];
    assert.equal(uniteDeLaReference(series), "par-haltere", "l'unité est reconnue");
    assert.equal(uniteDeCharge("24 kg / haltère"), "par-haltere");
    assert.equal(uniteDeCharge("48 kg"), "totale");
    assert.equal(uniteDeCharge(""), "totale");
    assert.equal(uniteDeCharge("poids du corps"), "totale");
    // La convention interne est conservée telle quelle.
    const lue = referenceDeProgression(series);
    assert.ok(lue.ok);
    assert.equal(lue.reference.chargeKg, 48, "24 kg par haltère = 48 kg effectifs");
    // …et c'est bien 48 qui entre dans le moteur.
    const ind = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: lue.reference.chargeKg, reps: lue.reference.reps },
      unite: "par-haltere",
    });
    assert.ok(ind.ok);
    assert.equal(ind.indicateurs.reference.chargeKg, 48, "la référence interne reste en total");
    // ⚠️ 52 ET NON 50 DEPUIS LE 23/09/2026. L'incrément s'applique PAR
    // HALTÈRE : 24 + 2 = 26 kg par haltère, soit 52 kg effectifs. Ce test
    // attendait 50 (incrément appliqué à la paire) — il verrouillait
    // l'ancienne règle, il a été adapté et non supprimé.
    assert.equal(ind.indicateurs.recommandation.chargeKg, 52, "26 kg/haltère = 52 kg effectifs");
    // Et la conversion est réversible sans perte.
    assert.equal(versEspaceDeProgression(48, "par-haltere"), 24);
    assert.equal(versChargeEffective(26, "par-haltere"), 52);
    assert.equal(versEspaceDeProgression(50, "totale"), 50, "hors haltères, aucun changement d'espace");
    assert.equal(versChargeEffective(52, "totale"), 52);
  });

  await test("17bis-a. HALTÈRES — l'incrément s'applique PAR HALTÈRE, palier par palier", () => {
    // Départ commun : 24 kg par haltère (48 kg effectifs), borne haute atteinte.
    const depuis24 = (groupe: MuscleGroup) => {
      const lue = indicateursDExercice({
        progressionActive: true,
        groupe,
        repsPrescrites: "8-13",
        reference: { chargeKg: 48, reps: 13 },
        unite: "par-haltere",
      });
      assert.ok(lue.ok, `recommandation pour ${groupe}`);
      return lue.indicateurs;
    };

    // pectoraux : +2 kg par haltère → 26 kg / haltère.
    const pecs = depuis24("pectoraux");
    assert.equal(pecs.recommandation.chargeKg, 52, "52 kg effectifs");
    assert.equal(formaterChargeUtilisateur(pecs.recommandation.chargeKg, "par-haltere"), "26 kg / haltère");

    // dos / quadriceps / ischios / fessiers : +2,5 kg par haltère → 26,5 kg.
    for (const groupe of ["dos", "quadriceps", "ischios", "fessiers"] as MuscleGroup[]) {
      const ind = depuis24(groupe);
      assert.equal(ind.recommandation.chargeKg, 53, `${groupe} : 53 kg effectifs`);
      assert.equal(
        formaterChargeUtilisateur(ind.recommandation.chargeKg, "par-haltere"),
        "26,5 kg / haltère",
        `${groupe} : 26,5 kg par haltère`,
      );
    }

    // petits groupes : +1 kg par haltère → 25 kg / haltère.
    for (const groupe of ["biceps", "mollets", "triceps", "épaules", "abdos", "lombaires", "autre", "avant-bras"] as MuscleGroup[]) {
      const ind = depuis24(groupe);
      assert.equal(ind.recommandation.chargeKg, 50, `${groupe} : 50 kg effectifs`);
      assert.equal(
        formaterChargeUtilisateur(ind.recommandation.chargeKg, "par-haltere"),
        "25 kg / haltère",
        `${groupe} : 25 kg par haltère`,
      );
    }
  });

  await test("17bis-b. JAMAIS 25,25 kg / haltère — le défaut que cette règle corrige", () => {
    // 24 kg/haltère avec un incrément de 2,5 kg. Appliqué à la PAIRE (48 kg),
    // il rendait 50,5 kg effectifs, soit 25,25 kg par haltère : une charge qui
    // n'existe sur aucun rack. Appliqué PAR HALTÈRE, il rend 26,5 kg.
    const ind = indicateursDExercice({
      progressionActive: true,
      groupe: "dos",
      repsPrescrites: "8-13",
      reference: { chargeKg: 48, reps: 13 },
      unite: "par-haltere",
    });
    assert.ok(ind.ok);
    assert.notEqual(ind.indicateurs.recommandation.chargeKg, 50.5, "50,5 kg effectifs = 25,25 par haltère : interdit");
    assert.equal(ind.indicateurs.recommandation.chargeKg, 53);
    const affiche = formaterChargeUtilisateur(ind.indicateurs.recommandation.chargeKg, "par-haltere");
    assert.equal(affiche, "26,5 kg / haltère");
    assert.ok(!affiche.includes("25,25"), "aucune charge en quart de kilo");
    // Balayage : depuis n'importe quelle charge par haltère au demi-kilo, une
    // montée ne produit jamais de quart de kilo.
    for (let parHaltere = 2; parHaltere <= 40; parHaltere += 0.5) {
      for (const groupe of ["dos", "pectoraux", "biceps"] as MuscleGroup[]) {
        const lue = indicateursDExercice({
          progressionActive: true,
          groupe,
          repsPrescrites: "8-13",
          reference: { chargeKg: parHaltere * 2, reps: 13 },
          unite: "par-haltere",
        });
        assert.ok(lue.ok);
        const cible = lue.indicateurs.recommandation.chargeKg / 2;
        assert.equal(cible * 2, Math.round(cible * 2), `${parHaltere} kg/haltère → ${cible} : pas un quart de kilo`);
      }
    }
  });

  await test("17bis-c. HALTÈRES — la baisse et le plancher agissent aussi par haltère", () => {
    // Conséquence directe et assumée de la règle : le calcul entier se fait
    // dans l'espace de l'haltère, donc −1 kg PAR HALTÈRE sous la borne basse.
    const baisse = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 48, reps: 5 },
      unite: "par-haltere",
    });
    assert.ok(baisse.ok);
    assert.equal(baisse.indicateurs.recommandation.chargeKg, 46, "24 − 1 = 23 kg/haltère = 46 kg effectifs");
    assert.equal(formaterChargeUtilisateur(baisse.indicateurs.recommandation.chargeKg, "par-haltere"), "23 kg / haltère");
    assert.equal(baisse.indicateurs.sensCharge, "baisse");
    // Plancher : 0,5 kg PAR HALTÈRE, donc 1 kg effectif.
    const plancher = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 2, reps: 5 },
      unite: "par-haltere",
    });
    assert.ok(plancher.ok);
    assert.equal(plancher.indicateurs.recommandation.chargeKg, 1, "1 kg effectif = 0,5 kg par haltère");
    assert.equal(formaterChargeUtilisateur(plancher.indicateurs.recommandation.chargeKg, "par-haltere"), "0,5 kg / haltère");
  });

  await test("17ter. L'AFFICHAGE reste dans l'unité de saisie : « / haltère », jamais le total", () => {
    assert.equal(formaterChargeUtilisateur(48, "par-haltere"), "24 kg / haltère");
    assert.equal(formaterChargeUtilisateur(50, "par-haltere"), "25 kg / haltère");
    assert.equal(formaterChargeUtilisateur(49, "par-haltere"), "24,5 kg / haltère");
    assert.equal(formaterChargeUtilisateur(48, "totale"), "48 kg", "sans haltère, rien ne change");
    assert.equal(formaterChargeUtilisateur(Number.NaN, "par-haltere"), "—");
    // La transformation est l'EXACTE réciproque de getEffectiveLoadKg.
    for (const parHaltere of [8, 10, 12.5, 24, 27.5]) {
      const effectif = getEffectiveLoadKg(parseLoad(`${parHaltere} kg / haltère`));
      assert.equal(effectif, parHaltere * 2, `${parHaltere} kg/haltère = ${parHaltere * 2} kg`);
      assert.ok(
        formaterChargeUtilisateur(effectif!, "par-haltere").startsWith(String(parHaltere).replace(".", ",")),
        "l'affichage revient à la valeur saisie",
      );
    }
    // Et à l'écran : le libellé accessible de la flèche parle par haltère.
    const ind = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 48, reps: 13 },
      unite: "par-haltere",
    });
    assert.ok(ind.ok);
    // 26 kg / haltère : l'incrément pectoraux (+2 kg) appliqué PAR HALTÈRE.
    assert.equal(libelleCharge(ind.indicateurs), "Charge recommandée en hausse : 26 kg / haltère");
    const html = rendreCarte({ indicateurs: ind.indicateurs });
    assert.ok(html.includes("26 kg / haltère"), "l'écran affiche l'unité de saisie");
    assert.ok(!/\b52(?:[.,]\d+)? kg\b/.test(html), "et JAMAIS le total effectif, sous aucune écriture");
  });

  await test("17bis-d. NON-RÉGRESSION — un exercice sans haltères est calculé exactement comme avant", () => {
    // Même charge numérique (48 kg), mais saisie en charge totale : le
    // changement d'espace ne doit RIEN faire. Les trois paliers rendent les
    // valeurs d'avant la règle du 23/09/2026.
    const attendu: [MuscleGroup, number][] = [
      ["dos", 50.5],
      ["quadriceps", 50.5],
      ["ischios", 50.5],
      ["fessiers", 50.5],
      ["pectoraux", 50],
      ["biceps", 49],
      ["mollets", 49],
      ["triceps", 49],
      ["épaules", 49],
      ["abdos", 49],
      ["lombaires", 49],
      ["autre", 49],
      ["avant-bras", 49],
    ];
    for (const [groupe, cible] of attendu) {
      const lue = indicateursDExercice({
        progressionActive: true,
        groupe,
        repsPrescrites: "8-13",
        reference: { chargeKg: 48, reps: 13 },
        // unite absente = "totale" : le comportement historique.
      });
      assert.ok(lue.ok, `recommandation pour ${groupe}`);
      assert.equal(lue.indicateurs.recommandation.chargeKg, cible, `${groupe} : ${cible} kg, inchangé`);
      assert.equal(lue.indicateurs.unite, "totale");
    }
    // La baisse et le plancher aussi : −1 kg total, plancher 0,5 kg total.
    const baisse = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 48, reps: 5 },
    });
    assert.ok(baisse.ok);
    assert.equal(baisse.indicateurs.recommandation.chargeKg, 47, "48 − 1 kg");
    const plancher = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 1, reps: 5 },
    });
    assert.ok(plancher.ok);
    assert.equal(plancher.indicateurs.recommandation.chargeKg, 0.5, "plancher inchangé à 0,5 kg");
    // Et les répétitions ne sont jamais touchées par le changement d'espace.
    const dansLaPlage = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 48, reps: 10 },
      unite: "par-haltere",
    });
    assert.ok(dansLaPlage.ok);
    assert.equal(dansLaPlage.indicateurs.recommandation.reps, 11, "+1 rep, haltères ou non");
    assert.equal(dansLaPlage.indicateurs.recommandation.chargeKg, 48, "charge inchangée dans la plage");
    assert.equal(dansLaPlage.indicateurs.sensCharge, null, "aucune flèche");
  });

  await test("17quater. sans haltères, l'affichage est inchangé — aucune régression", () => {
    const ind = indicateurs({ chargeKg: 50, reps: 13 });
    assert.equal(ind.unite, "totale", "l'unité par défaut ne transforme rien");
    assert.equal(libelleCharge(ind), "Charge recommandée en hausse : 52 kg");
    const html = rendreCarte({ indicateurs: ind });
    assert.ok(html.includes("52 kg"), "charge totale affichée telle quelle");
    assert.ok(!html.includes("haltère"), "aucune mention d'haltère hors contexte");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * FORMAT DE CHARGE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("17. format de charge : au plus UNE décimale, aucune décimale inutile", () => {
    assert.equal(formaterChargeKg(15), "15 kg");
    assert.equal(formaterChargeKg(14.5), "14,5 kg");
    assert.equal(formaterChargeKg(11.5), "11,5 kg");
    assert.equal(formaterChargeKg(0.5), "0,5 kg");
    assert.equal(formaterChargeKg(52.5), "52,5 kg");
    assert.equal(formaterChargeKg(15.0), "15 kg", "jamais « 15,0 kg »");
    assert.equal(formaterChargeKg(14.55), "14,6 kg", "arrondi à une décimale");
    assert.equal(formaterChargeKg(Number.NaN), "—");
    // Le libellé accessible utilise ce format, pas une concaténation brute.
    const ind = indicateurs({ chargeKg: 12, reps: 13, groupe: "dos" });
    assert.equal(libelleCharge(ind), "Charge recommandée en hausse : 14,5 kg");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * ON / OFF ET REFUS NOMMÉS
   * ══════════════════════════════════════════════════════════════════════ */

  await test("18. progression DÉSACTIVÉE : aucun indicateur, aucun badge", () => {
    const lue = indicateursDExercice({
      progressionActive: false,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 50, reps: 13 },
    });
    assert.equal(lue.ok, false);
    assert.equal(lue.ok === false && lue.motif, "progression-desactivee");
    const html = rendreCarte({ repsSaisies: ["20"], indicateurs: null });
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche");
    assert.ok(!html.includes("+10"), "aucun écart");
  });

  await test("19. sans indicateurs, la carte est EXACTEMENT celle d'avant ce chantier", () => {
    const html = rendreCarte({ repsSaisies: ["12", "10", "8"], indicateurs: null });
    assert.equal(html.split("aria-label").length - 1, 3, "3 aria-label : le repère de série + les 2 RPE, comme avant");
    assert.ok(!html.includes("text-emerald-600") && !html.includes("text-red-600"), "aucun badge coloré");
  });

  await test("20. plage prescrite ambiguë ou absente : refus nommé, aucun indicateur", () => {
    const motif = (reps: string) => {
      const lue = indicateursDExercice({
        progressionActive: true,
        groupe: "pectoraux",
        repsPrescrites: reps,
        reference: { chargeKg: 50, reps: 13 },
      });
      return lue.ok ? "lue" : lue.motif;
    };
    assert.equal(motif(""), "aucune-prescription");
    assert.equal(motif("6-10, 8-13"), "plage-par-serie");
    assert.equal(motif("11-10-9"), "sequence-de-series");
    assert.equal(motif("13-8"), "bornes-inversees");
    assert.equal(motif("AMRAP"), "illisible");
    assert.equal(motif("8-13"), "lue");
    // Et sans référence : refus, jamais une recommandation inventée.
    const sansRef = indicateursDExercice({
      progressionActive: true,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: null,
    });
    assert.equal(sansRef.ok === false && sansRef.motif, "aucune-reference");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * PAS DE LOGIQUE PARALLÈLE
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * ⚠️ INVARIANT REFORMULÉ LE 23/09/2026, ET LE CHANGEMENT EST DÉLIBÉRÉ.
   *
   * Version d'origine : « aucun fichier hors du moteur ne compare des
   * répétitions à une borne de plage ». Elle était juste tant que le seul
   * consommateur de la plage était la recommandation.
   *
   * Règle posée depuis : les INDICATEURS IMMÉDIATS (✓/✕ et flèche de conseil)
   * ne doivent PAS dépendre du moteur de surcharge automatique — sinon un
   * exercice sans tarif (cardio, full-body) perd tous ses indicateurs. Ils
   * lisent donc la fourchette prescrite directement, et c'est voulu.
   *
   * Ce que l'invariant défend désormais, et qui est le vrai enjeu :
   *   • AUCUN KILOGRAMME n'est décidé hors de lib/progression-automatique.ts —
   *     pas d'incrément, pas de palier, pas de plancher ;
   *   • la RECOMMANDATION (`indicateursDExercice`) délègue toujours au moteur ;
   *   • la CARTE et la SECTION, elles, ne lisent toujours aucune plage et
   *     n'appellent aucun moteur : elles affichent ce qu'on leur donne.
   */
  await test("21. AUCUN SECOND MOTEUR DE CHARGE : le kilogramme n'est décidé qu'une fois", () => {
    const codeIndicateurs = sansCommentaires(sourceIndicateurs);
    const codeCarte = sansCommentaires(sourceCarte);
    const codeSection = sansCommentaires(sourceSection);
    for (const [nom, code] of [
      ["lib/indicateurs-progression.ts", codeIndicateurs],
      ["ExerciseFeedbackCard.tsx", codeCarte],
      ["SessionFeedbackSection.tsx", codeSection],
    ] as const) {
      assert.ok(!/BAISSE_KG|PLANCHER_KG|INCREMENT_PAR_GROUPE/.test(code), `${nom} ne rejoue pas les incréments`);
      assert.ok(!/2\.5|\+\s*2\b/.test(code) || nom !== "lib/indicateurs-progression.ts", `${nom} sans incrément en dur`);
    }
    // La carte et la section ne lisent AUCUNE borne : c'est inchangé.
    for (const [nom, code] of [
      ["ExerciseFeedbackCard.tsx", codeCarte],
      ["SessionFeedbackSection.tsx", codeSection],
    ] as const) {
      assert.ok(!/plage\.(min|max)/.test(code), `${nom} ne lit aucune borne de plage`);
      assert.ok(!code.includes("lirePlageReps"), `${nom} ne lit aucune plage`);
      assert.ok(!code.includes("recommanderProchaineCible"), `${nom} n'appelle aucun moteur`);
    }
    // Et l'unique source de décision de CHARGE est bien appelée.
    assert.ok(
      codeIndicateurs.includes("recommanderProchaineCible("),
      "la recommandation délègue la décision au moteur du lot A",
    );
    // Les bornes ne sont lues QUE par les indicateurs immédiats — jamais pour
    // en déduire un kilogramme. Les deux seules comparaisons autorisées sont
    // celles du verdict et du conseil ; toute troisième serait une règle de
    // plus, écrite au mauvais endroit.
    const comparaisonsDeBorne = codeIndicateurs.match(/reps\s*[<>]=?\s*[\w.]*plage\.(min|max)/g) ?? [];
    assert.equal(comparaisonsDeBorne.length, 3, "verdict (borne basse) + conseil (haute puis basse), et rien d'autre");
    const niveau1 = codeIndicateurs.slice(
      codeIndicateurs.indexOf("export type SensEcartCharge"),
      codeIndicateurs.indexOf("export type SensCharge"),
    );
    for (const comparaison of comparaisonsDeBorne) {
      assert.ok(niveau1.includes(comparaison), `« ${comparaison} » vit dans le niveau 1, pas ailleurs`);
    }
    assert.ok(!/plage\.(min|max)/.test(codeIndicateurs.replace(niveau1, "")), "aucune borne lue hors du niveau 1");
  });

  await test("22. COMPORTEMENTAL — la référence est l'occurrence N-1, et il n'y a AUCUN repli chronologique", () => {
    // Lundi/mercredi/vendredi, charges toutes distinctes pour que la moindre
    // confusion d'occurrence soit visible. Le lundi de la semaine 3 est le
    // plus RÉCENT : c'est le piège.
    const idx = indexHistorique([
      { id: "s2-lun", weekNumber: 2, day: "Lundi", performedAt: "2026-08-17", charge: "40 kg" },
      { id: "s2-mer", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-19", charge: "50 kg" },
      { id: "s2-ven", weekNumber: 2, day: "Vendredi", performedAt: "2026-08-21", charge: "60 kg" },
      { id: "s3-lun", weekNumber: 3, day: "Lundi", performedAt: "2026-08-24", charge: "45 kg" },
    ]);
    const exercice = { name: "Développé couché" };

    const mercrediS3 = referenceDeLOccurrencePrecedente(idx, exercice, { weekNumber: 3, day: "Mercredi" });
    assert.equal(mercrediS3?.chargeKg, 50, "le mercredi prend le mercredi de la semaine 2");
    assert.notEqual(mercrediS3?.chargeKg, 45, "jamais le lundi de la semaine 3, pourtant plus récent");
    assert.notEqual(mercrediS3?.chargeKg, 60, "jamais le vendredi");

    // Occurrence N-1 absente : `null`, PAS la performance la plus proche.
    assert.equal(
      referenceDeLOccurrencePrecedente(idx, exercice, { weekNumber: 4, day: "Mercredi" }),
      null,
      "semaine 3 non réalisée le mercredi → aucune référence, aucun repli sur la semaine 2",
    );
    assert.equal(
      referenceDeLOccurrencePrecedente(idx, exercice, { weekNumber: 2, day: "Jeudi" }),
      null,
      "jour non programmé → aucune référence, jamais le mercredi voisin",
    );
    assert.equal(
      referenceDeLOccurrencePrecedente(idx, exercice, { weekNumber: 1, day: "Mercredi" }),
      null,
      "semaine 1 : il n'existe pas de semaine 0",
    );
    assert.equal(referenceDeLOccurrencePrecedente(idx, exercice, null), null, "aucune occurrence connue");
    assert.equal(
      referenceDeLOccurrencePrecedente(idx, { name: "Squat" }, { weekNumber: 3, day: "Mercredi" }),
      null,
      "un autre exercice n'emprunte pas la référence du premier",
    );

    // La ligne « Dernières perfs », elle, reste chronologique : les deux
    // chemins divergent, et c'est voulu.
    const code = sansCommentaires(sourceSection);
    assert.ok(
      /findPreviousPerformance\(previousIndex, exercise\)/.test(code),
      "« Dernières perfs » garde son appel chronologique",
    );
    assert.ok(
      code.includes("referenceDeLOccurrencePrecedente(previousIndex, exercise, occurrence)"),
      "les indicateurs passent par la résolution testée, sans recalcul local",
    );
  });

  await test("23. les séries d'une performance passée sont ordonnées par NUMÉRO de série", () => {
    // Ordre d'insertion volontairement inversé : 3, 1, 2.
    const perf = {
      sets: {
        3: { loadUsed: "60 kg", repsDone: "6", rpe: null },
        1: { loadUsed: "50 kg", repsDone: "12", rpe: null },
        2: { loadUsed: "50 kg", repsDone: "10", rpe: null },
      },
      exerciseRpe: null,
      performedAt: "2026-08-19",
      matchedBy: "name" as const,
    } satisfies PreviousExercisePerf;
    const series = seriesRealiseesDe(perf);
    assert.deepEqual(
      series.map((s) => s.repsDone),
      ["12", "10", "6"],
      "séries 1, 2, 3 dans cet ordre",
    );
    assert.deepEqual(seriesRealiseesDe(null), [], "aucune performance → aucune série");
    assert.deepEqual(seriesRealiseesDe(undefined), []);
  });

  await test("24. libellés accessibles : ils disent la VALEUR, jamais la couleur", () => {
    const ind = indicateurs({ chargeKg: 50, reps: 13 });
    assert.ok(!/vert|rouge|couleur/i.test(libelleCharge(ind)), "aucune couleur dans le libellé de charge");
    assert.ok(!/vert|rouge|couleur/i.test(libelleEcartReps(3, 1)), "aucune couleur dans le libellé d'écart");
    assert.equal(libelleEcartReps(1, 2), "Série 2 : 1 répétition de plus que la référence", "singulier respecté");
    assert.equal(libelleEcartReps(-1, 2), "Série 2 : 1 répétition de moins que la référence");
    assert.equal(libelleEcartReps(10, 1), "Série 1 : 10 répétitions de plus que la référence");
    // Et à l'écran, chaque badge porte son libellé.
    const html = rendreCarte({
      repsSaisies: ["20"],
      indicateurs: indicateurs({ chargeKg: 50, reps: 10 }),
      comparaison: comparaisonDe({ chargeKg: 50, reps: 10 }),
    });
    assert.ok(html.includes('aria-label="Série 1 : 10 répétitions de plus que la référence"'));
  });

  /* ══════════════════════════════════════════════════════════════════════
   * SABOTAGE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("25. SABOTAGE — un plafonnement de l'écart à ±3 est pris en défaut", () => {
    // Trois écarts qu'un plafond à ±3 rendrait tous identiques à ±3. Le jeu
    // d'essai discrimine donc réellement : sans plafond, les trois diffèrent.
    assert.equal(ecartReps("14", 10), 4);
    assert.equal(ecartReps("17", 10), 7);
    assert.equal(ecartReps("20", 10), 10);
    assert.equal(ecartReps("6", 10), -4);
    assert.equal(ecartReps("3", 10), -7);
    const html = rendreCarte({
      repsSaisies: ["14", "17", "20"],
      indicateurs: indicateurs({ reps: 10 }),
      comparaison: comparaisonDe({ reps: 10 }),
    });
    for (const attendu of ["+4", "+7", "+10"]) {
      assert.ok(html.includes(attendu), `${attendu} rendu tel quel`);
    }
    assert.equal(
      (html.match(/>\+3</g) ?? []).length,
      0,
      "aucun écart n'a été ramené à +3 — c'est exactement ce qu'un plafond produirait",
    );
  });

  await test("26. SABOTAGE — un indicateur calculé hors du moteur est pris en défaut", () => {
    // Le dépassement de borne et la borne atteinte donnent la MÊME charge
    // (règle du lot A). Une implémentation qui recalculerait l'incrément
    // « proportionnellement au dépassement » divergerait ici.
    const atteinte = indicateurs({ chargeKg: 50, reps: 13 });
    const dépassée = indicateurs({ chargeKg: 50, reps: 18 });
    assert.equal(dépassée.recommandation.chargeKg, atteinte.recommandation.chargeKg, "52 kg dans les deux cas");
    assert.equal(dépassée.sensCharge, "hausse");
    // Et le sens de la flèche est déduit de la recommandation, pas des reps :
    // au-dessus de la borne, la charge monte ; sous la borne basse, elle
    // descend — même si les répétitions sont, elles, en hausse.
    const moteur = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: PLAGE,
      reference: { chargeKg: 50, reps: 18 },
    });
    assert.ok(moteur.ok);
    assert.equal(dépassée.recommandation.chargeKg, moteur.recommandation.chargeKg, "aucune divergence avec le moteur");
    assert.equal(dépassée.recommandation.reps, moteur.recommandation.reps);
    assert.equal(dépassée.recommandation.motif, moteur.recommandation.motif);
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
