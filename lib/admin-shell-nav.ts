/**
 * Helpers PURS et testables du shell admin (polish Apple, Lot A) :
 *  - détection de route active de la sidebar (item + groupe Programmation),
 *    source unique du style actif ET de `aria-current` ;
 *  - machine d'état minimale du drawer mobile (Échap / overlay / navigation /
 *    bouton menu) ;
 *  - boucle de focus du drawer (Tab depuis le dernier élément → premier,
 *    Shift+Tab depuis le premier → dernier, focus égaré → premier), calculée
 *    sur une simple liste — aucun accès DOM ici, donc testable en Node ;
 *  - verrou de scroll du document derrière le drawer.
 * Aucune dépendance. Consommé par AdminShell/AdminSidebar uniquement.
 */

/** Item actif : correspondance exacte pour /admin (racine), préfixe sinon. */
export function isAdminRouteActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

/** Groupe actif (ex. Programmation) : au moins une route enfant active. */
export function isAnyAdminRouteActive(pathname: string | null | undefined, hrefs: readonly string[]): boolean {
  return hrefs.some((href) => isAdminRouteActive(pathname, href));
}

/** Sous-menu affiché : ouvert dès qu'une route du groupe est active, sinon piloté par le clic. */
export function isSubmenuOpen(groupActive: boolean, manuallyOpen: boolean): boolean {
  return groupActive || manuallyOpen;
}

/**
 * Sélecteur des éléments focusables du drawer. `:not([disabled])` exclut les
 * contrôles désactivés de la boucle clavier.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Cible du focus pour un appui Tab/Shift+Tab dans le drawer :
 *  - liste vide → null (rien à faire) ;
 *  - focus courant hors de la liste (égaré derrière l'overlay) → premier ;
 *  - Tab sur le dernier → premier ; Shift+Tab sur le premier → dernier ;
 *  - sinon → null (le navigateur gère le Tab interne normalement).
 */
export function wrapFocusTarget<T>(elements: readonly T[], current: T | null, shiftKey: boolean): T | null {
  if (elements.length === 0) return null;
  const first = elements[0];
  const last = elements[elements.length - 1];
  const index = current === null ? -1 : elements.indexOf(current);
  if (index === -1) return first;
  if (shiftKey && index === 0) return last;
  if (!shiftKey && index === elements.length - 1) return first;
  return null;
}

export type DrawerEvent = "escape" | "overlay" | "navigate" | "toggle";

/** Prochain état ouvert/fermé du drawer selon l'événement. */
export function nextDrawerOpen(open: boolean, event: DrawerEvent): boolean {
  if (event === "toggle") return !open;
  return false; // escape, overlay et navigation ferment toujours
}

/**
 * Valeur d'`overflow` du <body> : "hidden" tant que le drawer est ouvert,
 * valeur d'origine restaurée à la fermeture (y compris chaîne vide).
 */
export function bodyOverflowFor(open: boolean, previousOverflow: string): string {
  return open ? "hidden" : previousOverflow;
}
