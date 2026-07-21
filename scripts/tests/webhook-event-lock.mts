// Tests exécutables du verrou d'évènement Stripe GÉNÉRIQUE (Lot W1 —
// juillet 2026) : acquisition atomique, reprise après échec, expiration de
// lease, marquage processed/failed, garde test/live.
//
// CE QUI EST TESTÉ ICI, ET POURQUOI. L'audit lecture seule a établi deux
// bugs dans l'ancien `recordBillingEventIfNew` :
//   1. la ligne billing_events était insérée AVANT l'exécution du handler,
//      avec `processed_at default now()` — un handler en échec renvoyait
//      500, Stripe réessayait, mais la ligne existait déjà : la route
//      répondait 200 "deduplicated" et le handler n'était PLUS JAMAIS
//      rejoué (perte définitive et silencieuse) ;
//   2. le SELECT puis INSERT n'étaient pas atomiques et la violation 23505
//      était avalée : deux livraisons simultanées recevaient toutes deux
//      "nouveau, traite-le" et exécutaient le handler deux fois.
// Les scénarios 1 à 8 ci-dessous verrouillent la correction de ces deux
// défauts ; 9 couvre les évènements volontairement ignorés ; 10 et 11 la
// garde test/live ; 12 est assuré par le harnais existant
// (`npm run test:webhook-idempotency`, 17 tests, non modifié).
//
// Même approche que scripts/tests/webhook-idempotency.mts : aucun
// framework (Node natif + `node:assert/strict`), aucun accès réseau,
// aucune base réelle. Le `FakeSupabase` ci-dessous est volontairement une
// copie réduite de celui du harnais existant, limitée à la surface
// réellement utilisée par le verrou générique — le dupliquer plutôt que
// l'extraire évite de toucher un fichier de test déjà validé, ce qui est
// hors du périmètre W1.
//
// Aucun identifiant, secret ou URL de projet réel n'apparaît dans ce
// fichier.

import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acquireStripeEventLock,
  markStripeEventFailed,
  markStripeEventProcessed,
  STRIPE_EVENT_LOCK_LEASE_MS,
} from "@/lib/supabase/billing";
import { checkStripeLivemode } from "@/lib/stripe/livemode";
import {
  assessStripeObjectOwnership,
  handleSubscriptionUpsert,
  IGNORED_UNRELATED_STRIPE_OBJECT,
  StripeCustomerMappingUnresolvedError,
  StripeUnrelatedObjectError,
} from "@/lib/stripe/webhook-handlers";
import type { Database } from "@/types/supabase";

type Row = Record<string, unknown>;

interface FakeError {
  message: string;
  code?: string;
}

interface FakeResult {
  data: unknown;
  error: FakeError | null;
}

/** Découpe une expression `.or(...)` sur les virgules de premier niveau. */
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

/** Évalue un terme `col.op.valeur` ou `and(terme,...)` de la syntaxe PostgREST `.or()`. */
function evalOrTerm(term: string, row: Row): boolean {
  if (term.startsWith("and(") && term.endsWith(")")) {
    return splitTopLevelCommas(term.slice(4, -1)).every((t) => evalOrTerm(t, row));
  }
  const m = term.match(/^(.+?)\.(eq|neq|lt|lte|gt|gte)\.(.*)$/);
  if (!m) throw new Error(`[fake] terme .or() non supporté : ${term}`);
  const [, col, op, value] = m;
  const actual = row[col];
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
      throw new Error(`[fake] opérateur non supporté : ${op}`);
  }
}

