// Fuseau figé pour les tests de date : sans lui, ils passeraient ou non
// selon la machine, ce qui est la définition d'un test inutile.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";

import { DepotOffline, MoteurMemoire } from "../../lib/offline/depot";
import { SCHEMA_VERSION, cleOutbox, estTypeAcces } from "../../lib/offline/schema";
import { dateMetier, seanceReellementDuJour, snapshotEstDuJour } from "../../lib/offline/seance-du-jour";
import type { WorkoutFeedbackPayload } from "../../types";

/**
 * HORS LIGNE — LE DÉPÔT LOCAL, EXÉCUTÉ.
 *
 *   npm run test:offline-depot
 *
 * Ces tests font TOURNER `DepotOffline` sur un moteur en mémoire et
 * observent ce qui est réellement écrit et relu. Ce qu'ils protègent, dans
 * l'ordre :
 *
 *   1. deux comptes sur le même téléphone ne se croisent JAMAIS ;
 *   2. aucun jeton n'atterrit dans le stockage local ;
 *   3. une séance d'hier n'est jamais présentée comme celle d'aujourd'hui ;
 *   4. une saisie non synchronisée ne disparaît jamais en silence ;
 *   5. une séance n'a jamais plus d'une opération en attente.
 */

const A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const B = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const SEANCE_1 = "33333333-3333-4333-8333-111111111111";
const SEANCE_2 = "44444444-4444-4444-8444-222222222222";
const T0 = 1_786_000_000_000;

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

