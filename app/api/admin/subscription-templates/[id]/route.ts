import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteUnusedSubscriptionTemplateRpc,
  getSubscriptionTemplateById,
  getSubscriptionTemplateReferences,
  isTemplateDeletable,
  setSubscriptionTemplateActive,
  updateSubscriptionTemplate,
} from "@/lib/supabase/subscription-templates";
import { getStripeClient } from "@/lib/stripe/client";
import {
  performSubscriptionTemplateArchive,
  performSubscriptionTemplateDeletion,
  performSubscriptionTemplateReactivation,
} from "@/lib/billing/subscription-template-deletion";
import { parseJsonBody, parseParams } from "@/lib/api/validate";
import { idParamSchema } from "@/lib/api/schemas/common";
import { updateSubscriptionTemplateBodySchema } from "@/lib/api/schemas/subscription-templates";
import {
  archiveStripeForDeletedTemplate,
  archiveStripePriceOnly,
  createStripePriceForExistingProduct,
  createStripeProductAndPrice,
  describeStripeError,
  isStripeResourceMissing,
  reactivateStripeForTemplate,
} from "@/lib/stripe/subscription-templates";

/**
 * PATCH /api/admin/subscription-templates/[id] — modifie un modèle
 * d'abonnement (chantier "supabase-subscription-templates") : réservé au
 * staff. Un changement de `amountCents` déclenche la création d'un nouveau
 * Price Stripe (immuable) et la désactivation de l'ancien — jamais de
 * mutation en place d'un Price existant. `isActive: false` archive le
 * modèle (n'est alors plus proposé, mais reste lisible pour l'historique).
 *
 * Body attendu (tous les champs optionnels) : { name?, description?,
 * amountCents?, durationMonths?, isActive? }.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = parseParams(await params, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;
  const { id } = parsedParams.data;

  const parsed = await parseJsonBody(request, updateSubscriptionTemplateBodySchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const existing = await getSubscriptionTemplateById(sessionSupabase, id);
  if (!existing) {
    return NextResponse.json({ error: "Modèle d'abonnement introuvable." }, { status: 404 });
  }

  // SOURCE UNIQUE de changement de statut : `isActive` ne peut JAMAIS être
  // modifié en même temps que d'autres champs — sinon un changement de statut
  // pourrait être appliqué en base sans son effet Stripe correspondant. Le
  // formulaire d'édition n'expose plus ce champ ; seules les actions dédiées
  // Archiver/Réactiver l'envoient, seules.
  const hasOtherFields =
    body.name !== undefined ||
    body.description !== undefined ||
    body.amountCents !== undefined ||
    body.durationMonths !== undefined;

  if (body.isActive !== undefined && hasOtherFields) {
    return NextResponse.json(
      {
        error:
          "Le statut actif/archivé ne peut pas être modifié en même temps que d'autres champs. Utilisez les actions dédiées Archiver ou Réactiver.",
      },
      { status: 400 },
    );
  }

  // Bascule actif/archivé SEULE → flux symétriques dédiés (archiver : local
  // puis Price Stripe ; réactiver : Product puis Price puis local).
  const onlyToggleActive = body.isActive !== undefined && body.isActive !== existing.isActive;

  if (onlyToggleActive) {
    const stripeClient = getStripeClient();
    const outcome = body.isActive
      ? await performSubscriptionTemplateReactivation(id, {
          loadTemplate: (templateId) => getSubscriptionTemplateById(sessionSupabase, templateId),
          reactivateStripe: (input) => {
            if (!stripeClient) throw new Error("Stripe non configuré.");
            return reactivateStripeForTemplate(stripeClient, input);
          },
          setActive: (templateId, isActive) => setSubscriptionTemplateActive(sessionSupabase, templateId, isActive),
          stripeConfigured: stripeClient !== null,
          describeStripeError,
        })
      : await performSubscriptionTemplateArchive(id, {
          loadTemplate: (templateId) => getSubscriptionTemplateById(sessionSupabase, templateId),
          archivePrice: (priceId) => {
            if (!stripeClient) throw new Error("Stripe non configuré.");
            return archiveStripePriceOnly(stripeClient, priceId);
          },
          setActive: (templateId, isActive) => setSubscriptionTemplateActive(sessionSupabase, templateId, isActive),
          stripeConfigured: stripeClient !== null,
          describeStripeError,
        });
    return NextResponse.json(outcome.body, { status: outcome.status });
  }

  let stripeProductId = existing.stripeProductId;
  let stripePriceId = existing.stripePriceId;
  const priceChanged = body.amountCents !== undefined && body.amountCents > 0 && body.amountCents !== existing.amountCents;

  if (priceChanged) {
    const stripe = getStripeClient();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquante)." }, { status: 503 });
    }
    try {
      if (stripeProductId) {
        try {
          stripePriceId = await createStripePriceForExistingProduct(stripe, {
            productId: stripeProductId,
            amountCents: body.amountCents!,
            currency: existing.currency,
            billingInterval: existing.billingInterval,
            previousPriceId: stripePriceId,
          });
        } catch (error) {
          // Cause fréquente : stripe_product_id enregistré dans un autre
          // mode Stripe (test/live) que la clé secrète actuellement
          // configurée — le produit n'existe simplement plus pour ce
          // compte/mode. Plutôt que d'échouer, on recrée un Product/Price
          // neuf (l'ancien price_id en base, s'il existe encore quelque
          // part, n'est de toute façon plus valide).
          if (!isStripeResourceMissing(error)) throw error;
          console.error(
            `[Stripe] update-subscription-template : produit ${stripeProductId} introuvable (${describeStripeError(error)}), recréation d'un Product/Price neuf.`,
          );
          const created = await createStripeProductAndPrice(stripe, {
            name: body.name ?? existing.name,
            description: body.description ?? existing.description,
            amountCents: body.amountCents!,
            currency: existing.currency,
            billingInterval: existing.billingInterval,
          });
          stripeProductId = created.productId;
          stripePriceId = created.priceId;
        }
      } else {
        const created = await createStripeProductAndPrice(stripe, {
          name: body.name ?? existing.name,
          description: body.description ?? existing.description,
          amountCents: body.amountCents!,
          currency: existing.currency,
          billingInterval: existing.billingInterval,
        });
        stripeProductId = created.productId;
        stripePriceId = created.priceId;
      }
    } catch (error) {
      const message = describeStripeError(error);
      console.error(`[Stripe] update-subscription-template (price) : ${message}`, error);
      return NextResponse.json({ error: `Échec de la mise à jour du prix Stripe : ${message}` }, { status: 502 });
    }
  }

  const template = await updateSubscriptionTemplate(sessionSupabase, id, {
    name: body.name,
    description: body.description,
    durationMonths: body.durationMonths,
    isActive: body.isActive,
    ...(priceChanged ? { amountCents: body.amountCents, stripeProductId, stripePriceId } : {}),
  });

  if (!template) {
    return NextResponse.json({ error: "Échec de la mise à jour du modèle d'abonnement." }, { status: 500 });
  }

  return NextResponse.json({ template });
}

/** Auth commune aux handlers staff : renvoie soit une NextResponse d'erreur, soit le client session + le rôle. */
async function requireStaff(): Promise<
  { ok: false; response: NextResponse } | { ok: true; supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>> }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, response: NextResponse.json({ error: "Supabase non configuré." }, { status: 503 }) };
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Authentification requise." }, { status: 401 }) };
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return { ok: false, response: NextResponse.json({ error: "Accès refusé." }, { status: 403 }) };
  }
  return { ok: true, supabase };
}

