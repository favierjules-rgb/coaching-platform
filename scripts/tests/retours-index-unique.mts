/**
 * Harnais — LES MODALES FERMÉES NE DOIVENT RIEN CALCULER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * `/admin/retours` rend UNE modale par ligne. Chacune construisait son index
 * des performances précédentes AU RENDU, avant et indépendamment du `{open &&
 * …}` : 129 lignes × 129 retours d'historique = 16 641 parcours pour un écran
 * où le coach n'ouvre qu'un seul détail.
 *
 * Ce fichier mesure ce travail au lieu de le supposer. Les retours
 * d'historique portent un ACCESSEUR sur `studentId` — la toute première
 * propriété que lit le filtre de `buildPreviousPerformanceIndex`, et une seule
 * fois par retour et par construction. Le compteur dit donc exactement combien
 * d'index ont été construits, sans remplacer aucun module.
 *
 * ⚠️ ET IL PROUVE AUSSI QUE RIEN N'A CHANGÉ D'AUTRE. Même référence N-1, même
 * photographie du prescrit, mêmes badges, même absence de badge sans
 * historique. Le correctif est architectural : s'il déplaçait la moindre
 * règle, les tests 5 à 9 le diraient.
 *
 * Lancement : npm run test:retours-index
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { FeedbackDetailModal } from "../../components/admin/FeedbackDetailModal";
import { cleDeSerie, comparaisonsDuRetour } from "../../lib/comparaison-retour-coach";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import type { AdminStudent, AdminStudentFeedback } from "../../types";

const ELEVE = "11111111-1111-4111-8111-111111111111";
const AUTRE_ELEVE = "22222222-2222-4222-8222-222222222222";
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

const texteRendu = (html: string) => html.replace(/<!-- -->/g, "");
const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/* ─── Fabriques ─── */

interface Serie {
  readonly charge: string;
  readonly reps: string;
}

function retour(options: {
  id: string;
  weekNumber: number;
  day: string;
  date: string;
  series: readonly Serie[];
  eleve?: string;
  repsPrescrites?: string;
  sansSnapshot?: boolean;
}): AdminStudentFeedback {
  const snapshot = {
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
            exerciseLibraryId: null,
            name: EXERCICE,
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
  };
  return {
    id: options.id,
    studentId: options.eleve ?? ELEVE,
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
      exerciseName: EXERCICE,
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
    prescribedSnapshot: options.sansSnapshot ? null : snapshot,
  } as AdminStudentFeedback;
}

/* ─── LE COMPTEUR — un accesseur, pas un module remplacé ─── */

let parcours = 0;

/**
 * Pose un accesseur sur `studentId`, la première propriété que lit le filtre de
 * `buildPreviousPerformanceIndex`, et exactement une fois par retour et par
 * construction d'index. Un retour ainsi marqué compte les passages sans rien
 * changer à sa valeur.
 */
function compté(f: AdminStudentFeedback): AdminStudentFeedback {
  const valeur = f.studentId;
  Object.defineProperty(f, "studentId", {
    get() {
      parcours += 1;
      return valeur;
    },
    enumerable: true,
    configurable: true,
  });
  return f;
}

const ELEVE_FICHE = { id: ELEVE, firstName: "Jules", lastName: "Favier" } as AdminStudent;

function modale(options: {
  relu: AdminStudentFeedback;
  historique: readonly AdminStudentFeedback[];
  ouverte: boolean;
}) {
  return createElement(FeedbackDetailModal, {
    feedback: options.relu,
    student: ELEVE_FICHE,
    onReply: () => {},
    ouvertInitialement: options.ouverte,
    historique: options.historique,
  });
}

/**
 * Semaine 1 lundi 45 kg × 13, semaine 2 lundi 47 kg × 10 — l'élève a monté de
 * 2 kg et tenu sa fourchette. Le retour RELU n'est pas compté : seuls les
 * retours de RÉFÉRENCE le sont, pour que le compteur dise « nombre de
 * constructions × taille de l'historique » et rien d'autre.
 */
