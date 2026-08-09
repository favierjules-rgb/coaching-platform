// Fuseau figé : sans lui, les dates métier dépendraient de la machine.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";

import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";
import { DepotOffline, MoteurMemoire } from "../../lib/offline/depot";
import { ErreurStockage } from "../../lib/offline/idb";
import { soumettreRetour } from "../../lib/offline/soumission";
import { choisirOrigineFormulaire } from "../../lib/offline/priorite-etat";
import {
  appartientA,
  identiteDepuisSession,
  peutLire,
  peutSoumettre,
} from "../../lib/offline/identite";
import {
  afficheDonneesReelles,
  autoriseSoumissionHorsLigne,
  classerErreur,
  classerSource,
  diagnostiquer,
} from "../../lib/offline/source-donnees";
import { creerPlanificateurBrouillon, type Minuteur } from "../../lib/offline/brouillon-differe";
import {
  analyserDuree,
  construireWorkoutFeedbackPayload,
  corpsPourServeur,
  type EtatFormulaireRetour,
} from "../../lib/workout-feedback-payload";
import {
  assemblerSnapshot,
  charge,
  datePourRetour,
  lireSnapshotPourSeance,
  manque,
  type ContenuSnapshot,
} from "../../lib/offline/snapshot-seance";
import {
  deconnecterEnConservantLesEnvois,
  preparerDeconnexion,
} from "../../lib/offline/deconnexion";
import {
  flushEnCours,
  synchroniser,
  type ReponseServeur,
  type Transport,
} from "../../lib/offline/synchronisateur";
import type { AdminStudentFeedback, WorkoutFeedbackPayload, WorkoutSession } from "../../types";

/**
 * HORS LIGNE — L'INTÉGRATION DE LA SÉANCE, EXÉCUTÉE.
 *
 *   npm run test:offline-integration
 *
 * `offline-depot.mts` prouve le dépôt ; `scripts/tests/idb/` prouve le
 * moteur dans un vrai navigateur. Ici, on prouve ce qui se passe ENTRE les
 * deux : l'assemblage du snapshot, le choix de ce qui est servi hors ligne,
 * l'ordonnancement de la synchronisation, et la déconnexion.
 *
 * Tout tourne sur `MoteurMemoire` avec un transport injecté : aucune de ces
 * garanties ne dépend d'IndexedDB ni du réseau, donc aucune n'a besoin d'un
 * navigateur pour être vérifiée. Ce qui reste à prouver sur un vrai
 * téléphone est la COQUILLE React, pas ces règles.
 */

const A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const B = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const ELEVE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SEANCE = "33333333-3333-4333-8333-111111111111";
const SEANCE_2 = "44444444-4444-4444-8444-222222222222";
const EXERCICE = "66666666-6666-4666-8666-333333333333";
const REMPLACANT = "77777777-7777-4777-8777-444444444444";
const DIMANCHE = "2026-08-09";
const LUNDI = "2026-08-10";
const T0 = 1_786_000_000_000;

/** Un état de FORMULAIRE valide — la seule forme que `training_draft` accepte. */
const FORMULAIRE = {
  exerciseFeedback: {}, substitutions: {}, videosExercice: {}, blockDrafts: {},
  completed: true, globalRpe: "8", globalComment: "", pain: "",
  painLevel: "aucune", painDetail: "", durationMinutes: "65",
};

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

function neuf() {
  const moteur = new MoteurMemoire();
  return { moteur, depot: new DepotOffline(moteur) };
}

const SEANCE_VM = {
  id: SEANCE,
  programId: "prog-1",
  day: "Dimanche",
  name: "Haut du corps",
  muscleGroups: "Pectoraux",
  durationMinutes: 60,
  warmup: "5 min rameur",
  coachNotes: "Garde les coudes serrés",
  exercises: [],
  blocks: [],
  cardioBlocks: [],
} as unknown as WorkoutSession;

function contenuComplet(): ContenuSnapshot {
  return {
    studentId: ELEVE_A,
    session: SEANCE_VM,
    programId: "prog-1",
    programName: "Prise de masse",
    feedbackExistant: null,
    historique: [],
    remplacants: { "lib-1": [] },
    accessType: "programme_seul",
  };
}

function entreeComplete() {
  const c = contenuComplet();
  return {
    studentId: charge(c.studentId),
    session: charge(c.session),
    programId: charge(c.programId),
    programName: charge(c.programName),
    feedbackExistant: charge(c.feedbackExistant),
    historique: charge(c.historique),
    remplacants: charge(c.remplacants),
    accessType: charge(c.accessType),
  };
}

function payload(charge_: string, performedAt = DIMANCHE): WorkoutFeedbackPayload {
  return {
    studentId: ELEVE_A,
    sessionKey: SEANCE,
    sessionRefLabel: "Haut du corps",
    completed: true,
    globalRpe: 8,
    globalComment: "",
    pain: "",
    exercises: [
      {
        exerciseName: "Développé couché",
        exerciseOrder: 0,
        rpe: null,
        comment: "",
        sets: [{ setNumber: 1, loadUsed: charge_, repsDone: "10" }],
      },
    ],
    sessionId: SEANCE,
    durationMinutes: 65,
    performedAt,
  };
}

const FEEDBACK_SERVEUR = {
  id: "fb-1",
  studentId: ELEVE_A,
  type: "entrainement",
  sessionId: SEANCE,
  performedAt: DIMANCHE,
  durationMinutes: 65,
} as unknown as AdminStudentFeedback;

/** Transport programmable : chaque envoi consomme la réponse suivante. */
function transportScripte(reponses: ReponseServeur[], options?: { relecture?: () => Promise<AdminStudentFeedback | null> }) {
  const envois: WorkoutFeedbackPayload[] = [];
  const relectures: string[] = [];
  const transport: Transport = {
    async envoyer(p) {
      envois.push(p);
      return reponses.shift() ?? { etat: "succes" };
    },
    async relire(sessionId) {
      relectures.push(sessionId);
      if (options?.relecture) return options.relecture();
      return FEEDBACK_SERVEUR;
    },
  };
  return { transport, envois, relectures };
}

/* ════════════════════════════════════════════════════════════════════════
 * I. IDENTITÉ
 * ════════════════════════════════════════════════════════════════════════ */

