"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { PaymentResultCard } from "@/components/shared/PaymentResultCard";
import { useSupabaseMyAccess } from "@/hooks/useSupabaseMyAccess";
import { useSupabaseSubscriptionTemplates } from "@/hooks/useSupabaseSubscriptionTemplates";
import { buildCheckoutOffers } from "@/lib/stripe/plans";

/**
 * Contenu de /acces-limite (chantier "supabase-stripe-access-control",
 * étendu par "supabase-subscription-templates") — page atteinte via
 * requireActiveStudentAccess() quand l'élève n'a pas d'abonnement
 * actif/trialing (ou accès manuel) pour entraînement/nutrition/documents/
 * progression.
 */
export function AccessLimitedContent() {
  const access = useSupabaseMyAccess();
  const templates = useSupabaseSubscriptionTemplates(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTemplates = templates.templates.length > 0;
  const assignedOfferId = hasTemplates ? access.assignedTemplateId : access.assignedPlan;

  async function handlePayAssignedOffer(offerId: string) {
    setCreating(true);
    setError(null);
    const result = hasTemplates ? await access.startCheckoutForTemplate(offerId) : await access.startCheckout(offerId);
    if (result.url) {
      window.location.href = result.url;
      return;
    }
    setCreating(false);
    setError(result.error ?? "Échec de la création du paiement.");
  }

  return (
    <PaymentResultCard
      icon={Lock}
      iconTone="amber"
      title="Accès temporairement limité"
      message="Votre accès aux programmes, documents et plans nutritionnels sera activé après validation de votre abonnement."
    >
      {!access.ready ? (
        <span className="border border-border px-4 py-3 text-xs uppercase tracking-widest text-muted-foreground">Chargement…</span>
      ) : assignedOfferId ? (
        <button
          type="button"
          onClick={() => handlePayAssignedOffer(assignedOfferId)}
          disabled={creating}
          className="border border-primary bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? "Redirection…" : "Régler mon abonnement"}
        </button>
      ) : (
        <CreateCheckoutLinkModal
          triggerLabel="Régler mon abonnement"
          mode="student"
          offers={buildCheckoutOffers(templates.templates)}
          onCreateCheckout={hasTemplates ? access.startCheckoutForTemplate : access.startCheckout}
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <Link
        href="/profil"
        className="border border-border px-4 py-3 text-center text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Retour à mon profil
      </Link>
    </PaymentResultCard>
  );
}