function situation(nbReferences = 1) {
  const references: AdminStudentFeedback[] = [];
  for (let n = 0; n < nbReferences; n += 1) {
    references.push(
      compté(
        retour({
          id: `ref-${n}`,
          weekNumber: 1,
          day: n === 0 ? "Lundi" : "Mardi",
          date: `2026-08-${String(10 + n).padStart(2, "0")}`,
          series: [{ charge: "45 kg", reps: "13" }],
        }),
      ),
    );
  }
  const relu = retour({
    id: "relu",
    weekNumber: 2,
    day: "Lundi",
    date: "2026-08-31",
    series: [{ charge: "47 kg", reps: "10" }],
  });
  return { relu, references, historique: [...references, relu] };
}

await (async () => {
  await test("1. MODALE FERMÉE — aucun parcours de l'historique", () => {
    const { relu, historique } = situation(5);
    parcours = 0;
    renderToString(modale({ relu, historique, ouverte: false }));
    assert.equal(parcours, 0, `${parcours} parcours pour une modale fermée : l'index est calculé pour rien`);
  });

  await test("2. MODALE OUVERTE — exactement UN index, sur l'historique passé", () => {
    const { relu, historique, references } = situation(5);
    parcours = 0;
    renderToString(modale({ relu, historique, ouverte: true }));
    assert.equal(
      parcours,
      references.length,
      `${parcours} parcours au lieu de ${references.length} : l'index est construit plus d'une fois`,
    );
  });

  await test("3. UNE LISTE DE 40 MODALES FERMÉES NE COÛTE RIEN — le O(N²) a disparu", () => {
    const { relu, historique, references } = situation(10);
    parcours = 0;
    renderToString(
      createElement(
        "div",
        null,
        ...Array.from({ length: 40 }, (_, i) =>
          createElement("div", { key: i }, modale({ relu, historique, ouverte: false })),
        ),
      ),
    );
    assert.equal(
      parcours,
      0,
      `${parcours} parcours pour 40 lignes fermées (l'ancien code en faisait ${40 * references.length})`,
    );
  });

  await test("4. UN SEUL DÉTAIL OUVERT — un seul index pour tout l'écran", () => {
    const { relu, historique, references } = situation(10);
    parcours = 0;
    renderToString(
      createElement(
        "div",
        null,
        ...Array.from({ length: 40 }, (_, i) =>
          createElement("div", { key: i }, modale({ relu, historique, ouverte: i === 7 })),
        ),
      ),
    );
    assert.equal(
      parcours,
      references.length,
      `${parcours} parcours : une seule modale est ouverte, un seul index doit être construit`,
    );
  });

  await test("5. RÉSULTAT IDENTIQUE — les badges rendus sont exactement ceux d'avant", () => {
    const { relu, historique } = situation(1);
    const html = texteRendu(renderToString(modale({ relu, historique, ouverte: true })));
    assert.ok(html.includes("+2 kg"), "l'écart de charge a disparu de la modale ouverte");
    assert.ok(html.includes("✓"), "le verdict de tenue a disparu de la modale ouverte");

    // Et la table sous-jacente est celle du module, inchangée.
    const table = comparaisonsDuRetour({ retour: relu, historique });
    const lue = table.get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue, "aucune comparaison pour la série 1");
    assert.equal(lue!.comparaison.sens, "hausse");
    assert.equal(lue!.comparaison.ecartChargeKg, 2);
    assert.equal(lue!.comparaison.tenue, "tenue");
  });

  await test("6. HISTORIQUE PRÉ-FILTRÉ PAR ÉLÈVE — rigoureusement le même résultat", () => {
    const { relu, historique } = situation(1);
    const intrus = retour({
      id: "autre",
      weekNumber: 1,
      day: "Lundi",
      date: "2026-08-10",
      series: [{ charge: "90 kg", reps: "13" }],
      eleve: AUTRE_ELEVE,
    });

    const avecTousLesEleves = comparaisonsDuRetour({ retour: relu, historique: [intrus, ...historique] });
    const avecLaTrancheDeLEleve = comparaisonsDuRetour({ retour: relu, historique });

    assert.equal(avecTousLesEleves.size, avecLaTrancheDeLEleve.size);
    for (const [cle, valeur] of avecTousLesEleves) {
      const jumelle = avecLaTrancheDeLEleve.get(cle);
      assert.ok(jumelle, `la clé ${cle} a disparu en regroupant par élève`);
      assert.deepEqual(jumelle!.comparaison, valeur.comparaison, "le regroupement par élève a changé un verdict");
      assert.equal(jumelle!.unite, valeur.unite);
    }
  });

  await test("7. RÉFÉRENCE N-1, JAMAIS N-2 — la semaine la plus proche gagne", () => {
    const s1 = retour({ id: "s1", weekNumber: 1, day: "Lundi", date: "2026-08-10", series: [{ charge: "45 kg", reps: "13" }] });
    const s2 = retour({ id: "s2", weekNumber: 2, day: "Lundi", date: "2026-08-17", series: [{ charge: "50 kg", reps: "12" }] });
    const s3 = retour({ id: "s3", weekNumber: 3, day: "Lundi", date: "2026-08-24", series: [{ charge: "52 kg", reps: "10" }] });

    const lue = comparaisonsDuRetour({ retour: s3, historique: [s1, s2, s3] }).get(cleDeSerie(EXERCICE, 1));
    assert.ok(lue, "aucune comparaison pour la semaine 3");
    assert.equal(
      lue!.comparaison.ecartChargeKg,
      2,
      "l'écart doit être mesuré sur la semaine 2 (50 kg), pas sur la semaine 1 (45 kg)",
    );

    const html = texteRendu(renderToString(modale({ relu: s3, historique: [s1, s2, s3], ouverte: true })));
    assert.ok(html.includes("+2 kg"), "la modale affiche un écart qui n'est pas celui de l'occurrence N-1");
    assert.ok(!html.includes("+7 kg"), "la modale s'est comparée à N-2");
  });

  await test("8. SANS PHOTOGRAPHIE DU PRESCRIT — aucun badge, et aucun calcul inventé", () => {
    const sansSnapshot = retour({
      id: "relu",
      weekNumber: 2,
      day: "Lundi",
      date: "2026-08-31",
      series: [{ charge: "47 kg", reps: "10" }],
      sansSnapshot: true,
    });
    const reference = retour({ id: "ref", weekNumber: 1, day: "Lundi", date: "2026-08-24", series: [{ charge: "45 kg", reps: "13" }] });
    assert.equal(
      comparaisonsDuRetour({ retour: sansSnapshot, historique: [reference, sansSnapshot] }).size,
      0,
      "un retour sans photographie du prescrit n'a aucune occurrence : il ne peut rien comparer",
    );

    const html = texteRendu(renderToString(modale({ relu: sansSnapshot, historique: [reference, sansSnapshot], ouverte: true })));
    assert.ok(!html.includes("+2 kg"), "un badge est apparu sans photographie du prescrit");
  });

  await test("9. SANS HISTORIQUE — la modale est exactement celle d'avant", () => {
    const { relu } = situation(1);
    parcours = 0;
    const html = texteRendu(renderToString(modale({ relu, historique: [], ouverte: true })));
    assert.equal(parcours, 0, "un historique vide ne doit rien faire parcourir");
    assert.ok(!html.includes("+2 kg"), "un badge est apparu sans historique");
    assert.ok(html.includes("47 kg"), "la série réalisée doit rester affichée");
  });

  await test("10. L'ÉCRAN NE PASSE PLUS LA LISTE ENTIÈRE À CHAQUE LIGNE", () => {
    const page = lire("../../app/admin/retours/page.tsx");
    assert.ok(
      !/historique=\{feedback\}/.test(page),
      "la page repasse la liste entière à chaque modale : le regroupement par élève a sauté",
    );
    assert.ok(
      /historiqueParEleve\.get\(f\.studentId\)/.test(page),
      "la modale ne reçoit plus la tranche de SON élève",
    );
    assert.ok(/useMemo\(/.test(page), "le regroupement n'est plus mémorisé : il serait refait à chaque frappe");
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
