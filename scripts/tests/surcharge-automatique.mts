/**
 * Harnais — LOT 3 : SURCHARGE AUTOMATIQUE À PARTIR DE `referenceDeSurcharge`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA CHAÎNE COMPLÈTE, DE L'HISTORIQUE AU CHAMP DE SAISIE
 * ════════════════════════════════════════════════════════════════════════
 *   occurrence courante (semaine, jour)
 *     → occurrence N-1 du MÊME jour            (lib/occurrence-programmee.ts)
 *     → séries réellement réalisées            (lib/previous-performance.ts)
 *     → référence de SURCHARGE                 (lib/reference-progression.ts)
 *         charge la plus lourde réellement utilisée
 *         + moyenne des reps DES SEULES séries à cette charge, arrondie
 *           commercialement
 *     → règles de progression déjà définies    (lib/progression-automatique.ts)
 *     → même couple (charge, reps) pour TOUTES les séries
 *     → placeholders des champs                (lib/previous-performance.ts)
 *
 * ⚠️ AUCUNE RÈGLE N'EST DÉCIDÉE ICI NI RÉÉCRITE AILLEURS. Ce lot ne fait que
 * BRANCHER la bonne référence sur un moteur inchangé : les paliers par groupe,
 * la baisse sous la borne basse et le plancher restent la propriété exclusive
 * de lib/progression-automatique.ts.
 *
 * ⚠️ CE HARNAIS NE TOUCHE PAS AU LOT 2. Les indicateurs immédiats sont testés
 * par scripts/tests/indicateurs-immediats.mts ; ici on vérifie seulement
 * qu'ils n'ont pas bougé (dernier test).
 *
 * Lancement : npx tsx scripts/tests/surcharge-automatique.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import {
  indicateursDExercice,
  referenceDeLOccurrencePrecedente,
  seriesRealiseesDe,
  type Indicateurs,
} from "../../lib/indicateurs-progression";
import {
  arrondirReps,
  referenceDeProgression,
  referenceDeSurcharge,
  type SerieRealisee,
} from "../../lib/reference-progression";
import { buildPreviousPerformanceIndex, findPreviousPerformance } from "../../lib/previous-performance";
import { occurrencePrecedente } from "../../lib/occurrence-programmee";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import type { AdminStudentFeedback, Exercise, ExerciseFeedback, MuscleGroup } from "../../types";

const ELEVE = "11111111-1111-4111-8111-111111111111";
const EXERCICE = "Développé couché";

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
function texteRendu(html: string): string {
  return html.replace(/<!-- -->/g, "");
}
const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/* ─── Fabriques ─── */

/** Une série réalisée, écrite comme l'élève l'a saisie. */
function serie(charge: string, reps: string): SerieRealisee {
  return { loadUsed: charge, repsDone: reps };
}

/**
 * Un index d'historique PORTANT LES OCCURRENCES, avec une séance par
 * occurrence et autant de séries qu'on veut.
 *
 * `day` et `weekNumber` sont posés dans le `prescribed_snapshot`, exactement
 * là où la production les écrit à la soumission de la séance : c'est ce qui
 * permet de retrouver l'occurrence N-1 du MÊME jour.
 */
function indexHistorique(
  seances: { id: string; weekNumber: number; day: string; performedAt: string; series: SerieRealisee[] }[],
) {
  const feedbacks: AdminStudentFeedback[] = seances.map((s) => ({
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
    exerciseEntries: s.series.map((serieRealisee, index) => ({
      exerciseName: EXERCICE,
      setNumber: index + 1,
      loadUsed: serieRealisee.loadUsed ?? "",
      repsDone: serieRealisee.repsDone ?? "",
      rpe: null,
      exerciseRpe: null,
      comment: "",
    })),
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
              name: EXERCICE,
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
  }));
  return buildPreviousPerformanceIndex({
    feedbacks,
    studentId: ELEVE,
    currentSessionId: "session-actuelle",
    today: "2026-08-31",
  });
}

/**
 * LA CHAÎNE COMPLÈTE, telle que la page de séance l'exécute : historique →
 * occurrence N-1 → référence de surcharge → moteur → indicateurs.
 *
 * C'est volontairement le chemin réel et non un raccourci : un test qui
 * appellerait `indicateursDExercice` avec une référence écrite à la main ne
 * prouverait pas que c'est bien `referenceDeSurcharge` qui l'alimente.
 */