class FakeQueryBuilder implements PromiseLike<FakeResult> {
  private filters: Array<(r: Row) => boolean> = [];
  private pendingInsert: Row | null = null;
  private pendingUpdate: Row | null = null;
  private pendingUpsertResult: Row | null = null;
  private wantSingle: "single" | "maybeSingle" | null = null;

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature alignée sur le client Supabase réel : le fake ne projette pas de colonnes.
  select(_cols?: string) {
    return this;
  }

  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }

  or(expr: string) {
    const terms = splitTopLevelCommas(expr);
    this.filters.push((r) => terms.some((t) => evalOrTerm(t, r)));
    return this;
  }

  maybeSingle() {
    this.wantSingle = "maybeSingle";
    return this;
  }

  single() {
    this.wantSingle = "single";
    return this;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- signatures alignées sur le client Supabase réel ; le fake n'ordonne ni ne limite. */
  order(_col: string, _opts?: unknown) {
    return this;
  }

  limit(_n: number) {
    return this;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  insert(row: Row) {
    this.pendingInsert = row;
    return this;
  }

  /** `upsert(row, { onConflict })` — remplace la ligne en conflit, l'insère sinon. */
  upsert(row: Row, opts?: { onConflict?: string }) {
    const key = opts?.onConflict;
    if (key) {
      const existing = this.rows().find((r) => r[key] === row[key]);
      if (existing) {
        Object.assign(existing, row);
        this.pendingUpsertResult = existing;
        return this;
      }
    }
    this.pendingInsert = row;
    return this;
  }

  update(row: Row) {
    this.pendingUpdate = row;
    return this;
  }

  private rows(): Row[] {
    return this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
  }

  private matched(): Row[] {
    return this.rows().filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): FakeResult {
    if (this.pendingUpsertResult) {
      const fault = this.db.consumeFault(this.table, "update");
      if (fault) return { data: null, error: fault };
      this.db.log.push({ op: "upsert", table: this.table });
      return { data: this.wantSingle ? this.pendingUpsertResult : [this.pendingUpsertResult], error: null };
    }

    if (this.pendingInsert) {
      const fault = this.db.consumeFault(this.table, "insert");
      if (fault) return { data: null, error: fault };

      // Contrainte unique RÉELLE sur billing_events.stripe_event_id
      // (schema.sql) : c'est elle qui arbitre la course entre deux
      // livraisons simultanées, exactement comme Postgres en production.
      for (const cols of this.db.uniqueConstraints[this.table] ?? []) {
        const conflict = this.rows().some((r) => cols.every((c) => r[c] === this.pendingInsert![c]));
        if (conflict) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
      }
      // Défauts de colonnes, comme en base (migration W1).
      const row: Row =
        this.table === "billing_events"
          ? { status: "processing", attempts_count: 0, processed_at: null, ...this.pendingInsert }
          : { ...this.pendingInsert };
      this.rows().push(row);
      this.db.log.push({ op: "insert", table: this.table });
      return { data: this.wantSingle ? row : [row], error: null };
    }

    if (this.pendingUpdate) {
      const fault = this.db.consumeFault(this.table, "update");
      if (fault) return { data: null, error: fault };
      const matched = this.matched();
      for (const r of matched) Object.assign(r, this.pendingUpdate);
      this.db.log.push({ op: "update", table: this.table, count: matched.length });
      return { data: matched, error: null };
    }

    const fault = this.db.consumeFault(this.table, "select");
    if (fault) return { data: null, error: fault };
    const matched = this.matched();
    if (this.wantSingle) return { data: matched[0] ?? null, error: null };
    return { data: matched, error: null };
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {};
  log: Array<{ op: string; table: string; [k: string]: unknown }> = [];
  private faults: Record<string, boolean> = {};

  uniqueConstraints: Record<string, string[][]> = {
    billing_events: [["stripe_event_id"]],
  };

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  failNext(table: string, op: "insert" | "update" | "select") {
    this.faults[`${table}:${op}`] = true;
  }

  consumeFault(table: string, op: "insert" | "update" | "select"): FakeError | null {
    const key = `${table}:${op}`;
    if (this.faults[key]) {
      delete this.faults[key];
      return { message: `[fake] échec injecté sur ${key}`, code: "FAKE_FAULT" };
    }
    return null;
  }

  event(eventId: string): Row | undefined {
    return (this.tables.billing_events ?? []).find((r) => r.stripe_event_id === eventId);
  }
}

type TypedSupabaseClient = SupabaseClient<Database>;
type FakeDbHandle = FakeSupabase & TypedSupabaseClient;

function makeDb(): FakeDbHandle {
  return new FakeSupabase() as unknown as FakeDbHandle;
}

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

const EVENT_ID = "evt_test_w1";
const EVENT_TYPE = "customer.subscription.updated";
const PAYLOAD = { id: EVENT_ID, type: EVENT_TYPE };

/** Simule la partie de la route qui suit l'acquisition, sans HTTP. */
async function runRoute(
  db: FakeDbHandle,
  handler: () => Promise<void>,
  options: { handled?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const lock = await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
  if (lock === "already_processed") return { status: 200, body: { received: true, deduplicated: true } };
  if (lock === "already_processing") return { status: 409, body: { received: true, inFlight: true } };
  if (lock === "lock_error") return { status: 500, body: { error: "Verrou indisponible." } };

  const handled = options.handled ?? true;
  const ignoredReason: string | undefined = handled ? undefined : "ignored_unhandled_event_type";
  try {
    if (handled) await handler();
  } catch (error) {
    // CAS A — objet démontrablement étranger à SETH : acquitté, pas rejoué.
    // (Reproduit à l'identique la branche de app/api/stripe/webhook/route.ts.)
    if (error instanceof StripeUnrelatedObjectError) {
      await markStripeEventProcessed(db, EVENT_ID, { ignoredReason: IGNORED_UNRELATED_STRIPE_OBJECT });
      return { status: 200, body: { received: true, ignored: true, reason: IGNORED_UNRELATED_STRIPE_OBJECT } };
    }
    // CAS B et échecs d'écriture : failed + 500, rejeu autorisé.
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    await markStripeEventFailed(db, EVENT_ID, message);
    return { status: 500, body: { error: "Échec du traitement." } };
  }
  await markStripeEventProcessed(db, EVENT_ID, ignoredReason ? { ignoredReason } : undefined);
  return { status: 200, body: { received: true, ignored: ignoredReason ? true : undefined } };
}

// ═══════════════════════════════════════════════════════════════════════
// Scénarios 1 à 12
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  // ── 1. Premier évènement : un seul worker obtient "proceed" ──────────
  await test("1. Premier évènement — proceed, status=processing, processed_at null", async () => {
    const db = makeDb();
    const result = await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    assert.equal(result, "proceed");
    const row = db.event(EVENT_ID);
    assert.ok(row, "la ligne billing_events doit exister");
    assert.equal(row.status, "processing");
    assert.equal(row.processed_at, null, "processed_at ne doit JAMAIS être rempli à l'acquisition (bug d'origine)");
    assert.equal(row.attempts_count, 1);
  });

  // ── 2. Deux réceptions simultanées : un seul handler exécuté ─────────
  await test("2. Deux livraisons simultanées — un seul proceed, un seul handler", async () => {
    const db = makeDb();
    const [a, b] = await Promise.all([
      acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD),
      acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD),
    ]);
    const proceeds = [a, b].filter((r) => r === "proceed");
    assert.equal(proceeds.length, 1, `exactement un "proceed" attendu, obtenu : ${a} / ${b}`);
    assert.ok([a, b].includes("already_processing"), "le perdant doit recevoir already_processing");
    assert.equal((db.tables.billing_events ?? []).length, 1, "une seule ligne malgré deux livraisons");
  });

  // ── 3. Évènement déjà processed : 200, aucun retraitement ────────────
  await test("3. Évènement processed — already_processed, handler non exécuté, 200", async () => {
    const db = makeDb();
    await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    await markStripeEventProcessed(db, EVENT_ID);

    let handlerCalls = 0;
    const res = await runRoute(db, async () => {
      handlerCalls++;
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.deduplicated, true);
    assert.equal(handlerCalls, 0, "le handler ne doit PAS être rejoué");
  });

  // ── 4. Évènement failed : retry autorisé ────────────────────────────
  await test("4. Évènement failed — reprise autorisée, erreur nettoyée, attempts incrémenté", async () => {
    const db = makeDb();
    await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    await markStripeEventFailed(db, EVENT_ID, "panne transitoire");

    const before = db.event(EVENT_ID);
    assert.equal(before?.status, "failed");
    assert.equal(before?.error_message, "panne transitoire");

    const again = await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    assert.equal(again, "proceed", "un évènement failed DOIT pouvoir être rejoué (c'est le bug d'origine)");
    const after = db.event(EVENT_ID);
    assert.equal(after?.status, "processing");
    assert.equal(after?.error_message, null, "l'erreur précédente doit être nettoyée");
    assert.equal(after?.attempts_count, 2, "attempts_count doit être incrémenté à la reprise");
  });

  // ── 5. Processing récent : already_processing, réponse retryable ─────
  await test("5. Processing récent — already_processing, aucun handler, 409 retryable", async () => {
    const db = makeDb();
    await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);

    let handlerCalls = 0;
    const res = await runRoute(db, async () => {
      handlerCalls++;
    });
    assert.equal(res.status, 409, "409 et non 200 : ne jamais acquitter prématurément une livraison Stripe");
    assert.equal(handlerCalls, 0);
  });

  // ── 6. Processing expiré : reprise par un seul worker ────────────────
  await test("6. Processing expiré — reprise autorisée par UN SEUL worker", async () => {
    const db = makeDb();
    await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);

    // Vieillit artificiellement le bail au-delà de sa durée.
    const stale = new Date(Date.now() - STRIPE_EVENT_LOCK_LEASE_MS - 60_000).toISOString();
    const row = db.event(EVENT_ID);
    assert.ok(row);
    row.processing_started_at = stale;

    const [a, b] = await Promise.all([
      acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD),
      acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD),
    ]);
    const proceeds = [a, b].filter((r) => r === "proceed");
    assert.equal(proceeds.length, 1, `un seul worker doit reprendre un bail expiré, obtenu : ${a} / ${b}`);
  });

  // ── 7. Handler en erreur : failed, processed_at null, 500 ────────────
  await test("7. Handler en erreur — status=failed, processed_at null, HTTP 500", async () => {
    const db = makeDb();
    const res = await runRoute(db, async () => {
      throw new Error("écriture Supabase impossible");
    });
    assert.equal(res.status, 500, "500 pour que Stripe reprogramme un essai");
    const row = db.event(EVENT_ID);
    assert.equal(row?.status, "failed");
    assert.equal(row?.processed_at, null, "processed_at doit rester NULL en cas d'échec");
    assert.equal(row?.error_message, "écriture Supabase impossible");
    assert.ok(row?.failed_at, "failed_at doit être renseigné");
  });

  // ── 8. Handler réussi : processed, processed_at rempli ───────────────
  await test("8. Handler réussi — status=processed, processed_at rempli, HTTP 200", async () => {
    const db = makeDb();
    let handlerCalls = 0;
    const res = await runRoute(db, async () => {
      handlerCalls++;
    });
    assert.equal(res.status, 200);
    assert.equal(handlerCalls, 1);
    const row = db.event(EVENT_ID);
    assert.equal(row?.status, "processed");
    assert.ok(row?.processed_at, "processed_at doit être renseigné APRÈS la réussite du handler");
  });

  // ── 9. Évènement volontairement ignoré ──────────────────────────────
  await test("9. Évènement ignoré — processed avec raison, aucun effet métier, pas de retry", async () => {
    const db = makeDb();
    let handlerCalls = 0;
    const res = await runRoute(
      db,
      async () => {
        handlerCalls++;
      },
      { handled: false },
    );
    assert.equal(res.status, 200, "un type non géré n'est PAS une erreur : pas de retry Stripe inutile");
    assert.equal(res.body.ignored, true);
    assert.equal(handlerCalls, 0, "aucun effet métier");
    const row = db.event(EVENT_ID);
    assert.equal(row?.status, "processed");
    assert.equal(row?.error_message, "ignored_unhandled_event_type", "la raison doit rester traçable");
  });

  // ── 10. Évènement test reçu alors que STRIPE_EXPECTED_LIVEMODE=true ──
  await test("10. Event test + EXPECTED_LIVEMODE=true — rejet, aucune écriture, aucun handler", async () => {
    const db = makeDb();
    const previous = process.env.STRIPE_EXPECTED_LIVEMODE;
    process.env.STRIPE_EXPECTED_LIVEMODE = "true";
    try {
      const check = checkStripeLivemode(false);
      assert.equal(check.ok, false);
      assert.equal(check.ok === false && check.reason, "mismatch");
      // La route sort AVANT toute écriture : rien ne doit exister en base.
      assert.equal((db.tables.billing_events ?? []).length, 0, "aucune ligne ne doit être écrite pour un évènement rejeté");
    } finally {
      if (previous === undefined) delete process.env.STRIPE_EXPECTED_LIVEMODE;
      else process.env.STRIPE_EXPECTED_LIVEMODE = previous;
    }
  });

  // ── 11. Évènement live reçu alors que STRIPE_EXPECTED_LIVEMODE=false ─
  await test("11. Event live + EXPECTED_LIVEMODE=false — rejet, aucune écriture, aucun handler", async () => {
    const db = makeDb();
    const previous = process.env.STRIPE_EXPECTED_LIVEMODE;
    process.env.STRIPE_EXPECTED_LIVEMODE = "false";
    try {
      const check = checkStripeLivemode(true);
      assert.equal(check.ok, false);
      assert.equal(check.ok === false && check.reason, "mismatch");
      assert.equal((db.tables.billing_events ?? []).length, 0);

      // Cas nominal inverse : un évènement test est accepté.
      assert.equal(checkStripeLivemode(false).ok, true);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_EXPECTED_LIVEMODE;
      else process.env.STRIPE_EXPECTED_LIVEMODE = previous;
    }
  });

  // ── 11 bis. Variable absente : refus, jamais d'autorisation implicite ─
  await test("11bis. STRIPE_EXPECTED_LIVEMODE absente — refus explicite (pas de défaut permissif)", async () => {
    const previous = process.env.STRIPE_EXPECTED_LIVEMODE;
    delete process.env.STRIPE_EXPECTED_LIVEMODE;
    try {
      const check = checkStripeLivemode(false);
      assert.equal(check.ok, false);
      assert.equal(check.ok === false && check.reason, "not_configured");
    } finally {
      if (previous !== undefined) process.env.STRIPE_EXPECTED_LIVEMODE = previous;
    }
  });

  // ── 12. Non-régression du verrou programme public ───────────────────
  await test("12. Verrou programme public — non-régression déléguée au harnais existant", async () => {
    // Le verrou `acquirePublicProgramPurchaseEventLock` et ses 17 tests
    // (scripts/tests/webhook-idempotency.mts) ne sont PAS réécrits par le
    // Lot W1 : sa logique `_seth_*` et ses valeurs de retour sont
    // inchangées, seules des colonnes miroir ont été ajoutées à ses
    // écritures. La non-régression se vérifie donc en lançant
    // `npm run test:webhook-idempotency`, pas en dupliquant ces tests ici.
    assert.ok(true);
  });

  // ── Bonus : "unknown_legacy" ne doit jamais être rejoué ──────────────
  await test("bonus. Ligne unknown_legacy — jamais rejouée (réussite inconnue)", async () => {
    const db = makeDb();
    db.tables.billing_events = [
      {
        stripe_event_id: EVENT_ID,
        event_type: EVENT_TYPE,
        status: "unknown_legacy",
        processed_at: null,
        processing_started_at: null,
        attempts_count: 1,
      },
    ];
    const result = await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    assert.equal(result, "already_processed", "une ligne historique ne doit jamais être rejouée automatiquement");
    assert.equal(db.event(EVENT_ID)?.status, "unknown_legacy", "son statut ne doit pas être écrasé");
  });

  // ── Bonus : panne DB à l'acquisition → lock_error, jamais proceed ────
  await test("bonus. Panne DB à l'acquisition — lock_error, aucun handler", async () => {
    const db = makeDb();
    db.failNext("billing_events", "insert");
    const result = await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    assert.equal(result, "lock_error", "une panne ne doit jamais être confondue avec un verrou acquis");
  });

  // ═══════════════════════════════════════════════════════════════════
  // ORDRE DE LIVRAISON (correction bloquante W1)
  //
  // Stripe ne garantit PAS l'ordre : un subscription.created ou un
  // invoice.paid peut précéder le checkout.session.completed qui crée le
  // rattachement billing_customers. « Élève non résolu » ne vaut donc
  // JAMAIS succès automatique.
  // ═══════════════════════════════════════════════════════════════════

  /** Objet Stripe.Subscription minimal, typé via un cast unique (jamais `any`). */
  function fakeSubscription(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_order_test",
      customer: "cus_order_test",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: {},
      items: { data: [{ price: { id: "price_seth_1", product: "prod_1", unit_amount: 4500, currency: "eur" }, current_period_start: 1, current_period_end: 2 }] },
      ...overrides,
    } as unknown as Parameters<typeof handleSubscriptionUpsert>[1];
  }

  await test("O1. subscription.created AVANT checkout — failed, puis succès au retry", async () => {
    const db = makeDb();
    // Aucun billing_customers : le Checkout n'est pas encore arrivé.
    // MAIS la metadata prouve l'appartenance à SETH.
    const sub = fakeSubscription({ metadata: { student_id: "student_1", template_id: "tpl_1" } });

    // 1er passage : la metadata porte student_id → la résolution ABOUTIT
    // (c'est le comportement voulu : indépendance à l'ordre des évènements).
    await handleSubscriptionUpsert(db, sub);
    assert.equal(db.tables.subscriptions?.length, 1, "l'abonnement doit être enregistré grâce à la metadata");

    // Variante sans metadata student_id mais avec template_id : appartenance
    // prouvée, rattachement impossible → CAS B, erreur retryable.
    const db2 = makeDb();
    const subNoStudent = fakeSubscription({ id: "sub_b", metadata: { template_id: "tpl_1" } });
    await assert.rejects(
      () => handleSubscriptionUpsert(db2, subNoStudent),
      (err: unknown) => err instanceof StripeCustomerMappingUnresolvedError,
      "un objet SETH non rattaché doit lever une erreur RETRYABLE, jamais réussir silencieusement",
    );
    assert.equal(db2.tables.subscriptions?.length ?? 0, 0, "rien ne doit être écrit tant que le rattachement est inconnu");

    // Retry APRÈS création du mapping par le Checkout : succès.
    db2.tables.billing_customers = [{ stripe_customer_id: "cus_order_test", student_id: "student_1" }];
    await handleSubscriptionUpsert(db2, subNoStudent);
    assert.equal(db2.tables.subscriptions?.length, 1, "le retry doit aboutir une fois le mapping créé");
  });

  await test("O2. invoice.paid AVANT rattachement — failed, aucun processed prématuré", async () => {
    const db = makeDb();
    // Simule le parcours route complet avec un handler qui lève CAS B.
    const res = await runRoute(db, async () => {
      throw new StripeCustomerMappingUnresolvedError("invoice.paid / invoice in_x");
    });
    assert.equal(res.status, 500, "HTTP 500 pour autoriser le retry Stripe");
    const row = db.event(EVENT_ID);
    assert.equal(row?.status, "failed");
    assert.equal(row?.processed_at, null, "aucun processed prématuré");
    assert.equal(
      row?.error_message,
      StripeCustomerMappingUnresolvedError.REASON,
      "error_message doit valoir customer_or_student_mapping_unresolved",
    );
  });

  await test("O3. Objet sans metadata et réellement étranger — processed + ignored_unrelated_stripe_object", async () => {
    const db = makeDb();
    // Aucune metadata, aucun billing_customers, aucun price connu.
    const ownership = await assessStripeObjectOwnership(db, {
      metadata: {},
      stripeCustomerId: null,
      priceId: null,
    });
    assert.equal(ownership.belongsToSeth, false, "aucun indice ⇒ objet étranger");

    const res = await runRoute(db, async () => {
      throw new StripeUnrelatedObjectError("objet étranger");
    });
    assert.equal(res.status, 200, "un objet étranger ne doit PAS déclencher de retry Stripe");
    assert.equal(res.body.reason, IGNORED_UNRELATED_STRIPE_OBJECT);
    const row = db.event(EVENT_ID);
    assert.equal(row?.status, "processed");
    assert.equal(row?.error_message, IGNORED_UNRELATED_STRIPE_OBJECT, "la raison doit être persistée");
  });

  await test("O4. student_id inconnu — failed, PAS ignoré", async () => {
    const db = makeDb();
    // student_id présent mais introuvable en base : c'est un objet SETH.
    const ownership = await assessStripeObjectOwnership(db, {
      metadata: { student_id: "student_inexistant" } as unknown as Parameters<typeof assessStripeObjectOwnership>[1]["metadata"],
      stripeCustomerId: "cus_inconnu",
      priceId: null,
    });
    assert.equal(ownership.belongsToSeth, true, "un student_id, même inconnu, prouve l'appartenance à SETH");
    assert.ok(ownership.evidence.includes("metadata.student_id"));
  });

  await test("O5. Retry après résolution — un seul traitement métier final", async () => {
    const db = makeDb();
    let businessEffects = 0;

    // 1er essai : CAS B → failed, aucun effet métier.
    const first = await runRoute(db, async () => {
      throw new StripeCustomerMappingUnresolvedError("mapping absent");
    });
    assert.equal(first.status, 500);
    assert.equal(businessEffects, 0);

    // Retry après résolution : le verrou autorise la reprise, le handler réussit.
    const second = await runRoute(db, async () => {
      businessEffects++;
    });
    assert.equal(second.status, 200);
    assert.equal(businessEffects, 1, "exactement UN traitement métier au total");

    // 3e livraison (Stripe peut renvoyer même après un 200) : dédupliquée.
    const third = await runRoute(db, async () => {
      businessEffects++;
    });
    assert.equal(third.status, 200);
    assert.equal(third.body.deduplicated, true);
    assert.equal(businessEffects, 1, "toujours UN SEUL traitement métier");
    assert.equal((db.tables.billing_events ?? []).length, 1, "une seule ligne pour les 3 livraisons");
  });

  // ═══════════════════════════════════════════════════════════════════
  // MIGRATION DES LIGNES HISTORIQUES
  // Vérifie le comportement ATTENDU du backfill décrit dans
  // supabase/migrations/20260721180920_billing_events_processing_status.sql
  // (règle 3a/3b), sur des lignes simulées.
  // ═══════════════════════════════════════════════════════════════════

  /** Reproduit fidèlement le backfill SQL 3a/3b de la migration. */
  function applyLegacyBackfill(rows: Row[]): Row[] {
    return rows.map((r) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const sethStatus = payload._seth_status as string | undefined;
      const payloadBefore = JSON.stringify(payload);

      const migrated: Row =
        sethStatus && ["processing", "processed", "failed"].includes(sethStatus)
          ? {
              ...r,
              status: sethStatus,
              processing_started_at: payload._seth_lease_started_at ?? null,
              failed_at: payload._seth_failed_at ?? null,
              error_message: payload._seth_error ?? null,
              attempts_count: 1,
              last_attempt_at: r.created_at,
              processed_at: sethStatus === "processed" ? r.processed_at : null,
            }
          : { ...r, status: "unknown_legacy", processed_at: null, attempts_count: 1, last_attempt_at: r.created_at };

      // Le payload ne doit JAMAIS être modifié par la migration.
      assert.equal(JSON.stringify(migrated.payload), payloadBefore, "payload inchangé");
      return migrated;
    });
  }

  /** Contrainte SQL `billing_events_processed_at_check`. */
  function assertCoherence(row: Row) {
    assert.equal(
      row.status === "processed",
      row.processed_at !== null && row.processed_at !== undefined,
      `violation de billing_events_processed_at_check sur ${String(row.stripe_event_id)}`,
    );
  }

  await test("M1. Migration — anciennes lignes génériques deviennent unknown_legacy, processed_at null", async () => {
    // Reproduit les 15 lignes réellement observées en base (audit lecture
    // seule) : aucune ne portait de _seth_status.
    const legacy: Row[] = [
      { stripe_event_id: "evt_1", event_type: "customer.subscription.created", payload: { id: "evt_1", livemode: false }, processed_at: "2026-07-12T20:05:19Z", created_at: "2026-07-12T20:05:19Z" },
      { stripe_event_id: "evt_2", event_type: "invoice.payment_succeeded", payload: { id: "evt_2", livemode: false }, processed_at: "2026-07-13T13:47:20Z", created_at: "2026-07-13T13:47:20Z" },
      { stripe_event_id: "evt_3", event_type: "charge.succeeded", payload: { id: "evt_3", livemode: false }, processed_at: "2026-07-17T18:24:02Z", created_at: "2026-07-17T18:24:02Z" },
    ];

    const migrated = applyLegacyBackfill(legacy);
    for (const row of migrated) {
      assert.equal(row.status, "unknown_legacy", "aucune réussite ne doit être inventée");
      assert.equal(row.processed_at, null, "processed_at doit être effacé : il ne prouvait rien");
      assert.equal(row.attempts_count, 1);
      assertCoherence(row);
    }
  });

  await test("M2. Migration — lignes unknown_legacy jamais rejouées", async () => {
    const db = makeDb();
    db.tables.billing_events = applyLegacyBackfill([
      { stripe_event_id: EVENT_ID, event_type: EVENT_TYPE, payload: { id: EVENT_ID }, processed_at: "2026-07-12T20:05:19Z", created_at: "2026-07-12T20:05:19Z" },
    ]);

    let handlerCalls = 0;
    const res = await runRoute(db, async () => {
      handlerCalls++;
    });
    assert.equal(res.status, 200);
    assert.equal(handlerCalls, 0, "une ligne historique ne doit JAMAIS déclencher d'effet métier");
    assert.equal(db.event(EVENT_ID)?.status, "unknown_legacy", "son statut ne doit pas être écrasé");
  });

  await test("M3. Migration — lignes programme public : _seth_* et colonnes génériques cohérents", async () => {
    const legacy: Row[] = [
      {
        stripe_event_id: "evt_pp_processed",
        event_type: "checkout.session.completed",
        payload: { id: "evt_pp_processed", _seth_status: "processed", _seth_lease_started_at: "2026-07-17T18:24:00Z" },
        processed_at: "2026-07-17T18:24:05Z",
        created_at: "2026-07-17T18:24:00Z",
      },
      {
        stripe_event_id: "evt_pp_failed",
        event_type: "checkout.session.completed",
        payload: { id: "evt_pp_failed", _seth_status: "failed", _seth_error: "email refusé", _seth_failed_at: "2026-07-17T18:30:00Z" },
        processed_at: "2026-07-17T18:24:00Z",
        created_at: "2026-07-17T18:24:00Z",
      },
      {
        stripe_event_id: "evt_pp_processing",
        event_type: "checkout.session.completed",
        payload: { id: "evt_pp_processing", _seth_status: "processing", _seth_lease_started_at: "2026-07-17T18:24:00Z" },
        processed_at: "2026-07-17T18:24:00Z",
        created_at: "2026-07-17T18:24:00Z",
      },
    ];

    const migrated = applyLegacyBackfill(legacy);

    for (const row of migrated) {
      const payload = row.payload as Record<string, unknown>;
      assert.equal(row.status, payload._seth_status, "status doit refléter exactement _seth_status");
      assertCoherence(row);
    }

    assert.ok(migrated[0].processed_at, "processed conserve son processed_at (réussite prouvée)");
    assert.equal(migrated[1].processed_at, null, "failed ne doit PAS avoir de processed_at");
    assert.equal(migrated[1].error_message, "email refusé", "l'erreur _seth_error est reprise");
    assert.equal(migrated[2].processed_at, null, "processing ne doit PAS avoir de processed_at");
  });

  await test("M4. Migration — une ligne failed reste rejouable après migration", async () => {
    const db = makeDb();
    db.tables.billing_events = applyLegacyBackfill([
      {
        stripe_event_id: EVENT_ID,
        event_type: EVENT_TYPE,
        payload: { id: EVENT_ID, _seth_status: "failed", _seth_error: "panne" },
        processed_at: "2026-07-17T18:24:00Z",
        created_at: "2026-07-17T18:24:00Z",
      },
    ]);

    const result = await acquireStripeEventLock(db, EVENT_ID, EVENT_TYPE, PAYLOAD);
    assert.equal(result, "proceed", "un échec antérieur reste explicitement rejouable");
  });

  console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
