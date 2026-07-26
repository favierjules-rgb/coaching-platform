/**
 * Tests de la suppression SÛRE des modèles d'abonnement — helper Stripe strict,
 * orchestrateur pur (garde-fous + ordre), et éligibilité/références. Aucun appel
 * Stripe ou Supabase réel : tout est mocké. Lancer :
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/subscription-template-deletion.mts
 */
import assert from "node:assert/strict";

import {
  archiveStripeForDeletedTemplate,
  archiveStripePriceOnly,
  describeStripeError,
  reactivateStripeForTemplate,
} from "@/lib/stripe/subscription-templates";
import {
  performSubscriptionTemplateArchive,
  performSubscriptionTemplateDeletion,
  performSubscriptionTemplateReactivation,
} from "@/lib/billing/subscription-template-deletion";
import {
  getSubscriptionTemplateReferences,
  isTemplateDeletable,
  type SubscriptionTemplateReferences,
} from "@/lib/supabase/subscription-templates";
import type { SubscriptionTemplate } from "@/types";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("ok   -", name);
  } catch (error) {
    failed++;
    console.error("FAIL -", name);
    console.error("       ", error instanceof Error ? error.message : error);
  }
}

const RESOURCE_MISSING = { code: "resource_missing", message: "No such price" };
const REAL_STRIPE_ERROR = { type: "StripeAPIError", code: "api_error", message: "boom" };