await test("I1. l'id Auth suffit pour LIRE, jamais pour composer un retour", () => {
  assert.equal(peutLire({ userId: A, studentId: null }), true);
  assert.equal(peutSoumettre({ userId: A, studentId: null }), false);
  assert.equal(peutSoumettre({ userId: A, studentId: ELEVE_A }), true);
  assert.equal(peutLire(null), false);
  assert.equal(peutLire({ userId: "", studentId: ELEVE_A }), false);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. SNAPSHOT — ASSEMBLAGE ET REFUS
 * ════════════════════════════════════════════════════════════════════════ */

await test("S1. un chargement complet produit le snapshot", () => {
  const resultat = assemblerSnapshot(entreeComplete());
  assert.equal(resultat.ok, true);
  if (resultat.ok) {
    assert.equal(resultat.contenu.session.id, SEANCE);
    assert.equal(resultat.contenu.studentId, ELEVE_A);
    assert.deepEqual(resultat.contenu.remplacants, { "lib-1": [] });
  }
});

await test("S2. UNE seule part manquante suffit à refuser tout l'assemblage", () => {
  const partiel = { ...entreeComplete(), remplacants: manque<Record<string, never>>("timeout") };
  const resultat = assemblerSnapshot(partiel as never);
  assert.equal(resultat.ok, false);
  if (!resultat.ok) {
    assert.equal(resultat.manques.length, 1);
    assert.match(resultat.manques[0], /remplacants/);
  }
});

await test("S3. un chargement partiel N'ÉCRASE PAS un snapshot valide", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A,
    businessDate: DIMANCHE,
    sessionId: SEANCE,
    payload: contenuComplet(),
    maintenant: T0,
  });

  // Le réseau se dégrade : l'historique ne revient pas.
  const resultat = assemblerSnapshot({
    ...entreeComplete(),
    historique: manque<AdminStudentFeedback[]>("réseau"),
  });
  assert.equal(resultat.ok, false);
  // L'appelant n'écrit donc rien — et l'ancien snapshot est intact.
  const relu = await depot.lireSnapshot(A, DIMANCHE);
  assert.ok(relu);
  assert.equal((relu?.payload as ContenuSnapshot).studentId, ELEVE_A);
});

await test("S4. « aucun retour côté serveur » n'est PAS un échec de chargement", () => {
  const resultat = assemblerSnapshot({ ...entreeComplete(), feedbackExistant: charge(null) });
  assert.equal(resultat.ok, true);
});

/* ════════════════════════════════════════════════════════════════════════
 * III. SNAPSHOT — CE QUI EST SERVI HORS LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

await test("S5. le snapshot d'un AUTRE compte n'est jamais servi", () => {
  const snapshot = { userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet() };
  const lecture = lireSnapshotPourSeance(snapshot, { userId: B, sessionId: SEANCE, aujourdhui: DIMANCHE });
  assert.equal(lecture.etat, "autre_compte");
  assert.equal(lecture.contenu, null);
});

await test("S6. le snapshot d'une AUTRE séance n'est jamais servi", () => {
  const snapshot = { userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet() };
  const lecture = lireSnapshotPourSeance(snapshot, { userId: A, sessionId: SEANCE_2, aujourdhui: DIMANCHE });
  assert.equal(lecture.etat, "autre_seance");
});

await test("S7. une séance d'HIER ne devient jamais celle d'aujourd'hui", () => {
  const snapshot = { userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet() };
  const lecture = lireSnapshotPourSeance(snapshot, { userId: A, sessionId: SEANCE, aujourdhui: LUNDI });
  assert.equal(lecture.etat, "perime");
  assert.equal(lecture.contenu, null);
});

await test("S8. le bon compte, la bonne séance, le bon jour : servi", () => {
  const snapshot = { userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet() };
  const lecture = lireSnapshotPourSeance(snapshot, { userId: A, sessionId: SEANCE, aujourdhui: DIMANCHE });
  assert.equal(lecture.etat, "pret");
  assert.equal(lecture.contenu?.session.name, "Haut du corps");
});

await test("S9. `performedAt` reste la date de la SÉANCE, jamais celle de l'envoi", () => {
  // Séance faite dimanche hors ligne, synchronisée lundi.
  assert.equal(datePourRetour({ businessDate: DIMANCHE }, null, LUNDI), DIMANCHE);
  // Pas de brouillon : la date du snapshot fait foi.
  assert.equal(datePourRetour(null, { businessDate: DIMANCHE }, LUNDI), DIMANCHE);
  // Ni l'un ni l'autre : aujourd'hui, faute de mieux.
  assert.equal(datePourRetour(null, null, LUNDI), LUNDI);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. SYNCHRONISATEUR
 * ════════════════════════════════════════════════════════════════════════ */

await test("Y1. succès : relecture AVANT acquittement, puis outbox vidée", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });

  const ordre: string[] = [];
  const etatsServeur: (AdminStudentFeedback | null)[] = [];
  const { transport } = transportScripte([{ etat: "succes" }], {
    relecture: async () => {
      ordre.push("relire");
      return FEEDBACK_SERVEUR;
    },
  });

  const bilan = await synchroniser({
    depot, userId: A, transport, maintenant: () => T0,
    surEtatServeur: (_sessionId, feedback) => {
      ordre.push("copie-locale");
      etatsServeur.push(feedback);
    },
  });

  assert.equal(bilan.etat, "termine");
  if (bilan.etat === "termine") {
    assert.equal(bilan.operations[0].sortie, "acquittee");
    assert.equal(bilan.operations[0].revision, 1);
  }
  assert.deepEqual(ordre, ["relire", "copie-locale"], "la copie locale doit être reconstruite APRÈS la relecture");
  assert.equal(etatsServeur[0]?.id, "fb-1", "SERVER WINS : c'est l'état relu qui est propagé");
  assert.deepEqual(await depot.operationsEnAttente(A), []);
});

await test("Y2. A envoyée pendant que B est créée : A réussit, B RESTE", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });

  // La correction arrive PENDANT le POST — c'est la course exacte.
  const transport: Transport = {
    async envoyer() {
      await depot.validerRetourHorsLigne({
        userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
        etatFormulaire: FORMULAIRE, payloadServeur: payload("85"), operationId: "op-1", maintenant: T0 + 1,
      });
      return { etat: "succes" };
    },
    async relire() {
      return FEEDBACK_SERVEUR;
    },
  };

  const bilan = await synchroniser({ depot, userId: A, transport, maintenant: () => T0 });
  assert.equal(bilan.etat, "termine");
  if (bilan.etat === "termine") {
    assert.equal(bilan.operations[0].sortie, "remplacee");
  }

  const restantes = await depot.operationsEnAttente(A);
  assert.equal(restantes.length, 1, "la correction B a été effacée par l'acquittement de A");
  assert.equal(restantes[0].revision, 2);
  assert.equal(restantes[0].payload.exercises[0].sets[0].loadUsed, "85");
  assert.equal(restantes[0].operationId, "op-1", "même retour, donc même identifiant d'idempotence");
});

await test("Y3. nouvelle tentative : B part à son tour et est acquittée", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("85"), operationId: "op-1", maintenant: T0,
  });
  const { transport, envois } = transportScripte([{ etat: "succes" }]);
  const bilan = await synchroniser({ depot, userId: A, transport, maintenant: () => T0 });
  assert.equal(bilan.etat, "termine");
  if (bilan.etat === "termine") assert.equal(bilan.operations[0].sortie, "acquittee");
  assert.equal(envois[0].exercises[0].sets[0].loadUsed, "85");
  assert.deepEqual(await depot.operationsEnAttente(A), []);
});

await test("Y4. erreur RÉSEAU : conservée, sans gonfler le compteur de tentatives", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });
  const { transport, relectures } = transportScripte([{ etat: "reseau", message: "offline" }]);
  const bilan = await synchroniser({ depot, userId: A, transport, maintenant: () => T0 });

  if (bilan.etat === "termine") assert.equal(bilan.operations[0].sortie, "conservee_reseau");
  assert.deepEqual(relectures, [], "aucune relecture ne doit être tentée sans succès d'envoi");
  const operation = await depot.lireOperation(A, SEANCE);
  assert.equal(operation?.attempts, 0, "une coupure de réseau n'est pas un échec de ce retour");
  assert.equal(operation?.lastError, null);
});

