"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Bouton de nouvelle tentative pour l'état d'erreur de /programmes
 * (correctif chantier /programmes, juillet 2026) — relance le rendu serveur
 * de la page via `router.refresh()`, qui réexécute `getPublicPrograms()`
 * côté serveur avec les mêmes filtres métier. Action explicite de
 * l'utilisateur uniquement : pas de polling, pas de nouvelle tentative
 * automatique.
 */
export function PublicProgramsRetry() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setPending(true);
        router.refresh();
      }}
      disabled={pending}
      className="border border-primary px-5 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
    >
      {pending ? "Nouvelle tentative…" : "Réessayer"}
    </button>
  );
}
