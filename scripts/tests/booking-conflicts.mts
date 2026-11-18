/**
 * Harnais — protection atomique des conflits calendrier.
 *
 * La garantie de production vit dans la migration
 * supabase/migrations/20260726121000_calendar_atomic_booking.sql :
 * RPC SECURITY DEFINER + pg_advisory_xact_lock + contrôle inter-tables +
 * contrainte d'exclusion GiST. Aucune écriture n'étant autorisée contre
 * Supabase Production, ce harnais fige le CONTRAT de ces fonctions via un
 * mini-moteur TypeScript qui reproduit exactement leur sémantique :
 *  - verrou unique sérialisant toutes les écritures (deux appels simultanés :
 *    le second attend puis revoit l'état à jour) ;
 *  - règle de chevauchement partagée avec l'UI (lib/calendar-grid.ts::periodsOverlap,
 *    identique au SQL : nouveau_debut < fin_existante AND nouvelle_fin > debut_existant) ;
 *  - seuls les RDV pending/confirmed bloquent, un RDV annulé libère ;
 *  - TOUS les événements du coach bloquent (perso, pro, indisponibilité) ;
 *  - report/déplacement : annulation + contrôle + insertion dans UNE
 *    transaction (rollback si conflit) ;
 *  - indisponibilité simple : p_allow_overlap préserve le comportement
 *    historique de l'onglet Disponibilités.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/booking-conflicts.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";

import { periodsOverlap } from "../../lib/calendar-grid";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`ÉCHEC - ${name}`);
      console.error(error);
    });
}

/* ─── Mini-moteur reproduisant la sémantique des RPC ─── */

type Status = "pending" | "confirmed" | "cancelled";
interface Row {
  id: string;
  startMs: number;
  endMs: number;
  /**
   * ⚠️ LA DIMENSION QUI MANQUAIT AU MOTEUR (lot 1, 15/11/2026). Ce harnais
   * figeait le contrat de `calendar_has_conflict` en supposant UN seul coach
   * : « tous les événements du coach bloquent ». Avec deux coachs, cette
   * sémantique est fausse, et un test multi-coach ajouté par-dessus serait
   * passé pour la seule raison que le moteur ignorait les identités.
   *
   * `null` reproduit l'état historique mesuré en base (7 rendez-vous sur 9
   * sans propriétaire) : une telle ligne BLOQUE, parce qu'on ne peut pas
   * prouver qu'elle n'appartient pas au coach visé — c'est le choix
   * fail-closed de `calendar_has_conflict_pour_coach`.
   */
  coachId: string | null;
}
interface AppointmentRow extends Row {
  status: Status;
}
interface CoachEventRow extends Row {
  category: "unavailability" | "personal" | "professional";
}

/**
 * Coach par défaut du moteur. Les cas écrits avant le lot 1 ne nomment aucun
 * coach : ils s'exécutent donc tous sur CE coach, et conservent exactement la
 * sémantique mono-coach qu'ils vérifiaient. Aucune assertion n'est relâchée.
 */
const COACH_PAR_DEFAUT = "coach-A";

class CalendarStore {
  appointments: AppointmentRow[] = [];
  coachEvents: CoachEventRow[] = [];
  private lock: Promise<void> = Promise.resolve();
  private nextId = 1;

