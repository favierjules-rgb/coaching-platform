"use client";

import { XCircle } from "lucide-react";
import Link from "next/link";

import { PaymentResultCard } from "@/components/shared/PaymentResultCard";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { resolveRetryHref, resolveSpaceHref } from "@/lib/stripe/return-routes";

/** Contenu de /paiement/cancel (chantier "supabase-stripe-payments-subscriptions"). */
export function PaymentCancelContent() {
  const { ready, role } = useCurrentUserRole();

  return (
    <PaymentResultCard
      icon={XCircle}
      iconTone="amber"
      title="Paiement annulé"
      message="Le paiement a été annulé. Aucun prélèvement n'a été effectué."
    >
      {ready ? (
        <>
          <Link
            href={resolveRetryHref(role)}
            className="border border-primary bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
          >
            Réessayer
          </Link>
          <Link
            href={resolveSpaceHref(role)}
            className="border border-border px-4 py-3 text-center text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            Retour à mon espace
          </Link>
        </>
      ) : (
        <span className="border border-border px-4 py-3 text-xs uppercase tracking-widest text-muted-foreground">Chargement…</span>
      )}
    </PaymentResultCard>
  );
}
