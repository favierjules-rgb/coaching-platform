"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { DiagnosticOffline } from "@/components/pwa/DiagnosticOffline";
import type { EtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";

/**
 * « CETTE PARTIE NÉCESSITE UNE CONNEXION » — LA MÊME PHRASE PARTOUT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN COMPOSANT, ET PAS SIX COPIES
 * ════════════════════════════════════════════════════════════════════════
 * Six écrans élève doivent maintenant dire la même chose dans les mêmes
 * trois situations. Six rédactions séparées, ce sont six occasions de dire
 * « contacte ton coach » à quelqu'un qui est simplement dans le métro — le
 * défaut exact qu'on vient de corriger sur le dashboard.
 *
 * Ce composant ne DÉCIDE de rien : l'état lui est donné, il l'écrit. La
 * classification reste entièrement dans `useEtatOfflineEleve`
 * (`diagnostiquer` + `classerSource`). Aucune détection réseau ici.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL NE MONTRE JAMAIS DE DONNÉE
 * ════════════════════════════════════════════════════════════════════════
 * Ni ancienne, ni approchante, ni « de démonstration ». Une section qui a
 * besoin du serveur et ne l'a pas est VIDE, et le dit. C'est la seule
 * réponse qui ne trompe personne.
 */
export function SectionIndisponible({
  zone,
  titre,
  etat,
  retour,
  messageOffline,
  lignes,
}: {
  /** Le nom de la route, pour l'encart de diagnostic (Preview seulement). */
  zone: string;
  titre: string;
  /** `offline`, `erreur` ou `indisponible` — jamais `mock`, jamais `chargement`. */
  etat: Exclude<EtatOfflineEleve, "mock" | "chargement">;
  retour?: { href: string; libelle: string };
  /**
   * Ce que « hors ligne » veut dire SUR CET ÉCRAN. Le défaut convient aux
   * sections qui ne sont jamais conservées ; /entrainement, lui, a une
   * séance du jour à évoquer.
   */
  messageOffline?: string;
  lignes?: Record<string, string | number | boolean | null | undefined>;
}) {
  return (
    <div>
      <DiagnosticOffline titre={zone} lignes={{ etat, ...(lignes ?? {}) }} />

      {retour && (
        <Link
          href={retour.href}
          className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft size={14} />
          {retour.libelle}
        </Link>
      )}

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          {titre}
        </h1>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {etat === "offline"
          ? (messageOffline ??
            "Cette partie nécessite une connexion : elle n'est pas conservée sur cet appareil. Ta séance du jour, elle, reste disponible.")
          : etat === "erreur"
            ? "Le serveur n'a pas pu répondre correctement. Réessaie dans un instant — rien n'a été perdu."
            : "Ce compte n'est pas encore relié à une fiche élève. Contacte ton coach pour finaliser ton accès."}
      </p>
    </div>
  );
}
