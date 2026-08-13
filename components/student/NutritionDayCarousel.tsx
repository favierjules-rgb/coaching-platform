"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { indexParDefaut } from "@/lib/nutrition/progression";

/**
 * LES SEPT JOURS, UN À LA FOIS (ALIMENTS A5.6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE COMPOSANT NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CHANGER DE JOUR NE CHANGE QUE CE QUI EST AFFICHÉ. Aucun repas n'est
 * déplacé, aucune consommation copiée, aucun `consumed_on` réécrit. Ce
 * composant n'a pas une seule fonction d'écriture, ne reçoit aucun `onAjouter`
 * et ne connaît pas Supabase — c'est structurel, pas une promesse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CSS D'ABORD, JAVASCRIPT ENSUITE
 * ────────────────────────────────────────────────────────────────────────────
 * Le défilement est celui du navigateur : `overflow-x-auto` et `scroll-snap`.
 * Sur un téléphone, le glissement est donc natif — inertie, rebond, accroche —
 * et gratuit. Aucune bibliothèque de carrousel n'est utilisée : elles pèsent
 * des dizaines de kilo-octets pour reproduire, moins bien, ce que deux
 * propriétés CSS font déjà.
 *
 * Le JavaScript ne sert qu'à deux choses : placer la vue sur AUJOURD'HUI à
 * l'ouverture, et proposer deux flèches à la souris, qui n'a pas de geste de
 * glissement.
 */

export function NutritionDayCarousel({
  dates,
  libellés,
  aujourdHui,
  rendreJour,
}: {
  /** Les sept dates ISO de la semaine, dans l'ordre. */
  dates: readonly string[];
  /** Le libellé de chaque jour, dans le même ordre. */
  libellés: readonly string[];
  /** La date du jour, au format ISO. Injectée : jamais lue depuis l'horloge ici. */
  aujourdHui: string;
  rendreJour: (index: number) => React.ReactNode;
}) {
  const pisteRef = useRef<HTMLDivElement | null>(null);
  const [actif, setActif] = useState(() => indexParDefaut(dates, aujourdHui));
  /** Le placement initial n'a lieu QU'UNE fois : sinon tout défilement serait annulé. */
  const placé = useRef(false);

  // PLACEMENT INITIAL SUR AUJOURD'HUI.
  //
  // `scrollTo` sur le conteneur, et non `scrollIntoView` sur l'enfant :
  // `scrollIntoView` fait aussi défiler la PAGE, ce qui, sur un téléphone,
  // ferait sauter l'écran vers le milieu du document à l'ouverture.
  useEffect(() => {
    if (placé.current) return;
    const piste = pisteRef.current;
    if (!piste) return;
    const cible = indexParDefaut(dates, aujourdHui);
    piste.scrollTo({ left: piste.clientWidth * cible, behavior: "auto" });
    placé.current = true;
  }, [dates, aujourdHui]);

  function allerA(index: number) {
    const borné = Math.min(Math.max(index, 0), Math.max(dates.length - 1, 0));
    setActif(borné);
    pisteRef.current?.scrollTo({ left: (pisteRef.current.clientWidth || 0) * borné, behavior: "smooth" });
  }

  // Le défilement au doigt met à jour l'en-tête. On lit la position plutôt que
  // d'écouter chaque enfant : un `IntersectionObserver` par jour serait sept
  // observateurs pour une information que la piste connaît déjà.
  function surDefilement() {
    const piste = pisteRef.current;
    if (!piste || piste.clientWidth === 0) return;
    const index = Math.round(piste.scrollLeft / piste.clientWidth);
    setActif(Math.min(Math.max(index, 0), Math.max(dates.length - 1, 0)));
  }

  if (dates.length === 0) return null;

  const estAujourdHui = dates[actif] === aujourdHui;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => allerA(actif - 1)}
          disabled={actif === 0}
          aria-label="Jour précédent"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-30"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="min-w-0 text-center">
          {/* AUJOURD'HUI EST DIT, pas seulement souligné. Un élève qui ouvre
              l'écran doit savoir immédiatement où il est ; une mise en gras ne
              répond pas à cette question quand on arrive de la semaine
              dernière. */}
          {estAujourdHui && (
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
              Aujourd&apos;hui
            </p>
          )}
          <p className="truncate font-heading text-sm font-bold uppercase tracking-widest text-foreground">
            {libellés[actif] ?? ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => allerA(actif + 1)}
          disabled={actif >= dates.length - 1}
          aria-label="Jour suivant"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-30"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* LA PISTE. `snap-x snap-mandatory` accroche chaque jour au bord ;
          `overflow-x-auto` fait le défilement. Aucune largeur en pixels : sur un
          téléphone de 375 px comme sur un écran large, un jour occupe exactement
          la largeur disponible, et rien ne déborde horizontalement. */}
      <div
        ref={pisteRef}
        onScroll={surDefilement}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {dates.map((date, index) => (
          <div key={date} className="w-full flex-shrink-0 snap-start px-0.5">
            {rendreJour(index)}
          </div>
        ))}
      </div>
    </div>
  );
}
