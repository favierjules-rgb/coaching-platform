"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { PaymentResultCard } from "@/components/shared/PaymentResultCard";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { resolveSpaceHref } from "@/lib/stripe/return-routes";

/**
 * Contenu de /paiement/success (chantier "supabase-stripe-payments-subscriptions").
 * Ne considère JAMAIS le paiement comme confirmé à partir du seul paramètre
 * d'URL `session_id` — celui-ci n'est même pas lu ici. Le vrai statut vient
 * du webhook Stripe qui met à jour Supabase ; cette page se contente
 * d'indiquer que le paiement a été reçu et que la synchronisation est en
 * cours, sans jamais annoncer un abonnement "actif".
 */
export function PaymentSuccessContent() {
  const { ready, role } = useCurrentUserRole();

  return (
    <PaymentResultCard
      icon={CheckCircle2}
      title="Paiement reçu"
      message="Ton paiement a bien été reçu par Stripe. Ton abonnement est en cours d'activation — le statut sera mis à jour sur ton espace dès la confirmation de Stripe (quelques instants)."
    >
      {ready ? (
        <Link
          href={resolveSpaceHref(role)}
          className="border border-primary bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Retour à mon espace
        </Link>
      ) : (
        <span className="border border-border px-4 py-3 text-xs uppercase tracking-widest text-muted-foreground">Chargement…</span>
      )}
    </PaymentResultCard>
  );
}
