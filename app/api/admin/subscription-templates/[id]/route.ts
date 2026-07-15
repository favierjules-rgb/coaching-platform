import { NextResponse } from "next/server";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubscriptionTemplateById, updateSubscriptionTemplate } from "@/lib/supabase/subscription-templates";
import { getStripeClient } from "@/lib/stripe/client";
import { parseJsonBody, parseParams } from "@/lib/api/validate";
import { idParamSchema } from "@/lib/api/schemas/common";
import { updateSubscriptionTemplateBodySchema } from "@/lib/api/schemas/subscription-templates";
import {
  createStripePriceForExistingProduct,
  createStripeProductAndPrice,
  describeStripeError,
  isStripeResourceMissing,
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