await test("Y5. session EXPIRÉE : outbox intacte, et le flush s'arrête là", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_2, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: { ...payload("60"), sessionId: SEANCE_2, sessionKey: SEANCE_2 },
    operationId: "op-2", maintenant: T0,
  });
  const { transport, envois } = transportScripte([{ etat: "auth" }]);
  const bilan = await synchroniser({ depot, userId: A, transport, maintenant: () => T0 });

  if (bilan.etat === "termine") {
    assert.equal(bilan.operations.length, 1, "inutile d'insister avec une session expirée");
    assert.equal(bilan.operations[0].sortie, "conservee_auth");
  }
  assert.equal(envois.length, 1);
  assert.equal((await depot.operationsEnAttente(A)).length, 2, "aucune opération ne doit être perdue");
});

await test("Y6. refus MÉTIER : conservée, avec attempts et lastError", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });
  const { transport } = transportScripte([
    { etat: "metier", message: "remplacement devenu invalide" },
  ]);
  const bilan = await synchroniser({ depot, userId: A, transport, maintenant: () => T0 + 5 });

  if (bilan.etat === "termine") assert.equal(bilan.operations[0].sortie, "conservee_metier");
  const operation = await depot.lireOperation(A, SEANCE);
  assert.equal(operation?.attempts, 1);
  assert.equal(operation?.lastError, "remplacement devenu invalide");
  assert.equal(operation?.lastAttemptAt, T0 + 5);
  assert.equal(operation?.payload.exercises[0].sets[0].loadUsed, "80", "aucune perte silencieuse");
});

await test("Y7. relecture en échec : AUCUN acquittement", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });
  const { transport } = transportScripte([{ etat: "succes" }], {
    relecture: async () => {
      throw new Error("lecture impossible");
    },
  });
  const bilan = await synchroniser({ depot, userId: A, transport, maintenant: () => T0 });

  if (bilan.etat === "termine") assert.equal(bilan.operations[0].sortie, "conservee_relecture");
  assert.equal(
    (await depot.operationsEnAttente(A)).length,
    1,
    "sans relecture, on ne sait pas ce que le serveur a retenu : on n'efface rien",
  );
});

await test("Y8. UN SEUL envoi par retour, même sur deux flush simultanés", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });

  let enVol = 0;
  let maxSimultanes = 0;
  const envois: string[] = [];
  const transport: Transport = {
    async envoyer(p) {
      enVol += 1;
      maxSimultanes = Math.max(maxSimultanes, enVol);
      envois.push(p.exercises[0].sets[0].loadUsed);
      await new Promise((ok) => setTimeout(ok, 10));
      enVol -= 1;
      return { etat: "succes" };
    },
    async relire() {
      return FEEDBACK_SERVEUR;
    },
  };

  // Quatre déclencheurs dans la même seconde : démarrage, `online`,
  // `visibilitychange`, ouverture de la séance.
  const bilans = await Promise.all([
    synchroniser({ depot, userId: A, transport, maintenant: () => T0 }),
    synchroniser({ depot, userId: A, transport, maintenant: () => T0 }),
    synchroniser({ depot, userId: A, transport, maintenant: () => T0 }),
    synchroniser({ depot, userId: A, transport, maintenant: () => T0 }),
  ]);

  assert.equal(envois.length, 1, "le retour est parti plus d'une fois");
  assert.equal(maxSimultanes, 1);
  assert.equal(bilans.filter((b) => b.etat === "deja_en_cours").length, 3);
  assert.equal(flushEnCours(A), false, "le verrou doit être relâché à la fin");
});

await test("Y9. le verrou est relâché même quand le transport explose", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });
  const transport: Transport = {
    async envoyer() {
      throw new Error("boum");
    },
    async relire() {
      return null;
    },
  };
  await assert.rejects(() => synchroniser({ depot, userId: A, transport, maintenant: () => T0 }));
  assert.equal(flushEnCours(A), false);
});

await test("Y10. le compte B ne flushe JAMAIS l'outbox de A", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-a", maintenant: T0,
  });
  const { transport, envois } = transportScripte([{ etat: "succes" }]);
  const bilan = await synchroniser({ depot, userId: B, transport, maintenant: () => T0 });

  assert.equal(bilan.etat, "rien_a_faire");
  assert.deepEqual(envois, []);
  assert.equal((await depot.operationsEnAttente(A)).length, 1, "l'opération de A est toujours là");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. DÉCONNEXION
 * ════════════════════════════════════════════════════════════════════════ */

await test("D1. sans rien en attente : purge complète du compte", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  await depot.ecrireBrouillon({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, payload: {}, maintenant: T0, revision: 1,
  });
  await depot.ecrireTypeAcces(A, "programme_seul", T0);

  const decision = await preparerDeconnexion(depot, A);
  assert.equal(decision.etat, "purge");
  assert.equal(await depot.lireSnapshot(A, DIMANCHE), null);
  assert.equal(await depot.lireBrouillon(A, SEANCE), null);
  assert.equal(await depot.lireTypeAcces(A), null);
});

await test("D2. avec une séance en attente : AUCUNE suppression, et on le dit", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });

  const decision = await preparerDeconnexion(depot, A);
  assert.equal(decision.etat, "en_attente");
  if (decision.etat === "en_attente") {
    assert.equal(decision.operations.length, 1);
    assert.equal(decision.operations[0].sessionId, SEANCE);
    assert.equal(decision.operations[0].businessDate, DIMANCHE, "la date annoncée est celle de la séance");
  }
  // Rien n'a bougé : c'est un constat, pas une suppression différée.
  assert.ok(await depot.lireSnapshot(A, DIMANCHE));
  assert.equal((await depot.operationsEnAttente(A)).length, 1);
});

await test("D3. partir quand même : l'envoi survit, le reste part", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  await depot.ecrireTypeAcces(A, "coaching", T0);
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });

  const bilan = await deconnecterEnConservantLesEnvois(depot, A);
  assert.equal(bilan.operationsConservees, 1);
  assert.equal(await depot.lireSnapshot(A, DIMANCHE), null);
  assert.equal(await depot.lireTypeAcces(A), null);
  assert.equal((await depot.operationsEnAttente(A)).length, 1);
  assert.ok(await depot.lireBrouillon(A, SEANCE), "le brouillon de l'opération en attente doit rester");
});

