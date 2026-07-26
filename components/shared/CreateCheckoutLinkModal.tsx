"use client";

import { useId, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";

import { Modal, PrimaryButton } from "@/components/admin/Modal";
import type { CheckoutOffer } from "@/lib/stripe/plans";

interface CreateCheckoutLinkModalProps {
  triggerLabel: string;
  /** "student" : redirige automatiquement vers Stripe Checkout après création. "admin" : affiche un bouton "Ouvrir le lien" pour ne pas quitter la page admin. */
  mode: "student" | "admin";
  /** Formules sélectionnables — modèles d'abonnements actifs (chantier "supabase-subscription-templates", source prioritaire) ou repli .env (lib/stripe/plans.ts) selon l'appelant. */
  offers: CheckoutOffer[];
  onCreateCheckout: (offerId: string) => Promise<{ url: string | null; error: string | null }>;
  /** Formule pré-sélectionnée à l'ouverture (ex : formule attribuée à l'élève) — reste modifiable dans le sélecteur. */
  defaultOfferId?: string | null;
}

/** Sélection de formule + création de session Stripe Checkout, partagée élève ("Activer mon abonnement") et admin ("Créer lien de paiement"). */
function resolveDefaultOfferId(offers: CheckoutOffer[], defaultOfferId?: string | null): string {
  // Ne retient defaultOfferId que s'il correspond a une offre encore active/
  // presente dans la liste actuelle. Sans cette verification, une offre
  // desactivee ou supprimee depuis (ex: modele d'abonnement retire) restait
  // selectionnee silencieusement et onCreateCheckout() echouait ou generait
  // un lien de paiement pour la mauvaise offre.
  if (defaultOfferId && offers.some((offer) => offer.id === defaultOfferId)) {
    return defaultOfferId;
  }
  return offers[0]?.id ?? "";
}

export function CreateCheckoutLinkModal({ triggerLabel, mode, offers, onCreateCheckout, defaultOfferId }: CreateCheckoutLinkModalProps) {
  const [open, setOpen] = useState(false);
  const [offerId, setOfferId] = useState(() => resolveDefaultOfferId(offers, defaultOfferId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const selectId = useId();

  function openModal() {
    setOfferId(resolveDefaultOfferId(offers, defaultOfferId));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
    setCheckoutUrl(null);
    setLoading(false);
  }

  async function handleCreate() {
    if (!offerId) {
      setError("Aucune formule disponible.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await onCreateCheckout(offerId);
    setLoading(false);
    if (result.error || !result.url) {
      setError(result.error ?? "Échec de la création du lien de paiement.");
      return;
    }
    if (mode === "student") {
      window.location.href = result.url;
      return;
    }
    setCheckoutUrl(result.url);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <CreditCard size={14} aria-hidden="true" />
        {triggerLabel}
      </button>

      {open && (
        <Modal title={triggerLabel} onClose={close} maxWidth="max-w-sm">
          {checkoutUrl ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Lien de paiement créé.</p>
              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-primary bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Ouvrir le lien Stripe
              </a>
            </div>
          ) : offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune formule disponible pour le moment.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor={selectId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Formule
                </label>
                <select
                  id={selectId}
                  value={offerId}
                  onChange={(event) => setOfferId(event.target.value)}
                  className="w-full rounded-control border border-border bg-surface-soft px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                >
                  {offers.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.label}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
              <PrimaryButton onClick={handleCreate} disabled={loading}>
                {loading ? "Création…" : "Créer le lien de paiement"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