function surchargeDeLOccurrence(options: {
  series: SerieRealisee[];
  repsPrescrites?: string;
  groupe?: MuscleGroup;
  active?: boolean;
  /** Pose l'occurrence N-1 un AUTRE jour : il n'y a alors pas de N-1. */
  jourPrecedentDifferent?: boolean;
}) {
  const courante = { weekNumber: 2, day: "Lundi" };
  const precedente = occurrencePrecedente(courante);
  assert.ok(precedente, "l'occurrence N-1 existe pour la semaine 2");
  const index = indexHistorique([
    {
      id: "s1",
      weekNumber: precedente.weekNumber,
      day: options.jourPrecedentDifferent ? "Mercredi" : precedente.day,
      performedAt: "2026-08-24",
      series: options.series,
    },
  ]);
  const reference = referenceDeLOccurrencePrecedente(index, { name: EXERCICE }, courante);
  const lue = indicateursDExercice({
    progressionActive: options.active ?? true,
    groupe: options.groupe ?? "pectoraux",
    repsPrescrites: options.repsPrescrites ?? "8-13",
    reference,
    ...(reference?.unite ? { unite: reference.unite } : {}),
  });
  return { reference, lue, index, courante };
}

/** La carte rendue en SSR, avec la prescription du coach du cas réel. */
function rendreCarte(options: {
  nombreDeSeries?: number;
  indicateurs?: Indicateurs | null;
  prescriptionCharge?: string;
  prescriptionReps?: string;
}): string {
  const nombre = options.nombreDeSeries ?? 3;
  const exercice: Exercise = {
    id: "ex-1",
    name: EXERCICE,
    sets: nombre,
    reps: options.prescriptionReps ?? "8-13",
    restSeconds: 120,
    tempo: "",
    recommendedLoad: options.prescriptionCharge ?? "RIR 1",
    videoUrl: "",
    recommendedRpe: "",
  };
  const saisie: ExerciseFeedback = {
    studentId: "e",
    sessionId: "s",
    exerciseId: "ex-1",
    exerciseName: EXERCICE,
    sets: Array.from({ length: nombre }, (_, i) => ({
      studentId: "e",
      sessionId: "s",
      exerciseId: "ex-1",
      setNumber: i + 1,
      loadUsed: "",
      repsDone: "",
      rpe: "",
    })),
    rpe: null,
    comment: "",
  };
  return renderToString(
    createElement(ExerciseFeedbackCard, {
      exercise: exercice,
      index: 0,
      feedback: saisie,
      previous: null,
      indicateurs: options.indicateurs ?? null,
      comparaison: null,
      onSetChange: () => {},
      onCommentChange: () => {},
    }),
  );
}

/** L'exemple obligatoire du chantier. */
const EXEMPLE = [serie("45 kg", "13"), serie("45 kg", "14"), serie("47 kg", "10")];

