// Tests exécutables pour l'idempotence du webhook Stripe "achat d'un
// programme public payant" (chantier conformité juridique/RGPD, Lot E-bis
// technique — juillet 2026) : verrou d'évènement atomique, séquence
// consentements → email → activation, persistance de l'email au-delà des
// 24h Resend, "skipped" bloquant en production, garanties DB réelles
// (contraintes uniques) sous concurrence.
//
// Aucun framework de test n'existe dans ce projet (voir package.json) : ce
// script utilise Node.js natif (`node:assert/strict`) et un harnais minimal
// (~15 lignes, cf. la fonction `test` plus bas), lancé via tsx pour résoudre
// l'alias `@/*` de tsconfig.json et les imports TypeScript sans étape de
// build. `NODE_OPTIONS="--conditions=react-server"` est nécessaire car
// certains modules importés (billing.ts, public-program-provisioning.ts)
// dépendent transitivement du package `server-only`, qui lève sinon une
// erreur hors du bundler Next.js — voir la commande dans package.json
// (`npm run test:webhook-idempotency`).
//
// AUCUN accès réseau, AUCUNE base de données réelle : `FakeSupabase`
// ci-dessous est un client Supabase entièrement en mémoire (voir la classe
// plus bas), et tous les emails passent par le vrai `sendTransactionalEmail`
// SANS `RESEND_API_KEY` configurée (donc toujours "skipped", jamais un
// envoi réel — voir lib/email/resend.ts). Aucun identifiant, secret, ou URL
// de projet Supabase réel n'apparaît dans ce fichier.

import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acquirePublicProgramPurchaseEventLock,
  getPublicProgramPurchaseConfirmationEmailState,
  markPublicProgramPurchaseEventFailed,
  markPublicProgramPurchaseEventProcessed,
  recordPublicProgramPurchaseConfirmationEmailResult,
} from "@/lib/supabase/billing";
import { provisionPublicProgramAccess, RetryablePublicProgramProvisioningError } from "@/lib/supabase/public-program-provisioning";
import type { Database } from "@/types/supabase";

// ─── Fake Supabase client : surface minimale réellement utilisée par le
// code testé (from/select/eq/or/limit/order/maybeSingle/single/insert/
// update/delete, y compris le filtre jsonb `metadata->>checkout_session_id`
// et la syntaxe PostgREST `.or("col.eq.x,and(col.eq.y,col.lt.z)")`).
//
// Application RÉELLE de contraintes d'unicité à l'insertion
// (uniqueConstraints ci-dessous), pour que les tests de concurrence
// exercent une vraie violation 23505 — sans ça, le code de production qui
// gère spécifiquement ce cas (acquirePublicProgramPurchaseEventLock,
// setProgramAssignment, insertCgvConsentIfProvided/
// insertImmediateAccessAndWaiverConsentIfProvided) ne serait jamais
// réellement exercé. ───

type Row = Record<string, unknown>;

interface FakeError {
  message: string;
  code?: string;
}

interface FakeResult {
  data: unknown;
  error: FakeError | null;
}

/** Résout une "colonne" simple ("student_id") ou un chemin jsonb ("metadata->>checkout_session_id"). */
function getFieldValue(row: Row, colSpec: string): unknown {
  const arrowMatch = colSpec.match(/^(.+)->>(.+)$/);
  if (arrowMatch) {
    const [, jsonCol, key] = arrowMatch;
    const nested = row[jsonCol];
    return nested && typeof nested === "object" ? (nested as Record<string, unknown>)[key] : undefined;
  }
  return row[colSpec];
}

