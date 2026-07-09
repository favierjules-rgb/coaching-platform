"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, XCircle } from "lucide-react";

/**
 * Bannière de retour Stripe Checkout (`?payment=success|cancelled`), lue
 * sur /dashboard (success_url) et /profil (cancel_url) — voir
 * app/api/stripe/create-checkout-session. `useSearchParams` isolé dans un
 * composant enfant + `Suspense` pour rester compatible avec le rendu
 * statique de Next.js App Router.
 */
function PaymentStatusBannerInner() {
  const searchParams = useSearchParams();
  const payment = searchParams.get("payment");

  if (payment === "success") {
    return (
      <div className="mb-6 flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
        <CheckCircle size={18} className="flex-shrink-0" aria-hidden="true" />
        Paiement réussi. Ton abonnement sera actif dès sa confirmation par Stripe (quelques secondes).
      </div>
    );
  }

  if (payment === "cancelled") {
    return (
      <div className="mb-6 flex items-center gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
        <XCircle size={18} className="flex-shrink-0" aria-hidden="true" />
        Paiement annulé. Aucune somme n&apos;a été débitée.
      </div>
    );
  }

  return null;
}

export function PaymentStatusBanner() {
  return (
    <Suspense fallback={null}>
      <PaymentStatusBannerInner />
    </Suspense>
  );
}