/**
 * GET /api/admin/subscription-templates/[id] — références métier + éligibilité
 * à la suppression définitive d'un modèle (staff uniquement). Utilisé par la
 * confirmation UI : aucune écriture, aucune requête Stripe, aucun secret. Le
 * partage de Product est déterminé en base (autres modèles référençant le même
 * stripe_product_id) ; la vérification Stripe fine (autres Price actifs) n'a
 * lieu qu'au moment du DELETE.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = parseParams(await params, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;
  const { id } = parsedParams.data;

  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const existing = await getSubscriptionTemplateById(auth.supabase, id);
  if (!existing) {
    return NextResponse.json({ error: "Modèle d'abonnement introuvable." }, { status: 404 });
  }

  const references = await getSubscriptionTemplateReferences(auth.supabase, existing);
  return NextResponse.json({
    references,
    deletable: isTemplateDeletable(references),
    productShared: references.otherTemplatesSharingProduct > 0,
    hasStripePrice: existing.stripePriceId !== null,
  });
}

/**
 * DELETE /api/admin/subscription-templates/[id] — suppression DÉFINITIVE d'un
 * modèle, réservée au staff et autorisée UNIQUEMENT si le modèle est réellement
 * inutilisé (aucun élève attribué par id ou par prix, aucun abonnement local).
 * Sinon 409 (proposer l'archivage), sans détacher personne et sans aucune
 * requête Stripe. Ordre strict et NON best-effort :
 *  1) auth staff → 2) charger le modèle → 3) vérifier les références (409 si
 *  utilisé) → 4) archiver le Price Stripe (échec réel ⇒ 502, aucune
 *  suppression DB) → 5) archiver le Product seulement s'il devient inutilisé →
 *  6) supprimer la ligne (échec ⇒ 500, ligne conservée, réessai possible car
 *  l'archivage Stripe est idempotent). Aucune réactivation automatique du Price.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = parseParams(await params, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;
  const { id } = parsedParams.data;

  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  // La RPC destructive n'est exécutable QUE par `service_role` (EXECUTE révoqué
  // à authenticated) : elle est donc appelée avec le client admin, uniquement
  // après la vérification staff ci-dessus. La clé service role reste serveur.
  const adminSupabase = createSupabaseAdminClient();
  if (!adminSupabase) {
    return NextResponse.json(
      { error: "Client d'administration Supabase indisponible (SUPABASE_SERVICE_ROLE_KEY manquante)." },
      { status: 503 },
    );
  }

  const stripe = getStripeClient();
  const outcome = await performSubscriptionTemplateDeletion(id, {
    loadTemplate: (templateId) => getSubscriptionTemplateById(auth.supabase, templateId),
    getReferences: (template) => getSubscriptionTemplateReferences(auth.supabase, template),
    setActive: (templateId, isActive) => setSubscriptionTemplateActive(auth.supabase, templateId, isActive),
    archiveStripe: (input) => {
      if (!stripe) throw new Error("Stripe non configuré.");
      return archiveStripeForDeletedTemplate(stripe, input);
    },
    deleteViaRpc: (templateId) => deleteUnusedSubscriptionTemplateRpc(adminSupabase, templateId),
    stripeConfigured: stripe !== null,
    describeStripeError,
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