/** Découpe une expression `.or(...)` sur les virgules de premier niveau (pas celles à l'intérieur d'un `and(...)`). */
function splitTopLevelCommas(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Évalue un terme `col.op.valeur` ou `and(terme,terme,...)` de la syntaxe PostgREST `.or()`. */
function evalOrTerm(term: string, row: Row): boolean {
  if (term.startsWith("and(") && term.endsWith(")")) {
    const inner = term.slice(4, -1);
    return splitTopLevelCommas(inner).every((t) => evalOrTerm(t, row));
  }
  const m = term.match(/^(.+?)\.(eq|neq|lt|lte|gt|gte)\.(.*)$/);
  if (!m) throw new Error(`[fake] terme .or() non supporté : ${term}`);
  const [, col, op, value] = m;
  const actual = getFieldValue(row, col);
  switch (op) {
    case "eq":
      return actual !== undefined && actual !== null && String(actual) === value;
    case "neq":
      return String(actual ?? "") !== value;
    case "lt":
      return actual !== undefined && actual !== null && String(actual) < value;
    case "lte":
      return actual !== undefined && actual !== null && String(actual) <= value;
    case "gt":
      return actual !== undefined && actual !== null && String(actual) > value;
    case "gte":
      return actual !== undefined && actual !== null && String(actual) >= value;
    default:
      return false;
  }
}

function evalOrExpr(expr: string, row: Row): boolean {
  return splitTopLevelCommas(expr).some((term) => evalOrTerm(term, row));
}

class FakeQueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private orExpr: string | null = null;
  private isInsert = false;
  private isUpdate = false;
  private isDelete = false;
  private payload: Row | null = null;
  private selectSingle = false;

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature miroir de PostgrestFilterBuilder.select(columns?), colonnes ignorées (le fake ne projette jamais)
  select(_cols?: string) {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  ilike(col: string, val: unknown) {
    this.filters.push([`__ilike__${col}`, val]);
    return this;
  }
  or(expr: string) {
    this.orExpr = expr;
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature miroir de PostgrestFilterBuilder.limit(n), jamais appliqué (le fake ne pagine pas)
  limit(_n: number) {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature miroir de PostgrestFilterBuilder.order(col, opts), jamais appliqué (le fake ne trie pas)
  order(_col: string, _opts?: { ascending?: boolean }) {
    return this;
  }
  insert(payload: Row) {
    this.isInsert = true;
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.isUpdate = true;
    this.payload = payload;
    return this;
  }
  delete() {
    this.isDelete = true;
    return this;
  }
  single() {
    this.selectSingle = true;
    return this.resolve(true);
  }
  maybeSingle() {
    this.selectSingle = true;
    return this.resolve(false);
  }
  // Rend le builder "thenable" pour `await supabase.from(x).insert(y)` sans .select().
  then<TResult1 = FakeResult, TResult2 = never>(
    onFulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.resolve(false).then(onFulfilled, onRejected);
  }

  private matches(row: Row): boolean {
    const eqOk = this.filters.every(([col, val]) => {
      if (col.startsWith("__ilike__")) {
        const realCol = col.replace("__ilike__", "");
        return String(row[realCol] ?? "").toLowerCase() === String(val).toLowerCase();
      }
      return getFieldValue(row, col) === val;
    });
    if (!eqOk) return false;
    if (this.orExpr) {
      return evalOrExpr(this.orExpr, row);
    }
    return true;
  }

  private async resolve(requireSingle: boolean): Promise<FakeResult> {
    const table = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const forcedError = this.db.consumeFault(this.table, this.isInsert ? "insert" : this.isUpdate ? "update" : "select");
    if (forcedError) {
      return { data: null, error: forcedError };
    }

    if (this.isInsert) {
      // Application RÉELLE des contraintes d'unicité déclarées pour cette
      // table (voir FakeSupabase.uniqueConstraints) — une seule opération
      // synchrone (aucun await entre la vérification et l'écriture), donc
      // deux appels "concurrents" (Promise.all) ne peuvent jamais tous les
      // deux réussir cette insertion pour la même clé : exactement comme un
      // vrai index/contrainte unique Postgres, c'est Postgres (ici : ce
      // bloc synchrone) qui arbitre, jamais une lecture préalable côté JS.
      const constraints = this.db.uniqueConstraints[this.table] ?? [];
      const payload = this.payload ?? {};
      for (const cols of constraints) {
        const conflict = table.some((existingRow) =>
          cols.every((col) => {
            const v = getFieldValue(payload, col);
            return v !== undefined && v !== null && getFieldValue(existingRow, col) === v;
          }),
        );
        if (conflict) {
          this.db.log.push({ op: "insert_conflict", table: this.table, code: "23505", cols, attempted: payload });
          return { data: null, error: { message: `[fake] violation d'unicité simulée (${cols.join(", ")})`, code: "23505" } };
        }
      }
      const row: Row = { id: `row_${table.length}_${Math.random().toString(36).slice(2)}`, ...payload };
      table.push(row);
      this.db.log.push({ op: "insert", table: this.table, row });
      return { data: this.selectSingle ? row : [row], error: null };
    }
    if (this.isUpdate) {
      const matched = table.filter((r) => this.matches(r));
      matched.forEach((r) => Object.assign(r, this.payload));
      this.db.log.push({ op: "update", table: this.table, count: matched.length, payload: this.payload });
      return { data: matched, error: null };
    }
    if (this.isDelete) {
      const before = table.length;
      const remaining = table.filter((r) => !this.matches(r));
      this.db.tables[this.table] = remaining;
      this.db.log.push({ op: "delete", table: this.table, deleted: before - remaining.length });
      return { data: null, error: null };
    }
    // select
    const matched = table.filter((r) => this.matches(r));
    if (requireSingle) {
      if (matched.length === 0) return { data: null, error: { message: "not found", code: "PGRST116" } };
      return { data: matched[0], error: null };
    }
    return { data: matched.length ? (matched[0] ?? null) : null, error: null };
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {};
  log: Array<{ op: string; table: string; [k: string]: unknown }> = [];
  private faults: Record<string, "insert" | "update" | "select"> = {};

  /**
   * Contraintes d'unicité simulées, par table. Reflètent l'état RÉEL du
   * schéma (voir supabase/schema.sql) :
   * - billing_events.stripe_event_id : `unique` en base — toujours active.
   * - assignments (student_id, content_type, content_id) : `unique` en
   *   base — toujours active.
   * - legal_consents (consent_type, metadata->>'checkout_session_id') :
   *   `legal_consents_program_checkout_unique_idx`, voir
   *   supabase/migrations/20260721154347_add_legal_consents_checkout_unique_index.sql
   *   — vide par défaut ici (activée explicitement par les tests qui
   *   simulent son application, pour prouver que le code applicatif la gère
   *   correctement).
   */
  uniqueConstraints: Record<string, string[][]> = {
    billing_events: [["stripe_event_id"]],
    assignments: [["student_id", "content_type", "content_id"]],
    legal_consents: [],
  };

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  /** Force la PROCHAINE opération donnée sur cette table à échouer une fois. */
  failNext(table: string, op: "insert" | "update" | "select") {
    this.faults[`${table}:${op}`] = op;
  }

  consumeFault(table: string, op: "insert" | "update" | "select"): FakeError | null {
    const key = `${table}:${op}`;
    if (this.faults[key]) {
      delete this.faults[key];
      return { message: `[fake] échec injecté sur ${key}`, code: "FAKE_FAULT" };
    }
    return null;
  }

  countRows(table: string, predicate: (r: Row) => boolean = () => true) {
    return (this.tables[table] ?? []).filter(predicate).length;
  }
}

// Même construction que `TypedSupabaseClient` dans lib/supabase/billing.ts /
// lib/supabase/public-program-provisioning.ts (type non exporté par ces
// modules) — reproduite ici pour que `makeDb()` ci-dessous soit assignable
// aux fonctions de production sans jamais recourir à `any`.
type TypedSupabaseClient = SupabaseClient<Database>;
// Intersection plutôt qu'un simple alias : conserve à la fois les membres
// propres au fake (tables/log/uniqueConstraints/failNext/countRows) ET
// l'assignabilité à TypedSupabaseClient attendue par le code de production —
// un unique `as unknown as X` par instance, jamais `any`.
type FakeDbHandle = FakeSupabase & TypedSupabaseClient;

function makeDb(): FakeDbHandle {
  return new FakeSupabase() as unknown as FakeDbHandle;
}

// ─── Harness de test minimal (pas de framework, juste des assertions) ───

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`❌ ${name}`);
    console.error(error);
  }
}

const baseProvisionInput = {
  programId: "prog_1",
  programName: "LOL",
  coachId: null,
  firstName: "Test",
  lastName: "Verif",
  email: "test-verif@example.com",
  cgvConsentTextVersion: "2026-07-fr-v1",
  immediateAccessAndWaiverConsentTextVersion: "2026-07-fr-v2",
  checkoutSessionId: "cs_test_abc123",
};

function seedExistingStudent(db: FakeDbHandle) {
  db.tables.students = [{ id: "student_1", user_id: "user_1", first_name: "Test", email: "test-verif@example.com" }];
}

// ═══════════════════════════════════════════════════════════════════════
// Suite A — verrou d'évènement billing_events (acquisition atomique)
// ═══════════════════════════════════════════════════════════════════════

await test("A1 — première réception : proceed, ligne créée avec _seth_status=processing", async () => {
  const db = makeDb();
  const result = await acquirePublicProgramPurchaseEventLock(db, "evt_1", "checkout.session.completed", { id: "evt_1" });
  assert.equal(result, "proceed");
  assert.equal(db.tables.billing_events.length, 1);
  const payload = db.tables.billing_events[0].payload as Record<string, unknown>;
  assert.equal(payload._seth_status, "processing");
  assert.ok(payload._seth_lease_started_at, "un lease doit être horodaté");
});

await test("A2 — double réception APRÈS succès (processed) : already_processed, aucune nouvelle ligne", async () => {
  const db = makeDb();
  await acquirePublicProgramPurchaseEventLock(db, "evt_2", "checkout.session.completed", { id: "evt_2" });
  await markPublicProgramPurchaseEventProcessed(db, "evt_2");
  const result = await acquirePublicProgramPurchaseEventLock(db, "evt_2", "checkout.session.completed", { id: "evt_2" });
  assert.equal(result, "already_processed");
  assert.equal(db.tables.billing_events.length, 1, "aucune ligne dupliquée");
  assert.equal((db.tables.billing_events[0].payload as Record<string, unknown>)._seth_status, "processed");
});

await test("A3 — double réception APRÈS échec (failed) : proceed autorisé (retry possible)", async () => {
  const db = makeDb();
  await acquirePublicProgramPurchaseEventLock(db, "evt_3", "checkout.session.completed", { id: "evt_3" });
  await markPublicProgramPurchaseEventFailed(db, "evt_3", "boom");
  assert.equal((db.tables.billing_events[0].payload as Record<string, unknown>)._seth_status, "failed");
  const result = await acquirePublicProgramPurchaseEventLock(db, "evt_3", "checkout.session.completed", { id: "evt_3" });
  assert.equal(result, "proceed", "un échec doit rester rejouable");
  assert.equal(db.tables.billing_events.length, 1, "toujours une seule ligne (même evt_id)");
  assert.equal(
    (db.tables.billing_events[0].payload as Record<string, unknown>)._seth_status,
    "processing",
    "repasse en processing pour le nouvel essai",
  );
});

await test("A4 (CORRIGÉ suite audit) — double réception PENDANT le traitement (processing récent, lease non expiré) : already_processing, aucun effet métier", async () => {
  const db = makeDb();
  await acquirePublicProgramPurchaseEventLock(db, "evt_4", "checkout.session.completed", { id: "evt_4" });
  // Ni markProcessed ni markFailed appelé, et le lease vient d'être posé
  // (aucune chance qu'il soit expiré) — simule un traitement réellement en
  // cours, pas un crash.
  const result = await acquirePublicProgramPurchaseEventLock(db, "evt_4", "checkout.session.completed", { id: "evt_4" });
  assert.equal(result, "already_processing", "un évènement 'processing' dans son lease ne doit JAMAIS renvoyer proceed");
  assert.equal(db.tables.billing_events.length, 1, "aucune ligne dupliquée");
  assert.equal(
    (db.tables.billing_events[0].payload as Record<string, unknown>)._seth_status,
    "processing",
    "le statut n'a pas été perturbé par la tentative refusée",
  );
});

await test("processing expiré (lease dépassé) : reprise possible", async () => {
  const db = makeDb();
  const oldLeaseIso = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min > lease de 5 min
  db.tables.billing_events = [
    {
      id: "row_seed",
      stripe_event_id: "evt_expired",
      event_type: "checkout.session.completed",
      payload: { id: "evt_expired", _seth_status: "processing", _seth_lease_started_at: oldLeaseIso },
    },
  ];
  const result = await acquirePublicProgramPurchaseEventLock(db, "evt_expired", "checkout.session.completed", { id: "evt_expired" });
  assert.equal(result, "proceed", "un lease expiré (traitement précédent probablement mort) doit permettre une reprise");
  assert.equal(db.tables.billing_events.length, 1, "toujours une seule ligne");
  assert.equal((db.tables.billing_events[0].payload as Record<string, unknown>)._seth_status, "processing", "repasse en processing pour la reprise");
});

await test("deux appels simultanés sur un évènement NEUF : un seul obtient le verrou (acquisition atomique)", async () => {
  const db = makeDb();
  const [r1, r2] = await Promise.all([
    acquirePublicProgramPurchaseEventLock(db, "evt_concurrent", "checkout.session.completed", { id: "evt_concurrent" }),
    acquirePublicProgramPurchaseEventLock(db, "evt_concurrent", "checkout.session.completed", { id: "evt_concurrent" }),
  ]);
  const results = [r1, r2].sort();
  assert.deepEqual(results, ["already_processing", "proceed"], "exactement un 'proceed', l'autre 'already_processing' — jamais les deux 'proceed'");
  assert.equal(db.tables.billing_events.length, 1, "aucune ligne dupliquée malgré les deux tentatives concurrentes");
});

// ═══════════════════════════════════════════════════════════════════════
// Suite E — persistance de l'email de confirmation au-delà des 24h Resend
// ═══════════════════════════════════════════════════════════════════════

/**
 * Réplique fidèle (pas un mock du SDK Resend, hors de portée sans framework
 * de mocking) de la garde ajoutée dans
 * lib/stripe/webhook-handlers.ts::onConsentsRecorded : vérifie l'état
 * persisté AVANT tout envoi, et persiste le résultat immédiatement après —
 * en appelant les deux fonctions de PRODUCTION réelles
 * (getPublicProgramPurchaseConfirmationEmailState /
 * recordPublicProgramPurchaseConfirmationEmailResult, importées ci-dessus
 * depuis lib/supabase/billing.ts).
 */
async function simulateConfirmationEmailSend(db: FakeDbHandle, stripeEventId: string, sendCounter: { count: number }): Promise<void> {
  const existing = await getPublicProgramPurchaseConfirmationEmailState(db, stripeEventId);
  if (existing?.status === "sent") {
    return;
  }
  sendCounter.count++;
  await recordPublicProgramPurchaseConfirmationEmailResult(db, stripeEventId, { status: "sent", emailId: `log_${sendCounter.count}` });
}

await test("retry après plus de 24h : aucun second email (persistance billing_events, sans limite de durée)", async () => {
  const db = makeDb();
  await acquirePublicProgramPurchaseEventLock(db, "evt_email_24h", "checkout.session.completed", { id: "evt_email_24h" });
  const counter = { count: 0 };

  await simulateConfirmationEmailSend(db, "evt_email_24h", counter);
  assert.equal(counter.count, 1, "premier envoi réel");

  // Simule un retry Stripe survenant bien après les 24h pendant lesquelles la
  // clé d'idempotence Resend elle-même protège (ce test ne dépend d'aucune
  // horloge simulée : la protection testée ici est indépendante du temps
  // écoulé, contrairement à celle de Resend).
  await simulateConfirmationEmailSend(db, "evt_email_24h", counter);
  assert.equal(counter.count, 1, "aucun second envoi, quel que soit l'écart de temps, grâce à l'état persisté dans billing_events.payload");

  const state = await getPublicProgramPurchaseConfirmationEmailState(db, "evt_email_24h");
  assert.equal(state?.status, "sent");
  assert.equal(state?.emailId, "log_1");
});

// ═══════════════════════════════════════════════════════════════════════
// Suite B — séquence consentements → email → activation
// ═══════════════════════════════════════════════════════════════════════

await test("B1 (happy path) — consentements + activation écrits, aucune duplication au retry", async () => {
  const db = makeDb();
  seedExistingStudent(db);

  const result = await provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} });
  assert.ok(result, "premier essai doit réussir");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "cgv_programme"), 1);
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "retractation_programme"), 1);
  assert.equal(db.countRows("assignments", (r) => r.content_id === "prog_1"), 1);

  // Retry avec le MÊME checkoutSessionId (Stripe renvoie le même évènement) :
  const retry = await provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} });
  assert.ok(retry, "un retry après succès doit rester silencieusement réussi (idempotent)");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "cgv_programme"), 1, "pas de doublon consentement CGV");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "retractation_programme"), 1, "pas de doublon consentement rétractation");
  assert.equal(db.countRows("assignments", (r) => r.content_id === "prog_1"), 1, "pas de doublon d'affectation (setProgramAssignment idempotent)");
});

