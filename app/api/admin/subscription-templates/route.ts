import { NextResponse } from "next/server";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSubscriptionTemplate } from "@/lib/supabase/subscription-templates";
import { getStripeClient } from "@/lib/stripe/client";
import { createStripeProductAndPrice, describeStripeError } from "@/lib/stripe/subscription-templates";
import { parseJsonBody } from "@/lib/api/validate";
import { createSubscriptionTemplateBodySchema } from "@/lib/api/schemas/subscription-templates";
import type { BillingInterval } from "@/types";

/**
 * POST /api/admin/subscription-templates — crée un modèle d'abonnement
 * (chantier "supabase-subscription-templates") : réservé au staff, crée le
 * Product + Price Stripe correspondant (si Stripe configuré) avant
 * d'insérer la ligne `subscription_templates`. Écrit via le client
 * Supabase de la session du coach connecté (RLS `subscription_templates_manage_staff`),
 * jamais le client service role.
 *
 * Body attendu : { name, description?, amountCents, currency?, billingInterval, durationMonths? }.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createSubscriptionTemplateBodySchema);
  if (!parsed.success) return parsed.response;
  const { name, description, amountCents, currency, billingInterval, durationMonths } = parsed.data;

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

  const stripe = getStripeClient();
  let stripeProductId: string | null = null;
  let stripePriceId: string | null = null;
  if (stripe) {
    try {
      const created = await createStripeProductAndPrice(stripe, {
        name,
        description: description ?? "",
        amountCents,
        currency: (currency ?? "eur").toLowerCase(),
        billingInterval: billingInterval as BillingInterval,
      });
      stripeProductId = created.productId;
      stripePriceId = created.priceId;
    } catch (error) {
      const message = describeStripeError(error);
      console.error(`[Stripe] create-subscription-template (product/price) : ${message}`, error);
      return NextResponse.json({ error: `Échec de la création du produit/prix Stripe : ${message}` }, { status: 502 });
    }
  }

  const { data: coach } = await sessionSupabase.from("coaches").select("id").eq("user_id", user.id).maybeSingle();

  const template = await createSubscriptionTemplate(sessionSupabase, {
    name,
    description: description ?? "",
    amountCents,
    currency: (currency ?? "eur").toLowerCase(),
    billingInterval: billingInterval as BillingInterval,
    durationMonths: durationMonths ?? null,
    stripeProductId,
    stripePriceId,
    createdBy: coach?.id ?? null,
  });

  if (!template) {
    return NextResponse.json({ error: "Échec de la création du modèle d'abonnement." }, { status: 500 });
  }

  return NextResponse.json({ template });
}