  /** pg_advisory_xact_lock simulé : toutes les écritures sont sérialisées. */
  private withLock<T>(fn: () => T): Promise<T> {
    const run = this.lock.then(async () => {
      // Latence simulée APRÈS l'obtention du verrou : la fenêtre
      // SELECT-puis-INSERT existe mais est protégée par la sérialisation.
      await new Promise((r) => setTimeout(r, 2));
      return fn();
    });
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * `calendar_has_conflict_pour_coach(p_coach_id, …)` : la portée vient du
   * coach DÉSIGNÉ, pas de l'appelant. Sans coach désigné, on répond
   * « conflit » — fail-closed, comme en SQL.
   */
  private hasConflict(
    coachId: string | null,
    startMs: number,
    endMs: number,
    excludeAppointmentId?: string,
    excludeCoachEventId?: string,
  ): boolean {
    if (coachId === null) return true;
    const concerne = (ligneCoachId: string | null) => ligneCoachId === coachId || ligneCoachId === null;
    return (
      this.appointments.some(
        (a) =>
          (a.status === "pending" || a.status === "confirmed") &&
          a.id !== excludeAppointmentId &&
          concerne(a.coachId) &&
          periodsOverlap(startMs, endMs, a.startMs, a.endMs),
      ) ||
      this.coachEvents.some(
        (e) => e.id !== excludeCoachEventId && concerne(e.coachId) && periodsOverlap(startMs, endMs, e.startMs, e.endMs),
      )
    );
  }

  createAppointment(
    startMs: number,
    endMs: number,
    status: Status = "confirmed",
    coachId: string | null = COACH_PAR_DEFAUT,
  ): Promise<{ id: string | null; conflict: boolean }> {
    return this.withLock(() => {
      if (endMs <= startMs) throw new Error("calendar_invalid_period");
      if (this.hasConflict(coachId, startMs, endMs)) return { id: null, conflict: true };
      const id = `apt-${this.nextId++}`;
      this.appointments.push({ id, startMs, endMs, status, coachId });
      return { id, conflict: false };
    });
  }

  cancelAppointment(id: string): Promise<boolean> {
    return this.withLock(() => {
      const row = this.appointments.find((a) => a.id === id);
      if (!row) return false;
      row.status = "cancelled";
      return true;
    });
  }

  /** reschedule_appointment_atomic : annulation + contrôle + insertion, rollback si conflit. */
  reschedule(id: string, newStartMs: number, newEndMs: number): Promise<{ id: string | null; conflict: boolean }> {
    return this.withLock(() => {
      const original = this.appointments.find((a) => a.id === id);
      if (!original) throw new Error("calendar_not_found");
      const previousStatus = original.status;
      original.status = "cancelled"; // annulé d'abord (permet le décalage sur sa propre plage)
      // ⚠️ LE COACH DU RENDEZ-VOUS, PAS CELUI DE L'APPELANT : c'est la
      // correction apportée à `reschedule_appointment_atomic` par le lot 1.
      if (this.hasConflict(original.coachId, newStartMs, newEndMs)) {
        original.status = previousStatus; // ROLLBACK de la transaction
        return { id: null, conflict: true };
      }
      const newId = `apt-${this.nextId++}`;
      this.appointments.push({
        id: newId,
        startMs: newStartMs,
        endMs: newEndMs,
        status: "confirmed",
        coachId: original.coachId,
      });
      return { id: newId, conflict: false };
    });
  }

  createCoachEvent(
    category: CoachEventRow["category"],
    startMs: number,
    endMs: number,
    allowOverlap = false,
    coachId: string | null = COACH_PAR_DEFAUT,
  ): Promise<{ id: string | null; conflict: boolean }> {
    return this.withLock(() => {
      if (endMs <= startMs) throw new Error("calendar_invalid_period");
      if (!(allowOverlap && category === "unavailability") && this.hasConflict(coachId, startMs, endMs)) {
        return { id: null, conflict: true };
      }
      const id = `evt-${this.nextId++}`;
      this.coachEvents.push({ id, startMs, endMs, category, coachId });
      return { id, conflict: false };
    });
  }

  updateCoachEvent(id: string, newStartMs: number, newEndMs: number): Promise<{ id: string | null; conflict: boolean }> {
    return this.withLock(() => {
      const row = this.coachEvents.find((e) => e.id === id);
      if (!row) return { id: null, conflict: false };
      if (row.category !== "unavailability" && this.hasConflict(row.coachId, newStartMs, newEndMs, undefined, id)) {
        return { id: null, conflict: true };
      }
      row.startMs = newStartMs;
      row.endMs = newEndMs;
      return { id, conflict: false };
    });
  }
}

const day = (h: number, m = 0) => Date.UTC(2026, 6, 27, h, m); // lundi 27/07/2026

/* ─── Tests ─── */

await test("CONCURRENCE : deux réservations simultanées du même intervalle → une seule réussit", async () => {
  const store = new CalendarStore();
  const [a, b] = await Promise.all([store.createAppointment(day(9), day(10)), store.createAppointment(day(9), day(10))]);
  const succeeded = [a, b].filter((r) => r.id !== null);
  const conflicted = [a, b].filter((r) => r.conflict);
  assert.equal(succeeded.length, 1, "exactement une réservation doit réussir");
  assert.equal(conflicted.length, 1, "l'autre doit être refusée pour conflit");
  assert.equal(store.appointments.filter((x) => x.status !== "cancelled").length, 1);
});

await test("CONCURRENCE : 10 réservations simultanées chevauchantes → une seule réussit", async () => {
  const store = new CalendarStore();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.createAppointment(day(9, i * 5), day(10, i * 5))),
  );
  assert.equal(results.filter((r) => r.id !== null).length, 1);
  assert.equal(results.filter((r) => r.conflict).length, 9);
});

await test("CONCURRENCE inter-tables : RDV élève et événement personnel simultanés sur le même créneau → un seul réussit", async () => {
  const store = new CalendarStore();
  const [apt, evt] = await Promise.all([
    store.createAppointment(day(14), day(15)),
    store.createCoachEvent("personal", day(14, 30), day(15, 30)),
  ]);
  assert.equal([apt, evt].filter((r) => r.id !== null).length, 1);
});

