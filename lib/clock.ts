/**
 * Horloge de l'application.
 *
 * Point unique d'obtention de « maintenant ». Toutes les fonctions qui
 * dépendent de la date courante (déblocage progressif des documents, semaine
 * actuelle d'un programme, repère « aujourd'hui » d'un calendrier, listes de
 * suivi admin) prennent un paramètre `reference` optionnel dont la valeur par
 * défaut est `currentDate()` — elles sont donc justes en production ET
 * déterministes en test, où l'on passe explicitement une date figée.
 *
 * Correction du 26/07/2026 : `ADMIN_REFERENCE_DATE` (2 juillet 2026), héritée
 * du mode démo/mock, servait de « aujourd'hui » par défaut dans ces calculs.
 * Conséquence en production : un document en déblocage automatique dont la
 * date tombait après le 2 juillet 2026 restait verrouillé indéfiniment, et la
 * semaine de programme d'un élève ne progressait plus. Cette constante est
 * désormais réservée aux fixtures de démonstration et aux tests.
 *
 * L'évaluation a lieu à CHAQUE appel (paramètre par défaut, pas une constante
 * de module) : aucune date n'est capturée au chargement du module, ce qui
 * serait faux pour un serveur Next.js qui vit plusieurs jours.
 */

/** « Maintenant », heure locale du runtime (Europe/Paris pour cette application). */
export function currentDate(): Date {
  return new Date();
}

/** Minuit local du jour de `reference` — utile pour comparer des jours entiers. */
export function startOfToday(reference: Date = currentDate()): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
}
