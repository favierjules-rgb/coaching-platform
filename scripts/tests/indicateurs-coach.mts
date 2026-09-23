/**
 * Harnais — LES INDICATEURS IMMÉDIATS CÔTÉ COACH.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE HARNAIS DÉFEND
 * ════════════════════════════════════════════════════════════════════════
 * Le coach qui relit un retour soumis doit voir, sans calculer de tête, si
 * l'élève a monté la charge et s'il l'a tenue. Trois indicateurs de CONSTAT :
 * écart de charge factuel, verdict ✓/✕ à la hausse, écart de répétitions à
 * charge égale.
 *
 * ⚠️ MÊME RÈGLE ET MÊME RÉFÉRENCE QUE CÔTÉ ÉLÈVE. Le test de cohérence (13)
 * compare les deux écrans sur la même situation : s'ils divergeaient un jour,
 * le coach et l'élève liraient deux vérités différentes de la même séance.
 *
 * ⚠️ LA FLÈCHE DE CONSEIL N'EST PAS REPRISE, ET C'EST TESTÉ. ↑/↓ dit « change
 * la charge à la série suivante » : sur une séance terminée, elle a déjà eu
 * lieu.
 *
 * Lancement : npx tsx scripts/tests/indicateurs-coach.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { FeedbackDetailModal } from "../../components/admin/FeedbackDetailModal";
import { cleDeSerie, comparaisonsDuRetour } from "../../lib/comparaison-retour-coach";
import { comparerALaReference, contexteDeComparaison } from "../../lib/indicateurs-progression";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import type { AdminStudent, AdminStudentFeedback } from "../../types";

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

interface Serie {
  readonly charge: string;
  readonly reps: string;
}

/**
 * Un retour d'entraînement, avec sa PHOTOGRAPHIE DU PRESCRIT — c'est elle qui
 * porte l'occurrence (semaine, jour) et la fourchette de répétitions en
 * vigueur ce jour-là.
 */
function retour(options: {
  id: string;
  weekNumber: number;
  day: string;
  date: string;
  series: readonly Serie[];
  repsPrescrites?: string;
  nom?: string;
  libraryId?: string | null;
}): AdminStudentFeedback {
  const nom = options.nom ?? EXERCICE;
  return {
    id: options.id,
    studentId: ELEVE,
    type: "entrainement",
    sessionId: `session-${options.id}`,
    programId: null,
    refLabel: `Séance ${options.id}`,
    date: options.date,
    completed: true,
    rpe: null,
    pain: "",
    comment: "",
    exerciseEntries: options.series.map((serie, index) => ({
      exerciseName: nom,
      setNumber: index + 1,
      loadUsed: serie.charge,
      repsDone: serie.reps,
      rpe: null,
      exerciseRpe: null,
      comment: "",
    })),
    status: "a-traiter",
    coachReply: "",
    createdAt: `${options.date}T10:00:00Z`,
    updatedAt: `${options.date}T10:00:00Z`,
    performedAt: options.date,
    prescribedSnapshot: {
      version: PRESCRIBED_SNAPSHOT_VERSION,
      sessionId: `session-${options.id}`,
      sessionName: `Séance ${options.id}`,
      day: options.day,
      weekNumber: options.weekNumber,
      capturedAt: `${options.date}T10:00:00Z`,
      blocks: [
        {
          title: null,
          category: "strength",
          position: 0,
          exercises: [
            {
              exerciseLibraryId: options.libraryId ?? null,
              name: nom,
              order: 0,
              sets: null,
              reps: options.repsPrescrites ?? "8-13",
              recommendedLoad: null,
              restSeconds: null,
              tempo: null,
              notes: null,
            },
          ],
        },
      ],
    },
  } as AdminStudentFeedback;
}

const ELEVE_FICHE = { id: ELEVE, firstName: "Jules", lastName: "Favier" } as AdminStudent;

/** La modale rendue OUVERTE (couture de test : `renderToString` ne clique pas). */
function rendreModale(options: {
  relu: AdminStudentFeedback;
  historique?: readonly AdminStudentFeedback[];
  sansHistorique?: boolean;
}): string {
  return renderToString(
    createElement(FeedbackDetailModal, {
      feedback: options.relu,
      student: ELEVE_FICHE,
      onReply: () => {},
      ouvertInitialement: true,
      ...(options.sansHistorique ? {} : { historique: options.historique ?? [options.relu] }),
    }),
  );
}

/**
 * La situation de référence : semaine 1 lundi à 45 kg × 13, puis semaine 2
 * lundi à 47 kg × 10. L'élève a monté de 2 kg et tenu la fourchette 8-13.
 */