function payload(sessionKey: string, charge: string): WorkoutFeedbackPayload {
  return {
    studentId: "",
    sessionKey,
    sessionRefLabel: "Haut du corps",
    completed: true,
    globalRpe: 8,
    globalComment: "",
    pain: "",
    exercises: [
      {
        exerciseName: "Développé couché",
        exerciseOrder: 0,
        rpe: 8,
        comment: "",
        sets: [{ setNumber: 1, loadUsed: charge, repsDone: "10" }],
      },
    ],
    sessionId: SEANCE_1,
    durationMinutes: 62,
    performedAt: "2026-08-09",
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * I. DEUX COMPTES SUR LE MÊME TÉLÉPHONE
 * ════════════════════════════════════════════════════════════════════════ */

await test("D1. le compte B ne lit RIEN de ce que le compte A a écrit", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: "2026-08-09", sessionId: SEANCE_1, payload: { secret: "séance de A" }, maintenant: T0,
  });
  await depot.ecrireBrouillon({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { charge: "80" }, maintenant: T0, revision: 1 });
  await depot.deposerOperation({
    userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-a", maintenant: T0, revision: 1 });
  await depot.ecrireTypeAcces(A, "programme_seul", T0);

  assert.equal(await depot.lireSnapshot(B, "2026-08-09"), null);
  assert.equal(await depot.lireBrouillon(B, SEANCE_1), null);
  assert.equal(await depot.lireOperation(B, SEANCE_1), null);
  assert.deepEqual(await depot.operationsEnAttente(B), []);
  assert.equal(await depot.lireTypeAcces(B), null, "le type d'accès de A ne doit jamais servir à B");
});

await test("D2. une clé qui COMMENCE par l'identifiant d'un autre ne suffit pas", async () => {
  // Défense de second rang : même si une clé était un jour fabriquée
  // ailleurs, le contenu est revérifié à chaque lecture.
  const { moteur, depot } = neuf();
  await moteur.ecrire("training_draft", cleOutbox(B, SEANCE_1), {
    schemaVersion: SCHEMA_VERSION,
    userId: A, // clé de B, contenu de A
    sessionId: SEANCE_1,
    businessDate: "2026-08-09",
    payload: { charge: "80" },
    updatedAt: T0,
    syncStatus: "brouillon",
  });
  assert.equal(await depot.lireBrouillon(B, SEANCE_1), null);
});

await test("D3. la purge de A ne touche pas à B", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({ userId: A, businessDate: "2026-08-09", sessionId: SEANCE_1, payload: {}, maintenant: T0 });
  await depot.ecrireSnapshot({ userId: B, businessDate: "2026-08-09", sessionId: SEANCE_2, payload: {}, maintenant: T0 });
  await depot.purgerTout(A);
  assert.equal(await depot.lireSnapshot(A, "2026-08-09"), null);
  assert.ok(await depot.lireSnapshot(B, "2026-08-09"), "le snapshot de B doit survivre");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. AUCUN JETON DANS LE STOCKAGE LOCAL
 * ════════════════════════════════════════════════════════════════════════ */

await test("D4. RIEN QUI RESSEMBLE À UN JETON n'est jamais écrit", async () => {
  const { moteur, depot } = neuf();
  await depot.ecrireSnapshot({
    userId: A, businessDate: "2026-08-09", sessionId: SEANCE_1, payload: { exercices: ["Développé couché"] }, maintenant: T0,
  });
  await depot.ecrireBrouillon({ userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { charge: "80" }, maintenant: T0, revision: 1 });
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-a", maintenant: T0 , revision: 1});
  await depot.ecrireTypeAcces(A, "coaching", T0);

  const tout = JSON.stringify(moteur.toutPourInspection());
  for (const [motif, quoi] of [
    [/eyJ[A-Za-z0-9_-]{10,}/, "un JWT"],
    [/access_token|refresh_token|Bearer /i, "un jeton"],
    [/sb-[a-z0-9]+-auth-token/i, "un cookie de session Supabase"],
  ] as [RegExp, string][]) {
    assert.ok(!motif.test(tout), `${quoi} dans le stockage local`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. JAMAIS LA SÉANCE D'HIER
 * ════════════════════════════════════════════════════════════════════════ */

await test("D5. `dateMetier` suit l'heure LOCALE, jamais UTC", () => {
  // 23 h 30 heure locale : `toISOString()` donnerait le lendemain pour un
  // élève en France, et lui présenterait la séance du jour suivant.
  const tard = new Date(2026, 7, 9, 23, 30, 0);
  assert.equal(dateMetier(tard), "2026-08-09");
  assert.equal(dateMetier(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

await test("D5bis. minuit, 23 h 30, et le passage à l'heure d'été", () => {
  // Le jour LOCAL et le jour UTC divergent une partie de chaque journée, et
  // dans les deux sens selon le méridien. Ces quatre bornes le vérifient sur
  // les moments où l'écart existe vraiment.
  assert.equal(dateMetier(new Date(2026, 7, 9, 0, 30)), "2026-08-09", "00 h 30 : encore la veille en UTC (été, +2)");
  assert.equal(dateMetier(new Date(2026, 7, 9, 23, 30)), "2026-08-09", "23 h 30 : toujours le 9 en local");
  assert.equal(dateMetier(new Date(2026, 7, 9, 23, 59, 59)), "2026-08-09");
  assert.equal(dateMetier(new Date(2026, 7, 10, 0, 0, 0)), "2026-08-10", "le changement de jour est net");

  // Passage à l'heure d'été : 2 h 00 devient 3 h 00 dans la nuit du 29 mars
  // 2026. La date ne doit pas sauter — c'est la même journée des deux côtés.
  assert.equal(dateMetier(new Date(2026, 2, 29, 1, 30)), "2026-03-29");
  assert.equal(dateMetier(new Date(2026, 2, 29, 4, 30)), "2026-03-29");
  // Retour à l'heure d'hiver, nuit du 25 octobre : 3 h 00 redevient 2 h 00,
  // la journée dure 25 heures et garde une seule date.
  assert.equal(dateMetier(new Date(2026, 9, 25, 1, 30)), "2026-10-25");
  assert.equal(dateMetier(new Date(2026, 9, 25, 23, 30)), "2026-10-25");
});

await test("D5ter. la date métier suit `currentDate()`, pas UTC", () => {
  // La comparaison qui compte : ce que `toISOString()` aurait donné.
  const minuitTrente = new Date(2026, 7, 9, 0, 30);
  assert.notEqual(
    dateMetier(minuitTrente),
    minuitTrente.toISOString().slice(0, 10),
    "en heure d'été française, 00 h 30 local est encore le 8 en UTC — c'est exactement le piège",
  );
});

await test("D6. AUCUN REPLI : pas de séance aujourd'hui = pas de séance du jour", () => {
  // C'est toute la différence avec `getHighlightedScheduleDay`, qui rendrait
  // ici la séance du lundi.
  const planning = [
    { isToday: false, sessionId: SEANCE_1 },
    { isToday: true, sessionId: null },
    { isToday: false, sessionId: SEANCE_2 },
  ];
  assert.equal(seanceReellementDuJour(planning), null);
  assert.equal(seanceReellementDuJour([{ isToday: true, sessionId: SEANCE_2 }]), SEANCE_2);
  assert.equal(seanceReellementDuJour([]), null);
});

await test("D7. au passage de minuit, le snapshot d'hier n'est plus celui du jour", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({ userId: A, businessDate: "2026-08-09", sessionId: SEANCE_1, payload: {}, maintenant: T0 });
  const hier = await depot.lireSnapshot(A, "2026-08-09");

  assert.equal(snapshotEstDuJour(hier, "2026-08-09"), true);
  assert.equal(snapshotEstDuJour(hier, "2026-08-10"), false, "jamais présenté comme la séance de mardi");
  // Il n'est pas supprimé pour autant : une opération en attente peut encore
  // s'y rattacher.
  assert.ok(await depot.lireSnapshot(A, "2026-08-09"));
});

await test("D8. la date de la SÉANCE ne bouge plus, même saisie le lendemain", async () => {
  // Une séance du lundi soir synchronisée mardi matin reste une séance du
  // lundi. Recalculer cette date à l'envoi la décalerait d'un jour.
  const { depot } = neuf();
  await depot.ecrireBrouillon({ userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { v: 1 }, maintenant: T0, revision: 1 });
  await depot.ecrireBrouillon({ userId: A, sessionId: SEANCE_1, businessDate: "2026-08-10", payload: { v: 2 }, maintenant: T0 + 60_000, revision: 2 });
  const brouillon = await depot.lireBrouillon(A, SEANCE_1);
  assert.equal(brouillon!.businessDate, "2026-08-09");
  assert.deepEqual(brouillon!.payload, { v: 2 }, "la saisie, elle, est bien à jour");
  assert.equal(brouillon!.revision, 2);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. UNE SEULE OPÉRATION PAR SÉANCE
 * ════════════════════════════════════════════════════════════════════════ */

await test("D9. trois corrections ne font pas trois envois", async () => {
  const { depot } = neuf();
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "85"), operationId: "op-2", maintenant: T0 + 1000 , revision: 1});
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "90"), operationId: "op-3", maintenant: T0 + 2000 , revision: 1});

  const enAttente = await depot.operationsEnAttente(A);
  assert.equal(enAttente.length, 1, "une séance, une opération");
  assert.equal(enAttente[0].payload.exercises[0].sets[0].loadUsed, "90", "et c'est le DERNIER état");
  assert.equal(enAttente[0].operationId, "op-1", "même retour, donc même identifiant d'opération");
  assert.equal(enAttente[0].createdAt, T0, "la date de création ne redémarre pas");
});

await test("D10. deux séances différentes gardent chacune la sienne", async () => {
  const { depot } = neuf();
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_2, payload: payload("s2", "60"), operationId: "op-2", maintenant: T0 + 1000 , revision: 1});
  const enAttente = await depot.operationsEnAttente(A);
  assert.equal(enAttente.length, 2);
  assert.deepEqual(enAttente.map((o) => o.sessionId), [SEANCE_1, SEANCE_2], "la plus ancienne d'abord");
});

await test("D11. un échec CONSERVE l'opération et dit pourquoi", async () => {
  const { depot } = neuf();
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});
  await depot.marquerEchec(A, SEANCE_1, "401 session expirée", T0 + 5000);
  await depot.marquerEchec(A, SEANCE_1, "réseau injoignable", T0 + 9000);

  const operation = await depot.lireOperation(A, SEANCE_1);
  assert.equal(operation!.attempts, 2);
  assert.equal(operation!.lastError, "réseau injoignable");
  assert.equal(operation!.lastAttemptAt, T0 + 9000);
  assert.deepEqual(operation!.payload, payload("s1", "80"), "le retour est intact");
});

await test("D12. une correction après échec n'efface ni le compteur ni l'historique", async () => {
  const { depot } = neuf();
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});
  await depot.marquerEchec(A, SEANCE_1, "500", T0 + 1000);
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "85"), operationId: "op-9", maintenant: T0 + 2000 , revision: 1});
  const operation = await depot.lireOperation(A, SEANCE_1);
  assert.equal(operation!.attempts, 1, "on ne repart pas de zéro : c'est le même retour");
  assert.equal(operation!.payload.exercises[0].sets[0].loadUsed, "85");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. RIEN NE DISPARAÎT EN SILENCE
 * ════════════════════════════════════════════════════════════════════════ */

