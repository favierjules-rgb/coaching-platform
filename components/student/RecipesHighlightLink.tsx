"use client";

import Link from "next/link";
import { ChefHat, ArrowRight } from "lucide-react";

/**
 * L'ENTRÉE MISE EN AVANT VERS LES RECETTES ADAPTATIVES.
 *
 * POURQUOI UN PARCOURS À PART. Les recettes vivaient en bas de la fiche du
 * plan, après le suivi et la semaine prescrite : l'outil le plus utile au
 * quotidien était celui qu'il fallait le plus faire défiler pour atteindre.
 * Il a donc sa propre page, et cette carte y conduit depuis le haut de
 * l'écran.
 *
 * MOTIF VISUEL. Le filet lumineux tournant est celui de `.bilan-card`
 * (app/globals.css), transposé en vert et à l'échelle d'un bouton — même
 * technique de conic-gradient masqué en bordure, donc rien de nouveau à
 * maintenir. Le vert est la seule couleur de l'interface qui signale déjà
 * une réussite (`--success`), il vient du thème et n'est pas codé en dur.
 *
 * MOUVEMENT MESURÉ. Une seule animation, lente et continue, sur un SEUL
 * élément de la page — la mise en avant perdrait tout son sens si elle était
 * répétée. Sous `prefers-reduced-motion`, l'anneau ne disparaît pas : il se
 * fige sur un angle choisi, et la surbrillance verte reste entière.
 *
 * AUCUNE LOGIQUE MÉTIER ICI : ce composant ne fait que naviguer.
 */
export function RecipesHighlightLink({
  planId,
  className = "",
}: {
  readonly planId: string;
  readonly className?: string;
}) {
  return (
    <Link
      href={`/nutrition/${planId}/recettes`}
      className={`recettes-halo pressable group relative flex min-h-[44px] items-center justify-between gap-3 overflow-hidden rounded-card border border-success/50 bg-success/10 px-4 py-3 transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50 ${className}`}
    >
      <span className="flex items-center gap-3">
        <ChefHat size={18} className="flex-shrink-0 text-success" />
        <span className="flex flex-col">
          <span className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            Recettes
          </span>
          <span className="text-[11px] leading-tight text-muted-foreground">
            Adaptées à ton jour et à ton créneau
          </span>
        </span>
      </span>
      <ArrowRight
        size={16}
        className="flex-shrink-0 text-success transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