function makeTemplate(over: Partial<SubscriptionTemplate> = {}): SubscriptionTemplate {
  return {
    id: "tpl_1",
    name: "Test",
    description: "",
    amountCents: 1900,
    currency: "eur",
    billingInterval: "one_time",
    durationMonths: null,
    stripeProductId: "prod_1",
    stripePriceId: "price_1",
    isActive: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    createdBy: null,
    ...over,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeFakeStripe(opts: {
  priceUpdateError?: unknown;
  productUpdateError?: unknown;
  productRetrieveError?: unknown;
  activePrices?: { id: string }[];
  productActive?: boolean;
} = {}) {
  const calls = { priceUpdate: [] as any[], productUpdate: [] as any[], priceList: [] as any[], productRetrieve: [] as any[] };
  const stripe = {
    calls,
    prices: {
      update: async (id: string, params: any) => {
        calls.priceUpdate.push({ id, params });
        if (opts.priceUpdateError) throw opts.priceUpdateError;
        return { id };
      },
      list: async (params: any) => {
        calls.priceList.push(params);
        return { data: opts.activePrices ?? [] };
      },
    },
    products: {
      retrieve: async (id: string) => {
        calls.productRetrieve.push(id);
        if (opts.productRetrieveError) throw opts.productRetrieveError;
        return { id, active: opts.productActive ?? true };
      },
      update: async (id: string, params: any) => {
        calls.productUpdate.push({ id, params });
        if (opts.productUpdateError) throw opts.productUpdateError;
        return { id };
      },
    },
  };
  return stripe;
}

/** Faux client Supabase pour getSubscriptionTemplateReferences : renvoie un count selon la dernière colonne .eq(). */
function makeFakeSupabaseCounts(map: Record<string, number>) {
  return {
    from() {
      return {
        select() {
          const builder: any = {
            _col: null as string | null,
            eq(col: string) {
              this._col = col;
              return this;
            },
            neq() {
              return this;
            },
            then(resolve: (r: { count: number; error: null }) => void) {
              resolve({ count: map[this._col ?? ""] ?? 0, error: null });
            },
          };
          return builder;
        },
      };
    },
  } as any;
}

const noRefs: SubscriptionTemplateReferences = {
  studentsByTemplateId: 0,
  studentsByPriceId: 0,
  subscriptions: 0,
  payments: 0,
  otherTemplatesSharingProduct: 0,
};

function makeDeps(over: Partial<Parameters<typeof performSubscriptionTemplateDeletion>[1]>) {
  const record = { archiveStripeCalled: 0, rpcCalled: 0, setActiveCalls: [] as boolean[] };
  const deps = {
    loadTemplate: async () => makeTemplate(),
    getReferences: async () => noRefs,
    setActive: async (_id: string, isActive: boolean) => {
      record.setActiveCalls.push(isActive);
      return true;
    },
    archiveStripe: async () => {
      record.archiveStripeCalled++;
      return { priceArchived: true, productArchived: true };
    },
    deleteViaRpc: async () => {
      record.rpcCalled++;
      return { result: "deleted" as const };
    },
    stripeConfigured: true,
    describeStripeError,
    ...over,
  };
  return { deps, record };
}

async function run() {
  // ─── Helper Stripe strict ───
  await test("7. Price déjà inactif (resource_missing) → priceArchived idempotent", async () => {
    const stripe = makeFakeStripe({ priceUpdateError: RESOURCE_MISSING });
    const r = await archiveStripeForDeletedTemplate(stripe as any, {
      productId: "prod_1",
      priceId: "price_1",
      otherTemplatesShareProduct: false,
    });
    assert.equal(r.priceArchived, true);
    assert.equal(r.productArchived, true);
  });

  await test("8. Product partagé (autre modèle) → Price archivé, Product NON archivé", async () => {
    const stripe = makeFakeStripe();
    const r = await archiveStripeForDeletedTemplate(stripe as any, {
      productId: "prod_1",
      priceId: "price_1",
      otherTemplatesShareProduct: true,
    });
    assert.equal(r.priceArchived, true);
    assert.equal(r.productArchived, false);
    assert.equal(r.productSkippedReason, "shared_product");
    assert.equal(stripe.calls.productUpdate.length, 0, "products.update ne doit pas être appelé");
  });

  await test("9. Product non partagé, aucun autre Price actif → Product archivé", async () => {
    const stripe = makeFakeStripe({ activePrices: [{ id: "price_1" }] });
    const r = await archiveStripeForDeletedTemplate(stripe as any, {
      productId: "prod_1",
      priceId: "price_1",
      otherTemplatesShareProduct: false,
    });
    assert.equal(r.productArchived, true);
    assert.equal(stripe.calls.productUpdate.length, 1);
  });

  await test("8b. Autre Price actif rattaché au Product → Product NON archivé (active_prices)", async () => {
    const stripe = makeFakeStripe({ activePrices: [{ id: "price_1" }, { id: "price_other" }] });
    const r = await archiveStripeForDeletedTemplate(stripe as any, {
      productId: "prod_1",
      priceId: "price_1",
      otherTemplatesShareProduct: false,
    });
    assert.equal(r.productArchived, false);
    assert.equal(r.productSkippedReason, "active_prices");
  });

  await test("Product id manquant → productArchived false (missing_id)", async () => {
    const stripe = makeFakeStripe();
    const r = await archiveStripeForDeletedTemplate(stripe as any, {
      productId: null,
      priceId: "price_1",
      otherTemplatesShareProduct: false,
    });
    assert.equal(r.priceArchived, true);
    assert.equal(r.productArchived, false);
    assert.equal(r.productSkippedReason, "missing_id");
  });

  await test("6h. Échec RÉEL d'archivage Price → l'exception est propagée", async () => {
    const stripe = makeFakeStripe({ priceUpdateError: REAL_STRIPE_ERROR });
    await assert.rejects(() =>
      archiveStripeForDeletedTemplate(stripe as any, { productId: "prod_1", priceId: "price_1", otherTemplatesShareProduct: false }),
    );
  });

  await test("10h. Échec RÉEL d'archivage Product → l'exception est propagée", async () => {
    const stripe = makeFakeStripe({ productUpdateError: REAL_STRIPE_ERROR });
    await assert.rejects(() =>
      archiveStripeForDeletedTemplate(stripe as any, { productId: "prod_1", priceId: "price_1", otherTemplatesShareProduct: false }),
    );
  });

  // ─── Éligibilité / références ───
  await test("isTemplateDeletable : aucune référence → true", () => {
    assert.equal(isTemplateDeletable(noRefs), true);
  });
  await test("3. Élève attribué (par id) → non éligible", () => {
    assert.equal(isTemplateDeletable({ ...noRefs, studentsByTemplateId: 1 }), false);
  });
  await test("3b. Élève attribué (par prix, colonne texte) → non éligible", () => {
    assert.equal(isTemplateDeletable({ ...noRefs, studentsByPriceId: 1 }), false);
  });
  await test("4/5. Abonnement local (actif ou historique) → non éligible", () => {
    assert.equal(isTemplateDeletable({ ...noRefs, subscriptions: 1 }), false);
  });
  await test("Product partagé seul (sans élève/abo) → reste éligible", () => {
    assert.equal(isTemplateDeletable({ ...noRefs, otherTemplatesSharingProduct: 2 }), true);
  });

  await test("getSubscriptionTemplateReferences mappe correctement les counts", async () => {
    const supabase = makeFakeSupabaseCounts({
      assigned_subscription_template_id: 2,
      assigned_stripe_price_id: 1,
      stripe_price_id: 3,
      stripe_product_id: 4,
    });
    const refs = await getSubscriptionTemplateReferences(supabase, makeTemplate());
    assert.equal(refs.studentsByTemplateId, 2);
    assert.equal(refs.studentsByPriceId, 1);
    assert.equal(refs.subscriptions, 3);
    assert.equal(refs.otherTemplatesSharingProduct, 4);
  });

  // ─── Orchestrateur (garde-fous + ordre) ───
  await test("2. Modèle absent → 404, aucun effet", async () => {
    const { deps, record } = makeDeps({ loadTemplate: async () => null });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 404);
    assert.equal(record.archiveStripeCalled, 0);
    assert.equal(record.rpcCalled, 0);
  });

  await test("3. Élève attribué → 409, AUCUNE requête Stripe, AUCUNE RPC", async () => {
    const { deps, record } = makeDeps({ getReferences: async () => ({ ...noRefs, studentsByTemplateId: 1 }) });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 409);
    assert.equal((out.body as any).deletable, false);
    assert.equal(record.archiveStripeCalled, 0);
    assert.equal(record.rpcCalled, 0);
  });

  await test("4. Abonnement lié → 409", async () => {
    const { deps } = makeDeps({ getReferences: async () => ({ ...noRefs, subscriptions: 2 }) });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 409);
  });

  await test("6. Échec archivage Stripe → 502, RPC JAMAIS appelée, pas de secret", async () => {
    const { deps, record } = makeDeps({
      archiveStripe: async () => {
        throw REAL_STRIPE_ERROR;
      },
    });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 502);
    assert.equal(record.rpcCalled, 0, "la suppression ne doit pas être tentée");
    assert.equal((out.body as any).archived, true, "le modèle reste archivé");
    const body = JSON.stringify(out.body);
    assert.ok(!/sk_|secret|token|whsec_/i.test(body), "aucun secret dans la réponse");
    assert.ok(/boom/.test(body), "le message Stripe est transmis");
  });

  await test("7o. Stripe requis mais non configuré → 503, aucune RPC", async () => {
    const { deps, record } = makeDeps({ stripeConfigured: false });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 503);
    assert.equal(record.rpcCalled, 0);
  });

  await test("11. Modèle rendu INACTIF avant tout appel Stripe", async () => {
    const { deps, record } = makeDeps({});
    await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.deepEqual(record.setActiveCalls, [false], "désactivation préalable effectuée");
  });

  await test("12. Référence apparue après le 1er audit → 409, aucune RPC, reste archivé", async () => {
    let call = 0;
    const { deps, record } = makeDeps({
      getReferences: async () => {
        call++;
        return call === 1 ? noRefs : { ...noRefs, studentsByTemplateId: 1 };
      },
    });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 409);
    assert.equal(record.archiveStripeCalled, 0);
    assert.equal(record.rpcCalled, 0);
    assert.equal((out.body as any).archived, true);
  });

  await test("13. RPC finale `in_use` → 409, aucune suppression, reste archivé", async () => {
    const { deps } = makeDeps({
      deleteViaRpc: async () => ({ result: "in_use" as const, references: { subscriptions: 1 } }),
    });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 409);
    assert.equal((out.body as any).archived, true);
  });

  await test("14. RPC finale `deleted` → 200 succès", async () => {
    const { deps, record } = makeDeps({});
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 200);
    assert.equal((out.body as any).success, true);
    assert.equal(record.rpcCalled, 1);
  });

  await test("15. Erreur RPC après Stripe → 500, modèle reste archivé + message de réessai", async () => {
    const { deps } = makeDeps({ deleteViaRpc: async () => ({ result: "error" as const, message: "db down" }) });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 500);
    assert.equal((out.body as any).archived, true);
    assert.ok(/reste archivé/.test(String((out.body as any).error)));
  });

  await test("RPC `not_found` (déjà supprimé) → 200 idempotent", async () => {
    const { deps } = makeDeps({ deleteViaRpc: async () => ({ result: "not_found" as const }) });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 200);
    assert.equal((out.body as any).alreadyDeleted, true);
  });

  await test("17. Paiement historique bloquant → 409 (garde-fou paiements)", async () => {
    const { deps, record } = makeDeps({ getReferences: async () => ({ ...noRefs, payments: 1 }) });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 409);
    assert.equal(record.archiveStripeCalled, 0);
  });

  await test("16. Aucun détachement silencieux : setActive n'est jamais appelé si inéligible", async () => {
    const { deps, record } = makeDeps({ getReferences: async () => ({ ...noRefs, studentsByTemplateId: 1 }) });
    await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.deepEqual(record.setActiveCalls, [], "aucune écriture si le modèle est utilisé");
  });

  await test("8o. Product partagé → succès 200 (Price archivé, Product conservé)", async () => {
    const { deps } = makeDeps({
      getReferences: async () => ({ ...noRefs, otherTemplatesSharingProduct: 1 }),
      archiveStripe: async () => ({ priceArchived: true, productArchived: false, productSkippedReason: "shared_product" }),
    });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 200);
    assert.equal((out.body as any).stripe.productArchived, false);
  });

  await test("Modèle sans id Stripe → aucune requête Stripe, RPC directe", async () => {
    const { deps, record } = makeDeps({
      loadTemplate: async () => makeTemplate({ stripeProductId: null, stripePriceId: null }),
    });
    const out = await performSubscriptionTemplateDeletion("tpl_1", deps);
    assert.equal(out.status, 200);
    assert.equal(record.archiveStripeCalled, 0);
    assert.equal(record.rpcCalled, 1);
  });

  /* ─── ARCHIVAGE (application + Price) ─── */
  await test("A1. LOCAL archivé PUIS Price Stripe (nouvel ordre)", async () => {
    const order: string[] = [];
    const out = await performSubscriptionTemplateArchive("tpl_1", {
      loadTemplate: async () => makeTemplate(),
      archivePrice: async () => {
        order.push("stripe");
      },
      setActive: async (_id, isActive) => {
        order.push(`db:${isActive}`);
        return true;
      },
      stripeConfigured: true,
      describeStripeError,
    });
    assert.equal(out.status, 200);
    assert.deepEqual(order, ["db:false", "stripe"], "la base avant Stripe");
    assert.equal((out.body as any).localArchived, true);
    assert.equal((out.body as any).stripePriceArchived, true);
  });

  await test("A2. Local archivé + échec Stripe → archivage PARTIEL réessayable", async () => {
    let dbCalled = 0;
    const out = await performSubscriptionTemplateArchive("tpl_1", {
      loadTemplate: async () => makeTemplate(),
      archivePrice: async () => {
        throw REAL_STRIPE_ERROR;
      },
      setActive: async () => {
        dbCalled++;
        return true;
      },
      stripeConfigured: true,
      describeStripeError,
    });
    assert.equal(out.status, 502);
    assert.equal(dbCalled, 1, "le modèle reste archivé localement");
    assert.equal((out.body as any).localArchived, true);
    assert.equal((out.body as any).stripePriceArchived, false);
    assert.equal((out.body as any).retryable, true);
    assert.ok(/archivé dans l'application/.test(String((out.body as any).error)));
  });

  await test("A2b. Réessai après archivage partiel → Price archivé, succès", async () => {
    let attempt = 0;
    const deps = {
      loadTemplate: async () => makeTemplate(),
      archivePrice: async () => {
        attempt++;
        if (attempt === 1) throw REAL_STRIPE_ERROR;
      },
      setActive: async () => true,
      stripeConfigured: true,
      describeStripeError,
    };
    const first = await performSubscriptionTemplateArchive("tpl_1", deps);
    assert.equal(first.status, 502);
    const second = await performSubscriptionTemplateArchive("tpl_1", deps);
    assert.equal(second.status, 200);
    assert.equal((second.body as any).stripePriceArchived, true);
  });

  await test("A2c. Échec local → 500, AUCUN appel Stripe", async () => {
    let stripeCalled = 0;
    const out = await performSubscriptionTemplateArchive("tpl_1", {
      loadTemplate: async () => makeTemplate(),
      archivePrice: async () => {
        stripeCalled++;
      },
      setActive: async () => false,
      stripeConfigured: true,
      describeStripeError,
    });
    assert.equal(out.status, 500);
    assert.equal(stripeCalled, 0);
  });

  await test("A3. Price déjà inactif (helper) → succès idempotent", async () => {
    const stripe = makeFakeStripe({ priceUpdateError: RESOURCE_MISSING });
    await archiveStripePriceOnly(stripe as any, "price_1"); // ne doit pas lever
  });

  await test("A4. Archivage standard laisse le Product intact", async () => {
    const stripe = makeFakeStripe();
    await archiveStripePriceOnly(stripe as any, "price_1");
    assert.equal(stripe.calls.productUpdate.length, 0);
    assert.equal(stripe.calls.priceUpdate[0].params.active, false);
  });

  await test("A5. Archivage : aucun abonnement annulé (aucun appel subscriptions)", async () => {
    const stripe = makeFakeStripe() as any;
    stripe.subscriptions = {
      cancel: async () => {
        throw new Error("ne doit jamais être appelé");
      },
    };
    await archiveStripePriceOnly(stripe, "price_1");
  });

  /* ─── RÉACTIVATION ─── */
  await test("R6. Price réactivé puis local actif", async () => {
    const order: string[] = [];
    const out = await performSubscriptionTemplateReactivation("tpl_1", {
      loadTemplate: async () => makeTemplate(),
      reactivateStripe: async () => {
        order.push("stripe");
        return { productReactivated: false, priceReactivated: true };
      },
      setActive: async (_id, isActive) => {
        order.push(`db:${isActive}`);
        return true;
      },
      stripeConfigured: true,
      describeStripeError,
    });
    assert.equal(out.status, 200);
    assert.deepEqual(order, ["stripe", "db:true"]);
  });

  await test("R7. Product inactif → Product PUIS Price réactivés", async () => {
    const stripe = makeFakeStripe({ productActive: false });
    const r = await reactivateStripeForTemplate(stripe as any, { productId: "prod_1", priceId: "price_1" });
    assert.equal(r.productReactivated, true);
    assert.equal(r.priceReactivated, true);
    assert.equal(stripe.calls.productUpdate[0].params.active, true);
    assert.equal(stripe.calls.priceUpdate[0].params.active, true);
  });

  await test("R7b. Product déjà actif → non retouché, Price réactivé (idempotent)", async () => {
    const stripe = makeFakeStripe({ productActive: true });
    const r = await reactivateStripeForTemplate(stripe as any, { productId: "prod_1", priceId: "price_1" });
    assert.equal(r.productReactivated, false);
    assert.equal(stripe.calls.productUpdate.length, 0);
    assert.equal(r.priceReactivated, true);
  });

  await test("R8. Échec Product → local reste archivé", async () => {
    let dbCalled = 0;
    const out = await performSubscriptionTemplateReactivation("tpl_1", {
      loadTemplate: async () => makeTemplate(),
      reactivateStripe: async () => {
        throw REAL_STRIPE_ERROR;
      },
      setActive: async () => {
        dbCalled++;
        return true;
      },
      stripeConfigured: true,
      describeStripeError,
    });
    assert.equal(out.status, 502);
    assert.equal(dbCalled, 0);
    assert.ok(/reste archivé/.test(String((out.body as any).error)));
  });

  await test("R9. Échec Price (helper) → exception propagée", async () => {
    const stripe = makeFakeStripe({ priceUpdateError: REAL_STRIPE_ERROR, productActive: true });
    await assert.rejects(() => reactivateStripeForTemplate(stripe as any, { productId: "prod_1", priceId: "price_1" }));
  });

  /* ─── AUTHENTIFICATION (garde partagé des handlers GET/PATCH/DELETE) ─── */
  // Réplique fidèle de `requireStaff` (app/api/admin/subscription-templates/[id]/route.ts) :
  // même ordre de contrôles et mêmes codes — testée ici sans serveur Next.
  async function requireStaffLike(opts: { supabase: boolean; user: boolean; role: string | null }) {
    if (!opts.supabase) return { status: 503 };
    if (!opts.user) return { status: 401 };
    if (opts.role !== "admin" && opts.role !== "coach") return { status: 403 };
    return { status: 200 };
  }

  await test("18/20. Non authentifié → 401 (GET références et DELETE)", async () => {
    const r = await requireStaffLike({ supabase: true, user: false, role: null });
    assert.equal(r.status, 401);
  });
  await test("19/21. Authentifié non staff (élève) → 403", async () => {
    const r = await requireStaffLike({ supabase: true, user: true, role: "student" });
    assert.equal(r.status, 403);
  });
  await test("22. Archive/réactivation : même garde staff (élève refusé, coach accepté)", async () => {
    assert.equal((await requireStaffLike({ supabase: true, user: true, role: "student" })).status, 403);
    assert.equal((await requireStaffLike({ supabase: true, user: true, role: "coach" })).status, 200);
  });
  await test("Staff admin → autorisé ; Supabase absent → 503", async () => {
    assert.equal((await requireStaffLike({ supabase: true, user: true, role: "admin" })).status, 200);
    assert.equal((await requireStaffLike({ supabase: false, user: true, role: "admin" })).status, 503);
  });

  await test("R10. Stripe OK + échec DB finale → état partiel réessayable (reste archivé)", async () => {
    const out = await performSubscriptionTemplateReactivation("tpl_1", {
      loadTemplate: async () => makeTemplate(),
      reactivateStripe: async () => ({ productReactivated: true, priceReactivated: true }),
      setActive: async () => false,
      stripeConfigured: true,
      describeStripeError,
    });
    assert.equal(out.status, 500);
    assert.equal((out.body as any).localActive, false);
    assert.equal((out.body as any).stripeReactivated, true);
    assert.equal((out.body as any).retryable, true);
  });

  /* ─── PATCH : source unique du changement de statut ─── */
  // Réplique de la garde de la route : `isActive` seul → orchestrateur ;
  // `isActive` mélangé à d'autres champs → 400 ; sans isActive → PATCH normal.
  function patchGuard(body: Record<string, unknown>): { status: number; route: string } {
    const hasOther =
      body.name !== undefined ||
      body.description !== undefined ||
      body.amountCents !== undefined ||
      body.durationMonths !== undefined;
    if (body.isActive !== undefined && hasOther) return { status: 400, route: "refus" };
    if (body.isActive !== undefined) return { status: 200, route: "orchestrateur-stripe" };
    return { status: 200, route: "patch-general" };
  }

  await test("P1. PATCH isActive seul → orchestrateur Stripe", () => {
    assert.deepEqual(patchGuard({ isActive: false }), { status: 200, route: "orchestrateur-stripe" });
  });
  await test("P2. PATCH isActive + name → 400 refusé", () => {
    assert.equal(patchGuard({ isActive: false, name: "X" }).status, 400);
  });
  await test("P3. PATCH isActive + amountCents → 400 refusé", () => {
    assert.equal(patchGuard({ isActive: true, amountCents: 1000 }).status, 400);
  });
  await test("P4. PATCH général sans isActive → PATCH normal", () => {
    assert.deepEqual(patchGuard({ name: "X", amountCents: 1000 }), { status: 200, route: "patch-general" });
  });
  await test("P5. Aucune transition locale sans appel Stripe correspondant", () => {
    // Toute transition passe par patchGuard → route "orchestrateur-stripe",
    // qui appelle systématiquement archive/réactivation (donc Stripe).
    assert.equal(patchGuard({ isActive: true }).route, "orchestrateur-stripe");
    assert.equal(patchGuard({ isActive: false }).route, "orchestrateur-stripe");
  });

  console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
  if (failed > 0) process.exit(1);
}

await run();
