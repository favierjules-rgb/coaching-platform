/**
 * HORS LIGNE, UN CLIC DE MENU DOIT RECHARGER LE DOCUMENT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CETTE FONCTION FERME
 * ════════════════════════════════════════════════════════════════════════
 * `<Link>` ne recharge pas la page : le routeur de Next va chercher la
 * charge RSC de la route (`/nutrition?_rsc=…`), en `mode: "cors"`. Le
 * service worker la laisse passer — il le doit, une charge RSC est privée et
 * n'a rien à faire dans Cache Storage. Sans réseau, elle échoue, le routeur
 * lève, et `app/error.tsx` s'affiche : « Une erreur est survenue ».
 * Constaté sur iPhone le 10/08/2026, sur les sept entrées du menu.
 *
 * Une NAVIGATION DOCUMENT, elle, est interceptée par le service worker
 * (`requete.mode === "navigate"`), qui sert la coquille préparée. C'est le
 * seul chemin qui aboutisse sans réseau.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ELLE NE S'APPLIQUE QU'AU MENU, ET QU'HORS LIGNE
 * ════════════════════════════════════════════════════════════════════════
 * En ligne, elle ne fait rien : le routeur de Next garde la main, et la
 * navigation client reste ce qu'elle était. Aucune autre navigation de
 * l'application n'est transformée.
 *
 * `navigator.onLine === false` est le MÊME signal que celui qui ouvre déjà
 * le mode hors ligne côté données (`classerErreur`, lib/offline/source-
 * donnees.ts, premier contrôle de transport). Aucune classification
 * nouvelle : quand il ment — il peut être vrai sans qu'Internet réponde —
 * on retombe simplement sur le comportement d'avant, c'est-à-dire sur
 * l'écran d'erreur. Il ne peut pas produire de faux hors-ligne.
 */

/** Ce que la fonction a besoin de connaître du navigateur — injectable pour les tests. */
export interface FenetreNavigable {
  enLigne: boolean;
  aller: (href: string) => void;
}

/**
 * Rend `true` si la navigation a été prise en charge (donc si l'appelant ne
 * doit rien faire de plus), `false` s'il faut laisser le routeur agir.
 */
export function naviguerParDocumentSiHorsLigne(
  href: string,
  evenement: { preventDefault: () => void },
  fenetre: FenetreNavigable,
): boolean {
  if (fenetre.enLigne) {
    return false;
  }
  evenement.preventDefault();
  fenetre.aller(href);
  return true;
}

/** La fenêtre réelle. `enLigne` vaut `true` par défaut : on ne bloque jamais par ignorance. */
export function fenetreReelle(): FenetreNavigable {
  return {
    enLigne: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    aller: (href: string) => window.location.assign(href),
  };
}