await test("D4. la déconnexion de A ne touche pas au compte B", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  await depot.ecrireSnapshot({
    userId: B, businessDate: DIMANCHE, sessionId: SEANCE_2, payload: contenuComplet(), maintenant: T0,
  });
  await depot.ecrireTypeAcces(B, "coaching", T0);

  await preparerDeconnexion(depot, A);
  assert.ok(await depot.lireSnapshot(B, DIMANCHE), "le snapshot de B a été emporté par la purge de A");
  assert.equal(await depot.lireTypeAcces(B), "coaching");
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. TROIS SOURCES — ET LE MOCK QUI NE DOIT PLUS APPARAÎTRE
 * ════════════════════════════════════════════════════════════════════════ */

await test("S1. Supabase réellement NON configuré → mock, et c'est le SEUL chemin", () => {
  assert.equal(classerSource(diagnostiquer({ clientDisponible: false, sessionLocale: false })), "mock");
});

await test("S2. vrai compte + réseau ABSENT → offline, jamais mock", () => {
  const diagnostic = diagnostiquer({
    clientDisponible: true,
    sessionLocale: true,
    erreur: new TypeError("Failed to fetch"),
  });
  assert.equal(diagnostic, "reseau_indisponible");
  const source = classerSource(diagnostic);
  assert.equal(source, "offline");
  assert.notEqual(source, "mock");
});

await test("S3. vrai compte SANS fiche élève → état dédié, JAMAIS une séance de démonstration", () => {
  const diagnostic = diagnostiquer({ clientDisponible: true, sessionLocale: true, ficheEleve: false });
  assert.equal(diagnostic, "sans_fiche_eleve");
  const source = classerSource(diagnostic);
  assert.equal(source, "sans_fiche_eleve");
  assert.notEqual(source, "mock", "ce compte est réel : lui montrer une séance inventée lui ferait remplir un entraînement qui n'existe pas");
  assert.equal(afficheDonneesReelles(source), false, "aucune donnée ne doit être présentée dans cet état");
});

await test("S4. 401 / 403 → erreur, jamais offline, jamais mock", () => {
  for (const [statut, attendu] of [[401, "erreur_auth"], [403, "erreur_autorisation"]] as const) {
    const diagnostic = diagnostiquer({
      clientDisponible: true, sessionLocale: true, erreur: { status: statut, message: "refusé" },
    });
    assert.equal(diagnostic, attendu);
    const source = classerSource(diagnostic);
    assert.equal(source, "erreur");
    assert.notEqual(source, "offline", "un refus du serveur n'autorise pas à servir un snapshot ancien");
    assert.notEqual(source, "mock");
  }
  // Le même refus vu depuis PostgREST plutôt que depuis le statut HTTP.
  assert.equal(classerErreur({ code: "PGRST301", message: "JWT expired" }), "auth");
  assert.equal(classerErreur({ code: "42501", message: "new row violates row-level security policy" }), "autorisation");
});

await test("S5. 500 → erreur, jamais offline, jamais mock", () => {
  const diagnostic = diagnostiquer({
    clientDisponible: true, sessionLocale: true, erreur: { status: 500, message: "internal error" },
  });
  assert.equal(diagnostic, "erreur_serveur");
  const source = classerSource(diagnostic);
  assert.equal(source, "erreur");
  assert.notEqual(source, "offline");
  assert.notEqual(source, "mock");
});

await test("S6. erreur INCONNUE → erreur, jamais offline, jamais mock", () => {
  // Le doute ne profite plus au hors-ligne : une erreur illisible est bien
  // plus souvent un bug applicatif qu'une coupure, et la traiter comme une
  // coupure afficherait un snapshot d'hier comme si tout allait bien.
  for (const erreur of [
    new Error("Cannot read properties of undefined"),
    { message: "quelque chose s'est mal passé" },
    {},
    "chaîne nue",
  ]) {
    assert.equal(classerErreur(erreur), "inconnue", JSON.stringify(erreur));
    const source = classerSource(
      diagnostiquer({ clientDisponible: true, sessionLocale: true, erreur }),
    );
    assert.equal(source, "erreur");
    assert.notEqual(source, "offline");
    assert.notEqual(source, "mock");
  }
});

await test("S6b. seuls des signaux de TRANSPORT reconnus basculent hors ligne", () => {
  for (const erreur of [
    new TypeError("Failed to fetch"),
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    { message: "NetworkError when attempting to fetch resource" },
    { message: "Load failed" },
    { message: "net::ERR_INTERNET_DISCONNECTED" },
  ]) {
    assert.equal(classerErreur(erreur), "reseau", JSON.stringify(erreur));
  }
  // Un STATUT HTTP prouve que le serveur a répondu : jamais « réseau »,
  // même si le message parle de fetch.
  assert.equal(classerErreur({ status: 503, message: "failed to fetch upstream" }), "serveur");
});

await test("S6c. sans erreur ET sans réponse : erreur, pas une absence de fiche inventée", () => {
  assert.equal(
    diagnostiquer({ clientDisponible: true, sessionLocale: true, ficheEleve: null }),
    "erreur_inconnue",
  );
});

await test("S6d. non authentifié → écran d'authentification ; mock UNIQUEMENT en démo assumée", () => {
  const diagnostic = diagnostiquer({ clientDisponible: true, sessionLocale: false });
  assert.equal(diagnostic, "non_authentifie");
  assert.equal(classerSource(diagnostic), "non_authentifie");
  assert.equal(classerSource(diagnostic, { environnementDemo: true }), "mock");
});

/* ════════════════════════════════════════════════════════════════════════
 * VII. IDENTITÉ LOCALE — SANS JETON, SANS REQUÊTE
 * ════════════════════════════════════════════════════════════════════════ */

await test("I2. `authUserId` vient de la session locale, et RIEN d'autre n'en sort", () => {
  // Une session telle que `@supabase/ssr` la persiste, jetons compris.
  const session = {
    access_token: "eyJhbGciOi.NE.DOIT.PAS.SORTIR",
    refresh_token: "r-NE-DOIT-PAS-SORTIR",
    expires_at: 1_786_000_000,
    user: { id: A, email: "eleve@example.com" },
  };
  const identite = identiteDepuisSession(session, ELEVE_A);
  assert.deepEqual(identite, { userId: A, studentId: ELEVE_A });
  // La preuve tient en une ligne : l'objet rendu n'a que deux clés.
  assert.deepEqual(Object.keys(identite ?? {}).sort(), ["studentId", "userId"]);
  const serialise = JSON.stringify(identite);
  for (const interdit of ["access_token", "refresh_token", "eyJ", "expires_at", "email"]) {
    assert.equal(serialise.includes(interdit), false, `${interdit} a fuité dans l'identité`);
  }
});

await test("I3. sans session locale fiable : aucune identité, donc aucune donnée privée", () => {
  assert.equal(identiteDepuisSession(null), null);
  assert.equal(identiteDepuisSession({ user: null }), null);
  assert.equal(identiteDepuisSession({ user: { id: "" } }), null);
});

await test("I4. le compte B ne peut pas faire tomber la lecture sur les données de A", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  const identiteB = identiteDepuisSession({ user: { id: B } }, null);

  // Le dépôt ne rend rien à B…
  assert.equal(await depot.lireSnapshot(B, DIMANCHE), null);
  // …et le dernier filet refuse aussi l'enregistrement de A présenté à B.
  const snapshotDeA = { userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet() };
  assert.equal(appartientA(identiteB, snapshotDeA), false);
  assert.equal(appartientA(identiteDepuisSession({ user: { id: A } }), snapshotDeA), true);
  assert.equal(appartientA(null, snapshotDeA), false);
});

/* ════════════════════════════════════════════════════════════════════════
 * VIII. UN SEUL CONSTRUCTEUR DE PAYLOAD
 * ════════════════════════════════════════════════════════════════════════ */

