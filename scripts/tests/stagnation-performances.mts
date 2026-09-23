/**
 * Harnais — LOT D : courbe de performance par exercice et détection de
 * stagnation, dans la section « Performances » du profil élève.
 *
 * RÈGLE RETENUE POUR « MÊME PERFORMANCE » : même charge ET même moyenne
 * arrondie de répétitions (lot A) — PAS « le moteur recommande la même
 * chose ». Le cas qui départage est testé explicitement (test 7).
 *
 * Lancement : npx tsx scripts/tests/stagnation-performances.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  OCCURRENCES_POUR_STAGNATION,
  exercicesDeLHistorique,
  messageDeStagnation,
  performanceFigee,
  serieDeLExercice,
  stagnationEnCours,
  type PointPerformance,
} from "../../lib/performance-exercice";
import { StudentPerformanceSection } from "../../components/admin/StudentPerformanceSection";
import { PRESCRIBED_SNAPSHOT_VERSION } from "../../lib/workout-history";
import type { AdminStudentFeedback } from "../../types";

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

/**
 * Le rendu serveur de React sépare deux nœuds de texte voisins par un
 * marqueur `<!-- -->` (il lui sert à retrouver les frontières à l'hydratation).
 * Une phrase composée d'expressions interpolées n'est donc JAMAIS présente
 * telle quelle dans le HTML brut. On retire ces marqueurs avant d'asserter sur
 * une phrase — c'est une normalisation du transport, pas un assouplissement de
 * l'assertion : le texte comparé reste celui que lira un lecteur d'écran.
 */
function texteRendu(html: string): string {
  return html.replace(/<!--\s*-->/g, "");
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sourceSection = lire("../../components/admin/StudentPerformanceSection.tsx");
const sourceModule = lire("../../lib/performance-exercice.ts");
const sourceProfil = lire("../../app/admin/eleves/[studentId]/page.tsx");

const ELEVE = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";
const LIB_DC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface Seance {
  id: string;
  weekNumber: number | null;
  day: string | null;
  performedAt: string;
  /** nom → séries « charge × reps ». */
  exercices: Record<string, [string, string][]>;
  studentId?: string;
  completed?: boolean;
  banque?: Record<string, string>;
  sansSnapshot?: boolean;
}

function retours(seances: Seance[]): AdminStudentFeedback[] {
  return seances.map((s) => {
    const noms = Object.keys(s.exercices);
    return {
      id: s.id,
      studentId: s.studentId ?? ELEVE,
      type: "entrainement",
      sessionId: `session-${s.id}`,
      programId: null,
      refLabel: `Séance ${s.id}`,
      date: s.performedAt,
      completed: s.completed ?? true,
      rpe: null,
      pain: "",
      comment: "",
      exerciseEntries: noms.flatMap((nom) =>
        s.exercices[nom].map(([loadUsed, repsDone], i) => ({
          exerciseName: nom,
          setNumber: i + 1,
          loadUsed,
          repsDone,
          rpe: null,
          exerciseRpe: null,
          comment: "",
        })),
      ),
      status: "a-traiter",
      coachReply: "",
      createdAt: `${s.performedAt}T10:00:00Z`,
      updatedAt: `${s.performedAt}T10:00:00Z`,
      performedAt: s.performedAt,
      prescribedSnapshot: s.sansSnapshot
        ? undefined
        : {
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
                exercises: noms.map((nom, i) => ({
                  exerciseLibraryId: s.banque?.[nom] ?? null,
                  name: nom,
                  order: i,
                  sets: null,
                  reps: null,
                  recommendedLoad: null,
                  restSeconds: null,
                  tempo: null,
                  notes: null,
                })),
              },
            ],
          },
    };
  });
}

/** Raccourci : une séance « un exercice, une charge, des reps identiques ». */
function seance(id: string, weekNumber: number, day: string, date: string, charge: string, reps: string): Seance {
  return {
    id,
    weekNumber,
    day,
    performedAt: date,
    exercices: { "Développé couché": [[charge, reps], [charge, reps], [charge, reps]] },
  };
}

function points(seances: Seance[]): PointPerformance[] {
  const jeu = retours(seances);
  const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
  assert.ok(exercice, "au moins un exercice disponible");
  return serieDeLExercice(jeu, ELEVE, exercice.cle);
}