await test("RDV vs RDV : chevauchement partiel refusé (avant ET après)", async () => {
  const store = new CalendarStore();
  await store.createAppointment(day(9), day(10));
  assert.equal((await store.createAppointment(day(8, 30), day(9, 30))).conflict, true);
  assert.equal((await store.createAppointment(day(9, 30), day(10, 30))).conflict, true);
  assert.equal((await store.createAppointment(day(9, 15), day(9, 45))).conflict, true); // inclusion
});

await test("RDV vs événement personnel : refusé", async () => {
  const store = new CalendarStore();
  await store.createCoachEvent("personal", day(11), day(12));
  assert.equal((await store.createAppointment(day(11, 30), day(12, 30))).conflict, true);
});

await test("RDV vs événement professionnel : refusé", async () => {
  const store = new CalendarStore();
  await store.createCoachEvent("professional", day(11), day(12));
  assert.equal((await store.createAppointment(day(11, 30), day(12, 30))).conflict, true);
});

await test("événement personnel vs RDV existant : refusé (toutes combinaisons)", async () => {
  const store = new CalendarStore();
  await store.createAppointment(day(9), day(10));
  assert.equal((await store.createCoachEvent("personal", day(9, 30), day(10, 30))).conflict, true);
  assert.equal((await store.createCoachEvent("professional", day(9, 30), day(10, 30))).conflict, true);
});

await test("déplacement d'un RDV vers une période occupée : refusé, l'original RESTE ACTIF (rollback)", async () => {
  const store = new CalendarStore();
  const a = await store.createAppointment(day(9), day(10));
  await store.createAppointment(day(14), day(15));
  const moved = await store.reschedule(a.id as string, day(14, 30), day(15, 30));
  assert.equal(moved.conflict, true);
  const original = store.appointments.find((x) => x.id === a.id);
  assert.equal(original?.status, "confirmed", "rollback : l'original ne doit pas rester annulé");
});

await test("déplacement d'un RDV sur sa propre plage (décalage 30 min) : accepté", async () => {
  const store = new CalendarStore();
  const a = await store.createAppointment(day(9), day(10));
  const moved = await store.reschedule(a.id as string, day(9, 30), day(10, 30));
  assert.notEqual(moved.id, null);
  assert.equal(store.appointments.find((x) => x.id === a.id)?.status, "cancelled");
});

await test("modification d'un événement privé vers une période occupée : refusée ; vers une période libre : acceptée", async () => {
  const store = new CalendarStore();
  const evt = await store.createCoachEvent("personal", day(9), day(10));
  await store.createAppointment(day(14), day(15));
  assert.equal((await store.updateCoachEvent(evt.id as string, day(14, 30), day(15, 30))).conflict, true);
  assert.notEqual((await store.updateCoachEvent(evt.id as string, day(11), day(12))).id, null);
  // se re-déplacer sur sa propre plage : accepté (exclusion de soi)
  assert.notEqual((await store.updateCoachEvent(evt.id as string, day(11, 30), day(12, 30))).id, null);
});

await test("événement toute la journée vs créneau horaire du même jour : refusé", async () => {
  const store = new CalendarStore();
  // toute la journée = [00:00, 00:00 le lendemain) — même représentation que la modale
  await store.createCoachEvent("personal", day(0), Date.UTC(2026, 6, 28, 0));
  assert.equal((await store.createAppointment(day(9), day(10))).conflict, true);
});

await test("RDV annulé libère son créneau (règle métier existante)", async () => {
  const store = new CalendarStore();
  const a = await store.createAppointment(day(9), day(10));
  await store.cancelAppointment(a.id as string);
  const b = await store.createAppointment(day(9), day(10));
  assert.notEqual(b.id, null, "un créneau annulé doit être réservable");
});

await test("indisponibilité simple (onglet Disponibilités, allow_overlap) : peut se poser par-dessus un RDV — comportement historique préservé", async () => {
  const store = new CalendarStore();
  await store.createAppointment(day(9), day(10));
  const unav = await store.createCoachEvent("unavailability", day(8), day(12), true);
  assert.notEqual(unav.id, null);
  // …mais un nouveau RDV sur l'indisponibilité est refusé
  assert.equal((await store.createAppointment(day(10, 30), day(11, 30))).conflict, true);
});

await test("bornes qui se touchent : jamais un conflit", async () => {
  const store = new CalendarStore();
  await store.createAppointment(day(9), day(10));
  assert.notEqual((await store.createAppointment(day(10), day(11))).id, null);
  assert.notEqual((await store.createAppointment(day(8), day(9))).id, null);
});