await test("B2 (a — échec consentement) — insert legal_consents échoue : throw, PAS d'activation", async () => {
  const db = makeDb();
  seedExistingStudent(db);
  db.failNext("legal_consents", "insert");

  await assert.rejects(
    () => provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} }),
    RetryablePublicProgramProvisioningError,
  );
  assert.equal(db.countRows("legal_consents"), 0, "aucune ligne de consentement écrite");
  assert.equal(db.countRows("assignments"), 0, "activation NE DOIT PAS avoir eu lieu");
});

await test("B3 (b — échec email) — onConsentsRecorded rejette (simulate sendTransactionalEmail status:failed) : throw, PAS d'activation", async () => {
  const db = makeDb();
  seedExistingStudent(db);

  const fakeSendResult = { status: "failed" as const, logId: "log_1", error: "Resend indisponible (simulation test)" };
  const onConsentsRecorded = async () => {
    if (fakeSendResult.status === "failed") {
      throw new RetryablePublicProgramProvisioningError(`Échec de l'envoi de la confirmation de commande : ${fakeSendResult.error}.`);
    }
  };

  await assert.rejects(
    () => provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded }),
    RetryablePublicProgramProvisioningError,
  );
  assert.equal(db.countRows("legal_consents"), 2, "les 2 consentements sont écrits AVANT l'email, donc présents");
  assert.equal(db.countRows("assignments"), 0, "activation NE DOIT PAS avoir eu lieu si l'email a échoué");
});

