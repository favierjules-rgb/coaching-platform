"use client";

import { useId, useState } from "react";
import { isValidEmail } from "@/lib/newsletter/validation";

type Status = "idle" | "loading" | "success" | "error";

const CONSENT_LABEL =
  "J'accepte de recevoir par email les conseils, actualités et offres de SETH Préparation Physique. Je peux me désinscrire à tout moment.";

export function NewsletterSignupForm() {
  const emailId = useId();
  const consentId = useId();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const emailValid = isValidEmail(email);
  const canSubmit = emailValid && consent && status !== "loading";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, consent, source: "landing_page" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "Une erreur est survenue. Réessayez plus tard.");
        return;
      }
      setStatus("success");
      setMessage(data.message ?? "Merci pour votre inscription !");
      setEmail("");
      setConsent(false);
    } catch {
      setStatus("error");
      setMessage("Une erreur réseau est survenue. Réessayez plus tard.");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="border border-border bg-card p-6 text-center"
      >
        <p className="font-heading text-base font-bold uppercase text-foreground">
          Merci !
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="border border-border bg-card p-6"
    >
      <h2 className="font-heading text-lg font-bold uppercase text-foreground">
        Reçois mes conseils entraînement et nutrition
      </h2>

      <div className="mt-4">
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

      <div className="mt-3 flex items-start gap-2">
        <input
          id={consentId}
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1"
        />
        <label htmlFor={consentId} className="text-xs text-muted-foreground">
          {CONSENT_LABEL}{" "}
          <a
            href="/politique-de-confidentialite"
            className="underline hover:text-foreground"
          >
            Politique de confidentialité
          </a>
          .
        </label>
      </div>

      {status === "error" && message ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 w-full border border-border bg-foreground px-4 py-3 text-sm font-bold uppercase text-background transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Envoi…" : "Je m'inscris"}
      </button>
    </form>
  );
}
