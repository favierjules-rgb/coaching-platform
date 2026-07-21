"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CGV_PROGRAMME_CONSENT_TEXT,
  IMMEDIATE_ACCESS_CONSENT_TEXT,
  WITHDRAWAL_RIGHT_WAIVER_CONSENT_TEXT,
} from "@/lib/legal-consents";
import { isValidEmail } from "@/lib/newsletter/validation";
import { formatAmountCents } from "@/lib/stripe/status";

type Status = "idle" | "loading" | "error";

/**
 * Formulaire d'achat/réclamation d'un programme public (chantier module
 * Programmation, étape 6) — prénom/nom/email puis :
 * - programme payant -> POST /api/public/programs/[id]/checkout, redirige
 *   vers l'URL Stripe Checkout retournée (mode paiement unique, anonyme) ;
 * - programme gratuit -> POST /api/public/programs/[id]/claim, provisionne
 *   le compte directement puis redirige vers /programmes/merci.
 * Aucune authentification requise pour soumettre ce formulaire — le compte
 * élève (accès restreint à /entrainement) est créé côté serveur après
 * paiement/réclamation, voir lib/supabase/public-program-provisioning.ts.
 */
export function PublicProgramPurchaseForm({
  programId,
  priceCents,
  currency,
}: {
  programId: string;
  priceCents: number | null;
  currency: string;
}) {
  const router = useRouter();
  const firstNameId = useId();
  const lastNameId = useId();
  const emailId = useId();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cgvAccepted, setCgvAccepted] = useState(false);
  // Réservées au chemin payant (Lot E) : un programme gratuit n'a pas de
  // paiement à rétracter, ces deux cases n'ont pas de sens pour lui — voir
  // publicProgramCheckoutBodySchema (lib/api/schemas/stripe.ts), utilisé
  // uniquement par /checkout, jamais par /claim.
  const [immediateAccessRequested, setImmediateAccessRequested] = useState(false);
  const [withdrawalRightWaived, setWithdrawalRightWaived] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const isPaid = Boolean(priceCents);
  const canSubmit =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    isValidEmail(email) &&
    cgvAccepted &&
    (!isPaid || (immediateAccessRequested && withdrawalRightWaived)) &&
    status !== "loading";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setStatus("loading");
    setMessage(null);
    try {
      const endpoint = isPaid ? `/api/public/programs/${programId}/checkout` : `/api/public/programs/${programId}/claim`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          cgvAccepted: true,
          // Uniquement pour /checkout — publicProgramAccessBodySchema (chemin
          // /claim, gratuit) est `.strict()` et rejetterait ces champs
          // inconnus, donc on ne les envoie jamais sur le chemin gratuit.
          ...(isPaid ? { immediateAccessRequested: true, withdrawalRightWaived: true } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "Une erreur est survenue. Réessaie plus tard.");
        return;
      }
      if (isPaid && data.url) {
        window.location.href = data.url;
        return;
      }
      router.push("/programmes/merci");
    } catch {
      setStatus("error");
      setMessage("Une erreur réseau est survenue. Réessaie plus tard.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={firstNameId} className="sr-only">
            Prénom
          </label>
          <input
            id={firstNameId}
            type="text"
            autoComplete="given-name"
            required
            placeholder="Prénom"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div>
          <label htmlFor={lastNameId} className="sr-only">
            Nom
          </label>
          <input
            id={lastNameId}
            type="text"
            autoComplete="family-name"
            required
            placeholder="Nom"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div>
        <label htmlFor={emailId} className="sr-only">
          Adresse email
        </label>
        <input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="Ton adresse email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          checked={cgvAccepted}
          onChange={(event) => setCgvAccepted(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          {CGV_PROGRAMME_CONSENT_TEXT}{" "}
          <a
            href="/cgv"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            Consulter les CGV
          </a>
        </span>
      </label>

      {isPaid && (
        <>
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-muted-foreground">
            <input
              type="checkbox"
              checked={immediateAccessRequested}
              onChange={(event) => setImmediateAccessRequested(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>{IMMEDIATE_ACCESS_CONSENT_TEXT}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-muted-foreground">
            <input
              type="checkbox"
              checked={withdrawalRightWaived}
              onChange={(event) => setWithdrawalRightWaived(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>{WITHDRAWAL_RIGHT_WAIVER_CONSENT_TEXT}</span>
          </label>
        </>
      )}

      {status === "error" && message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full border border-primary bg-primary px-4 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Un instant…" : isPaid ? `Acheter — ${formatAmountCents(priceCents, currency)}` : "Obtenir gratuitement"}
      </button>
    </form>
  );
}
