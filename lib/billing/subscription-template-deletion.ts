import type { SubscriptionTemplate } from "@/types";
import {
  isTemplateDeletable,
  type DeleteUnusedTemplateRpcResult,
  type SubscriptionTemplateReferences,
} from "@/lib/supabase/subscription-templates";
import type { ArchiveStripeResult } from "@/lib/stripe/subscription-templates";

/**
 * Orchestration PURE (sans dépendance framework/HTTP) des trois opérations
 * métier sur un modèle d'abonnement — extraite des routes pour être testée avec
 * des mocks Stripe/Supabase. Les effets réels sont injectés via `deps`.
 *
 * Invariant commun : **Stripe d'abord, base ensuite**. On n'écrit jamais un
 * état local qui contredirait Stripe (jamais de modèle actif pointant un Price
 * inactif, jamais de "archivé" annoncé si Stripe a refusé).
 */

export interface ArchiveTemplateDeps {
  loadTemplate: (id: string) => Promise<SubscriptionTemplate | null>;
  /** Archive UNIQUEMENT le Price (le Product reste actif). Doit lever en cas d'échec réel. */
  archivePrice: (priceId: string | null) => Promise<void>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
  stripeConfigured: boolean;
  describeStripeError: (error: unknown) => string;
}

export interface ReactivateTemplateDeps {
  loadTemplate: (id: string) => Promise<SubscriptionTemplate | null>;
  /** Réactive le Product (s'il est inactif) PUIS le Price. Doit lever en cas d'échec réel. */
  reactivateStripe: (input: { productId: string | null; priceId: string | null }) => Promise<{
    productReactivated: boolean;
    priceReactivated: boolean;
  }>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
  stripeConfigured: boolean;
  describeStripeError: (error: unknown) => string;
}

export interface DeleteTemplateDeps {
  loadTemplate: (id: string) => Promise<SubscriptionTemplate | null>;
  getReferences: (template: SubscriptionTemplate) => Promise<SubscriptionTemplateReferences>;
  /** Désactivation préalable (empêche toute nouvelle vente/affectation pendant l'opération). Idempotente. */
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
  /** Archivage Stripe STRICT (Price obligatoire, Product seulement s'il devient inutilisé). Doit lever en cas d'échec réel. */
  archiveStripe: (input: {
    productId: string | null;
    priceId: string | null;
    otherTemplatesShareProduct: boolean;
  }) => Promise<ArchiveStripeResult>;
  /** Suppression TRANSACTIONNELLE (RPC) : verrou + revérification + delete dans la même transaction. */
  deleteViaRpc: (id: string) => Promise<DeleteUnusedTemplateRpcResult | { result: "error"; message: string }>;
  stripeConfigured: boolean;
  describeStripeError: (error: unknown) => string;
}

export interface Outcome {
  status: 200 | 404 | 409 | 500 | 502 | 503;
  body: Record<string, unknown>;
}

const RETRY_HINT =
  "La suppression n'a pas abouti. Le modèle reste archivé et ne peut plus être proposé. Vous pouvez réessayer.";

/* ─────────────── ARCHIVER (application + Price Stripe) ─────────────── */

export async function performSubscriptionTemplateArchive(id: string, deps: ArchiveTemplateDeps): Promise<Outcome> {
  const existing = await deps.loadTemplate(id);
  if (!existing) return { status: 404, body: { error: "Modèle d'abonnement introuvable." } };

  // 2. LOCAL D'ABORD : un échec Supabase ne doit jamais laisser un modèle
  // encore proposable. Dès ce point, le modèle n'est plus vendable côté app.
  const archivedLocally = await deps.setActive(id, false);
  if (!archivedLocally) {
    return { status: 500, body: { error: "Échec de l'archivage local du modèle. Réessayez.", localArchived: false } };
  }

  // 3. Puis le Price Stripe — strict.
  if (existing.stripePriceId) {
    if (!deps.stripeConfigured) {
      return {
        status: 503,
        body: {
          error:
            "Le modèle est archivé dans l'application, mais le tarif Stripe n'a pas pu être désactivé (Stripe non configuré). Réessayez pour terminer l'archivage Stripe.",
          localArchived: true,
          stripePriceArchived: false,
          retryable: true,
        },
      };
    }
    try {
      await deps.archivePrice(existing.stripePriceId);
    } catch (error) {
      // Archivage PARTIEL assumé : local archivé, Stripe non — jamais de
      // réactivation automatique, nouvelle tentative idempotente.
      return {
        status: 502,
        body: {
          error: `Le modèle est archivé dans l'application, mais le tarif Stripe n'a pas pu être désactivé (${deps.describeStripeError(error)}). Réessayez pour terminer l'archivage Stripe.`,
          localArchived: true,
          stripePriceArchived: false,
          retryable: true,
        },
      };
    }
  }

  // 4. Résultat structuré — Product laissé actif, élèves/abonnements/paiements intacts.
  return {
    status: 200,
    body: {
      success: true,
      localArchived: true,
      stripePriceArchived: existing.stripePriceId !== null,
      productArchived: false,
    },
  };
}