await test("B3bis — retry après échec email : consentements PAS dupliqués, activation a bien lieu cette fois", async () => {
  const db = makeDb();
  seedExistingStudent(db);

  let emailAttempt = 0;
  const onConsentsRecorded = async () => {
    emailAttempt++;
    if (emailAttempt === 1) {
      throw new RetryablePublicProgramProvisioningError("Échec simulé du premier essai.");
    }
  };

  await assert.rejects(() => provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded }));
  assert.equal(db.countRows("legal_consents"), 2);
  assert.equal(db.countRows("assignments"), 0);

  const retryResult = await provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded });
  assert.ok(retryResult, "le retry doit réussir");
  assert.equal(emailAttempt, 2);
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "cgv_programme"), 1, "pas de doublon malgré le retry");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "retractation_programme"), 1, "pas de doublon malgré le retry");
  assert.equal(db.countRows("assignments"), 1, "l'activation a bien lieu au retry réussi");
});

await test("B4 (c — échec activation) — setProgramAssignment échoue : throw, consentements déjà présents (reprenable)", async () => {
  const db = makeDb();
  seedExistingStudent(db);
  db.failNext("assignments", "insert");

  await assert.rejects(
    () => provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} }),
    RetryablePublicProgramProvisioningError,
  );
  assert.equal(db.countRows("legal_consents"), 2, "les consentements restent écrits malgré l'échec d'activation");
  assert.equal(db.countRows("assignments"), 0, "l'activation a bien échoué, comme injecté");
});

