/**
 * Harnais — LOT 2 : INDICATEURS IMMÉDIATS, ET PRIORITÉ DE LA RECOMMANDATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE HARNAIS DÉFEND
 * ════════════════════════════════════════════════════════════════════════
 * 1. La COMPARAISON immédiate ne dépend PAS du réglage « progression
 *    automatique ». Constater qu'un élève a mis 2 kg de plus n'est pas
 *    recommander quoi que ce soit.
 * 2. Elle ne conclut JAMAIS naïvement : les répétitions ne se comparent qu'à
 *    CHARGE ÉGALE, et une charge en baisse ne reçoit aucun verdict.
 * 3. La flèche ↑/↓ est un CONSEIL porté par la série SUIVANTE, déduit des
 *    répétitions de la précédente.
 * 4. Progression ACTIVÉE, la recommandation calculée passe devant la
 *    prescription du coach DANS LES CHAMPS ; désactivée, la prescription est
 *    intacte au caractère près.
 *
 * ⚠️ AUCUNE RÈGLE MÉTIER N'EST DÉCIDÉE ICI, ni dans le code testé : tout
 * jugement de borne est obtenu en interrogeant `recommanderProchaineCible`.
 * Plusieurs tests vérifient précisément cette délégation — un second `if`
 * serait une seconde vérité.
 *
 * Lancement : npx tsx scripts/tests/indicateurs-immediats.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import {
  comparerALaReference,
  conseilSerieSuivante,
  contexteDeComparaison,
  formaterEcartChargeKg,
  indicateursDExercice,
  libelleConseilSerieSuivante,
  libelleEcartCharge,
  texteEcartCharge,
  type ContexteComparaison,
  type Indicateurs,
  type UniteCharge,
} from "../../lib/indicateurs-progression";
import { referenceDeProgression, referenceDeSurcharge } from "../../lib/reference-progression";
import { recommanderProchaineCible } from "../../lib/progression-automatique";
import type { Exercise, ExerciseFeedback, MuscleGroup } from "../../types";

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

/**
 * React insère `<!-- -->` entre deux nœuds de texte adjacents : sans ce
 * nettoyage, une phrase interpolée ne se retrouve jamais par `includes`.
 */