function situation(options: {
  serieSemaine2: readonly Serie[];
  serieSemaine1?: readonly Serie[];
  repsPrescrites?: string;
  jourSemaine1?: string;
}) {
  const s1 = retour({
    id: "s1",
    weekNumber: 1,
    day: options.jourSemaine1 ?? "Lundi",
    date: "2026-08-24",
    series: options.serieSemaine1 ?? [{ charge: "45 kg", reps: "13" }],
    ...(options.repsPrescrites ? { repsPrescrites: options.repsPrescrites } : {}),
  });
  const s2 = retour({
    id: "s2",
    weekNumber: 2,
    day: "Lundi",
    date: "2026-08-31",
    series: options.serieSemaine2,
    ...(options.repsPrescrites ? { repsPrescrites: options.repsPrescrites } : {}),
  });
  return { s1, s2, historique: [s1, s2] as const };
}

await (async () => {
  await test("1. CAS NOMINAL — 47 kg × 10 après 45 kg × 13 : « +2 kg ✓ » sous les yeux du coach", () => {
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    const table = comparaisonsDuRetour({ retour: s2, historique });
    const lue = table.get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue, "la série 1 est comparée");
    assert.equal(lue.comparaison.sens, "hausse");
    assert.equal(lue.comparaison.ecartChargeKg, 2);
    assert.equal(lue.comparaison.tenue, "tenue", "10 est dans 8-13");
    assert.equal(lue.comparaison.ecartReps, null, "aucun ±N reps : la charge a bougé");
    const html = texteRendu(rendreModale({ relu: s2, historique }));
    assert.ok(html.includes("+2 kg ✓"), "le badge est rendu dans la modale");
    assert.ok(html.includes("47 kg · 10 reps"), "et la ligne d'origine est intacte");
    assert.ok(html.includes("charge tenue"), "le libellé accessible dit le verdict");
  });

  await test("2. ✕ quand la charge monte mais que les répétitions tombent sous la borne basse", () => {
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "6" }] });
    const lue = comparaisonsDuRetour({ retour: s2, historique }).get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue);
    assert.equal(lue.comparaison.tenue, "insuffisante");
    const html = texteRendu(rendreModale({ relu: s2, historique }));
    assert.ok(html.includes("+2 kg ✕"));
    assert.ok(html.includes("sous la borne basse prescrite"), "et le libellé le dit sans couleur");
  });

  await test("3. À CHARGE ÉGALE — l'écart de répétitions, et lui seul", () => {
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "45 kg", reps: "16" }] });
    const lue = comparaisonsDuRetour({ retour: s2, historique }).get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue);
    assert.equal(lue.comparaison.sens, "identique");
    assert.equal(lue.comparaison.ecartReps, 3, "16 − 13, sans plafond");
    assert.equal(lue.comparaison.tenue, null, "aucun ✓/✕ à charge égale");
    const html = texteRendu(rendreModale({ relu: s2, historique }));
    assert.ok(html.includes("+3 reps"), "l'écart de répétitions est rendu");
    assert.ok(!html.includes("✓") && !html.includes("✕"), "et aucun verdict");
    assert.ok(!/[+-]0 kg/.test(html), "aucun écart de charge nul affiché");
  });

  await test("4. CHARGE EN BAISSE — l'écart factuel seul, aucune conclusion", () => {
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "40 kg", reps: "20" }] });
    const lue = comparaisonsDuRetour({ retour: s2, historique }).get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue);
    assert.equal(lue.comparaison.sens, "baisse");
    assert.equal(lue.comparaison.tenue, null);
    assert.equal(lue.comparaison.ecartReps, null, "20 reps à 40 kg n'est pas « +7 »");
    const html = texteRendu(rendreModale({ relu: s2, historique }));
    assert.ok(html.includes("-5 kg"), "le fait est dit");
    assert.ok(!html.includes("✓") && !html.includes("✕"), "aucun verdict");
    assert.ok(!html.includes("+7 reps"), "aucune conclusion naïve");
    assert.ok(!html.includes("text-emerald-600"), "ni vert");
    assert.ok(!html.includes("text-red-600"), "ni rouge : une baisse est un fait, pas un échec");
  });

  await test("5. LA FLÈCHE DE CONSEIL N'APPARAÎT JAMAIS côté coach", () => {
    // Série 1 à 14 reps : côté élève, la série 2 porterait ↑. Ici, non :
    // la série suivante a déjà eu lieu.
    const { s2, historique } = situation({
      serieSemaine2: [
        { charge: "45 kg", reps: "14" },
        { charge: "45 kg", reps: "7" },
      ],
    });
    const html = rendreModale({ relu: s2, historique });
    assert.ok(!html.includes("↑") && !html.includes("↓"), "aucune flèche dans la modale du coach");
    // Et le module n'importe même pas de quoi la calculer.
    const code = sansCommentaires(lire("../../lib/comparaison-retour-coach.ts"));
    assert.ok(!code.includes("conseilSerieSuivante"), "le module ne calcule aucun conseil");
    assert.ok(!sansCommentaires(lire("../../components/admin/FeedbackDetailModal.tsx")).includes("conseilSerieSuivante"));
  });

  await test("6. LA PRESCRIPTION VIENT DU SNAPSHOT DU RETOUR, pas du programme d'aujourd'hui", () => {
    // Même saisie, deux fourchettes prescrites : le verdict change. C'est le
    // jeu d'essai qui discrimine — un module qui lirait la prescription
    // ailleurs rendrait le même verdict dans les deux cas.
    const large = situation({ serieSemaine2: [{ charge: "47 kg", reps: "6" }], repsPrescrites: "5-10" });
    const stricte = situation({ serieSemaine2: [{ charge: "47 kg", reps: "6" }], repsPrescrites: "8-13" });
    const verdictLarge = comparaisonsDuRetour({ retour: large.s2, historique: large.historique }).get(
      cleDeSerie(EXERCICE, 1),
    );
    const verdictStrict = comparaisonsDuRetour({ retour: stricte.s2, historique: stricte.historique }).get(
      cleDeSerie(EXERCICE, 1),
    );
    assert.ok(verdictLarge && verdictStrict);
    assert.equal(verdictLarge.comparaison.tenue, "tenue", "6 est dans 5-10 : charge tenue");
    assert.equal(verdictStrict.comparaison.tenue, "insuffisante", "6 est sous 8 : charge non tenue");
    // Et une fourchette illisible ne produit AUCUN badge, jamais un verdict deviné.
    const illisible = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }], repsPrescrites: "AMRAP" });
    assert.equal(
      comparaisonsDuRetour({ retour: illisible.s2, historique: illisible.historique }).size,
      0,
      "fourchette illisible : aucune comparaison",
    );
  });

  await test("7. AUCUN REPLI CHRONOLOGIQUE — l'occurrence N-1 est celle du MÊME jour", () => {
    // La semaine 1 a été faite un MERCREDI : ce n'est pas la référence du
    // lundi de la semaine 2, même si c'est la séance la plus récente.
    const autreJour = situation({
      serieSemaine2: [{ charge: "47 kg", reps: "10" }],
      jourSemaine1: "Mercredi",
    });
    assert.equal(
      comparaisonsDuRetour({ retour: autreJour.s2, historique: autreJour.historique }).size,
      0,
      "aucune comparaison : l'occurrence N-1 du lundi n'existe pas",
    );
    const html = rendreModale({ relu: autreJour.s2, historique: autreJour.historique });
    assert.ok(!texteRendu(html).includes("+2 kg"), "et rien n'est rendu");
    // Le même jour, en revanche, compare.
    const memeJour = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    assert.equal(comparaisonsDuRetour({ retour: memeJour.s2, historique: memeJour.historique }).size, 1);
  });

  await test("8. UN RETOUR NE SE COMPARE JAMAIS À LUI-MÊME", () => {
    // La semaine 1 relue : il n'y a pas de semaine 0, et sa propre séance est
    // exclue de l'index.
    const { s1, historique } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    assert.equal(comparaisonsDuRetour({ retour: s1, historique }).size, 0, "semaine 1 : aucune référence");
    // Et une séance POSTÉRIEURE ne sert jamais de référence à une séance
    // antérieure qu'on relit après coup.
    const s3 = retour({ id: "s3", weekNumber: 3, day: "Lundi", date: "2026-09-07", series: [{ charge: "60 kg", reps: "9" }] });
    assert.equal(
      comparaisonsDuRetour({ retour: s1, historique: [...historique, s3] }).size,
      0,
      "la semaine 3 n'éclaire pas la semaine 1",
    );
  });

  await test("9. SANS HISTORIQUE, la modale est EXACTEMENT celle d'avant", () => {
    const { s2 } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    const sans = texteRendu(rendreModale({ relu: s2, sansHistorique: true }));
    assert.ok(sans.includes("47 kg · 10 reps"), "la ligne d'origine est rendue");
    assert.ok(!sans.includes("✓") && !sans.includes("✕"), "aucun verdict");
    assert.ok(!/[+-]\d+ kg/.test(sans), "aucun écart de charge");
    assert.ok(!/[+-]\d+ reps/.test(sans), "aucun écart de répétitions");
    assert.ok(!sans.includes("text-emerald-600") && !sans.includes("text-red-600"), "aucun badge coloré");
  });

  await test("10. UN EXERCICE SANS TARIF garde ses indicateurs de constat", () => {
    // Le module ne reçoit AUCUN groupe musculaire : il ne peut pas distinguer
    // un exercice tarifé d'un autre. C'est la garantie structurelle du lot 2,
    // vérifiée ici du côté coach.
    const code = sansCommentaires(lire("../../lib/comparaison-retour-coach.ts"));
    /* ⚠️ GARDE ÉCRITE DEUX FOIS. La première version cherchait « cardio » et
       se déclenchait sur l'import `@/lib/cardio-feedback` — un filtre de
       lignes de résultats cardio, qui n'a rien à voir avec un groupe
       musculaire. Une garde qui s'allume sur un import sans rapport ne
       prouve rien. Celle-ci nomme ce qui compte : le module ne lit aucun
       groupe, n'appelle aucun moteur, ne consulte aucun réglage. */
    assert.ok(!/\bMuscleGroup\b/.test(code), "le module ne manipule aucun type de groupe musculaire");
    assert.ok(!/\bgroupe\b/.test(code), "aucune variable de groupe");
    assert.ok(!/INCREMENT_PAR_GROUPE|incrementDeMontee/.test(code), "aucun tarif de progression");
    assert.ok(!code.includes("recommanderProchaineCible"), "aucun moteur de surcharge");
    assert.ok(!code.includes("progressionActive"), "aucun réglage ON/OFF");
    // La seule mention de cardio est le filtre des lignes « Cardio · Résultats ».
    const mentionsCardio = code.match(/cardio/gi) ?? [];
    for (const mention of mentionsCardio) assert.ok(/cardio/i.test(mention));
    assert.ok(code.includes("isCardioResultEntryName"), "et c'est bien ce filtre-là");
    // Et les lignes « Cardio · Résultats » sont écartées : elles ne portent
    // aucune charge à comparer.
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    const avecCardio: AdminStudentFeedback = {
      ...s2,
      exerciseEntries: [
        ...s2.exerciseEntries,
        { exerciseName: "Cardio · Résultats", setNumber: 1, loadUsed: "{}", repsDone: "", rpe: null, exerciseRpe: null, comment: "" },
      ],
    } as AdminStudentFeedback;
    const table = comparaisonsDuRetour({ retour: avecCardio, historique: [historique[0], avecCardio] });
    assert.equal(table.size, 1, "seule la série de musculation est comparée");
  });

  await test("11. HALTÈRES — l'écart s'affiche PAR HALTÈRE, jamais en charge totale", () => {
    const s1 = retour({ id: "s1", weekNumber: 1, day: "Lundi", date: "2026-08-24", series: [{ charge: "24 kg / haltère", reps: "13" }] });
    const s2 = retour({ id: "s2", weekNumber: 2, day: "Lundi", date: "2026-08-31", series: [{ charge: "25 kg / haltère", reps: "10" }] });
    const lue = comparaisonsDuRetour({ retour: s2, historique: [s1, s2] }).get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue);
    assert.equal(lue.unite, "par-haltere");
    assert.equal(lue.comparaison.ecartChargeKg, 2, "les calculs internes restent en charge effective");
    const html = texteRendu(rendreModale({ relu: s2, historique: [s1, s2] }));
    assert.ok(html.includes("+1 kg / haltère ✓"), "l'affichage, lui, reste par haltère");
    assert.ok(!/\+2 kg(?! \/)/.test(html), "jamais l'écart de la paire");
  });

  await test("12. LIBELLÉS ACCESSIBLES — ils disent la valeur, jamais la couleur", () => {
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    const html = rendreModale({ relu: s2, historique });
    const labels = html.match(/aria-label="([^"]*)"/g) ?? [];
    const pertinents = labels.filter((l) => /Série \d+ :/.test(l));
    assert.ok(pertinents.length > 0, "les badges portent un libellé");
    for (const label of pertinents) {
      assert.ok(!/vert|rouge|couleur|badge/i.test(label), `« ${label} » ne parle pas de couleur`);
    }
  });

  await test("13. COHÉRENCE — le coach et l'élève lisent le MÊME verdict", () => {
    // La même situation, jugée par les deux chemins : le coach passe par
    // `comparaisonsDuRetour`, l'élève par `comparerALaReference` dans sa carte.
    // Les deux doivent rendre le même écart et le même verdict, sinon les deux
    // écrans racontent deux histoires de la même séance.
    for (const [charge, reps] of [
      ["47 kg", "10"],
      ["47 kg", "6"],
      ["45 kg", "16"],
      ["40 kg", "20"],
      ["45 kg", "13"],
    ] as const) {
      const { s2, historique } = situation({ serieSemaine2: [{ charge, reps }] });
      const cote = comparaisonsDuRetour({ retour: s2, historique }).get(cleDeSerie(EXERCICE, 1));
      // Le même calcul, demandé directement au module du lot 2.
      const contexte = contexteDeComparaison({
        repsPrescrites: "8-13",
        reference: { chargeKg: 45, reps: 13, unite: "totale" },
      });
      assert.ok(contexte);
      const eleve = comparerALaReference(contexte, { chargeSaisie: charge, repsSaisies: reps });
      if (cote === undefined) {
        assert.equal(eleve, null, `${charge} × ${reps} : les deux chemins refusent ensemble`);
        continue;
      }
      assert.deepEqual(cote.comparaison, eleve, `${charge} × ${reps} : même verdict des deux côtés`);
    }
  });

  await test("15. UN RETOUR SANS OCCURRENCE IDENTIFIABLE ne produit aucune comparaison", () => {
    /* ⚠️ TEST AJOUTÉ APRÈS UN SABOTAGE MAL CONSTRUIT. Mon premier sabotage
       « repli chronologique » remplaçait le refus par une occurrence par
       défaut : il est resté vert, parce qu'aucun test n'exerçait un retour
       SANS occurrence. Le trou était là, pas dans le sabotage. */
    const { s2, historique } = situation({ serieSemaine2: [{ charge: "47 kg", reps: "10" }] });
    for (const snapshot of [
      null,
      { version: PRESCRIBED_SNAPSHOT_VERSION, sessionId: "x", sessionName: "x", day: null, weekNumber: 2, capturedAt: "", blocks: [] },
      { version: PRESCRIBED_SNAPSHOT_VERSION, sessionId: "x", sessionName: "x", day: "Lundi", weekNumber: null, capturedAt: "", blocks: [] },
      { version: PRESCRIBED_SNAPSHOT_VERSION, sessionId: "x", sessionName: "x", day: "   ", weekNumber: 2, capturedAt: "", blocks: [] },
    ]) {
      const sansOccurrence = { ...s2, prescribedSnapshot: snapshot } as AdminStudentFeedback;
      assert.equal(
        comparaisonsDuRetour({ retour: sansOccurrence, historique }).size,
        0,
        `snapshot ${JSON.stringify(snapshot)?.slice(0, 40)} : aucune comparaison`,
      );
    }
    // Une semaine sans jour ne désigne aucune séance, un jour sans semaine ne
    // distingue pas deux mercredis : les deux sont exigés, jamais l'un seul.
    const html = texteRendu(
      rendreModale({ relu: { ...s2, prescribedSnapshot: null } as AdminStudentFeedback, historique }),
    );
    assert.ok(!html.includes("✓") && !/[+-]\d+ kg/.test(html), "et rien n'est rendu");
  });

  await test("14. AUCUNE REQUÊTE — le module est pur", () => {
    const code = lire("../../lib/comparaison-retour-coach.ts");
    assert.ok(!/supabase|createSupabase|fetch\(/i.test(sansCommentaires(code)), "aucun accès réseau");
    /*
     * Et l'écran passe l'historique QU'IL A DÉJÀ, sans le recharger.
     *
     * ⚠️ LA PROPRIÉTÉ N'A PAS CHANGÉ, SEULE SON ÉCRITURE A CHANGÉ. L'écran
     * passait `historique={feedback}` — la liste entière à chacune de ses
     * lignes. Depuis le correctif pré-merge, il passe la tranche de l'élève du
     * retour, regroupée une seule fois pour tout l'écran. L'index construit est
     * le même (`buildPreviousPerformanceIndex` filtrait déjà sur `studentId`),
     * et c'est prouvé par scripts/tests/retours-index-unique.mts, test 6.
     * Ce qui compte ici reste : AUCUNE lecture de plus.
     */
    const page = sansCommentaires(lire("../../app/admin/retours/page.tsx"));
    assert.ok(
      /historique=\{historiqueParEleve\.get\(f\.studentId\)/.test(page),
      "l'historique déjà chargé n'est plus passé à la modale",
    );
    assert.ok(!/\.from\(|getWorkoutFeedbackForStudent/.test(page), "l'écran recharge l'historique au lieu de le réutiliser");
    assert.equal((page.match(/useSupabaseAdminFeedback\(/g) ?? []).length, 1, "une seule lecture, comme avant");
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