await test("B5 — email 'skipped' HORS PRODUCTION (EMAILS_ENABLED=false) N'EST PAS traité comme un échec : activation a bien lieu", async () => {
  const db = makeDb();
  seedExistingStudent(db);
  const previousNodeEnv = process.env.NODE_ENV;
  // NODE_ENV est déclaré `readonly` par les types Next.js/@types/node — cast
  // structurel (pas `any`) vers une vue mutable, uniquement pour ce test.
  const mutableEnv = process.env as { NODE_ENV?: string };
  mutableEnv.NODE_ENV = "development";
  try {
    const fakeSendResult = { status: "skipped" as const, logId: "log_2" };
    const onConsentsRecorded = async () => {
      if ((fakeSendResult.status as string) === "failed") {
        throw new RetryablePublicProgramProvisioningError("ne doit jamais être atteint ici");
      }
      if (fakeSendResult.status === "skipped" && process.env.NODE_ENV === "production") {
        throw new RetryablePublicProgramProvisioningError("ne doit pas être atteint hors production");
      }
      // "skipped" hors production : décision documentée — ne bloque pas l'accès d'un client qui a payé.
    };

    const result = await provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded });
    assert.ok(result, "un envoi 'skipped' hors production ne doit pas empêcher l'activation");
    assert.equal(db.countRows("assignments"), 1);
  } finally {
    mutableEnv.NODE_ENV = previousNodeEnv;
  }
});