await test("D13. la purge de déconnexion CONSERVE une opération en attente", async () => {
  const { depot } = neuf();
  await depot.ecrireSnapshot({ userId: A, businessDate: "2026-08-09", sessionId: SEANCE_1, payload: {}, maintenant: T0 });
  await depot.ecrireBrouillon({ userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { charge: "80" }, maintenant: T0, revision: 1 });
  await depot.ecrireBrouillon({ userId: A, sessionId: SEANCE_2, businessDate: "2026-08-08", payload: { charge: "60" }, maintenant: T0, revision: 1 });
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});

  const bilan = await depot.purgerSaufEnAttente(A);
  assert.equal(bilan.operationsConservees, 1);
  assert.ok(await depot.lireOperation(A, SEANCE_1), "le retour non envoyé doit survivre");
  assert.ok(await depot.lireBrouillon(A, SEANCE_1), "et sa saisie avec lui");
  assert.equal(await depot.lireBrouillon(A, SEANCE_2), null, "le brouillon sans envoi en attente part");
  assert.equal(await depot.lireSnapshot(A, "2026-08-09"), null);
});

await test("D14. `purgerTout` n'efface qu'après décision explicite", async () => {
  const { depot } = neuf();
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});
  await depot.ecrireTypeAcces(A, "coaching", T0);
  await depot.purgerTout(A);
  assert.deepEqual(await depot.operationsEnAttente(A), []);
  assert.equal(await depot.lireTypeAcces(A), null);
});