function etatFormulaire(): EtatFormulaireRetour {
  return {
    exerciseFeedback: {
      [EXERCICE]: {
        studentId: ELEVE_A,
        sessionId: SEANCE,
        exerciseId: EXERCICE,
        exerciseName: "Développé couché",
        rpe: null,
        comment: "épaule ok",
        sets: [
          { studentId: ELEVE_A, sessionId: SEANCE, exerciseId: EXERCICE, setNumber: 1, loadUsed: "80", repsDone: "10", rpe: "8" },
          { studentId: ELEVE_A, sessionId: SEANCE, exerciseId: EXERCICE, setNumber: 2, loadUsed: "", repsDone: "", rpe: "" },
        ],
      },
    },
    cardioPayloads: [
      {
        exerciseName: "cardio-results",
        exerciseOrder: 900,
        rpe: 7,
        comment: '{"version":2,"blockId":"b1"}',
        sets: [{ setNumber: 1, loadUsed: "5000", repsDone: "1800" }],
      },
    ],
    substitutions: { [EXERCICE]: { id: REMPLACANT, name: "Développé haltères", videoUrl: "", alternativeVideoUrl: "", muscleGroup: "", equipment: "", level: "" } },
    videosExercice: { [EXERCICE]: null },
    completed: true,
    globalRpe: "8",
    globalComment: "bonne séance",
    painText: "aucune",
    durationMinutes: "65",
  };
}

const CONTEXTE = {
  studentId: ELEVE_A,
  sessionKey: SEANCE,
  sessionRefLabel: "Haut du corps",
  sessionId: SEANCE,
  programId: null,
  performedAt: DIMANCHE,
};

await test("P1. le payload construit est accepté TEL QUEL par le schéma de la route", () => {
  const resultat = construireWorkoutFeedbackPayload(etatFormulaire(), CONTEXTE);
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  const verdict = workoutFeedbackPayloadSchema.safeParse(corpsPourServeur(resultat.payload));
  assert.equal(verdict.success, true, JSON.stringify(verdict.error?.issues ?? [], null, 2));
});

await test("P2. `studentId` ne part JAMAIS au serveur — le schéma est strict", () => {
  const resultat = construireWorkoutFeedbackPayload(etatFormulaire(), CONTEXTE);
  if (!resultat.ok) throw new Error("construction refusée");
  assert.equal(resultat.payload.studentId, ELEVE_A, "le dépôt local, lui, en a besoin");
  const corps = corpsPourServeur(resultat.payload) as Record<string, unknown>;
  assert.equal("studentId" in corps, false);
  // Et la preuve par le schéma : le remettre fait échouer la validation.
  assert.equal(
    workoutFeedbackPayloadSchema.safeParse({ ...corps, studentId: ELEVE_A }).success,
    false,
  );
});

await test("P3. MÊME état de formulaire → payload ONLINE == payload OFFLINE, après aller-retour outbox", async () => {
  const { depot } = neuf();
  const etat = etatFormulaire();

  // Chemin ONLINE : construction puis envoi immédiat.
  const online = construireWorkoutFeedbackPayload(etat, CONTEXTE);
  if (!online.ok) throw new Error(online.erreur);
  const corpsOnline = corpsPourServeur(online.payload);

  // Chemin OFFLINE : même construction, mise en outbox, ressortie six
  // heures plus tard par le synchronisateur.
  const offline = construireWorkoutFeedbackPayload(etat, CONTEXTE);
  if (!offline.ok) throw new Error(offline.erreur);
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: offline.payload, operationId: "op-1", maintenant: T0,
  });
  const enFile = await depot.lireOperation(A, SEANCE);
  assert.ok(enFile);
  const corpsOffline = corpsPourServeur(enFile.payload);

  assert.deepEqual(corpsOffline, corpsOnline, "les deux chemins ont divergé");
  assert.equal(workoutFeedbackPayloadSchema.safeParse(corpsOffline).success, true);
});

await test("P4. `performedAt` et `durationMinutes` traversent l'outbox sans bouger", async () => {
  const { depot } = neuf();
  const resultat = construireWorkoutFeedbackPayload(etatFormulaire(), CONTEXTE);
  if (!resultat.ok) throw new Error(resultat.erreur);
  assert.equal(resultat.payload.performedAt, DIMANCHE);
  assert.equal(resultat.payload.durationMinutes, 65);

  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: resultat.payload, operationId: "op-1", maintenant: T0,
  });
  // Une correction lundi ne déplace pas la séance de dimanche.
  const relu = await depot.lireOperation(A, SEANCE);
  assert.equal(relu?.payload.performedAt, DIMANCHE);
  assert.equal(relu?.payload.durationMinutes, 65);
});

await test("P5. minuit franchi : la date reste celle de la séance ouverte", () => {
  // Dimanche 23h50 : le brouillon est écrit avec businessDate = dimanche.
  // Lundi 00h20 : l'élève valide. `datePourRetour` tranche AVANT la
  // construction, et le payload en hérite.
  const performedAt = datePourRetour({ businessDate: DIMANCHE }, { businessDate: DIMANCHE }, LUNDI);
  const resultat = construireWorkoutFeedbackPayload(etatFormulaire(), { ...CONTEXTE, performedAt });
  if (!resultat.ok) throw new Error(resultat.erreur);
  assert.equal(resultat.payload.performedAt, DIMANCHE, "la séance a changé de jour en franchissant minuit");
});

await test("P6. durée : bornes 1–600, entier, facultative — et refus VISIBLE", () => {
  assert.deepEqual(analyserDuree(""), { ok: true, minutes: null });
  assert.deepEqual(analyserDuree("1"), { ok: true, minutes: 1 });
  assert.deepEqual(analyserDuree("600"), { ok: true, minutes: 600 });
  // Un champ contenant des espaces est un champ VIDE, pas une faute de
  // frappe : le refuser afficherait une erreur à quelqu'un qui n'a rien saisi.
  assert.deepEqual(analyserDuree("   "), { ok: true, minutes: null });
  for (const mauvais of ["0", "601", "-5", "62,5", "62.5", "abc"]) {
    assert.equal(analyserDuree(mauvais).ok, false, `« ${mauvais} » aurait dû être refusé`);
  }
  const refus = construireWorkoutFeedbackPayload(
    { ...etatFormulaire(), durationMinutes: "999" },
    CONTEXTE,
  );
  assert.equal(refus.ok, false);
  if (!refus.ok) assert.match(refus.erreur, /1 et 600/);
});