await test("email 'skipped' EN PRODUCTION : traité comme un échec retryable, PAS d'activation (correctif suite audit)", async () => {
  const db = makeDb();
  seedExistingStudent(db);
  const previousNodeEnv = process.env.NODE_ENV;
  const mutableEnv = process.env as { NODE_ENV?: string };
  mutableEnv.NODE_ENV = "production";
  try {
    const fakeSendResult = { status: "skipped" as const };
    // Réplique exacte de la garde ajoutée dans webhook-handlers.ts::onConsentsRecorded.
    const onConsentsRecorded = async () => {
      if (fakeSendResult.status === "skipped" && process.env.NODE_ENV === "production") {
        throw new RetryablePublicProgramProvisioningError("skipped en production — simulation test");
      }
    };

    await assert.rejects(
      () => provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded }),
      RetryablePublicProgramProvisioningError,
    );
    assert.equal(db.countRows("assignments"), 0, "aucune activation si l'email a été 'skipped' en production");
  } finally {
    mutableEnv.NODE_ENV = previousNodeEnv;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Suite C — garanties DB réelles sous concurrence (point 4)
// ═══════════════════════════════════════════════════════════════════════

await test("deux insertions simultanées de consentement (migration simulée appliquée) : aucun doublon", async () => {
  const db = makeDb();
  // Simule la migration réelle
  // (supabase/migrations/20260721154347_add_legal_consents_checkout_unique_index.sql).
  db.uniqueConstraints.legal_consents = [["consent_type", "metadata->>checkout_session_id"]];
  seedExistingStudent(db);

  const [r1, r2] = await Promise.all([
    provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} }),
    provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} }),
  ]);
  assert.ok(r1 && r2, "les deux appels concurrents doivent réussir (idempotent), aucun ne doit lever");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "cgv_programme"), 1, "aucun doublon CGV malgré la course");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "retractation_programme"), 1, "aucun doublon rétractation malgré la course");
});

