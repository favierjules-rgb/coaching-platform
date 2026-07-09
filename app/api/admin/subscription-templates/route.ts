import { NextResponse } from "next/server";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSubscriptionTemplate } from "@/lib/supabase/subscription-templates";
import { getStripeClient } from "@/lib/stripe/client";
import { createStripeProductAndPrice } from "@/lib/stripe/subscription-templates";
import type { BillingInterval } from "@/types";

const VALID_INTERVALS: BillingInterval[] = ["monthly", "quarterly", "yearly", "one_time"];

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
  let body: {
    name?: string;
    description?: string;
    amountCents?: number;
    currency?: string;
    billingInterval?: string;
    durationMonths?: number | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { name, amountCents, billingInterval } = body;
  if (!name || !amountCents || amountCents <= 0 || !billingInterval || !VALID_INTERVALS.includes(billingInterval as BillingInterval)) {
    return NextResponse.json({ error: "name, amountCents (> 0) et billingInterval valides sont requis." }, { status: 400 });
  }

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
        description: body.description ?? "",
        amountCents,
        currency: (body.currency ?? "eur").toLowerCase(),
        billingInterval: billingInterval as BillingInterval,
      });
      stripeProductId = created.productId;
      stripePriceId = created.priceId;
    } catch (error) {
      console.error("[Stripe] create-subscription-template (product/price)", error);
      return NextResponse.json({ error: "Échec de la création du produit/prix Stripe." }, { status: 502 });
    }
  }

  const { data: coach } = await sessionSupabase.from("coaches").select("id").eq("user_id", user.id).maybeSingle();

  const template = await createSubscriptionTemplate(sessionSupabase, {
    name,
    description: body.description ?? "",
    amountCents,
    currency: (body.currency ?? "eur").toLowerCase(),
    billingInterval: billingInterval as BillingInterval,
    durationMonths: body.durationMonths ?? null,
    stripeProductId,
    stripePriceId,
    createdBy: coach?.id ?? null,
  });

  if (!template) {
    return NextResponse.json({ error: "Échec de la création du modèle d'abonnement." }, { status: 500 });
  }

  return NextResponse.json({ template });
}
