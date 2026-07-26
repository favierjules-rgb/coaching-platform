/**
 * Harnais de RÉGRESSION — « aujourd'hui » réel en production.
 *
 * Bug corrigé le 26/07/2026 : ADMIN_REFERENCE_DATE (2 juillet 2026, héritée
 * du mode démo) servait de date courante par défaut. Conséquences observées
 * en production :
 *  - un document en déblocage automatique dont la date tombait après le
 *    2 juillet 2026 restait verrouillé indéfiniment (cas réel : élève
 *    démarré le 17/07, document toujours « Disponible le 17/07/2026 » le 26/07) ;
 *  - la semaine actuelle du programme et le repère « aujourd'hui » du
 *    calendrier de séances ne progressaient plus.
 *
 * Ces tests injectent une date explicite (déterminisme) ET vérifient que la
 * valeur PAR DÉFAUT suit bien l'horloge réelle, ce qui est le cœur du bug :
 * un test qui passerait toujours une référence explicite ne l'aurait pas
 * détecté.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/time-reference.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";

import { ADMIN_REFERENCE_DATE, computeDocumentAvailability, daysBetween, studentsWithoutRecentLogin } from "../../lib/admin";
import { currentDate } from "../../lib/clock";
import { buildScheduleForWeek, computeCurrentWeekNumber } from "../../lib/training-schedule";
import type { AdminDocument, AdminProgram, AdminStudent, StudentDocumentUnlock } from "../../types";

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

/* ─── Fixtures : reproduction exacte du cas réel signalé ─── */

const document: AdminDocument = {
  id: "doc-tempo",
  title: "Tempo d'exécution",
  type: "vidéo",
  category: "entrainement",
  level: 1,
  difficulty: "facile",
  shortDescription: "",
  fullDescription: "",
  contentText: "",
  externalUrl: "",
  videoUrl: "",
  fileName: null,
  storagePath: null,
  fileSizeBytes: null,
  fileMimeType: null,
  status: "publié",
  important: false,
  distributionMode: "deblocage-auto",
  unlockAfterWeeks: 1,
  unlockAt: null,
  visibility: "assigned",
  tags: [],
  assignedStudentIds: ["stu-1"],
  createdAt: "2026-07-08T10:00:00.000Z",
  updatedAt: "2026-07-08T10:00:00.000Z",
} as AdminDocument;

/** Élève réel : début de suivi le 17/07/2026 → déblocage niveau 1 le 17/07. */
const student = { startDate: "2026-07-17" };

const LE_26_JUILLET = new Date("2026-07-26T12:00:00.000Z");
const LE_16_JUILLET = new Date("2026-07-16T12:00:00.000Z");

/* ─── Documents ─── */

test("RÉGRESSION : le 26/07, le document dont le déblocage tombe le 17/07 est DISPONIBLE", () => {
  const availability = computeDocumentAvailability(student, document, [], LE_26_JUILLET);
  assert.equal(availability.available, true, "le document doit être débloqué");
  assert.equal(availability.unlockDate, null);
});

test("avant la date de déblocage, le document reste verrouillé avec la bonne date", () => {
  const availability = computeDocumentAvailability(student, document, [], LE_16_JUILLET);
  assert.equal(availability.available, false);
  assert.equal(availability.unlockDate, "2026-07-17");
});

test("le jour même du déblocage, le document est disponible", () => {
  const availability = computeDocumentAvailability(student, document, [], new Date("2026-07-17T08:00:00.000Z"));
  assert.equal(availability.available, true);
});

test("CŒUR DU BUG : sans référence explicite, le calcul suit l'horloge réelle (pas la date de démo)", () => {
  // Document débloqué la veille de « maintenant » : n'est disponible que si
  // la référence par défaut est la date réelle. Avec l'ancienne valeur par
  // défaut (2 juillet 2026 figé), ce test échouerait dès que l'horloge
  // dépasse cette date.
  const hier = new Date(currentDate().getTime() - 86_400_000);
  const debutHier = { startDate: hier.toISOString().slice(0, 10) };
  const availability = computeDocumentAvailability(debutHier, document, []);
  assert.equal(availability.available, true, "un déblocage passé doit être effectif sans référence explicite");

  // …et un déblocage futur reste verrouillé.
  const demain = new Date(currentDate().getTime() + 2 * 86_400_000);
  const debutDemain = { startDate: demain.toISOString().slice(0, 10) };
  assert.equal(computeDocumentAvailability(debutDemain, document, []).available, false);
});

