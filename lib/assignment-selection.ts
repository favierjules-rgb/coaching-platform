/**
 * Sélection d'élèves dans les modales d'assignation — fonctions PURES
 * (fix/program-assignment-checkbox).
 *
 * Bug corrigé : la modale écrivait l'assignation À CHAQUE CLIC et dérivait
 * l'état coché des données serveur du programme MODÈLE. Depuis
 * l'individualisation (PR #53), l'assignation d'un programme individuel vise
 * la COPIE de l'élève — jamais le modèle — donc la case ne se cochait
 * jamais, tout en écrivant réellement en base à chaque clic.
 *
 * Nouveau contrat : la sélection vit LOCALEMENT dans la modale (ces
 * fonctions), et les écritures ne partent qu'au clic sur « Terminer »
 * (diff ajouté/retiré). Toujours immuable : jamais de mutation du tableau
 * reçu — chaque bascule rend une NOUVELLE référence, sinon React ne
 * re-rend pas.
 */

/** Coche/décoche un élève — immuable, idempotent (double ajout impossible). */
export function toggleStudentSelection(ids: string[], studentId: string, checked: boolean): string[] {
  if (checked) {
    return ids.includes(studentId) ? ids : [...ids, studentId];
  }
  return ids.filter((id) => id !== studentId);
}

/**
 * Applique la sélection validée par « Terminer » : compare l'état initial
 * (assignations existantes à l'ouverture) et la sélection visible, puis
 * n'émet QUE les changements — jamais de ré-écriture des inchangés (pas de
 * ré-envoi d'email d'assignation, pas d'écriture inutile).
 */
export function applySelectionDiff(
  before: string[],
  after: string[],
  apply: (studentId: string, assigned: boolean) => void,
): { added: string[]; removed: string[] } {
  const avant = new Set(before);
  const apres = new Set(after);
  const added = after.filter((id) => !avant.has(id));
  const removed = before.filter((id) => !apres.has(id));
  for (const id of added) apply(id, true);
  for (const id of removed) apply(id, false);
  return { added, removed };
}

/**
 * Élèves « assignés » d'un programme tels qu'affichés (cases cochées à
 * l'ouverture) : les liens directs (mode groupe, héritage) PLUS les
 * propriétaires d'une copie individuelle issue de ce modèle — c'est là que
 * vit l'assignation réelle depuis l'individualisation. Dédupliqué, ordre
 * stable (directs d'abord).
 */
export function mergeAssignedStudentIds(direct: string[], copyOwners: string[]): string[] {
  return [...new Set([...direct, ...copyOwners])];
}