await test("période invalide (fin <= début) : rejetée", async () => {
  const store = new CalendarStore();
  await assert.rejects(() => store.createAppointment(day(10), day(10)));
  await assert.rejects(() => store.createCoachEvent("personal", day(10), day(9)));
});

/* ─── MULTI-COACH (lot 1) ──────────────────────────────────────────────────
 *
 * ⚠️ CES CAS NE PASSENT QUE PARCE QUE LE MOTEUR CONNAÎT LES IDENTITÉS. Avant
 * l'extension ci-dessus, `hasConflict` ignorait `coachId` : « l'agenda de B
 * reste libre » aurait été vérifié par un moteur incapable de distinguer A de
 * B, donc vrai par ignorance. La contre-épreuve est dans
 * scripts/tests/affectation-multi-coach.mts (perturbation du prédicat).
 */

await test("MULTI-COACH : un rendez-vous de A ne bloque pas le même horaire chez B", async () => {
  const store = new CalendarStore();
  const chezA = await store.createAppointment(day(9), day(10), "confirmed", "coach-A");
  assert.notEqual(chezA.id, null, "A réserve son créneau");
  const chezB = await store.createAppointment(day(9), day(10), "confirmed", "coach-B");
  assert.notEqual(chezB.id, null, "le même horaire reste libre chez B");
  assert.equal(chezB.conflict, false);
});

await test("MULTI-COACH : deux rendez-vous du MÊME coach au même horaire → un seul", async () => {
  const store = new CalendarStore();
  assert.notEqual((await store.createAppointment(day(9), day(10), "confirmed", "coach-B")).id, null);
  assert.equal((await store.createAppointment(day(9), day(10), "confirmed", "coach-B")).conflict, true);
});

await test("MULTI-COACH : l'indisponibilité de A ne ferme pas l'agenda de B", async () => {
  const store = new CalendarStore();
  await store.createCoachEvent("personal", day(8), day(18), false, "coach-A");
  assert.equal((await store.createAppointment(day(9), day(10), "confirmed", "coach-A")).conflict, true);
  assert.notEqual((await store.createAppointment(day(9), day(10), "confirmed", "coach-B")).id, null);
});

await test("MULTI-COACH : une ligne SANS propriétaire bloque tout le monde (fail-closed)", async () => {
  const store = new CalendarStore();
  /*
   * ⚠️ LA LIGNE ORPHELINE EST INJECTÉE, PAS CRÉÉE. Aucun chemin d'écriture
   * n'en produit plus : `createAppointment(…, null)` est refusé d'emblée
   * (cas suivant). On reproduit donc l'ÉTAT historique mesuré — 7 rendez-vous
   * sur 9 sans `coach_id` —, pas le chemin qui y menait.
   *
   * Avant le lot 1, ces lignes ne bloquaient PERSONNE : `calendar_has_conflict`
   * écartait `a.coach_id is null` sauf pour l'administrateur. C'était le trou
   * de double réservation. Elles bloquent désormais tout le monde.
   */
  store.appointments.push({ id: "apt-historique", startMs: day(9), endMs: day(10), status: "confirmed", coachId: null });
  assert.equal((await store.createAppointment(day(9), day(10), "confirmed", "coach-A")).conflict, true);
  assert.equal((await store.createAppointment(day(9), day(10), "confirmed", "coach-B")).conflict, true);
});

await test("MULTI-COACH : sans coach désigné, l'écriture est refusée (jamais « à l'aveugle »)", async () => {
  const store = new CalendarStore();
  assert.equal(
    (await store.createAppointment(day(9), day(10), "confirmed", null)).conflict,
    true,
    "un appelant qui n'a pas résolu le coach doit échouer, pas réserver",
  );
});

await test("MULTI-COACH : le report suit le coach du rendez-vous, pas celui de l'appelant", async () => {
  const store = new CalendarStore();
  const chezB = await store.createAppointment(day(9), day(10), "confirmed", "coach-B");
  // A est occupé sur la cible ; B est libre. Le report du rendez-vous de B
  // doit réussir — avec la portée de l'appelant, il aurait été refusé.
  await store.createAppointment(day(14), day(15), "confirmed", "coach-A");
  const reporte = await store.reschedule(chezB.id as string, day(14), day(15));
  assert.notEqual(reporte.id, null, "le report chez B ne doit pas voir l'agenda de A");
});

await test("MULTI-COACH : concurrence sur le même créneau du même coach → une seule réservation", async () => {
  const store = new CalendarStore();
  const resultats = await Promise.all([
    store.createAppointment(day(9), day(10), "confirmed", "coach-B"),
    store.createAppointment(day(9), day(10), "confirmed", "coach-B"),
  ]);
  assert.equal(resultats.filter((r) => r.id !== null).length, 1, "exactement une réservation");
  assert.equal(resultats.filter((r) => r.conflict).length, 1);
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
