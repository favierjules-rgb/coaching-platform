/**
 * Navigation de l'espace élève — logique PURE, testable sans rendu.
 *
 * Pendant du `lib/admin-shell-nav.ts` de l'administration, écrit pour la même
 * raison : l'entrée active était calculée par `pathname === href`, une
 * égalité STRICTE. Sur `/nutrition/[planId]`, aucune entrée n'était donc
 * marquée active — l'élève perdait le repère de la section où il se trouve
 * dès qu'il ouvrait le détail d'un plan, d'un programme ou d'une séance.
 *
 * Le préfixe doit être comparé SEGMENT PAR SEGMENT : un simple
 * `pathname.startsWith(href)` marquerait `/nutritionnisme` comme actif pour
 * `/nutrition`. C'est la version sûre de `startsWith`.
 */
export function isStudentRouteActive(
  pathname: string | null | undefined,
  href: string,
): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  // `/nutrition` ↔ `/nutrition/xxx` : oui. `/nutrition` ↔ `/nutritionnisme` : non.
  return pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
}