await test("D15. on n'acquitte que ce qui a été confirmé", async () => {
  const { depot } = neuf();
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_1, payload: payload("s1", "80"), operationId: "op-1", maintenant: T0 , revision: 1});
  await depot.deposerOperation({ userId: A, sessionId: SEANCE_2, payload: payload("s2", "60"), operationId: "op-2", maintenant: T0 , revision: 1});
  await depot.acquitter(A, SEANCE_1);
  const restantes = await depot.operationsEnAttente(A);
  assert.deepEqual(restantes.map((o) => o.sessionId), [SEANCE_2]);
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. VERSION DU SCHÉMA
 * ════════════════════════════════════════════════════════════════════════ */

await test("D16. un enregistrement d'une AUTRE version est ignoré, jamais rendu à moitié", async () => {
  const { moteur, depot } = neuf();
  await moteur.ecrire("training_snapshot", `${A}:2026-08-09`, {
    schemaVersion: SCHEMA_VERSION + 1,
    userId: A,
    businessDate: "2026-08-09",
    sessionId: SEANCE_1,
    payload: { forme: "inconnue" },
    syncedAt: T0,
  });
  assert.equal(await depot.lireSnapshot(A, "2026-08-09"), null);
});

await test("D17. un enregistrement corrompu ne fait pas planter la lecture", async () => {
  const { moteur, depot } = neuf();
  for (const valeur of [null, "texte", 42, {}, { schemaVersion: SCHEMA_VERSION }]) {
    await moteur.ecrire("training_draft", `${A}:${SEANCE_1}`, valeur);
    assert.equal(await depot.lireBrouillon(A, SEANCE_1), null);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * VII. LE TYPE D'ACCÈS — AFFICHAGE, ET RIEN D'AUTRE
 * ════════════════════════════════════════════════════════════════════════ */

await test("D18. le type d'accès mémorisé se relit tel quel", async () => {
  const { depot } = neuf();
  await depot.ecrireTypeAcces(A, "programme_seul", T0);
  assert.equal(await depot.lireTypeAcces(A), "programme_seul");
  await depot.ecrireTypeAcces(A, "coaching", T0 + 1000);
  assert.equal(await depot.lireTypeAcces(A), "coaching", "une synchronisation en ligne met à jour");
});

await test("D19. une valeur INVENTÉE est refusée, à l'écriture comme à la lecture", async () => {
  // Cette valeur vit sur le disque d'un téléphone : elle est modifiable par
  // qui le possède. On n'accepte que les deux types existants — et jamais
  // pour décider d'un accès, seulement pour dessiner un menu.
  const { moteur, depot } = neuf();
  await depot.ecrireTypeAcces(A, "administrateur" as never, T0);
  assert.equal(await depot.lireTypeAcces(A), null, "écriture refusée");

  await moteur.ecrire("display_prefs", A, {
    schemaVersion: SCHEMA_VERSION, userId: A, accessType: "super_admin", updatedAt: T0,
  });
  assert.equal(await depot.lireTypeAcces(A), null, "lecture refusée");
  assert.equal(estTypeAcces("coaching"), true);
  assert.equal(estTypeAcces("programme_seul"), true);
  assert.equal(estTypeAcces("autre"), false);
});

await test("D20. absent = `null`, jamais un défaut inventé", async () => {
  // L'appelant retombe alors sur le comportement actuel du hook plutôt que
  // sur une valeur fabriquée ici.
  const { depot } = neuf();
  assert.equal(await depot.lireTypeAcces(A), null);
});

/* ════════════════════════════════════════════════════════════════════════
 * VIII. ATOMICITÉ ET COURSES
 * ════════════════════════════════════════════════════════════════════════ */

/** Moteur qui fait échouer la Nième écriture d'un magasin donné. */
class MoteurCassant extends MoteurMemoire {
  constructor(private readonly magasinFautif: string, private readonly message: string) {
    super();
  }
  override async ecrire(magasin: never, cle: string, valeur: unknown): Promise<void> {
    if (magasin === this.magasinFautif) {
      throw new Error(this.message);
    }
    return super.ecrire(magasin, cle, valeur);
  }
}

await test("A32. brouillon écrit, file d'attente en échec : RIEN ne survit", async () => {
  // L'entre-deux redouté : un retour enregistré localement qui ne partira
  // jamais. Il n'existe aucune façon de le rattraper au redémarrage — rien
  // ne le distingue d'un brouillon en cours de saisie.
  const moteur = new MoteurCassant("training_outbox", "quota dépassé");
  const depot = new DepotOffline(moteur);
  await depot.ecrireBrouillon({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { v: "avant" }, maintenant: T0, revision: 1,
  });

  await assert.rejects(() =>
    depot.validerRetourHorsLigne({
      userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
      etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "100"), operationId: "op-1", maintenant: T0 + 1000,
    }),
  );

  const brouillon = await depot.lireBrouillon(A, SEANCE_1);
  assert.deepEqual(brouillon!.payload, { v: "avant" }, "le brouillon d'avant doit être restauré");
  assert.equal(brouillon!.revision, 1);
  assert.equal(await depot.lireOperation(A, SEANCE_1), null, "aucune file d'attente ne doit exister");
});

await test("A33. transaction réussie : DEUX FORMES, une seule révision", async () => {
  /*
   * L'invariant a changé le 09/08/2026, et c'est une correction de fond.
   *
   * Avant : « le brouillon et la file portent le même payload ». L'égalité
   * paraissait rassurante ; elle mettait en réalité un payload SERVEUR dans
   * le magasin que l'ÉCRAN relit, et l'écran tombait en essayant d'hydrater
   * un formulaire avec des nombres normalisés.
   *
   * Désormais chaque magasin porte SA forme, et ce qui les lie est la
   * révision — plus le contenu.
   */
  const { depot } = neuf();
  const formulaire = { globalRpe: "8", durationMinutes: "65", completed: true };
  const serveur = payload("s1", "100");

  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: formulaire, payloadServeur: serveur, operationId: "op-1", maintenant: T0,
  });

  const brouillon = await depot.lireBrouillon(A, SEANCE_1);
  const operation = await depot.lireOperation(A, SEANCE_1);

  // Les DEUX ont été écrits — l'atomicité elle-même reste vérifiée par A32.
  assert.ok(brouillon, "le brouillon manque");
  assert.ok(operation, "l'opération manque");

  // ── CE QUI LES LIE ────────────────────────────────────────────────
  assert.equal(brouillon!.revision, operation!.revision, "même révision des deux côtés");
  assert.equal(brouillon!.userId, operation!.userId);
  assert.equal(brouillon!.sessionId, operation!.sessionId);
  assert.equal(brouillon!.businessDate, "2026-08-09");
  assert.equal(operation!.payload.performedAt, "2026-08-09", "la date de séance est figée dans la file");
  assert.equal(brouillon!.syncStatus, "en_attente");

  // ── CE QUI LES DISTINGUE ──────────────────────────────────────────
  assert.deepEqual(brouillon!.payload, formulaire, "le brouillon doit porter la forme FORMULAIRE");
  assert.deepEqual(operation!.payload, serveur, "la file doit porter la forme SERVEUR");
  assert.notDeepEqual(
    brouillon!.payload,
    operation!.payload,
    "confondre les deux formes est exactement le défaut corrigé",
  );

  // Et les types le disent : chaînes de saisie d'un côté, valeurs
  // normalisées de l'autre.
  const brut = brouillon!.payload as { globalRpe: unknown; durationMinutes: unknown };
  assert.equal(typeof brut.globalRpe, "string");
  assert.equal(typeof brut.durationMinutes, "string");
  assert.equal(typeof operation!.payload.durationMinutes, "number");
});

