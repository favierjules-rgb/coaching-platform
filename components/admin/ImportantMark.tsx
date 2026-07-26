import { Star } from "lucide-react";

/**
 * Marqueur "document important" — non interactif. L'importance est signalée
 * par une forme (étoile pleine) ET un libellé texte "Important", jamais par la
 * seule couleur. Contrat d'accessibilité simple, sans annonce redondante :
 * l'étoile est purement décorative (`aria-hidden`) et seul le texte visible
 * "Important" est annoncé par les lecteurs d'écran (pas de `role="img"` ni
 * d'`aria-label` qui doublerait la lecture).
 */
export function ImportantMark() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
      <Star size={11} aria-hidden className="fill-primary text-primary" />
      Important
    </span>
  );
}