await test("P7. un RPE de série invalide arrête la construction, sans rien effacer", () => {
  const etat = etatFormulaire();
  etat.exerciseFeedback[EXERCICE].sets[0].rpe = "12";
  const resultat = construireWorkoutFeedbackPayload(etat, CONTEXTE);
  assert.equal(resultat.ok, false);
  if (!resultat.ok) assert.match(resultat.erreur, /RPE invalide \(série 1/);
  // L'état d'origine n'a pas été touché : l'élève retrouve sa saisie.
  assert.equal(etat.exerciseFeedback[EXERCICE].sets[0].loadUsed, "80");
});

await test("P8. seules les séries SAISIES partent ; le cardio reste APRÈS la musculation", () => {
  const resultat = construireWorkoutFeedbackPayload(etatFormulaire(), CONTEXTE);
  if (!resultat.ok) throw new Error(resultat.erreur);
  const muscu = resultat.payload.exercises[0];
  assert.equal(muscu.sets.length, 1, "la série vide ne doit pas être envoyée");
  assert.equal(muscu.sets[0].rpe, 8);
  assert.equal(muscu.substituteExerciseLibraryId, REMPLACANT, "la substitution part par le chemin normal");
  assert.equal(muscu.videoPath, null, "aucune vidéo n'est requise pour enregistrer le reste");
  assert.equal(resultat.payload.exercises[1].exerciseOrder, 900);
});

/* ════════════════════════════════════════════════════════════════════════
 * IX. LE CLIC SUR « ENREGISTRER MON RETOUR »
 * ════════════════════════════════════════════════════════════════════════ */

/** Un moteur dont TOUTE opération échoue — navigation privée, quota, stockage coupé. */
class MoteurIndisponible extends MoteurMemoire {
  private refus(): never {
    throw new ErreurStockage("indisponible", "IndexedDB n'existe pas sur ce navigateur");
  }
  async lire(): Promise<unknown> {
    this.refus();
  }
  async ecrire(): Promise<void> {
    this.refus();
  }
  async supprimer(): Promise<void> {
    this.refus();
  }
  async cles(): Promise<string[]> {
    this.refus();
  }
  async transaction(): Promise<void> {
    this.refus();
  }
}

function payloadDeTest(): WorkoutFeedbackPayload {
  const resultat = construireWorkoutFeedbackPayload(etatFormulaire(), CONTEXTE);
  if (!resultat.ok) throw new Error(resultat.erreur);
  return resultat.payload;
}

await test("Q1. ONLINE + IndexedDB INDISPONIBLE → le POST serveur fonctionne quand même", async () => {
  const depot = new DepotOffline(new MoteurIndisponible());
  const envois: WorkoutFeedbackPayload[] = [];
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, maintenant: () => T0,
    reseau: {
      async envoyer(p) {
        envois.push(p);
        return FEEDBACK_SERVEUR;
      },
    },
  });

  assert.equal(resultat.etat, "envoye", "une panne de stockage local a bloqué le chemin en ligne");
  assert.equal(envois.length, 1, "le retour n'a pas été envoyé au serveur");
  if (resultat.etat === "envoye") {
    assert.equal(resultat.feedback.id, "fb-1");
    assert.equal(
      resultat.cacheLocalIndisponible,
      true,
      "la panne de cache doit être SIGNALÉE, discrètement — mais elle ne bloque rien",
    );
  }
});

await test("Q2. HORS LIGNE + IndexedDB indisponible → AUCUN faux « sauvegardé »", async () => {
  const depot = new DepotOffline(new MoteurIndisponible());
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, reseau: null, maintenant: () => T0,
  });

  assert.equal(resultat.etat, "echec_local");
  assert.notEqual(resultat.etat, "en_attente", "« Synchronisation en attente » serait un mensonge");
});

await test("Q3. HORS LIGNE : commit atomique brouillon + outbox, PUIS seulement l'attente", async () => {
  const { depot } = neuf();
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, reseau: null, maintenant: () => T0,
  });

  assert.equal(resultat.etat, "en_attente");
  if (resultat.etat === "en_attente") assert.equal(resultat.revision, 1);
  const brouillon = await depot.lireBrouillon(A, SEANCE);
  const operation = await depot.lireOperation(A, SEANCE);
  assert.ok(brouillon, "le brouillon manque : la transaction n'était pas atomique");
  assert.ok(operation, "l'opération manque : la transaction n'était pas atomique");
  assert.equal(brouillon?.revision, operation?.revision, "même transaction, donc même révision");
  assert.equal(brouillon?.businessDate, DIMANCHE);
  assert.equal(operation?.payload.performedAt, DIMANCHE);
});

await test("Q4. le POST échoue en ligne → bascule en file d'attente, rien n'est perdu", async () => {
  const { depot } = neuf();
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, maintenant: () => T0,
    reseau: {
      async envoyer() {
        throw new TypeError("Failed to fetch");
      },
    },
  });

  assert.equal(resultat.etat, "en_attente");
  assert.equal((await depot.operationsEnAttente(A)).length, 1);
});

await test("Q5. le serveur reste prioritaire tant qu'il répond : aucune opération en file", async () => {
  const { depot } = neuf();
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, maintenant: () => T0,
    reseau: { async envoyer() { return FEEDBACK_SERVEUR; } },
  });

  assert.equal(resultat.etat, "envoye");
  assert.deepEqual(
    await depot.operationsEnAttente(A),
    [],
    "un envoi réussi ne doit RIEN laisser dans l'outbox",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * X. LE BROUILLON DIFFÉRÉ
 * ════════════════════════════════════════════════════════════════════════ */

/** Minuteur manuel : les tests décident quand le temps passe. */
function minuteurManuel() {
  let suivant = 1;
  const rappels = new Map<number, () => void>();
  const minuteur: Minuteur = {
    programmer(rappel) {
      const jeton = suivant++;
      rappels.set(jeton, rappel);
      return jeton;
    },
    annuler(jeton) {
      rappels.delete(jeton as number);
    },
  };
  return {
    minuteur,
    /** Déclenche tous les différés encore programmés. */
    avancer() {
      const aExecuter = [...rappels.values()];
      rappels.clear();
      for (const rappel of aExecuter) rappel();
    },
    enSuspens: () => rappels.size,
  };
}

await test("S9. le brouillon est restauré au montage — même compte, même séance", async () => {
  const { depot } = neuf();
  await depot.ecrireBrouillon({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    payload: { charge: "82.5", durationMinutes: "65" }, maintenant: T0, revision: 4,
  });

  // « Nouveau montage » : un dépôt neuf sur le même moteur, comme après un
  // kill complet de la PWA.
  const brouillon = await depot.lireBrouillon(A, SEANCE);
  assert.ok(brouillon, "le brouillon n'a pas survécu");
  assert.deepEqual(brouillon?.payload, { charge: "82.5", durationMinutes: "65" });
  assert.equal(brouillon?.revision, 4);
  assert.equal(brouillon?.businessDate, DIMANCHE);

  // Et il n'est restauré ni pour un autre compte, ni pour une autre séance.
  assert.equal(await depot.lireBrouillon(B, SEANCE), null);
  assert.equal(await depot.lireBrouillon(A, SEANCE_2), null);
});

await test("S10. un différé « état A » réveillé APRÈS la validation « état B » ne remplace pas B", async () => {
  const { depot } = neuf();
  const horloge = minuteurManuel();
  const refus: number[] = [];

  const planificateur = creerPlanificateurBrouillon({
    minuteur: horloge.minuteur,
    surRefus: (revision) => refus.push(revision),
    ecrire: (payload, revision) =>
      depot.ecrireBrouillon({
        userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
        payload, maintenant: T0, revision,
      }),
  });

  // L'élève modifie une charge : « état A » est PROGRAMMÉ, pas écrit.
  planificateur.planifier({ charge: "80" });
  assert.equal(planificateur.enAttente(), true);

  // Il valide immédiatement : le différé est abandonné, puis la validation
  // écrit l'état B définitif dans sa propre transaction atomique.
  planificateur.abandonner();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: { ...FORMULAIRE, globalComment: "validation B" },
    payloadServeur: payload("85"), operationId: "op-1", maintenant: T0,
  });

  // Le différé se réveille — il ne doit rien avoir à faire.
  horloge.avancer();
  assert.equal(horloge.enSuspens(), 0);

  const brouillon = await depot.lireBrouillon(A, SEANCE);
  // Le brouillon porte désormais l'état de FORMULAIRE écrit par la
  // validation — pas le payload serveur. Ce qui est vérifié reste le même :
  // le différé « état A » n'a rien remplacé.
  assert.deepEqual(
    brouillon?.payload,
    { ...FORMULAIRE, globalComment: "validation B" },
    "l'état A programmé a écrasé la validation B",
  );
  assert.equal(refus.length, 0, "rien n'aurait dû être tenté après l'abandon");
});