await test("A41. LA RÉVISION EST CALCULÉE DANS LA TRANSACTION, DEPUIS LES DEUX MAGASINS", async () => {
  // Un brouillon en révision 7 et une file en révision 8 : la prochaine doit
  // être 9. Ne regarder que le brouillon produirait un 8 en double, et
  // l'acquittement conditionnel ne saurait plus distinguer l'ancien état du
  // nouveau — il supprimerait une correction que l'élève croit enregistrée.
  const { moteur, depot } = neuf();
  await moteur.ecrire("training_draft", `${A}:${SEANCE_1}`, {
    schemaVersion: SCHEMA_VERSION, userId: A, sessionId: SEANCE_1, revision: 7,
    businessDate: "2026-08-09", payload: { v: 7 }, updatedAt: T0, syncStatus: "brouillon",
  });
  await moteur.ecrire("training_outbox", `${A}:${SEANCE_1}`, {
    schemaVersion: SCHEMA_VERSION, userId: A, operationId: "op-1", revision: 8, sessionId: SEANCE_1,
    payload: payload("s1", "80"), createdAt: T0, updatedAt: T0, attempts: 0, lastAttemptAt: null, lastError: null,
  });

  const { revision } = await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "90"), operationId: "op-neuf", maintenant: T0 + 1000,
  });
  assert.equal(revision, 9);
  assert.equal((await depot.lireBrouillon(A, SEANCE_1))!.revision, 9);
  assert.equal((await depot.lireOperation(A, SEANCE_1))!.revision, 9);
  assert.equal((await depot.lireOperation(A, SEANCE_1))!.operationId, "op-1", "même retour, même identifiant");
});