function texteRendu(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sourceCarte = lire("../../components/student/ExerciseFeedbackCard.tsx");
const sourceSection = lire("../../components/student/SessionFeedbackSection.tsx");
const sourceIndicateurs = lire("../../lib/indicateurs-progression.ts");
const sourcePerformanceExercice = lire("../../lib/performance-exercice.ts");
const sourceSectionPerformances = lire("../../components/admin/StudentPerformanceSection.tsx");
const sourceToggle = lire("../../components/admin/ProgressionAutomatiqueToggle.tsx");

/* ─── Fabriques ─── */

const PLAGE = { min: 8, max: 13 } as const;

function comparaison(options: {
  chargeKg?: number;
  reps?: number;
  repsPrescrites?: string;
  sansReference?: boolean;
  unite?: UniteCharge;
}): ContexteComparaison {
  const contexte = contexteDeComparaison({
    repsPrescrites: options.repsPrescrites ?? "8-13",
    reference: options.sansReference
      ? null
      : { chargeKg: options.chargeKg ?? 50, reps: options.reps ?? 10, unite: options.unite ?? "totale" },
  });
  assert.ok(contexte, `contexte attendu (${JSON.stringify(options)})`);
  return contexte;
}

function indicateurs(options: {
  chargeKg?: number;
  reps?: number;
  groupe?: MuscleGroup;
  repsPrescrites?: string;
  active?: boolean;
  unite?: UniteCharge;
}): Indicateurs | null {
  const lue = indicateursDExercice({
    progressionActive: options.active ?? true,
    groupe: options.groupe ?? "pectoraux",
    repsPrescrites: options.repsPrescrites ?? "8-13",
    reference: { chargeKg: options.chargeKg ?? 50, reps: options.reps ?? 10 },
    ...(options.unite ? { unite: options.unite } : {}),
  });
  return lue.ok ? lue.indicateurs : null;
}

/**
 * La carte rendue en SSR.
 *
 * `prescriptionCharge` / `prescriptionReps` reproduisent le cas réel qui
 * motivait le lot 3 : un coach écrit « RIR 1 » et « 8-13 », deux textes qui
 * gagnaient toujours la priorité et empêchaient la cible calculée d'atteindre
 * l'écran.
 */
function rendreCarte(options: {
  repsSaisies?: string[];
  chargesSaisies?: string[];
  indicateurs?: Indicateurs | null;
  comparaison?: ContexteComparaison | null;
  prescriptionCharge?: string;
  prescriptionReps?: string;
}): string {
  const saisies = options.repsSaisies ?? ["", "", ""];
  const charges = options.chargesSaisies ?? saisies.map(() => "");
  const exercice: Exercise = {
    id: "ex-1",
    name: "Développé couché",
    sets: saisies.length,
    reps: options.prescriptionReps ?? "8-13",
    restSeconds: 120,
    tempo: "",
    recommendedLoad: options.prescriptionCharge ?? "",
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
      index: 0,
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
   * CAS NOMINAUX — L'ÉCART DE CHARGE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("1. écart de charge en kg, signé, et rendu dans la cellule CHARGE", () => {
    const contexte = comparaison({ chargeKg: 45, reps: 13 });
    const lue = comparerALaReference(contexte, { chargeSaisie: "47 kg", repsSaisies: "10" });
    assert.ok(lue);
    assert.equal(lue.sens, "hausse");
    assert.equal(lue.ecartChargeKg, 2, "47 − 45");
    assert.equal(formaterEcartChargeKg(lue.ecartChargeKg, "totale"), "+2 kg");
    const baisse = comparerALaReference(contexte, { chargeSaisie: "42,5 kg", repsSaisies: "12" });
    assert.ok(baisse);
    assert.equal(baisse.sens, "baisse");
    assert.equal(baisse.ecartChargeKg, -2.5);
    assert.equal(formaterEcartChargeKg(baisse.ecartChargeKg, "totale"), "-2,5 kg");
    const html = rendreCarte({
      repsSaisies: ["10"],
      chargesSaisies: ["47 kg"],
      comparaison: contexte,
    });
    assert.ok(texteRendu(html).includes("+2 kg"), "l'écart de charge est rendu");
  });

  await test("2. ✓ quand la charge montée est TENUE, ✕ quand les reps tombent sous la borne", () => {
    const contexte = comparaison({ chargeKg: 45, reps: 13 });
    const tenue = comparerALaReference(contexte, { chargeSaisie: "47 kg", repsSaisies: "10" });
    assert.ok(tenue);
    assert.equal(tenue.tenue, "tenue", "10 est dans 8-13 : la charge est tenue");
    assert.equal(texteEcartCharge(tenue, "totale"), "+2 kg ✓");
    const insuffisante = comparerALaReference(contexte, { chargeSaisie: "47 kg", repsSaisies: "6" });
    assert.ok(insuffisante);
    assert.equal(insuffisante.tenue, "insuffisante", "6 est sous 8");
    assert.equal(texteEcartCharge(insuffisante, "totale"), "+2 kg ✕");
    // Le verdict est celui du MOTEUR, pas une relecture locale des bornes.
    const moteur = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: PLAGE,
      reference: { chargeKg: 100, reps: 6 },
    });
    assert.ok(moteur.ok && moteur.recommandation.chargeKg < 100, "le moteur baisse : d'où le ✕");
    const html = rendreCarte({ repsSaisies: ["10"], chargesSaisies: ["47 kg"], comparaison: contexte });
    assert.ok(texteRendu(html).includes("+2 kg ✓"));
    assert.ok(html.includes("charge tenue"), "le libellé accessible dit le verdict");
  });

  await test("3. CHARGE EN BAISSE — aucun verdict, aucune conclusion naïve", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    // 20 répétitions à 40 kg : un système naïf afficherait « +10 ✓ ».
    const lue = comparerALaReference(contexte, { chargeSaisie: "40 kg", repsSaisies: "20" });
    assert.ok(lue);
    assert.equal(lue.sens, "baisse");
    assert.equal(lue.tenue, null, "aucun ✓/✕ à la baisse");
    assert.equal(lue.ecartReps, null, "aucun écart de répétitions à la baisse");
    assert.equal(texteEcartCharge(lue, "totale"), "-10 kg", "ni ✓ ni ✕");
    const html = rendreCarte({ repsSaisies: ["20"], chargesSaisies: ["40 kg"], comparaison: contexte });
    const rendu = texteRendu(html);
    assert.ok(rendu.includes("-10 kg"), "l'écart de charge est bien rendu, lui");
    assert.ok(!rendu.includes("✓") && !rendu.includes("✕"), "aucun verdict à l'écran");
    assert.ok(!/>\+10</.test(rendu), "aucun « +10 » de répétitions");
    assert.ok(!html.includes("text-emerald-600"), "aucun vert : une baisse n'est pas une réussite");
    assert.ok(!html.includes("text-red-600"), "aucun rouge non plus : c'est un fait, pas un échec");
  });

  await test("4. les RÉPÉTITIONS ne se comparent QU'À CHARGE ÉGALE", () => {
    const contexte = comparaison({ chargeKg: 45, reps: 13 });
    // Le faux négatif exact que la règle interdit : 47 kg × 10 après 45 kg × 13.
    const montee = comparerALaReference(contexte, { chargeSaisie: "47 kg", repsSaisies: "10" });
    assert.ok(montee);
    assert.equal(montee.ecartReps, null, "−3 aurait été un mensonge : l'élève a progressé");
    const egale = comparerALaReference(contexte, { chargeSaisie: "45 kg", repsSaisies: "16" });
    assert.ok(egale);
    assert.equal(egale.sens, "identique");
    assert.equal(egale.ecartReps, 3, "à charge égale, l'écart est rendu tel quel, sans plafond");
    const html = rendreCarte({ repsSaisies: ["10"], chargesSaisies: ["47 kg"], comparaison: contexte });
    assert.ok(!/>-3</.test(texteRendu(html)), "aucun −3 à l'écran quand la charge a monté");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * CAS LIMITES
   * ══════════════════════════════════════════════════════════════════════ */

  await test("5. charge NON SAISIE : aucune comparaison — inconnue n'est pas égale", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    assert.equal(comparerALaReference(contexte, { chargeSaisie: "", repsSaisies: "14" }), null);
    assert.equal(comparerALaReference(contexte, { chargeSaisie: "   ", repsSaisies: "14" }), null);
    assert.equal(comparerALaReference(contexte, { chargeSaisie: "au max", repsSaisies: "14" }), null);
    assert.equal(comparerALaReference(contexte, { chargeSaisie: "0 kg", repsSaisies: "14" }), null);
    assert.equal(comparerALaReference(contexte, { chargeSaisie: "50 kg", repsSaisies: "" }), null);
    assert.equal(comparerALaReference(contexte, { chargeSaisie: "50 kg", repsSaisies: "AMRAP" }), null);
    // Et sans référence du tout (semaine 1) : rien à comparer.
    assert.equal(
      comparerALaReference(comparaison({ sansReference: true }), { chargeSaisie: "50 kg", repsSaisies: "10" }),
      null,
    );
    const html = rendreCarte({ repsSaisies: ["14"], chargesSaisies: [""], comparaison: contexte });
    assert.ok(!/>[+-]\d/.test(texteRendu(html)), "aucun badge d'écart sans charge saisie");
  });

  await test("6. écart de répétitions NUL : aucun badge — règle du lot B préservée", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    const lue = comparerALaReference(contexte, { chargeSaisie: "50 kg", repsSaisies: "10" });
    assert.ok(lue);
    assert.equal(lue.sens, "identique");
    assert.equal(lue.ecartChargeKg, 0);
    assert.equal(lue.ecartReps, null, "« 0 » n'apprend rien");
    const html = rendreCarte({ repsSaisies: ["10"], chargesSaisies: ["50 kg"], comparaison: contexte });
    const rendu = texteRendu(html);
    assert.ok(!/>[+-]?0[^\d]/.test(rendu), "aucun badge « 0 » de répétitions");
    // Attention : « 50 kg » contient « 0 kg ». La garde porte donc sur un
    // badge d'écart SIGNÉ valant zéro, pas sur la sous-chaîne.
    assert.ok(!/[+-]0(?:,0)? kg/.test(rendu), "aucun écart de charge nul affiché");
    assert.ok(!rendu.includes("✓") && !rendu.includes("✕"), "aucun verdict à charge égale");
  });

  await test("7. la flèche ↑/↓ est portée par la série SUIVANTE, jamais par celle qui la produit", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    // Série 1 à 14 répétitions (borne haute dépassée) → la série 2 porte ↑.
    const html = rendreCarte({
      repsSaisies: ["14", "", ""],
      chargesSaisies: ["50 kg", "", ""],
      comparaison: contexte,
    });
    assert.ok(html.includes("↑"), "une flèche montante est rendue");
    assert.ok(
      html.includes(libelleConseilSerieSuivante("monter", 2)),
      "et elle est portée par la SÉRIE 2, pas par la série 1",
    );
    assert.ok(!html.includes(libelleConseilSerieSuivante("monter", 1)), "la série 1 ne porte aucun conseil");
    // Sous la borne basse : la série suivante porte ↓.
    const basse = rendreCarte({
      repsSaisies: ["5", "", ""],
      chargesSaisies: ["50 kg", "", ""],
      comparaison: contexte,
    });
    assert.ok(basse.includes("↓"));
    assert.ok(basse.includes(libelleConseilSerieSuivante("baisser", 2)));
  });

  await test("8. la SÉRIE 1 ne porte jamais de conseil — il n'y a rien avant elle", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    const html = rendreCarte({
      repsSaisies: ["", "", ""],
      chargesSaisies: ["", "", ""],
      comparaison: contexte,
    });
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche sans aucune saisie");
    // Même avec une saisie sur la SEULE série, aucune flèche : personne ne suit.
    const seule = rendreCarte({ repsSaisies: ["20"], chargesSaisies: ["50 kg"], comparaison: contexte });
    assert.ok(!seule.includes("↑") && !seule.includes("↓"), "une série unique ne conseille personne");
  });

  await test("9. le conseil applique la FOURCHETTE PRESCRITE, sans le moteur de surcharge", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    // Règle posée : au-dessus de la fourchette → monter ; en dessous →
    // baisser ; DANS la fourchette, bornes comprises → rien.
    assert.equal(conseilSerieSuivante(contexte, "14"), "monter");
    assert.equal(conseilSerieSuivante(contexte, "13"), null, "13 est la borne haute, pas un débordement");
    assert.equal(conseilSerieSuivante(contexte, "12"), null);
    assert.equal(conseilSerieSuivante(contexte, "8"), null, "la borne basse atteinte n'est pas un échec");
    assert.equal(conseilSerieSuivante(contexte, "7"), "baisser");
    assert.equal(conseilSerieSuivante(contexte, ""), null);
    assert.equal(conseilSerieSuivante(contexte, "AMRAP"), null);
    assert.equal(conseilSerieSuivante(contexte, "-3"), null);
    // Une autre fourchette déplace les deux seuils, sans rien coder en dur.
    const large = comparaison({ chargeKg: 50, reps: 10, repsPrescrites: "5-20" });
    assert.equal(conseilSerieSuivante(large, "14"), null, "14 est dans 5-20");
    assert.equal(conseilSerieSuivante(large, "21"), "monter");
    assert.equal(conseilSerieSuivante(large, "4"), "baisser");
    /* ⚠️ DIVERGENCE ASSUMÉE AVEC LE MOTEUR, ET C'EST LE TEST QUI LA FIXE.
       Le moteur monte la charge dès la borne haute ATTEINTE ; le conseil
       immédiat n'apparaît qu'AU-DESSUS de la fourchette. Les deux niveaux
       répondent à deux questions différentes. Si un jour on voulait les
       aligner, ce test échouerait — c'est exactement son rôle. */
    const moteur = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: PLAGE,
      reference: { chargeKg: 100, reps: 13 },
    });
    assert.ok(moteur.ok && moteur.recommandation.chargeModifiee, "le moteur, lui, monte déjà à 13");
    assert.equal(conseilSerieSuivante(contexte, "13"), null, "le conseil immédiat, non");
    // Et la preuve d'indépendance : ce module n'interroge le moteur que dans
    // `indicateursDExercice`, jamais depuis la comparaison immédiate.
    const code = sansCommentaires(sourceIndicateurs);
    const niveau1 = code.slice(code.indexOf("export type SensEcartCharge"), code.indexOf("export type SensCharge"));
    assert.ok(niveau1.length > 500, "le niveau 1 a bien été isolé");
    assert.ok(!niveau1.includes("recommanderProchaineCible"), "le niveau 1 n'appelle aucun moteur de surcharge");
    assert.ok(!niveau1.includes("progressionActive"), "le niveau 1 ne lit aucun réglage");
    assert.ok(!/groupe|MuscleGroup/.test(niveau1), "le niveau 1 ne connaît aucun groupe musculaire");
  });

  await test("10. INDÉPENDANCE DU ON/OFF — la comparaison s'affiche progression désactivée", () => {
    // Progression désactivée : aucune recommandation…
    const off = indicateursDExercice({
      progressionActive: false,
      groupe: "pectoraux",
      repsPrescrites: "8-13",
      reference: { chargeKg: 45, reps: 13 },
    });
    assert.equal(off.ok, false);
    assert.equal(off.ok === false && off.motif, "progression-desactivee");
    // … mais le contexte de comparaison existe quand même.
    const contexte = comparaison({ chargeKg: 45, reps: 13 });
    const html = rendreCarte({
      repsSaisies: ["10", "14", ""],
      chargesSaisies: ["47 kg", "45 kg", ""],
      indicateurs: null,
      comparaison: contexte,
    });
    const rendu = texteRendu(html);
    assert.ok(rendu.includes("+2 kg ✓"), "l'écart de charge et son verdict s'affichent sans la progression");
    assert.ok(rendu.includes("+1"), "l'écart de répétitions à charge égale aussi (14 − 13)");
    assert.ok(rendu.includes("↑"), "et le conseil de série suivante aussi");
    // La table de comparaison de la section ne consulte JAMAIS le réglage.
    const code = sansCommentaires(sourceSection);
    const bloc = code.slice(code.indexOf("comparaisonsParExercice"));
    const corps = bloc.slice(0, bloc.indexOf("}, ["));
    assert.ok(!corps.includes("progressionActivePourExercice"), "la comparaison ignore le réglage ON/OFF");
  });

  await test("11. EXERCICE SANS TARIF DE PROGRESSION : tous les indicateurs immédiats restent là", () => {
    /* Règle posée : les indicateurs immédiats ne dépendent PAS du fait que
       l'exercice possède un tarif de progression automatique. Cardio et
       full-body sont refusés par le moteur (`groupe-non-tarife`) — c'est
       correct pour la RECOMMANDATION, et ce refus ne doit RIEN retirer à la
       comparaison. Une version antérieure faisait le contraire : c'est
       précisément ce que ce test verrouille. */
    for (const groupe of ["cardio", "full-body"] as MuscleGroup[]) {
      // Le moteur refuse, sans ambiguïté.
      const moteur = indicateursDExercice({
        progressionActive: true,
        groupe,
        repsPrescrites: "8-13",
        reference: { chargeKg: 45, reps: 13 },
      });
      assert.equal(moteur.ok === false && moteur.motif, "groupe-non-tarife", `${groupe} : refusé par le moteur`);
      // La comparaison immédiate, elle, est complète.
      const contexte = comparaison({ chargeKg: 45, reps: 13 });
      const tenue = comparerALaReference(contexte, { chargeSaisie: "47 kg", repsSaisies: "10" });
      assert.ok(tenue);
      assert.equal(tenue.ecartChargeKg, 2, `${groupe} : écart factuel`);
      assert.equal(tenue.tenue, "tenue", `${groupe} : le ✓ est bien rendu`);
      assert.equal(texteEcartCharge(tenue, "totale"), "+2 kg ✓");
      const ratee = comparerALaReference(contexte, { chargeSaisie: "47 kg", repsSaisies: "6" });
      assert.ok(ratee);
      assert.equal(ratee.tenue, "insuffisante", `${groupe} : le ✕ aussi`);
      assert.equal(conseilSerieSuivante(contexte, "14"), "monter", `${groupe} : la flèche aussi`);
      assert.equal(conseilSerieSuivante(contexte, "7"), "baisser", `${groupe} : dans les deux sens`);
      // Et à l'écran, de bout en bout : série 1 à 14 reps, série 2 porte ↑.
      const html = rendreCarte({
        repsSaisies: ["14", "10", ""],
        chargesSaisies: ["45 kg", "47 kg", ""],
        indicateurs: null, // le moteur a refusé : aucune recommandation
        comparaison: contexte,
      });
      const rendu = texteRendu(html);
      assert.ok(rendu.includes("+1"), `${groupe} : l'écart de reps à charge égale (14 − 13)`);
      assert.ok(rendu.includes("+2 kg ✓"), `${groupe} : l'écart de charge et son verdict`);
      assert.ok(html.includes("↑"), `${groupe} : la flèche de conseil est rendue`);
      assert.ok(html.includes(libelleConseilSerieSuivante("monter", 2)), `${groupe} : portée par la série 2`);
      assert.ok(!html.includes("Reco "), `${groupe} : et aucune recommandation inventée`);
    }
    // Aucun nom de groupe dans le niveau 1 : il ne peut pas les distinguer.
    assert.ok(!/cardio|full-body/.test(sansCommentaires(sourceIndicateurs)), "aucun nom de groupe en dur");
  });

  await test("12. HALTÈRES : l'écart s'affiche PAR HALTÈRE, jamais en charge totale", () => {
    // Référence 24 kg / haltère = 48 kg effectifs ; saisie 25 kg / haltère = 50.
    const contexte = comparaison({ chargeKg: 48, reps: 13, unite: "par-haltere" });
    assert.equal(contexte.unite, "par-haltere");
    const lue = comparerALaReference(contexte, { chargeSaisie: "25 kg / haltère", repsSaisies: "10" });
    assert.ok(lue);
    assert.equal(lue.ecartChargeKg, 2, "les calculs INTERNES restent en charge effective");
    assert.equal(formaterEcartChargeKg(lue.ecartChargeKg, contexte.unite), "+1 kg / haltère", "l'affichage, lui, non");
    assert.equal(texteEcartCharge(lue, contexte.unite), "+1 kg / haltère ✓");
    assert.ok(libelleEcartCharge(lue, contexte.unite, 1).includes("1 kg / haltère"));
    const html = rendreCarte({
      repsSaisies: ["10"],
      chargesSaisies: ["25 kg / haltère"],
      comparaison: contexte,
    });
    const rendu = texteRendu(html);
    assert.ok(rendu.includes("+1 kg / haltère"), "l'écart est rendu par haltère");
    assert.ok(!/\+2 kg(?! \/)/.test(rendu), "jamais l'écart de la paire");
  });

  await test("13. plage prescrite inexploitable : aucun contexte, carte inchangée", () => {
    for (const reps of ["", "AMRAP", "6-10, 8-13", "11-10-9", "13-8"]) {
      assert.equal(
        contexteDeComparaison({ repsPrescrites: reps, reference: { chargeKg: 50, reps: 10 } }),
        null,
        `« ${reps} » ne produit aucun contexte`,
      );
    }
    const html = rendreCarte({
      repsSaisies: ["20", "20", "20"],
      chargesSaisies: ["60 kg", "60 kg", "60 kg"],
      comparaison: null,
    });
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche");
    assert.ok(!texteRendu(html).includes("kg ✓"), "aucun verdict");
    assert.ok(!html.includes("text-emerald-600") && !html.includes("text-red-600"), "aucun badge coloré");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * PRIORITÉ DE LA RECOMMANDATION DANS LES CHAMPS
   * ══════════════════════════════════════════════════════════════════════ */

  await test("14. PROGRESSION ACTIVE — la recommandation passe devant la prescription du coach", () => {
    // Le cas réel : référence 47 kg × 10, plage 8-13 → cible 47 kg × 11, alors
    // que le coach a écrit « RIR 1 » et « 8-13 » — deux textes qui gagnaient
    // toujours et empêchaient la cible d'atteindre l'écran.
    const ind = indicateurs({ chargeKg: 47, reps: 10 });
    assert.ok(ind);
    assert.equal(ind.recommandation.chargeKg, 47);
    assert.equal(ind.recommandation.reps, 11);
    const html = rendreCarte({
      indicateurs: ind,
      comparaison: comparaison({ chargeKg: 47, reps: 10 }),
      prescriptionCharge: "RIR 1",
      prescriptionReps: "8-13",
    });
    assert.ok(html.includes('placeholder="Reco 47 kg"'), "la charge calculée est dans le champ");
    assert.ok(html.includes('placeholder="Reco 11 reps"'), "les répétitions calculées aussi");
    assert.ok(!html.includes('placeholder="Charge (RIR 1)"'), "« RIR 1 » ne gagne plus");
    assert.ok(!html.includes('placeholder="Reps (8-13)"'), "« 8-13 » ne gagne plus");
    // La prescription reste visible dans le résumé de l'en-tête : elle n'est
    // pas effacée, elle est dépriorisée DANS LE CHAMP.
    assert.ok(texteRendu(html).includes("charge conseillée RIR 1"), "la prescription reste affichée en en-tête");
  });

  await test("15. PROGRESSION DÉSACTIVÉE — la prescription du coach est intacte au caractère près", () => {
    const html = rendreCarte({
      indicateurs: null,
      comparaison: comparaison({ chargeKg: 47, reps: 10 }),
      prescriptionCharge: "RIR 1",
      prescriptionReps: "8-13",
    });
    assert.ok(html.includes('placeholder="Charge (RIR 1)"'), "la prescription du coach est le placeholder");
    assert.ok(html.includes('placeholder="Reps (8-13)"'));
    assert.ok(!html.includes("Reco "), "aucune recommandation nulle part");
    // Et aucune valeur calculée n'entre dans l'état : ni value, ni payload.
    const code = sansCommentaires(sourceCarte);
    assert.ok(!/value=\{[^}]*(indicateurs|comparee|conseil|reco)/i.test(code), "rien de calculé dans value=");
    assert.ok(!/onSetChange\([^)]*(indicateurs|comparee|conseil)/i.test(code), "rien de calculé dans l'état");
    assert.ok(code.includes("value={set.loadUsed}") && code.includes("value={set.repsDone}"), "la saisie reste la saisie");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * NON-RÉGRESSION — CE QUI NE DOIT PAS BOUGER
   * ══════════════════════════════════════════════════════════════════════ */

  await test("16. le GRAPHIQUE et la STAGNATION n'ont pas été touchés", () => {
    // La courbe du profil élève lit toujours `referenceDeProgression`, qui
    // REFUSE une séance à charge non constante — c'est correct pour tracer un
    // point, et ce n'est pas la règle de surcharge.
    assert.ok(sourcePerformanceExercice.includes("referenceDeProgression"), "la courbe garde sa référence");
    assert.ok(
      !sourcePerformanceExercice.includes("referenceDeSurcharge"),
      "la courbe n'emprunte PAS la référence de surcharge",
    );
    const variable = [
      { loadUsed: "45 kg", repsDone: "13" },
      { loadUsed: "45 kg", repsDone: "14" },
      { loadUsed: "47 kg", repsDone: "10" },
    ];
    const pourLaCourbe = referenceDeProgression(variable);
    assert.equal(pourLaCourbe.ok, false);
    assert.equal(pourLaCourbe.ok === false && pourLaCourbe.motif, "charge-non-constante", "le refus est préservé");
    // La section « Performances » du coach ne connaît ni la comparaison
    // immédiate ni le conseil de série.
    const codePerf = sansCommentaires(sourceSectionPerformances);
    assert.ok(!/comparerALaReference|conseilSerieSuivante|contexteDeComparaison/.test(codePerf));
    assert.ok(codePerf.includes("stagnationEnCours("), "la stagnation reste calculée à la lecture");
  });

  await test("17. RÉGRESSION — surcharge, charge constante et sauvegarde groupée du lot 1", () => {
    // `referenceDeSurcharge` : charge la plus lourde + moyenne des reps à
    // cette charge. L'exemple de référence du chantier.
    const surcharge = referenceDeSurcharge([
      { loadUsed: "45 kg", repsDone: "13" },
      { loadUsed: "45 kg", repsDone: "14" },
      { loadUsed: "47 kg", repsDone: "10" },
    ]);
    assert.ok(surcharge.ok);
    assert.equal(surcharge.reference.chargeKg, 47);
    assert.equal(surcharge.reference.reps, 10);
    const cible = recommanderProchaineCible({
      progressionActive: true,
      groupe: "pectoraux",
      plage: PLAGE,
      reference: surcharge.reference,
    });
    assert.ok(cible.ok);
    assert.equal(cible.recommandation.chargeKg, 47, "47 kg × 11 — l'exemple de référence");
    assert.equal(cible.recommandation.reps, 11);
    // À CHARGE CONSTANTE, les deux références coïncident : la nouvelle règle
    // généralise l'ancienne, elle ne la contredit pas.
    const constante = [
      { loadUsed: "50 kg", repsDone: "12" },
      { loadUsed: "50 kg", repsDone: "10" },
      { loadUsed: "50 kg", repsDone: "8" },
    ];
    assert.deepEqual(referenceDeSurcharge(constante), referenceDeProgression(constante));
    // Lot 1 — la sauvegarde groupée est intacte : un tampon, un envoi par lot,
    // et un conflit visé sur la clé primaire (jamais un index partiel).
    const codeToggle = sansCommentaires(sourceToggle);
    assert.ok(codeToggle.includes("lotsDEcriture("), "les bascules partent toujours en lot");
    // ⚠️ MISE À JOUR DU 23/09/2026 : le regroupement n'est plus temporisé, il
    // est déclenché par « Enregistrer ». L'invariant qui compte pour ce
    // harnais reste le même — les bascules partent en LOT, jamais une par une.
    assert.ok(!/void ecrire\(\{/.test(codeToggle), "aucun retour à une écriture par bascule");
    assert.ok(codeToggle.includes("enregistrerRef.current = enregistrerLesReglages"), "persistance à l'enregistrement");
  });
  /* ══════════════════════════════════════════════════════════════════════
   * LA FLÈCHE EST ATTACHÉE À LA CELLULE CHARGE DE LA SÉRIE SUIVANTE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("18. la flèche vit DANS la cellule CHARGE, jamais dans la cellule RÉPÉTITIONS", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    // Série 1 à 14 reps (au-dessus de 8-13) → la série 2 doit porter ↑ sur sa
    // cellule CHARGE. Aucune prescription ni recommandation : les placeholders
    // valent « Charge » et « Reps (8-13) », ce qui rend les deux cellules
    // repérables dans le HTML.
    const html = rendreCarte({
      repsSaisies: ["14", "", ""],
      chargesSaisies: ["50 kg", "", ""],
      comparaison: contexte,
      prescriptionReps: "8-13",
    });
    const blocs = html.split(">Série ");
    assert.equal(blocs.length, 4, "trois blocs de série, plus l'en-tête");
    const serie2 = blocs[2];
    const posFleche = serie2.indexOf("↑");
    const posCharge = serie2.indexOf('placeholder="Charge"');
    const posReps = serie2.indexOf('placeholder="Reps (8-13)"');
    assert.ok(posFleche >= 0, "la série 2 porte bien la flèche");
    assert.ok(posCharge >= 0 && posReps > posCharge, "les deux champs sont repérés, dans l'ordre");
    assert.ok(posFleche < posCharge, "la flèche précède le champ CHARGE : elle est dans sa cellule");
    const celluleReps = serie2.slice(posCharge, posReps + 1);
    assert.ok(!celluleReps.includes("↑") && !celluleReps.includes("↓"), "aucune flèche dans la cellule RÉPÉTITIONS");
    // Et la flèche n'est PAS un placeholder : c'est un élément à part, qui ne
    // disparaît donc pas dès que l'élève saisit sa charge.
    assert.ok(!/placeholder="[^"]*[↑↓]/.test(html), "la flèche n'est jamais dans un placeholder");
    const avecSaisie = rendreCarte({
      repsSaisies: ["14", "9", ""],
      chargesSaisies: ["50 kg", "52 kg", ""],
      comparaison: contexte,
    });
    assert.ok(avecSaisie.includes("↑"), "la flèche reste visible alors que la série 2 est remplie");
    // Garde structurelle : dans le code, le conseil est rendu à l'intérieur de
    // l'enveloppe de la cellule CHARGE, avant son `input`, et nulle part entre
    // le champ charge et le champ répétitions.
    const code = sansCommentaires(sourceCarte);
    const posConseil = code.indexOf("{conseil && (");
    const posInputCharge = code.indexOf("value={set.loadUsed}");
    const posInputReps = code.indexOf("value={set.repsDone}");
    const posEnveloppe = code.indexOf('className="relative min-w-0"');
    assert.ok(posEnveloppe >= 0 && posConseil > posEnveloppe, "le conseil est dans une enveloppe positionnée");
    assert.ok(posConseil < posInputCharge, "le conseil est rendu dans la cellule CHARGE");
    const entreLesDeux = code.slice(posInputCharge, posInputReps);
    assert.ok(!entreLesDeux.includes("conseil"), "aucun conseil entre le champ charge et le champ répétitions");
    assert.ok(/absolute\s+-right-1\s+-top-1\.5/.test(code), "la flèche a son propre coin, distinct de l'écart");
  });

  await test("19. RÈGLE EXPLICITE — 14 reps ⇒ ↑ sur la série suivante, 7 reps ⇒ ↓", () => {
    const contexte = comparaison({ chargeKg: 50, reps: 10 });
    const html = rendreCarte({
      repsSaisies: ["14", "7", "10"],
      chargesSaisies: ["50 kg", "50 kg", "50 kg"],
      comparaison: contexte,
      prescriptionReps: "8-13",
    });
    const blocs = html.split(">Série ");
    // Série 1 : rien avant elle.
    assert.ok(!blocs[1].includes("↑") && !blocs[1].includes("↓"), "série 1 : aucune flèche");
    // Série 2 : ↑, parce que la série 1 a fait 14.
    assert.ok(blocs[2].includes("↑"), "série 2 : ↑ après 14 répétitions");
    assert.ok(!blocs[2].includes("↓"), "série 2 : et seulement ↑");
    assert.ok(blocs[2].includes(libelleConseilSerieSuivante("monter", 2)));
    // Série 3 : ↓, parce que la série 2 a fait 7.
    assert.ok(blocs[3].includes("↓"), "série 3 : ↓ après 7 répétitions");
    assert.ok(!blocs[3].includes("↑"), "série 3 : et seulement ↓");
    assert.ok(blocs[3].includes(libelleConseilSerieSuivante("baisser", 3)));
    // Chaque flèche est dans la cellule CHARGE de SA série.
    for (const [bloc, glyphe] of [
      [blocs[2], "↑"],
      [blocs[3], "↓"],
    ] as const) {
      const posFleche = bloc.indexOf(glyphe);
      const posCharge = bloc.indexOf('placeholder="Charge"');
      assert.ok(posCharge >= 0, "le champ charge est repéré");
      assert.ok(posFleche < posCharge, `${glyphe} précède le champ charge de sa propre série`);
    }
  });

  await test("20. AUCUNE CONDITION côté séance : ni réglage, ni groupe, ni moteur", () => {
    const code = sansCommentaires(sourceSection);
    const bloc = code.slice(code.indexOf("comparaisonsParExercice"));
    const corps = bloc.slice(0, bloc.indexOf("}, ["));
    const deps = bloc.slice(bloc.indexOf("}, ["), bloc.indexOf("]);") + 3);
    assert.ok(!corps.includes("progressionActivePourExercice"), "la comparaison ignore le réglage ON/OFF");
    assert.ok(!corps.includes("resolveExerciseMuscleGroup"), "la comparaison ignore le groupe musculaire");
    assert.ok(!corps.includes("recommanderProchaineCible"), "la comparaison n'appelle aucun moteur");
    assert.ok(!deps.includes("progressionActivePourExercice"), "le réglage n'est même pas une dépendance");
    assert.ok(!deps.includes("sessionMuscleGroup"), "le groupe n'est même pas une dépendance");
    assert.ok(corps.includes("referenceDeLOccurrencePrecedente("), "la référence reste l'occurrence N-1");
    // La recommandation, elle, garde ses deux conditions : c'est la table
    // voisine, et elle ne doit surtout pas les perdre.
    const blocReco = code.slice(code.indexOf("indicateursParExercice"));
    const corpsReco = blocReco.slice(0, blocReco.indexOf("}, ["));
    assert.ok(corpsReco.includes("progressionActivePourExercice"), "la recommandation obéit toujours au ON/OFF");
    assert.ok(corpsReco.includes("resolveExerciseMuscleGroup"), "et toujours au groupe musculaire");
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