/* ─────────────── RÉACTIVER (Product si besoin, puis Price) ─────────────── */

export async function performSubscriptionTemplateReactivation(id: string, deps: ReactivateTemplateDeps): Promise<Outcome> {
  const existing = await deps.loadTemplate(id);
  if (!existing) return { status: 404, body: { error: "Modèle d'abonnement introuvable." } };

  let stripeResult = { productReactivated: false, priceReactivated: false };
  if (existing.stripePriceId || existing.stripeProductId) {
    if (!deps.stripeConfigured) {
      return { status: 503, body: { error: "Stripe non configuré (STRIPE_SECRET_KEY manquante)." } };
    }
    try {
      stripeResult = await deps.reactivateStripe({
        productId: existing.stripeProductId,
        priceId: existing.stripePriceId,
      });
    } catch (error) {
      // Le modèle reste archivé localement : jamais de modèle actif avec un Price inactif.
      return {
        status: 502,
        body: {
          error: `Échec de la réactivation Stripe : ${deps.describeStripeError(error)}. Le modèle reste archivé.`,
        },
      };
    }
  }

  const updated = await deps.setActive(id, true);
  if (!updated) {
    // État partiel réessayable : Stripe est réactivé, le modèle reste archivé
    // localement — on ne prétend PAS que la réactivation applicative est faite.
    return {
      status: 500,
      body: {
        error:
          "Le tarif Stripe a été réactivé, mais le modèle est resté archivé dans l'application. Réessayez pour terminer la réactivation.",
        localActive: false,
        stripeReactivated: true,
        retryable: true,
        ...stripeResult,
      },
    };
  }
  return { status: 200, body: { success: true, localActive: true, ...stripeResult } };
}

/* ─────────────── SUPPRIMER DÉFINITIVEMENT ─────────────── */

export async function performSubscriptionTemplateDeletion(id: string, deps: DeleteTemplateDeps): Promise<Outcome> {
  const existing = await deps.loadTemplate(id);
  if (!existing) return { status: 404, body: { error: "Modèle d'abonnement introuvable." } };

  // Pré-contrôle applicatif (rapide, sert l'UI). La garantie finale est la RPC.
  const preReferences = await deps.getReferences(existing);
  if (!isTemplateDeletable(preReferences)) {
    return {
      status: 409,
      body: {
        error:
          "Ce modèle est encore utilisé (élève attribué, abonnement ou paiement lié). Suppression définitive impossible — utilisez l'archivage.",
        references: preReferences,
        deletable: false,
      },
    };
  }

  // 1–2. Désactivation préalable idempotente : dès cet instant le modèle ne
  // peut plus être proposé/affecté, même si la suite échoue.
  const deactivated = await deps.setActive(id, false);
  if (!deactivated) {
    return { status: 500, body: { error: "Impossible de désactiver le modèle avant suppression. Réessayez." } };
  }

  // 3–4. Références rechargées APRÈS la désactivation (une attribution a pu
  // survenir entre-temps) — refus si une référence est apparue.
  const references = await deps.getReferences(existing);
  if (!isTemplateDeletable(references)) {
    return {
      status: 409,
      body: {
        error:
          "Une référence est apparue pendant l'opération (élève, abonnement ou paiement). Le modèle reste archivé et n'est plus proposé.",
        references,
        deletable: false,
        archived: true,
      },
    };
  }

  // 5. Archivage Stripe STRICT.
  let stripeResult: ArchiveStripeResult = { priceArchived: false, productArchived: false };
  if (existing.stripeProductId || existing.stripePriceId) {
    if (!deps.stripeConfigured) {
      return { status: 503, body: { error: "Stripe non configuré (STRIPE_SECRET_KEY manquante).", archived: true } };
    }
    try {
      stripeResult = await deps.archiveStripe({
        productId: existing.stripeProductId,
        priceId: existing.stripePriceId,
        otherTemplatesShareProduct: references.otherTemplatesSharingProduct > 0,
      });
    } catch (error) {
      return {
        status: 502,
        body: {
          error: `Échec de l'archivage Stripe : ${deps.describeStripeError(error)}. ${RETRY_HINT}`,
          archived: true,
        },
      };
    }
  }

  // 6. Suppression TRANSACTIONNELLE (verrou + revérification + delete).
  const rpc = await deps.deleteViaRpc(id);
  if (rpc.result === "deleted") {
    return { status: 200, body: { success: true, stripe: stripeResult } };
  }
  if (rpc.result === "not_found") {
    // Déjà supprimé (réessai après une erreur réseau) → succès idempotent.
    return { status: 200, body: { success: true, alreadyDeleted: true, stripe: stripeResult } };
  }
  if (rpc.result === "in_use") {
    return {
      status: 409,
      body: {
        error:
          "Une référence bloquante est apparue au moment de la suppression. Le modèle reste archivé et n'est plus proposé.",
        references: rpc.references ?? null,
        deletable: false,
        archived: true,
      },
    };
  }
  return { status: 500, body: { error: `${RETRY_HINT} (${rpc.message})`, archived: true, stripe: stripeResult } };
}