await test("A42. deux validations successives ne produisent jamais la même révision", async () => {
  // Deux fenêtres de l'application sur la même séance : chacune demande une
  // nouvelle révision. Comme le calcul se fait DANS la transaction, la
  // seconde lit ce que la première a écrit.
  const { depot } = neuf();
  const r1 = await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "A"), operationId: "op-1", maintenant: T0,
  });
  const r2 = await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "B"), operationId: "op-1", maintenant: T0 + 1,
  });
  assert.notEqual(r1.revision, r2.revision);
  assert.ok(r2.revision > r1.revision);
});

await test("A43. la révision repart de l'état PERSISTÉ, jamais de zéro", async () => {
  // Après un redémarrage complet de l'application, un compteur en mémoire
  // recommencerait à 1 — et toutes les écritures suivantes seraient
  // refusées comme périmées, sans que rien ne le signale.
  const moteur = new MoteurMemoire();
  await new DepotOffline(moteur).validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "A"), operationId: "op-1", maintenant: T0,
  });
  for (let i = 0; i < 3; i += 1) {
    await new DepotOffline(moteur).validerRetourHorsLigne({
      userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
      etatFormulaire: { forme: "formulaire", i }, payloadServeur: payload("s1", `v${i}`),
      operationId: "op-1", maintenant: T0 + i,
    });
  }
  // Un dépôt tout neuf à chaque tour : rien n'est mémorisé côté JavaScript.
  assert.equal((await new DepotOffline(moteur).lireOperation(A, SEANCE_1))!.revision, 4);
});

