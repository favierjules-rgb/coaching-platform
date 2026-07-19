"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Filet de sécurité pour toute erreur runtime non gérée dans une page.
 * Sans ce fichier, une erreur de rendu affiche une page blanche sans
 * moyen de s'en sortir — ici, on propose de réessayer ou de revenir à
 * l'accueil au lieu de laisser le site "ne plus s'ouvrir".
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <AlertTriangle size={40} className="text-primary" />
      <div>
        <h1 className="font-heading text-2xl font-extrabold uppercase text-foreground">
          Une erreur est survenue
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Quelque chose s&apos;est mal passé pendant le chargement de cette page.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="border border-primary bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Réessayer
        </button>
        <Link
          href="/"
          className="border border-border px-5 py-2.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