await (async () => {
  /* ══════════════════════════════════════════════════════════════════════
   * L'EXEMPLE OBLIGATOIRE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("1. EXEMPLE OBLIGATOIRE — 45×13 / 45×14 / 47×10, plage 8-13 ⇒ 47 kg × 11", () => {
    // La référence, d'abord : la charge la plus lourde RÉELLEMENT utilisée…
    const ref = referenceDeSurcharge(EXEMPLE);
    assert.ok(ref.ok, "la séance à charge variable produit bien une référence de surcharge");
    assert.equal(ref.reference.chargeKg, 47, "charge la plus lourde réellement utilisée");
    assert.equal(ref.reference.reps, 10, "moyenne des reps aux SEULES séries à 47 kg");
    assert.equal(ref.reference.seriesRetenues, 1, "une seule série était à 47 kg");
    // … puis la chaîne complète, depuis l'historique jusqu'aux champs.
    const { reference, lue } = surchargeDeLOccurrence({ series: EXEMPLE });
    assert.deepEqual(reference, { chargeKg: 47, reps: 10, unite: "totale" });
    assert.ok(lue.ok, "une recommandation est produite");
    assert.equal(lue.indicateurs.recommandation.chargeKg, 47, "47 kg");
    assert.equal(lue.indicateurs.recommandation.reps, 11, "× 11");
    assert.equal(lue.indicateurs.recommandation.motif, "dans-la-plage");
    assert.equal(lue.indicateurs.recommandation.chargeModifiee, false, "10 est dans 8-13 : la charge ne bouge pas");
    // Et à l'écran, dans les CHAMPS, sur chacune des trois séries.
    const html = rendreCarte({ indicateurs: lue.indicateurs, nombreDeSeries: 3 });
    assert.equal((html.match(/placeholder="Reco 47 kg"/g) ?? []).length, 3, "champ charge : 47 kg, trois fois");
    assert.equal((html.match(/placeholder="Reco 11 reps"/g) ?? []).length, 3, "champ reps : 11, trois fois");
    assert.ok(!html.includes('placeholder="Charge (RIR 1)"'), "la prescription du coach ne gagne plus");
    assert.ok(!html.includes('placeholder="Reps (8-13)"'));
  });

  await test("2. la référence est la charge la PLUS LOURDE, ni la première ni la plus fréquente", () => {
    // Ordre inversé : la plus lourde d'abord. Même résultat.
    const inverse = referenceDeSurcharge([serie("47 kg", "10"), serie("45 kg", "13"), serie("45 kg", "14")]);
    assert.ok(inverse.ok);
    assert.equal(inverse.reference.chargeKg, 47, "l'ordre des séries ne change rien");
    assert.equal(inverse.reference.reps, 10);
    // La plus FRÉQUENTE (45 kg, deux séries) n'est pas la référence : si elle
    // l'était, la référence serait 45 × 14 (moyenne de 13 et 14) et la
    // recommandation deviendrait 47 kg — le mauvais résultat pour la bonne
    // raison. Ce jeu d'essai discrimine donc réellement.
    assert.notEqual(inverse.reference.chargeKg, 45);
    const { lue } = surchargeDeLOccurrence({ series: EXEMPLE });
    assert.ok(lue.ok);
    assert.equal(lue.indicateurs.recommandation.chargeKg, 47, "et non 47 obtenu par une montée depuis 45");
    assert.equal(lue.indicateurs.recommandation.chargeModifiee, false, "aucune montée : c'est bien 47 en référence");
  });

  await test("3. PLUSIEURS SÉRIES à la charge maximale : la moyenne ne porte que sur elles", () => {
    // 47×10 et 47×12 → moyenne 11 ; la série à 45 kg, même à 20 reps, n'entre pas.
    const ref = referenceDeSurcharge([serie("47 kg", "10"), serie("47 kg", "12"), serie("45 kg", "20")]);
    assert.ok(ref.ok);
    assert.equal(ref.reference.chargeKg, 47);
    assert.equal(ref.reference.reps, 11, "(10 + 12) / 2 — le 20 de la série légère est exclu");
    assert.equal(ref.reference.seriesRetenues, 2, "deux séries retenues, pas trois");
    // La preuve que l'exclusion compte : en incluant la série légère, la
    // moyenne serait 14 et la recommandation monterait la charge.
    assert.equal(arrondirReps((10 + 12 + 20) / 3), 14, "moyenne fautive qu'un filtre absent produirait");
    const { lue } = surchargeDeLOccurrence({
      series: [serie("47 kg", "10"), serie("47 kg", "12"), serie("45 kg", "20")],
    });
    assert.ok(lue.ok);
    assert.equal(lue.indicateurs.recommandation.chargeKg, 47, "la charge ne monte pas : 11 est dans 8-13");
    assert.equal(lue.indicateurs.recommandation.reps, 12);
    assert.equal(lue.indicateurs.sensCharge, null);
  });

  await test("4. CHARGE MAXIMALE SUR UNE SEULE SÉRIE : cette série seule fait la référence", () => {
    const ref = referenceDeSurcharge([serie("45 kg", "14"), serie("45 kg", "13"), serie("47 kg", "8")]);
    assert.ok(ref.ok);
    assert.equal(ref.reference.chargeKg, 47);
    assert.equal(ref.reference.reps, 8, "les 8 de la série à 47 kg, et rien d'autre");
    assert.equal(ref.reference.seriesRetenues, 1);
    const { lue } = surchargeDeLOccurrence({
      series: [serie("45 kg", "14"), serie("45 kg", "13"), serie("47 kg", "8")],
    });
    assert.ok(lue.ok);
    assert.equal(lue.indicateurs.recommandation.chargeKg, 47, "8 est dans 8-13 : la charge reste");
    assert.equal(lue.indicateurs.recommandation.reps, 9, "et l'objectif monte d'une répétition");
    // Sous la borne basse, en revanche, la règle déjà définie fait baisser.
    const sousLaBorne = surchargeDeLOccurrence({
      series: [serie("45 kg", "14"), serie("47 kg", "5")],
    });
    assert.ok(sousLaBorne.lue.ok);
    assert.equal(sousLaBorne.lue.indicateurs.recommandation.chargeKg, 46, "−1 kg, règle du lot A inchangée");
    assert.equal(sousLaBorne.lue.indicateurs.sensCharge, "baisse");
  });

  await test("5. MOYENNE DES REPS à la charge maximale, ARRONDI COMMERCIAL", () => {
    // 10,5 → 11 (et non 10) : l'arrondi commercial monte à la moitié.
    const demi = referenceDeSurcharge([serie("50 kg", "10"), serie("50 kg", "11")]);
    assert.ok(demi.ok);
    assert.equal(demi.reference.reps, 11, "(10 + 11) / 2 = 10,5 → 11");
    // 10,33 → 10 : en dessous de la moitié, on descend.
    const bas = referenceDeSurcharge([serie("50 kg", "10"), serie("50 kg", "10"), serie("50 kg", "11")]);
    assert.ok(bas.ok);
    assert.equal(bas.reference.reps, 10, "31 / 3 = 10,33 → 10");
    // 11,5 → 12, et le seuil de la plage est franchi : la charge monte.
    const haut = referenceDeSurcharge([serie("50 kg", "11"), serie("50 kg", "12")]);
    assert.ok(haut.ok);
    assert.equal(haut.reference.reps, 12);
    assert.equal(arrondirReps(10.5), 11);
    assert.equal(arrondirReps(10.4), 10);
    assert.equal(arrondirReps(12.5), 13);
    // Jamais une demi-répétition ne sort de la référence.
    for (const series of [
      [serie("50 kg", "9"), serie("50 kg", "10")],
      [serie("50 kg", "8"), serie("50 kg", "9"), serie("50 kg", "11")],
      [serie("50 kg", "13"), serie("50 kg", "14"), serie("50 kg", "14")],
    ]) {
      const lue = referenceDeSurcharge(series);
      assert.ok(lue.ok);
      assert.ok(Number.isInteger(lue.reference.reps), `${lue.reference.reps} est un entier`);
    }
    // Les séries illisibles sont COMPTÉES COMME IGNORÉES, jamais moyennées.
    const illisible = referenceDeSurcharge([serie("50 kg", "10"), serie("50 kg", "AMRAP")]);
    assert.ok(illisible.ok);
    assert.equal(illisible.reference.reps, 10);
    assert.equal(illisible.reference.seriesIgnorees, 1);
  });

  await test("6. CHARGE CONSTANTE — non-régression : la nouvelle règle généralise l'ancienne", () => {
    for (const series of [
      [serie("50 kg", "12"), serie("50 kg", "10"), serie("50 kg", "8")],
      [serie("50 kg", "10"), serie("50 kg", "10"), serie("50 kg", "10")],
      [serie("12,5 kg", "13"), serie("12,5 kg", "13")],
      [serie("24 kg / haltère", "9"), serie("24 kg / haltère", "11")],
      [serie("50 kg", "10")],
    ]) {
      assert.deepEqual(
        referenceDeSurcharge(series),
        referenceDeProgression(series),
        `charge constante : les deux références coïncident (${JSON.stringify(series)})`,
      );
    }
    // Et la recommandation de bout en bout est celle d'avant ce lot.
    const { reference, lue } = surchargeDeLOccurrence({
      series: [serie("50 kg", "12"), serie("50 kg", "10"), serie("50 kg", "8")],
    });
    assert.deepEqual(reference, { chargeKg: 50, reps: 10, unite: "totale" });
    assert.ok(lue.ok);
    assert.equal(lue.indicateurs.recommandation.chargeKg, 50);
    assert.equal(lue.indicateurs.recommandation.reps, 11);
  });

  await test("7. MÊME RECOMMANDATION SUR TOUTES LES SÉRIES, quel qu'en soit le nombre", () => {
    const { lue } = surchargeDeLOccurrence({ series: EXEMPLE });
    assert.ok(lue.ok);
    for (const nombre of [1, 3, 5, 8]) {
      const html = rendreCarte({ indicateurs: lue.indicateurs, nombreDeSeries: nombre });
      const charges = html.match(/placeholder="Reco [^"]*kg"/g) ?? [];
      const reps = html.match(/placeholder="Reco [^"]*reps"/g) ?? [];
      assert.equal(charges.length, nombre, `${nombre} séries : autant de champs charge`);
      assert.equal(reps.length, nombre, `${nombre} séries : autant de champs reps`);
      // Et un seul couple DISTINCT : aucune série ne reçoit une cible à elle.
      assert.equal(new Set(charges).size, 1, "une seule charge recommandée pour tout l'exercice");
      assert.equal(new Set(reps).size, 1, "une seule cible de répétitions pour tout l'exercice");
      assert.ok(charges[0]?.includes("47 kg"));
      assert.ok(reps[0]?.includes("11 reps"));
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LES REFUS — AUCUNE RECOMMANDATION INVENTÉE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("8. PROGRESSION DÉSACTIVÉE : aucune recommandation, prescription du coach intacte", () => {
    const { reference, lue } = surchargeDeLOccurrence({ series: EXEMPLE, active: false });
    // La référence existe — le OFF ne l'efface pas, il empêche d'en tirer une cible.
    assert.deepEqual(reference, { chargeKg: 47, reps: 10, unite: "totale" });
    assert.equal(lue.ok, false);
    assert.equal(lue.ok === false && lue.motif, "progression-desactivee");
    const html = rendreCarte({ indicateurs: null });
    assert.ok(html.includes('placeholder="Charge (RIR 1)"'), "la prescription du coach est strictement conservée");
    assert.ok(html.includes('placeholder="Reps (8-13)"'));
    assert.ok(!html.includes("Reco "), "aucune recommandation automatique nulle part");
    assert.ok(!html.includes("47 kg"), "et pas davantage la charge calculée sous une autre forme");
  });

  await test("9. AUCUNE OCCURRENCE N-1 : aucune recommandation", () => {
    // Semaine 1 : il n'y a pas de semaine 0.
    const semaine1 = referenceDeLOccurrencePrecedente(
      indexHistorique([{ id: "s1", weekNumber: 1, day: "Lundi", performedAt: "2026-08-24", series: EXEMPLE }]),
      { name: EXERCICE },
      { weekNumber: 1, day: "Lundi" },
    );
    assert.equal(semaine1, null, "aucune occurrence avant la première semaine");
    // Occurrence N-1 réalisée un AUTRE jour : aucun repli chronologique.
    const autreJour = surchargeDeLOccurrence({ series: EXEMPLE, jourPrecedentDifferent: true });
    assert.equal(autreJour.reference, null, "le mercredi de S1 n'est pas la référence du lundi de S2");
    assert.equal(autreJour.lue.ok, false);
    assert.equal(autreJour.lue.ok === false && autreJour.lue.motif, "aucune-reference");
    // Séance réalisée mais sans aucune charge chiffrable : refus nommé aussi.
    const sansCharge = surchargeDeLOccurrence({ series: [serie("au max", "10"), serie("", "")] });
    assert.equal(sansCharge.reference, null);
    assert.equal(sansCharge.lue.ok === false && sansCharge.lue.motif, "aucune-reference");
    const html = rendreCarte({ indicateurs: null });
    assert.ok(!html.includes("Reco "), "aucune cible affichée sans référence");
  });

  await test("10. CARDIO et FULL-BODY : aucune surcharge automatique", () => {
    for (const groupe of ["cardio", "full-body"] as MuscleGroup[]) {
      const { reference, lue } = surchargeDeLOccurrence({ series: EXEMPLE, groupe });
      // La référence se lit — c'est le TARIF qui manque, pas l'historique.
      assert.deepEqual(reference, { chargeKg: 47, reps: 10, unite: "totale" }, `${groupe} : la référence existe`);
      assert.equal(lue.ok, false, `${groupe} : aucune recommandation`);
      assert.equal(lue.ok === false && lue.motif, "groupe-non-tarife", `${groupe} : refus nommé`);
      const html = rendreCarte({ indicateurs: null });
      assert.ok(!html.includes("Reco "), `${groupe} : aucune cible dans les champs`);
      assert.ok(html.includes('placeholder="Charge (RIR 1)"'), `${groupe} : la prescription reste`);
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * PÉRIMÈTRE — CE QUE CE LOT NE DOIT PAS AVOIR TOUCHÉ
   * ══════════════════════════════════════════════════════════════════════ */

  await test("11. PÉRIMÈTRE — graphique, stagnation, indicateurs du lot 2 et sauvegarde du lot 1 intacts", () => {
    // GRAPHIQUE : il lit toujours `referenceDeProgression`, qui REFUSE une
    // séance à charge variable. C'est correct pour tracer un point, et ce lot
    // ne le change pas — les deux fonctions coexistent.
    const pourLaCourbe = referenceDeProgression(EXEMPLE);
    assert.equal(pourLaCourbe.ok, false);
    assert.equal(pourLaCourbe.ok === false && pourLaCourbe.motif, "charge-non-constante");
    const codeCourbe = lire("../../lib/performance-exercice.ts");
    assert.ok(codeCourbe.includes("referenceDeProgression"), "la courbe garde sa référence");
    assert.ok(!codeCourbe.includes("referenceDeSurcharge"), "la courbe n'emprunte pas celle de la surcharge");
    const codeSectionPerf = sansCommentaires(lire("../../components/admin/StudentPerformanceSection.tsx"));
    assert.ok(codeSectionPerf.includes("stagnationEnCours("), "la stagnation reste calculée à la lecture");
    assert.ok(!codeSectionPerf.includes("referenceDeSurcharge"), "et ne connaît pas la surcharge");
    // LOT 2 : les indicateurs immédiats ne passent ni par le moteur, ni par le
    // réglage, ni par le groupe. Ce lot n'y a pas touché.
    const codeIndicateurs = sansCommentaires(lire("../../lib/indicateurs-progression.ts"));
    const niveau1 = codeIndicateurs.slice(
      codeIndicateurs.indexOf("export type SensEcartCharge"),
      codeIndicateurs.indexOf("export type SensCharge"),
    );
    assert.ok(niveau1.length > 500, "le niveau 1 est bien présent");
    assert.ok(!niveau1.includes("recommanderProchaineCible"), "le niveau 1 n'appelle aucun moteur");
    assert.ok(!/groupe|MuscleGroup/.test(niveau1), "le niveau 1 ne connaît aucun groupe");
    const codeSection = sansCommentaires(lire("../../components/student/SessionFeedbackSection.tsx"));
    const blocComparaison = codeSection.slice(codeSection.indexOf("comparaisonsParExercice"));
    assert.ok(
      !blocComparaison.slice(0, blocComparaison.indexOf("}, [")).includes("progressionActivePourExercice"),
      "la comparaison immédiate ignore toujours le réglage",
    );
    // RÉGLAGE GLOBAL PAR EXERCICE : la recommandation, elle, l'écoute toujours.
    const blocReco = codeSection.slice(codeSection.indexOf("indicateursParExercice"));
    assert.ok(
      blocReco.slice(0, blocReco.indexOf("}, [")).includes("progressionActivePourExercice"),
      "la recommandation obéit toujours au réglage global par exercice",
    );
    // LOT 1 : sauvegarde groupée inchangée.
    const codeToggle = sansCommentaires(lire("../../components/admin/ProgressionAutomatiqueToggle.tsx"));
    assert.ok(codeToggle.includes("lotsDEcriture("), "les bascules partent toujours en lot");
    // ⚠️ MISE À JOUR DU 23/09/2026 : le regroupement est déclenché par
    // « Enregistrer » et non plus par une minuterie. Ce que ce harnais défend
    // reste identique — les bascules partent en LOT.
    assert.ok(codeToggle.includes("enregistrerRef.current = enregistrerLesReglages"), "persistance à l'enregistrement");
    // Et la chaîne du lot 3 passe bien par la référence de SURCHARGE.
    assert.ok(
      codeIndicateurs.includes("referenceDeSurcharge("),
      "la référence de l'occurrence N-1 est celle de la surcharge",
    );
    // Passerelle historique → séries : l'ordre des séries est respecté, sinon
    // la charge la plus lourde pourrait être lue sur la mauvaise série.
    const perf = findPreviousPerformance(
      indexHistorique([{ id: "s1", weekNumber: 1, day: "Lundi", performedAt: "2026-08-24", series: EXEMPLE }]),
      { name: EXERCICE },
      { weekNumber: 1, day: "Lundi" },
    );
    assert.ok(perf);
    assert.deepEqual(
      seriesRealiseesDe(perf).map((s) => `${s.loadUsed}×${s.repsDone}`),
      ["45 kg×13", "45 kg×14", "47 kg×10"],
      "les séries reviennent dans l'ordre des numéros",
    );
    assert.ok(texteRendu(rendreCarte({ indicateurs: null })).includes("charge conseillée RIR 1"));
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