await (async () => {
  /* ══════════════════════════════════════════════════════════════════════
   * STAGNATION — LES CAS EXIGÉS
   * ══════════════════════════════════════════════════════════════════════ */

  await test("1. même performance sur 2 occurrences → stagnation détectée", () => {
    assert.equal(OCCURRENCES_POUR_STAGNATION, 2);
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
      ]),
    );
    assert.ok(detectee, "stagnation détectée");
    assert.equal(detectee.occurrences, 2);
    assert.equal(detectee.chargeKg, 10);
    assert.equal(detectee.reps, 10);
    assert.equal(detectee.day, "Mercredi");
  });

  await test("2. même performance sur 3 occurrences → durée correcte", () => {
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
        seance("s3", 3, "Mercredi", "2026-08-19", "10 kg", "10"),
      ]),
    );
    assert.ok(detectee);
    assert.equal(detectee.occurrences, 3, "trois occurrences identiques");
    assert.equal(detectee.premiereSemaine, 1);
    assert.equal(detectee.derniereSemaine, 3);
    assert.ok(
      messageDeStagnation("Développé couché", detectee).startsWith(
        "Développé couché à surveiller : stagnation depuis 3 semaines",
      ),
      "le message annonce la bonne durée",
    );
  });

  await test("3. une répétition de PLUS → aucune stagnation", () => {
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "11"),
      ]),
    );
    assert.equal(detectee, null, "la performance a bougé");
  });

  await test("4. une AUGMENTATION DE CHARGE → aucune stagnation", () => {
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "12.5 kg", "10"),
      ]),
    );
    assert.equal(detectee, null, "la charge a bougé");
  });

  await test("5. JOURS DIFFÉRENTS : les occurrences ne sont JAMAIS mélangées", () => {
    // Lundi progresse, mercredi stagne. Une détection qui mélangerait les
    // jours verrait une série 10/10/12/12 et ne conclurait rien de juste.
    const serie = points([
      seance("lun1", 1, "Lundi", "2026-08-03", "8 kg", "10"),
      seance("mer1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("lun2", 2, "Lundi", "2026-08-10", "9 kg", "10"),
      seance("mer2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
      seance("lun3", 3, "Lundi", "2026-08-17", "10 kg", "10"),
      seance("mer3", 3, "Mercredi", "2026-08-19", "10 kg", "10"),
    ]);
    const detectee = stagnationEnCours(serie);
    assert.ok(detectee);
    assert.equal(detectee.day, "Mercredi", "le mercredi stagne");
    assert.equal(detectee.occurrences, 3);
    // Le lundi, lui, ne stagne pas : ses trois charges diffèrent. La
    // stagnation retenue ne peut donc pas venir de lui.
    assert.notEqual(detectee.premiereSemaine, undefined);
    // Et si le mercredi progresse, plus rien n'est signalé, malgré les
    // charges du lundi qui viennent de rejoindre 10 kg.
    const progresse = stagnationEnCours(
      points([
        seance("lun1", 1, "Lundi", "2026-08-03", "10 kg", "10"),
        seance("mer1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("lun2", 2, "Lundi", "2026-08-10", "10 kg", "10"),
        seance("mer2", 2, "Mercredi", "2026-08-12", "10 kg", "11"),
      ]),
    );
    assert.equal(progresse?.day, "Lundi", "seul le lundi stagne, et il est nommé");
    assert.equal(progresse?.occurrences, 2);
  });

  await test("6. SEMAINE MANQUANTE : aucune occurrence inventée", () => {
    // Semaines 1, 2 puis 4 — la 3 n'a pas été réalisée.
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
        seance("s4", 4, "Mercredi", "2026-08-26", "10 kg", "10"),
      ]),
    );
    assert.ok(detectee);
    assert.equal(detectee.occurrences, 3, "TROIS occurrences réelles, pas quatre");
    assert.equal(detectee.premiereSemaine, 1);
    assert.equal(detectee.derniereSemaine, 4);
    // Le message ne laisse pas croire à une série continue.
    const message = messageDeStagnation("Développé couché", detectee);
    assert.ok(message.includes("stagnation depuis 3 semaines"), "la durée est le nombre d'occurrences réelles");
    assert.ok(message.includes("1 semaine(s) sans séance"), "le trou est signalé, pas masqué");
    // Et la série elle-même n'a pas de point pour la semaine 3.
    const semaines = points([
      seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
      seance("s4", 4, "Mercredi", "2026-08-26", "10 kg", "10"),
    ]).map((p) => p.occurrence.weekNumber);
    assert.deepEqual(semaines, [1, 2, 4], "aucune semaine 3 interpolée");
  });

  await test("7. LA RÈGLE RETENUE : on compare la PERFORMANCE, pas la recommandation", () => {
    // Plage 8-13 : 13 puis 14 répétitions produisent la MÊME recommandation
    // (borne haute atteinte, puis dépassée — même traitement dans le lot A).
    // Une détection fondée sur la recommandation crierait « stagnation » ;
    // la règle retenue voit une répétition de plus, donc une progression.
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "13"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "14"),
      ]),
    );
    assert.equal(detectee, null, "13 → 14 n'est pas une stagnation : la performance a bougé");
    // Contrôle : à 13 puis 13, la stagnation est bien détectée.
    const stagne = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "13"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "13"),
      ]),
    );
    assert.equal(stagne?.occurrences, 2);
    // Et la règle est bien « charge ET reps » : le module ne consulte pas le
    // moteur de recommandation.
    const code = sansCommentaires(sourceModule);
    assert.ok(!code.includes("recommanderProchaineCible"), "aucune recommandation consultée");
  });

  await test("8. EXERCICE DIFFÉRENT : les séries ne sont jamais mélangées", () => {
    const jeu = retours([
      {
        id: "s1",
        weekNumber: 1,
        day: "Mercredi",
        performedAt: "2026-08-05",
        exercices: { "Développé couché": [["10 kg", "10"]], Squat: [["80 kg", "5"]] },
      },
      {
        id: "s2",
        weekNumber: 2,
        day: "Mercredi",
        performedAt: "2026-08-12",
        exercices: { "Développé couché": [["10 kg", "10"]], Squat: [["85 kg", "5"]] },
      },
    ]);
    const disponibles = exercicesDeLHistorique(jeu, ELEVE);
    assert.equal(disponibles.length, 2, "deux exercices distincts");
    const dc = disponibles.find((e) => e.nom === "Développé couché");
    const squat = disponibles.find((e) => e.nom === "Squat");
    assert.ok(dc && squat);
    // Le développé couché stagne, le squat progresse.
    assert.equal(stagnationEnCours(serieDeLExercice(jeu, ELEVE, dc.cle))?.occurrences, 2);
    assert.equal(stagnationEnCours(serieDeLExercice(jeu, ELEVE, squat.cle)), null);
    // Et leurs séries ne partagent aucun point.
    const charges = serieDeLExercice(jeu, ELEVE, squat.cle).map((p) => p.chargeKg);
    assert.deepEqual(charges, [80, 85], "aucune charge du développé couché dans la série du squat");
  });

  await test("9. une SEULE occurrence ne peut pas stagner", () => {
    assert.equal(stagnationEnCours(points([seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10")])), null);
    assert.equal(stagnationEnCours([]), null);
  });

  await test("10. la stagnation ne remonte que tant que la performance est IDENTIQUE", () => {
    // 10×10, 10×10, puis 12×10 : la série s'arrête à la dernière valeur.
    const rompue = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
        seance("s3", 3, "Mercredi", "2026-08-19", "12 kg", "10"),
      ]),
    );
    assert.equal(rompue, null, "la dernière occurrence a progressé : plus de stagnation en cours");
    // 12×10, 10×10, 10×10 : seules les deux dernières comptent.
    const partielle = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "12 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
        seance("s3", 3, "Mercredi", "2026-08-19", "10 kg", "10"),
      ]),
    );
    assert.equal(partielle?.occurrences, 2, "deux, pas trois");
    assert.equal(partielle?.premiereSemaine, 2);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LA SÉRIE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("11. la moyenne ARRONDIE du lot A est utilisée, jamais la dernière série", () => {
    const jeu = retours([
      {
        id: "s1",
        weekNumber: 1,
        day: "Mercredi",
        performedAt: "2026-08-05",
        exercices: { "Développé couché": [["10 kg", "12"], ["10 kg", "10"], ["10 kg", "8"]] },
      },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
    assert.equal(serie.length, 1);
    assert.equal(serie[0].reps, 10, "(12+10+8)/3 = 10, et non 8");
    assert.ok(Number.isInteger(serie[0].reps), "jamais une demi-répétition");
  });

  await test("12. un retour SANS occurrence identifiable ne produit aucun point", () => {
    const jeu = retours([
      {
        id: "brut",
        weekNumber: null,
        day: null,
        performedAt: "2026-08-05",
        sansSnapshot: true,
        exercices: { "Développé couché": [["10 kg", "10"]] },
      },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    assert.ok(exercice, "l'exercice reste listé");
    assert.deepEqual(serieDeLExercice(jeu, ELEVE, exercice.cle), [], "mais aucun point sans occurrence");
  });

  await test("13. une charge NON CONSTANTE sur les séries ne produit aucun point", () => {
    const jeu = retours([
      {
        id: "s1",
        weekNumber: 1,
        day: "Mercredi",
        performedAt: "2026-08-05",
        exercices: { "Développé couché": [["10 kg", "12"], ["12.5 kg", "8"]] },
      },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    assert.deepEqual(serieDeLExercice(jeu, ELEVE, exercice.cle), [], "aucune charge unique : rien n'est approximé");
  });

  await test("14. l'historique d'un AUTRE élève est exclu", () => {
    const jeu = retours([
      { ...seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"), studentId: AUTRE },
      { ...seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"), studentId: AUTRE },
    ]);
    assert.deepEqual(exercicesDeLHistorique(jeu, ELEVE), [], "aucun exercice pour cet élève");
  });

  await test("15. une séance NON TERMINÉE est exclue", () => {
    const jeu = retours([
      { ...seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"), completed: false },
      seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
    assert.equal(serie.length, 1, "seule la séance terminée compte");
    assert.equal(serie[0].occurrence.weekNumber, 2);
    assert.equal(stagnationEnCours(serie), null, "une seule occurrence ne stagne pas");
  });

  await test("16. l'identité de banque regroupe un exercice RENOMMÉ", () => {
    const jeu = retours([
      {
        id: "s1",
        weekNumber: 1,
        day: "Mercredi",
        performedAt: "2026-08-05",
        banque: { "Développé couché": LIB_DC },
        exercices: { "Développé couché": [["10 kg", "10"]] },
      },
      {
        id: "s2",
        weekNumber: 2,
        day: "Mercredi",
        performedAt: "2026-08-12",
        banque: { "DC barre (variante)": LIB_DC },
        exercices: { "DC barre (variante)": [["10 kg", "10"]] },
      },
    ]);
    const disponibles = exercicesDeLHistorique(jeu, ELEVE);
    assert.equal(disponibles.length, 1, "un seul exercice malgré deux noms");
    assert.equal(disponibles[0].nom, "DC barre (variante)", "le nom le plus récent est affiché");
    assert.equal(disponibles[0].occurrences, 2);
    assert.equal(stagnationEnCours(serieDeLExercice(jeu, ELEVE, disponibles[0].cle))?.occurrences, 2);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LA SECTION
   * ══════════════════════════════════════════════════════════════════════ */

  await test("17. la section rend le sélecteur, la courbe et la zone de stagnation", () => {
    const jeu = retours([
      seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
      seance("s3", 3, "Mercredi", "2026-08-19", "10 kg", "10"),
    ]);
    const html = renderToString(
      createElement(StudentPerformanceSection, { feedback: jeu, studentId: ELEVE }),
    );
    assert.ok(html.includes("<select"), "un sélecteur d'exercice");
    assert.ok(html.includes("Exercice dont afficher la progression"), "le sélecteur est étiqueté");
    assert.ok(html.includes("<svg"), "une courbe");
    assert.ok(html.includes("Courbe de charge de Développé couché"), "la courbe est nommée");
    const texte = texteRendu(html);
    assert.ok(texte.includes("stagnation depuis 3 semaines"), "la zone d'information est présente");
    assert.ok(texte.includes("à surveiller"), "le libellé demandé");
  });

  await test("18. la zone de stagnation est ABSENTE quand l'élève progresse", () => {
    const jeu = retours([
      seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "11"),
    ]);
    const html = renderToString(createElement(StudentPerformanceSection, { feedback: jeu, studentId: ELEVE }));
    assert.ok(html.includes("<svg"), "la courbe reste affichée");
    const texte = texteRendu(html);
    assert.ok(!texte.includes("à surveiller"), "aucune alerte");
    assert.ok(!texte.includes("stagnation"), "aucune mention de stagnation");
  });

  await test("19. sans historique chiffrable, la section le DIT au lieu d'afficher un graphique vide", () => {
    const html = renderToString(createElement(StudentPerformanceSection, { feedback: [], studentId: ELEVE }));
    assert.ok(html.includes("Aucune performance chiffrable"), "message honnête");
    assert.ok(!html.includes("<svg"), "aucune courbe vide");
    assert.ok(!html.includes("<select"), "aucun sélecteur vide");
  });

  await test("20. accessibilité : jamais uniquement le graphique", () => {
    const jeu = retours([
      seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("s2", 2, "Mercredi", "2026-08-12", "12 kg", "10"),
    ]);
    const html = renderToString(createElement(StudentPerformanceSection, { feedback: jeu, studentId: ELEVE }));
    assert.ok(/role="group"/.test(html) && /aria-label/.test(html), "un lecteur d'écran peut nommer la courbe");
    assert.ok(html.includes('class="sr-only"'), "résumé textuel des points");
    const texte = texteRendu(html);
    assert.ok(texte.includes("Semaine 1, Mercredi : 10 kg × 10 répétitions"), "chaque point est lisible en texte");
    assert.ok(texte.includes("Semaine 2, Mercredi : 12 kg × 10 répétitions"));
  });

  await test("21. la géométrie du graphique est RÉUTILISÉE, pas réécrite", () => {
    const code = sansCommentaires(sourceSection);
    assert.ok(code.includes("buildWeightChartModel("), "le modèle existant est utilisé");
    assert.ok(code.includes("DEFAULT_WEIGHT_LAYOUT"), "et sa mise en page");
    // Aucune arithmétique de domaine ni d'échelle réécrite ici.
    assert.ok(!/Math\.min\([^)]*kg|Math\.max\([^)]*kg/.test(code), "aucun calcul de domaine local");
    assert.ok(!code.includes("linePath ="), "aucun chemin SVG recalculé");
  });

  await test("22. AUCUNE requête nouvelle, et aucune table de stagnation", () => {
    const code = sansCommentaires(sourceSection);
    assert.ok(!code.includes("supabase") && !code.includes("createSupabase"), "la section ne lit rien elle-même");
    assert.ok(!code.includes("useEffect"), "aucun chargement : les données arrivent en props");
    // Le profil lui passe les retours DÉJÀ chargés.
    const profil = sansCommentaires(sourceProfil);
    assert.ok(
      profil.includes("<StudentPerformanceSection feedback={studentFeedback} studentId={student.id} />"),
      "les retours déjà chargés sont réutilisés",
    );
    // La stagnation est calculée à la lecture : aucune table, aucune colonne.
    const migrations = lire("../../supabase/baseline/manifest.json");
    assert.ok(!/stagnation/i.test(migrations), "aucune migration de stagnation déclarée");
    assert.ok(!/stagnation/i.test(lire("../../types/supabase.ts")), "aucune table de stagnation typée");
  });

  await test("23. AUCUNE notification push n'est créée pour la stagnation", () => {
    // ⚠️ ON VISE LES VRAIES PORTES DE SORTIE, PAS LA SOUS-CHAÎNE « push ».
    // Ma première version interdisait /push/i, qui attrapait `points.push(…)` :
    // une garde qui se déclenche sur un nom de méthode de tableau n'a aucune
    // valeur. Ce qui compte, c'est qu'aucun module de notification ne soit
    // importé et qu'aucune API de notification ne soit appelée.
    for (const chemin of ["../../lib/performance-exercice.ts", "../../components/admin/StudentPerformanceSection.tsx"]) {
      const code = sansCommentaires(lire(chemin));
      for (const porte of [
        "lib/push",
        "web-push",
        "lib/notifications",
        "showNotification",
        "Notification(",
        "pushManager",
        "notification_campaigns",
      ]) {
        assert.ok(!code.includes(porte), `${chemin} n'utilise pas ${porte}`);
      }
    }
  });

  await test("24. le reste du profil élève n'est PAS modifié", () => {
    // La section est AJOUTÉE : aucune barre d'onglets n'a été introduite, et
    // les sections existantes gardent leurs titres.
    const profil = sansCommentaires(sourceProfil);
    assert.ok(!/role="tab(list)?"/.test(profil), "aucun système d'onglets introduit");
    for (const titre of [
      "Charge d&apos;entraînement de l&apos;élève",
      "Notes privées du coach",
      "Informations personnelles",
      "Retours récents",
    ]) {
      assert.ok(profil.includes(titre), `la section « ${titre} » est intacte`);
    }
    assert.ok(profil.includes(">Performances<"), "la nouvelle section est titrée « Performances »");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * CE QUI EST EXACTEMENT COMPARÉ
   * ══════════════════════════════════════════════════════════════════════ */

  await test("24bis. DEUX valeurs, et seulement deux : la charge effective et la moyenne arrondie", () => {
    // La charge SEULE ne suffit pas…
    assert.equal(
      stagnationEnCours(
        points([
          seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
          seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "11"),
        ]),
      ),
      null,
      "charge identique mais reps différentes → pas de stagnation",
    );
    // …et les reps SEULES ne suffisent pas non plus.
    assert.equal(
      stagnationEnCours(
        points([
          seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
          seance("s2", 2, "Mercredi", "2026-08-12", "11 kg", "10"),
        ]),
      ),
      null,
      "reps identiques mais charge différente → pas de stagnation",
    );
    // Les deux ensemble, et là seulement.
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
      ]),
    );
    assert.ok(detectee);
    assert.deepEqual(
      { chargeKg: detectee.chargeKg, reps: detectee.reps },
      { chargeKg: 10, reps: 10 },
      "la stagnation ne porte que ces deux valeurs",
    );
    // Aucune autre donnée n'entre dans la comparaison : ni RPE, ni date, ni
    // durée, ni nombre de séries.
    const code = sansCommentaires(sourceModule);
    const comparaison = code.slice(code.indexOf("function memePerformance"));
    const corps = comparaison.slice(0, comparaison.indexOf("}"));
    assert.ok(corps.includes("a.chargeKg === b.chargeKg"), "la charge est comparée");
    assert.ok(corps.includes("a.reps === b.reps"), "les reps sont comparées");
    for (const hors of ["rpe", "performedAt", "duration", "seriesRetenues", "weekNumber", "day"]) {
      assert.ok(!corps.includes(hors), `${hors} n'entre pas dans la comparaison`);
    }
  });

  await test("24ter. les reps comparées sont la MOYENNE ARRONDIE, pas une série particulière", () => {
    // Deux séances dont les séries diffèrent une à une, mais dont la moyenne
    // arrondie est la même : c'est une stagnation. Une comparaison série par
    // série ne la verrait pas.
    const jeu = retours([
      {
        id: "s1", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05",
        exercices: { "Développé couché": [["10 kg", "12"], ["10 kg", "10"], ["10 kg", "8"]] },
      },
      {
        id: "s2", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12",
        exercices: { "Développé couché": [["10 kg", "10"], ["10 kg", "10"], ["10 kg", "10"]] },
      },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
    assert.deepEqual(serie.map((p) => p.reps), [10, 10], "12/10/8 et 10/10/10 ont la même moyenne");
    assert.equal(stagnationEnCours(serie)?.occurrences, 2, "stagnation vue sur la moyenne");
    // Et l'arrondi est bien commercial : 10,5 rend 11, donc 11/10 (moyenne
    // 10,5 → 11) ne stagne PAS face à 10/10 (moyenne 10).
    const jeu2 = retours([
      { id: "a", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05", exercices: { X: [["10 kg", "10"], ["10 kg", "10"]] } },
      { id: "b", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12", exercices: { X: [["10 kg", "11"], ["10 kg", "10"]] } },
    ]);
    const [ex2] = exercicesDeLHistorique(jeu2, ELEVE);
    const serie2 = serieDeLExercice(jeu2, ELEVE, ex2.cle);
    assert.deepEqual(serie2.map((p) => p.reps), [10, 11], "10,5 arrondi à 11");
    assert.equal(stagnationEnCours(serie2), null);
  });

  await test("24quater. la charge comparée est la charge EFFECTIVE — le doublement haltères s'applique", () => {
    // « 24 kg / haltère » est lu comme 48 kg (getEffectiveLoadKg double les
    // charges par haltère, comportement du moteur du lot A hérité du calcul de
    // tonnage). La COMPARAISON reste juste, puisque les deux occurrences
    // passent par la même lecture. Ce test porte sur ce calcul INTERNE ;
    // l'AFFICHAGE, lui, revient à l'unité de saisie depuis le 23/09/2026 —
    // voir les tests 24quater-bis et 24quater-ter.
    const jeu = retours([
      { id: "a", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05", exercices: { X: [["24 kg / haltère", "10"]] } },
      { id: "b", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12", exercices: { X: [["24 kg / haltère", "10"]] } },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
    assert.deepEqual(serie.map((p) => p.chargeKg), [48, 48], "24 kg par haltère = 48 kg effectifs");
    const detectee = stagnationEnCours(serie);
    assert.equal(detectee?.occurrences, 2, "la stagnation est correctement vue");
    assert.equal(detectee?.chargeKg, 48, "et elle porte la charge effective");
    // Contre-épreuve : une progression de 24 à 26 kg par haltère est bien vue
    // comme une progression, pas comme une stagnation.
    const jeu2 = retours([
      { id: "a", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05", exercices: { X: [["24 kg / haltère", "10"]] } },
      { id: "b", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12", exercices: { X: [["26 kg / haltère", "10"]] } },
    ]);
    const [ex2] = exercicesDeLHistorique(jeu2, ELEVE);
    assert.equal(stagnationEnCours(serieDeLExercice(jeu2, ELEVE, ex2.cle)), null);
  });

  await test("24quater-bis. le GRAPHIQUE affiche la charge SAISIE, jamais le total effectif", () => {
    const jeu = retours([
      { id: "a", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05", exercices: { "Développé haltères": [["24 kg / haltère", "10"]] } },
      { id: "b", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12", exercices: { "Développé haltères": [["26 kg / haltère", "10"]] } },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
    // INTERNE : la convention est conservée.
    assert.deepEqual(serie.map((p) => p.chargeKg), [48, 52], "48 et 52 kg effectifs en interne");
    assert.deepEqual(serie.map((p) => p.unite), ["par-haltere", "par-haltere"], "l'unité voyage avec le point");
    // AFFICHAGE : l'unité de saisie, sur le graphique comme dans le résumé.
    const html = renderToString(createElement(StudentPerformanceSection, { feedback: jeu, studentId: ELEVE }));
    const texte = texteRendu(html);
    assert.ok(texte.includes("24 kg / haltère × 10"), "point 1 affiché en kg/haltère");
    assert.ok(texte.includes("26 kg / haltère × 10"), "point 2 affiché en kg/haltère");
    // ⚠️ GARDE NÉGATIVE SUR TOUTES LES ÉCRITURES DU TOTAL, décimale comprise.
    // Ma première version cherchait « 48 kg » : le libellé du modèle de courbe
    // (`formatKg`) rend « 48,0 kg », qui passait à travers. Un sabotage
    // affichant `point.kgLabel` restait donc vert. Le test était faux, pas le
    // composant.
    for (const total of [48, 52]) {
      assert.ok(
        !new RegExp(`\\b${total}(?:[.,]\\d+)? kg`).test(texte),
        `le total effectif ${total} kg n'apparaît sous AUCUNE écriture`,
      );
    }
    // Et la garde POSITIVE compte les emplacements : deux étiquettes de points
    // sur la courbe + deux lignes du résumé lisible = quatre.
    assert.equal(
      (texte.match(/kg \/ haltère/g) ?? []).length,
      4,
      "chaque point porte son unité, sur la courbe ET dans le résumé textuel",
    );
    // Y compris dans le résumé lisible par un lecteur d'écran.
    assert.ok(texte.includes("Semaine 1, Mercredi : 24 kg / haltère × 10 répétitions"));
  });

  await test("24quater-ter. le MESSAGE DE STAGNATION parle aussi en unité de saisie", () => {
    const jeu = retours([
      { id: "a", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05", exercices: { X: [["24 kg / haltère", "10"]] } },
      { id: "b", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12", exercices: { X: [["24 kg / haltère", "10"]] } },
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const stagnation = stagnationEnCours(serieDeLExercice(jeu, ELEVE, exercice.cle));
    assert.ok(stagnation);
    assert.equal(stagnation.chargeKg, 48, "la comparaison reste en charge effective");
    assert.equal(stagnation.unite, "par-haltere");
    assert.equal(performanceFigee(stagnation), "24 kg / haltère × 10 répétitions", "le message parle au coach");
    const html = renderToString(createElement(StudentPerformanceSection, { feedback: jeu, studentId: ELEVE }));
    const texte = texteRendu(html);
    assert.ok(texte.includes("24 kg / haltère × 10 répétitions à chaque fois"));
    assert.ok(!/\b48 kg\b/.test(texte), "jamais 48 kg à l'écran");
  });

  await test("24quater-quater. sans haltères, l'affichage du graphique est INCHANGÉ", () => {
    const jeu = retours([
      seance("s1", 1, "Mercredi", "2026-08-05", "50 kg", "10"),
      seance("s2", 2, "Mercredi", "2026-08-12", "52.5 kg", "10"),
    ]);
    const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
    const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
    assert.deepEqual(serie.map((p) => p.unite), ["totale", "totale"]);
    const texte = texteRendu(renderToString(createElement(StudentPerformanceSection, { feedback: jeu, studentId: ELEVE })));
    assert.ok(texte.includes("50 kg × 10"), "charge totale telle quelle");
    assert.ok(texte.includes("52,5 kg × 10"), "décimale conservée");
    assert.ok(!texte.includes("haltère"), "aucune mention d'haltère hors contexte");
  });

  await test("24quinquies. une charge NON CHIFFRABLE ne produit jamais de stagnation", () => {
    // Poids du corps, machine, élastique : aucune charge comparable. Deux
    // séances identiques au poids du corps ne doivent PAS être signalées, faute
    // de quoi tout exercice sans charge stagnerait en permanence.
    for (const charge of ["poids du corps", "machine", "assisté", ""]) {
      const jeu = retours([
        { id: "a", weekNumber: 1, day: "Mercredi", performedAt: "2026-08-05", exercices: { X: [[charge, "10"]] } },
        { id: "b", weekNumber: 2, day: "Mercredi", performedAt: "2026-08-12", exercices: { X: [[charge, "10"]] } },
      ]);
      const [exercice] = exercicesDeLHistorique(jeu, ELEVE);
      const serie = serieDeLExercice(jeu, ELEVE, exercice.cle);
      assert.deepEqual(serie, [], `« ${charge || "(vide)"} » ne produit aucun point`);
      assert.equal(stagnationEnCours(serie), null);
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * SABOTAGE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("25. SABOTAGE — une stagnation fondée sur la performance CHRONOLOGIQUEMENT précédente est prise en défaut", () => {
    // Lundi et mercredi alternent. Chronologiquement, la suite des
    // performances est 10, 10, 10, 10 — une implémentation qui comparerait
    // deux séances consécutives DANS LE TEMPS verrait une stagnation de
    // quatre séances. À jour constant, le mercredi stagne sur DEUX
    // occurrences et le lundi progresse.
    const serie = points([
      seance("lun1", 1, "Lundi", "2026-08-03", "10 kg", "10"),
      seance("mer1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("lun2", 2, "Lundi", "2026-08-10", "10 kg", "12"),
      seance("mer2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
    ]);
    const detectee = stagnationEnCours(serie);
    assert.ok(detectee);
    assert.equal(detectee.day, "Mercredi", "seul le mercredi stagne");
    assert.equal(detectee.occurrences, 2, "DEUX occurrences — et non les quatre séances chronologiques");
    assert.notEqual(detectee.occurrences, 4, "4 serait la lecture chronologique");
  });

  await test("26. SABOTAGE — une stagnation mélangeant lundi et mercredi est prise en défaut", () => {
    // Le lundi stagne à 8 kg, le mercredi stagne à 10 kg. Une implémentation
    // qui mélangerait les jours ne verrait AUCUNE stagnation (les valeurs
    // alternent 8, 10, 8, 10), alors que les deux jours stagnent.
    const serie = points([
      seance("lun1", 1, "Lundi", "2026-08-03", "8 kg", "10"),
      seance("mer1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
      seance("lun2", 2, "Lundi", "2026-08-10", "8 kg", "10"),
      seance("mer2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
    ]);
    const detectee = stagnationEnCours(serie);
    assert.ok(detectee, "une stagnation EST détectée, alors qu'un mélange des jours n'en verrait aucune");
    assert.equal(detectee.occurrences, 2);
    assert.ok(["Lundi", "Mercredi"].includes(detectee.day));
    // Et la charge annoncée est celle d'UN jour, jamais une moyenne des deux.
    assert.ok([8, 10].includes(detectee.chargeKg), "charge d'un seul jour");
    assert.notEqual(detectee.chargeKg, 9, "9 serait la moyenne des deux jours");
  });

  await test("27. SABOTAGE — une semaine absente comptée comme une occurrence est prise en défaut", () => {
    // Semaines 1, 2, 5 : trois occurrences réelles sur un intervalle de cinq
    // semaines. Compter l'écart de semaines annoncerait 5.
    const detectee = stagnationEnCours(
      points([
        seance("s1", 1, "Mercredi", "2026-08-05", "10 kg", "10"),
        seance("s2", 2, "Mercredi", "2026-08-12", "10 kg", "10"),
        seance("s5", 5, "Mercredi", "2026-09-02", "10 kg", "10"),
      ]),
    );
    assert.ok(detectee);
    assert.equal(detectee.occurrences, 3, "trois occurrences réelles");
    assert.notEqual(detectee.occurrences, 5, "5 serait l'écart de semaines, donc deux semaines inventées");
    assert.equal(detectee.derniereSemaine - detectee.premiereSemaine + 1, 5, "l'intervalle, lui, est bien de 5");
    assert.ok(
      messageDeStagnation("Développé couché", detectee).includes("2 semaine(s) sans séance"),
      "les semaines absentes sont nommées, pas comptées",
    );
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