await test("S10b. SECOND FILET : même en échappant à l'abandon, l'ancien état est REFUSÉ", async () => {
  // On force le pire cas : un rappel déjà parti, que plus personne ne peut
  // annuler. La garde de révision du dépôt doit tenir seule.
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("85"), operationId: "op-1", maintenant: T0,
  });
  const apresValidation = await depot.lireBrouillon(A, SEANCE);
  assert.ok(apresValidation);

  const accepte = await depot.ecrireBrouillon({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    payload: { charge: "80" }, maintenant: T0 + 1,
    revision: apresValidation.revision, // révision d'un état antérieur
  });
  assert.equal(accepte, false, "une révision inférieure ou égale doit être refusée");
  assert.deepEqual(
    (await depot.lireBrouillon(A, SEANCE))?.payload,
    FORMULAIRE,
    "l'ancien état a été accepté malgré une révision non supérieure",
  );
});

await test("S10c. `viderMaintenant` écrit la dernière frappe et vide la file", async () => {
  const { depot } = neuf();
  const horloge = minuteurManuel();
  const planificateur = creerPlanificateurBrouillon({
    minuteur: horloge.minuteur,
    ecrire: (payload, revision) =>
      depot.ecrireBrouillon({
        userId: A, sessionId: SEANCE, businessDate: DIMANCHE, payload, maintenant: T0, revision,
      }),
  });

  planificateur.planifier({ charge: "80" });
  planificateur.planifier({ charge: "82.5" }); // remplace le différé précédent
  assert.equal(await planificateur.viderMaintenant(), true);
  assert.equal(planificateur.enAttente(), false);
  assert.equal(horloge.enSuspens(), 0);
  assert.deepEqual((await depot.lireBrouillon(A, SEANCE))?.payload, { charge: "82.5" });
  assert.equal(await planificateur.viderMaintenant(), false, "plus rien n'attend");
});

await test("S12. `durationMinutes` = 65 → kill → restauration → toujours 65", async () => {
  const { moteur } = neuf();
  const depot1 = new DepotOffline(moteur);
  const etat = { ...etatFormulaire(), durationMinutes: "65" };
  await depot1.ecrireBrouillon({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    payload: { durationMinutes: etat.durationMinutes }, maintenant: T0, revision: 1,
  });

  // Kill complet : nouveau dépôt, même stockage.
  const depot2 = new DepotOffline(moteur);
  const restaure = await depot2.lireBrouillon(A, SEANCE);
  const dureeRestauree = (restaure?.payload as { durationMinutes: string }).durationMinutes;
  assert.equal(dureeRestauree, "65");

  // Et elle traverse la construction du payload sans bouger.
  const resultat = construireWorkoutFeedbackPayload(
    { ...etatFormulaire(), durationMinutes: dureeRestauree },
    CONTEXTE,
  );
  if (!resultat.ok) throw new Error(resultat.erreur);
  assert.equal(resultat.payload.durationMinutes, 65);
});

/* ════════════════════════════════════════════════════════════════════════
 * XI. VIDÉOS — RIEN DE NEUF NE NAÎT HORS LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

await test("S16. hors ligne, un `videoPath` inconnu est écarté — et le reste est enregistré", () => {
  const etat = etatFormulaire();
  etat.videosExercice = { [EXERCICE]: "eleve-a/seance/nouvelle-video.mp4" };

  const resultat = construireWorkoutFeedbackPayload(etat, {
    ...CONTEXTE,
    horsLigne: true,
    cheminsVideoConnus: [],
  });
  assert.equal(resultat.ok, true);
  if (!resultat.ok) return;
  assert.equal(
    resultat.payload.exercises[0].videoPath,
    null,
    "un chemin fabriqué hors ligne ne désigne aucun fichier : il ne doit pas partir",
  );
  assert.deepEqual(resultat.videosIgnorees, ["eleve-a/seance/nouvelle-video.mp4"]);
  // Le reste du retour est intact : une vidéo n'empêche jamais d'enregistrer.
  assert.equal(resultat.payload.exercises[0].sets[0].loadUsed, "80");
  assert.equal(resultat.payload.durationMinutes, 65);
  assert.equal(workoutFeedbackPayloadSchema.safeParse(corpsPourServeur(resultat.payload)).success, true);
});

await test("S16b. un `videoPath` DÉJÀ enregistré est reconduit, hors ligne comme en ligne", () => {
  const connu = "eleve-a/seance/deja-deposee.mp4";
  const etat = etatFormulaire();
  etat.videosExercice = { [EXERCICE]: connu };

  const horsLigne = construireWorkoutFeedbackPayload(etat, {
    ...CONTEXTE, horsLigne: true, cheminsVideoConnus: [connu],
  });
  const enLigne = construireWorkoutFeedbackPayload(etat, CONTEXTE);
  if (!horsLigne.ok || !enLigne.ok) throw new Error("construction refusée");

  // Ne pas le renvoyer rendrait le fichier orphelin : la re-soumission
  // REMPLACE les lignes d'exercice.
  assert.equal(horsLigne.payload.exercises[0].videoPath, connu);
  assert.deepEqual(horsLigne.videosIgnorees, []);
  assert.deepEqual(corpsPourServeur(horsLigne.payload), corpsPourServeur(enLigne.payload));
});

/* ════════════════════════════════════════════════════════════════════════
 * XII. IDENTITÉ — AUCUN REPLI SUR « LE DERNIER COMPTE CONNU »
 * ════════════════════════════════════════════════════════════════════════ */

await test("S7. hors ligne SANS session locale : aucune donnée privée, aucun repli", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-1", maintenant: T0,
  });

  // Aucune session exploitable → aucune identité → rien à lire.
  const identite = identiteDepuisSession(null);
  assert.equal(identite, null);
  assert.equal(peutLire(identite), false);
  assert.equal(appartientA(identite, { userId: A }), false);

  // Et le dépôt n'offre AUCUN moyen de retrouver « le dernier compte
  // connu » : toutes ses lectures exigent un identifiant.
  const lectures = Object.getOwnPropertyNames(Object.getPrototypeOf(depot));
  for (const nom of lectures) {
    if (!nom.startsWith("lire") && !nom.startsWith("operations")) continue;
    assert.ok(
      depot[nom as keyof typeof depot] instanceof Function,
      `${nom} devrait être une méthode`,
    );
    assert.ok(
      (depot[nom as keyof typeof depot] as (...args: unknown[]) => unknown).length >= 1,
      `${nom} accepte zéro argument : il existerait donc une lecture sans identifiant de compte`,
    );
  }
});

await test("S8. snapshot de A + session de B → aucune donnée de A", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });
  const identiteB = identiteDepuisSession({ user: { id: B } });
  assert.ok(identiteB);

  assert.equal(await depot.lireSnapshot(identiteB.userId, DIMANCHE), null);
  assert.equal(await depot.lireBrouillon(identiteB.userId, SEANCE), null);
  assert.deepEqual(await depot.operationsEnAttente(identiteB.userId), []);
  const lecture = lireSnapshotPourSeance(
    { userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet() },
    { userId: identiteB.userId, sessionId: SEANCE, aujourdhui: DIMANCHE },
  );
  assert.equal(lecture.etat, "autre_compte");
  assert.equal(lecture.contenu, null);
});

