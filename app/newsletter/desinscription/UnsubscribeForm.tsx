"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "idle" | "loading" | "success" | "error";

export function UnsubscribeForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="border border-border bg-card p-6 text-center">
        <h1 className="font-heading text-lg font-bold uppercase text-foreground">
          Lien invalide
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ce lien de désinscription est incomplet ou invalide. Si vous
          souhaitez ne plus recevoir nos emails, contactez-nous directement.
        </p>
      </div>
    );
  }

  async function handleUnsubscribe() {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/newsletter/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
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
      setMessage(data.message ?? "Vous avez bien été désinscrit(e).");
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
        <h1 className="font-heading text-lg font-bold uppercase text-foreground">
          Désinscription confirmée
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <div className="border border-border bg-card p-6 text-center">
      <h1 className="font-heading text-lg font-bold uppercase text-foreground">
        Se désinscrire de la newsletter
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Vous êtes sur le point de vous désinscrire de la newsletter SETH
        Préparation Physique. Vous pourrez vous réinscrire à tout moment.
      </p>

      {status === "error" && message ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleUnsubscribe}
        disabled={status === "loading"}
        className="mt-6 w-full border border-border bg-foreground px-4 py-3 text-sm font-bold uppercase text-background transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Traitement…" : "Confirmer la désinscription"}
      </button>
    </div>
  );
}