await test("A36. UNE SAUVEGARDE DIFFÉRÉE NE PEUT PAS FAIRE REVENIR LA SÉANCE EN ARRIÈRE", async () => {
  // Ordre volontairement pathologique : l'état A est programmé, l'élève
  // continue jusqu'à B, valide, PUIS le rappel différé de A se déclenche.
  const { depot } = neuf();
  await depot.ecrireBrouillon({ userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { etat: "A" }, maintenant: T0, revision: 1 });
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "B"), operationId: "op-1", maintenant: T0 + 100,
  });

  // Le rappel oublié se réveille, avec SA révision d'origine.
  const accepte = await depot.ecrireBrouillon({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09", payload: { etat: "A" }, maintenant: T0 + 200, revision: 1,
  });

  assert.equal(accepte, false, "l'écriture périmée doit être refusée");
  const brouillon = await depot.lireBrouillon(A, SEANCE_1);
  assert.equal(brouillon!.revision, 2, "la validation a produit la révision 2");
  assert.equal(brouillon!.syncStatus, "en_attente", "B reste la valeur locale");
});

await test("C1 / A37-a. rien n'a bougé pendant l'envoi : la file est vidée", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "A"), operationId: "op-1", maintenant: T0,
  });
  const envoyee = (await depot.lireOperation(A, SEANCE_1))!.revision;
  assert.equal(await depot.acquitterSiInchange(A, SEANCE_1, envoyee), "acquitte");
  assert.equal(await depot.lireOperation(A, SEANCE_1), null);
});