await test("insertion directe : la DEUXIÈME insertion reçoit RÉELLEMENT une violation 23505 (constraint DB simulée), absorbée comme un succès idempotent", async () => {
  const db = makeDb();
  // Simule la migration réelle
  // (supabase/migrations/20260721154347_add_legal_consents_checkout_unique_index.sql),
  // déjà vérifiée sans doublon existant et dry-runnée avec succès contre la
  // vraie base — voir le rapport correspondant.
  db.uniqueConstraints.legal_consents = [["consent_type", "metadata->>checkout_session_id"]];
  seedExistingStudent(db);

  // 1er appel : insertion réelle, doit réussir normalement.
  const first = await provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} });
  assert.ok(first, "le premier appel doit réussir");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "cgv_programme"), 1);

  // On force le lookup-avant-insert (hasLegalConsentForCheckoutSession) à
  // RATER la ligne pourtant déjà présente — reproduit exactement la fenêtre
  // de course entre le SELECT et l'INSERT que la contrainte DB doit fermer :
  // sans elle, ce second appel dupliquerait la ligne ; avec elle, Postgres
  // refuse réellement l'insertion (23505) et le code applicatif
  // (insertCgvConsentIfProvided, lib/supabase/public-program-provisioning.ts)
  // absorbe ce refus comme un succès idempotent plutôt que de le laisser
  // remonter comme un échec.
  db.failNext("legal_consents", "select");

  const logLengthBefore = db.log.length;
  const second = await provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} });
  assert.ok(second, "le second appel ne doit PAS lever malgré le conflit réel en base");

  const conflict = db.log.slice(logLengthBefore).find((entry) => {
    if (entry.op !== "insert_conflict" || entry.table !== "legal_consents") return false;
    const attempted = entry.attempted as { consent_type?: string } | undefined;
    return attempted?.consent_type === "cgv_programme";
  });
  assert.ok(conflict, "une violation 23505 doit avoir été RÉELLEMENT levée par la couche DB simulée pour ce second insert");
  assert.equal(conflict?.code, "23505");
  assert.equal(db.countRows("legal_consents", (r) => r.consent_type === "cgv_programme"), 1, "toujours une seule ligne, pas de doublon");
});

await test("deux activations simultanées : aucune affectation en double (contrainte unique déjà existante en base)", async () => {
  const db = makeDb();
  seedExistingStudent(db);

  const [r1, r2] = await Promise.all([
    provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} }),
    provisionPublicProgramAccess(db, { ...baseProvisionInput, onConsentsRecorded: async () => {} }),
  ]);
  assert.ok(r1 && r2, "les deux appels concurrents doivent réussir (idempotent)");
  assert.equal(db.countRows("assignments", (r) => r.content_id === "prog_1"), 1, "une seule affectation malgré la course concurrente");
});

// ─── Résumé ───
console.log(`\n${passed} test(s) réussi(s), ${failed} échoué(s).`);
if (failed > 0) process.exit(1);
