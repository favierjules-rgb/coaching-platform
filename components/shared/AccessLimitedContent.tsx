"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { PaymentResultCard } from "@/components/shared/PaymentResultCard";
import { useSupabaseMyAccess } from "@/hooks/useSupabaseMyAccess";

/**
 * Contenu de /acces-limite (chantier "supabase-stripe-access-control") —
 * page atteinte via requireActiveStudentAccess() quand l'élève n'a pas
 * d'abonnement actif/trialing (ou accès manuel) pour entraînement/
 * nutrition/documents/progression.
 */
export function AccessLimitedContent() {
  const access = useSupabaseMyAccess();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePayAssignedPlan(planKey: string) {
    setCreating(true);
    setError(null);
    const result = await access.startCheckout(planKey);
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
      ) : access.assignedPlan ? (
        <button
          type="button"
          onClick={() => handlePayAssignedPlan(access.assignedPlan!)}
          disabled={creating}
          className="border border-primary bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? "Redirection…" : "Régler mon abonnement"}
        </button>
      ) : (
        <CreateCheckoutLinkModal triggerLabel="Régler mon abonnement" mode="student" onCreateCheckout={access.startCheckout} />
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