await test("C2 / A37-b. UNE CORRECTION PENDANT L'ENVOI N'EST JAMAIS EFFACÉE", async () => {
  // Le cas le plus dangereux du système : le serveur confirme A pendant que
  // l'élève vient d'écrire B. Acquitter aveuglément supprimerait B — une
  // correction qu'il croit enregistrée, partie sans un mot.
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "A"), operationId: "op-1", maintenant: T0,
  });
  const envoyee = (await depot.lireOperation(A, SEANCE_1))!.revision;

  // Pendant la requête, l'élève corrige.
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "B"), operationId: "op-1", maintenant: T0 + 500,
  });

  assert.equal(await depot.acquitterSiInchange(A, SEANCE_1, envoyee), "remplacee");
  const restante = await depot.lireOperation(A, SEANCE_1);
  assert.ok(restante, "B doit rester en file d'attente");
  assert.equal(restante!.revision, 2);
  assert.equal(restante!.payload.exercises[0].sets[0].loadUsed, "B");
  // Et `operationId` seul n'aurait pas suffi : il est resté le même.
  assert.equal(restante!.operationId, "op-1");
});

await test("A38. au flush suivant, B part à son tour puis est acquittée", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "B"), operationId: "op-1", maintenant: T0,
  });
  const envoyee = (await depot.lireOperation(A, SEANCE_1))!.revision;
  assert.equal(await depot.acquitterSiInchange(A, SEANCE_1, envoyee), "acquitte");
  assert.deepEqual(await depot.operationsEnAttente(A), []);
});

await test("C3. un envoi en échec laisse la file intacte", async () => {
  const { depot } = neuf();
  await depot.validerRetourHorsLigne({
    userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
    etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "A"), operationId: "op-1", maintenant: T0,
  });
  await depot.marquerEchec(A, SEANCE_1, "503", T0 + 1000);
  const operation = await depot.lireOperation(A, SEANCE_1);
  assert.ok(operation);
  assert.equal(operation!.attempts, 1);
  assert.equal(operation!.revision, 1, "la révision ne bouge pas sur un échec");
});

await test("A39. si l'écriture locale échoue, RIEN ne doit prétendre le contraire", async () => {
  // Quota atteint, IndexedDB refusé : la promesse est rejetée. L'appelant
  // ne doit surtout pas afficher « Synchronisation en attente » — le retour
  // n'est nulle part.
  const depot = new DepotOffline(new MoteurCassant("training_draft", "QuotaExceededError"));
  await assert.rejects(
    () =>
      depot.validerRetourHorsLigne({
        userId: A, sessionId: SEANCE_1, businessDate: "2026-08-09",
        etatFormulaire: { forme: "formulaire" }, payloadServeur: payload("s1", "A"), operationId: "op-1", maintenant: T0,
      }),
    /QuotaExceededError/,
  );
  assert.equal(await depot.lireOperation(A, SEANCE_1), null);
  assert.equal(await depot.lireBrouillon(A, SEANCE_1), null);
});

await test("A44. un `decider` devenu ASYNCHRONE est refusé, pas silencieusement toléré", async () => {
  // TypeScript l'interdit déjà, mais un cast, un fichier JavaScript ou une
  // évolution du code peuvent contourner la signature. Dans un vrai
  // IndexedDB, une promesse rendue ici laisserait la transaction se valider
  // AVANT les écritures — celles-ci partiraient dans une transaction morte,
  // et l'erreur n'apparaîtrait que sur un téléphone.
  const { moteur } = neuf();
  const deciderFautif = (async () => []) as unknown as () => never;
  await assert.rejects(
    () => moteur.transaction(["training_draft"], [], deciderFautif),
    /SYNCHRONE/,
  );
  assert.deepEqual(await moteur.cles("training_draft"), [], "aucune écriture ne doit avoir eu lieu");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