/* ════════════════════════════════════════════════════════════════════════
 * XIII. `performedAt` — SÉCURITÉ SUPPLÉMENTAIRE
 * ════════════════════════════════════════════════════════════════════════ */

await test("S-perf. snapshot/brouillon présents → `performedAt` n'est JAMAIS recalculé au flush", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: DIMANCHE, sessionId: SEANCE, payload: contenuComplet(), maintenant: T0,
  });

  // Le brouillon et le snapshot existent : la date est connue, et c'est
  // dimanche. Le flush a lieu lundi.
  const performedAt = datePourRetour({ businessDate: DIMANCHE }, { businessDate: DIMANCHE }, LUNDI);
  const construit = construireWorkoutFeedbackPayload(etatFormulaire(), { ...CONTEXTE, performedAt });
  if (!construit.ok) throw new Error(construit.erreur);
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: construit.payload, operationId: "op-1", maintenant: T0,
  });

  const envois: WorkoutFeedbackPayload[] = [];
  await synchroniser({
    depot, userId: A, maintenant: () => T0 + 86_400_000,
    transport: {
      async envoyer(p) { envois.push(p); return { etat: "succes" }; },
      async relire() { return FEEDBACK_SERVEUR; },
    },
  });

  assert.equal(envois.length, 1);
  assert.equal(
    envois[0].performedAt,
    DIMANCHE,
    "le flush du lundi a réattribué la séance au lundi",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * XIV. PRIORITÉ SERVEUR / BROUILLON / EN ATTENTE
 * ════════════════════════════════════════════════════════════════════════ */

const BROUILLON = { revision: 3, payload: { globalComment: "saisie locale" } };
const SERVEUR = { ...FEEDBACK_SERVEUR, comment: "version serveur" } as AdminStudentFeedback;

await test("R1. HORS LIGNE + snapshot + brouillon → le BROUILLON gagne", () => {
  const decision = choisirOrigineFormulaire({
    horsLigne: true, brouillon: BROUILLON, operationEnAttente: null, feedbackServeur: SERVEUR,
  });
  assert.equal(decision.origine, "brouillon");
  assert.deepEqual(decision.payload, BROUILLON.payload);
});

await test("R2. EN LIGNE + opération EN ATTENTE → le brouillon reste visible", () => {
  // Le serveur ne connaît, au mieux, que la révision précédente : afficher
  // sa version ferait disparaître une correction qui attend de partir.
  const decision = choisirOrigineFormulaire({
    horsLigne: false, brouillon: BROUILLON,
    operationEnAttente: { revision: 3 }, feedbackServeur: SERVEUR,
  });
  assert.equal(decision.origine, "brouillon");
  assert.deepEqual(decision.payload, BROUILLON.payload);
});

await test("R3. EN LIGNE + AUCUN pending + serveur frais → un vieux brouillon n'écrase RIEN", () => {
  const decision = choisirOrigineFormulaire({
    horsLigne: false, brouillon: BROUILLON, operationEnAttente: null, feedbackServeur: SERVEUR,
  });
  assert.equal(decision.origine, "serveur");
  assert.equal(decision.payload, null, "aucun payload local ne doit être injecté");
});

await test("R3b. aucun retour serveur : le brouillon est la seule source, il n'écrase personne", () => {
  assert.equal(
    choisirOrigineFormulaire({
      horsLigne: false, brouillon: BROUILLON, operationEnAttente: null, feedbackServeur: null,
    }).origine,
    "brouillon",
  );
  assert.equal(
    choisirOrigineFormulaire({
      horsLigne: false, brouillon: null, operationEnAttente: null, feedbackServeur: null,
    }).origine,
    "vierge",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * XV. SOUMISSION — CE QUI EST TENTÉ, ET CE QUI NE L'EST PAS
 * ════════════════════════════════════════════════════════════════════════ */

await test("R10. submit HORS LIGNE : AUCUNE tentative de POST", async () => {
  const { depot } = neuf();
  // Un transport qui LÈVERAIT s'il était appelé : la preuve est que le
  // scénario passe, donc qu'il ne l'a jamais été.
  const transportInterdit = {
    envoyer(): never {
      throw new Error("aucun POST ne doit être tenté hors ligne");
    },
  };
  void transportInterdit;
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, maintenant: () => T0,
    // `reseau: null` est ce que le composant passe quand la source est
    // `offline` : il n'y a même pas de transport à appeler.
    reseau: null,
  });
  assert.equal(resultat.etat, "en_attente");
  assert.equal((await depot.operationsEnAttente(A)).length, 1);
});

await test("R14. POST réussi + purge locale en échec → le succès serveur est CONSERVÉ", async () => {
  const depot = new DepotOffline(new MoteurIndisponible());
  const resultat = await soumettreRetour({
    payload: payloadDeTest(), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE, operationId: "op-1",
    depot, maintenant: () => T0,
    reseau: { async envoyer() { return FEEDBACK_SERVEUR; } },
  });
  assert.equal(resultat.etat, "envoye", "une purge locale impossible a été transformée en erreur");
  if (resultat.etat === "envoye") assert.equal(resultat.cacheLocalIndisponible, true);
});

await test("R17. feedback existant modifié HORS LIGNE → nouvelle révision en attente, même operationId", async () => {
  const { depot } = neuf();
  // Un premier retour a déjà été validé hors ligne.
  const premier = await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    etatFormulaire: FORMULAIRE, payloadServeur: payload("80"), operationId: "op-origine", maintenant: T0,
  });
  // L'élève corrige.
  const second = await soumettreRetour({
    payload: payload("85"), etatFormulaire: FORMULAIRE,
    userId: A, sessionId: SEANCE, businessDate: DIMANCHE,
    operationId: "op-ignore", reseau: null, depot, maintenant: () => T0 + 10,
  });

  assert.equal(second.etat, "en_attente");
  if (second.etat === "en_attente") {
    assert.equal(second.revision, premier.revision + 1, "la révision doit progresser");
  }
  const enFile = await depot.operationsEnAttente(A);
  assert.equal(enFile.length, 1, "une séance n'a jamais plus d'UNE opération en attente");
  assert.equal(enFile[0].operationId, "op-origine", "même retour, donc même identifiant d'idempotence");
  assert.equal(enFile[0].payload.exercises[0].sets[0].loadUsed, "85");
});

await test("R18. source `erreur` : ni mock, ni mise en file hors ligne", () => {
  for (const erreur of [{ status: 500 }, { status: 403 }, new Error("bug applicatif")]) {
    const source = classerSource(diagnostiquer({ clientDisponible: true, sessionLocale: true, erreur }));
    assert.equal(source, "erreur");
    assert.equal(autoriseSoumissionHorsLigne(source), false, "programmer la répétition d'un refus");
    assert.equal(afficheDonneesReelles(source), false);
  }
  // Seule `offline` autorise la file d'attente.
  assert.equal(autoriseSoumissionHorsLigne("offline"), true);
  assert.equal(autoriseSoumissionHorsLigne("mock"), false);
  assert.equal(autoriseSoumissionHorsLigne("supabase"), false);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