test("le déblocage manuel et le mode immédiat restent prioritaires et intacts", () => {
  const manuel: StudentDocumentUnlock[] = [
    { studentId: "stu-1", documentId: "doc-tempo", unlockedAt: "2026-07-10T00:00:00.000Z" },
  ];
  assert.equal(
    computeDocumentAvailability(student, document, manuel, LE_16_JUILLET).available,
    true,
    "déblocage manuel : disponible même avant la date",
  );
  const immediat = { ...document, distributionMode: "immediat" } as AdminDocument;
  assert.equal(computeDocumentAvailability(student, immediat, [], LE_16_JUILLET).available, true);
});

test("mode « date précise » : comparé à la date réelle, plus à la date de démo", () => {
  const dated = { ...document, distributionMode: "deblocage-date", unlockAt: "2026-07-20T00:00:00.000Z" } as AdminDocument;
  assert.equal(computeDocumentAvailability(student, dated, [], LE_26_JUILLET).available, true);
  assert.equal(computeDocumentAvailability(student, dated, [], LE_16_JUILLET).available, false);
});

/* ─── Programme ─── */

const program = {
  id: "prog-1",
  status: "actif",
  programMode: "individuel",
  groupStartDate: null,
  durationWeeks: 8,
  sessions: [],
} as unknown as AdminProgram;

const studentProgram = { startDate: "2026-07-17" } as AdminStudent;

test("RÉGRESSION : la semaine de programme progresse avec le temps réel", () => {
  // 17/07 = début → semaine 1 ; 26/07 = J+9 → semaine 2.
  assert.equal(computeCurrentWeekNumber(program, studentProgram, new Date("2026-07-17T12:00:00.000Z")), 1);
  assert.equal(computeCurrentWeekNumber(program, studentProgram, LE_26_JUILLET), 2);
  assert.equal(computeCurrentWeekNumber(program, studentProgram, new Date("2026-08-10T12:00:00.000Z")), 4);
});

test("le repère « aujourd'hui » du calendrier suit le vrai jour de la semaine", () => {
  // Lundi 27/07/2026 → index 0 ; dimanche 26/07 → index 6.
  const lundi = buildScheduleForWeek(program, 1, new Date("2026-07-27T12:00:00.000Z"));
  assert.equal(lundi.findIndex((d) => d.isToday), 0);
  const dimanche = buildScheduleForWeek(program, 1, new Date("2026-07-26T12:00:00.000Z"));
  assert.equal(dimanche.findIndex((d) => d.isToday), 6);
});

/* ─── Listes de suivi admin ─── */

test("daysBetween et les listes de suivi utilisent la date réelle par défaut", () => {
  assert.equal(daysBetween("2026-07-20", LE_26_JUILLET), 6);
  // Par défaut : un événement d'il y a 3 jours donne bien ~3, quelle que soit
  // la date du jour où le test tourne.
  const ilYATroisJours = new Date(currentDate().getTime() - 3 * 86_400_000).toISOString();
  assert.equal(daysBetween(ilYATroisJours), 3);

  const students = [
    { id: "a", status: "actif", lastLoginAt: new Date(currentDate().getTime() - 30 * 86_400_000).toISOString() },
    { id: "b", status: "actif", lastLoginAt: new Date(currentDate().getTime() - 2 * 86_400_000).toISOString() },
  ] as AdminStudent[];
  const sansConnexion = studentsWithoutRecentLogin(students);
  assert.deepEqual(sansConnexion.map((s) => s.id), ["a"], "seul l'élève absent depuis 30 jours doit ressortir");
});

/* ─── Garde-fou : la constante de démo ne doit plus servir de « maintenant » ─── */

test("ADMIN_REFERENCE_DATE reste disponible pour les fixtures mais n'est plus la référence par défaut", () => {
  assert.equal(ADMIN_REFERENCE_DATE.toISOString(), "2026-07-02T12:00:00.000Z");
  // La date réelle est nécessairement postérieure à cette constante de démo :
  // si le défaut la réutilisait, l'écart serait nul.
  assert.ok(
    currentDate().getTime() !== ADMIN_REFERENCE_DATE.getTime(),
    "currentDate() ne doit jamais renvoyer la date de démo",
  );
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
