/**
 * LA GRILLE DU RPE — module FEUILLE, sans aucune dépendance.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN MODULE À PART
 * ════════════════════════════════════════════════════════════════════════
 * Le RPE se lit et s'écrit dans quatre mondes qui ne se connaissent pas :
 * le formulaire élève, le builder coach, le cardio, et le schéma d'API.
 * Placer la règle dans l'un d'eux crée un cycle d'imports — mesuré :
 * `previous-performance` importe `cardio-feedback`, qui importe `cardio`,
 * qui aurait dû importer `previous-performance` pour formater un RPE.
 *
 * Ce fichier n'importe RIEN. Il ne peut donc entrer dans aucun cycle, et la
 * grille n'a qu'une seule définition.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA RÈGLE
 * ════════════════════════════════════════════════════════════════════════
 * Un RPE avance par PAS DE 0,5. Les BORNES, elles, ne sont PAS ici : elles
 * diffèrent d'une surface à l'autre et c'est volontaire — 1 à 10 pour un
 * ressenti d'élève, 0 à 10 pour une cible de segment cardio, où « RPE 0 »
 * veut dire « au repos ». Chaque appelant passe les siennes.
 */

/** Le pas, unique et non négociable. */
export const RPE_PAS = 0.5;

/**
 * Formes acceptées à la SAISIE : 1 à 10, demi-points, virgule OU point.
 * `10,5` est structurellement inexprimable : seul `10` (ou `10,0`) est admis
 * en haut de l'échelle.
 */
const MOTIF_RPE = /^(?:10(?:[.,]0)?|[1-9](?:[.,][05])?)$/;

/**
 * Un nombre est-il sur la grille ?
 *
 * `Number.isInteger(v * 2)` est un contrôle EXACT ici, et non une
 * approximation : les multiples de 0,5 sont les seuls décimaux représentés
 * sans perte en binaire, donc 7,5 × 2 vaut exactement 15 tandis que
 * 7,2 × 2 vaut 14,4 — non entier. Aucun epsilon à régler.
 */
export function estRpeSurLaGrille(valeur: number): boolean {
  return Number.isFinite(valeur) && Number.isInteger(valeur * RPE_PAS * 4);
}

/**
 * Texte saisi → nombre, ou `null` si la forme n'est pas sur la grille.
 * Les bornes ne sont PAS vérifiées ici : c'est l'appelant qui les connaît.
 * La virgule française est acceptée puis convertie — la valeur applicative
 * et la valeur SQL restent `7.5`, jamais `"7,5"`. Rien dans le stockage ne
 * dépend de la locale de l'utilisateur.
 */
export function lireRpe(brut: string): number | null {
  const texte = brut.trim();
  if (!MOTIF_RPE.test(texte)) return null;
  return Number(texte.replace(",", "."));
}

/**
 * Un RPE pour l'affichage français : `7.5` → « 7,5 », `8` → « 8 ».
 * La donnée reste numérique ; seul le texte rendu change.
 */
export function formatRpeFr(valeur: number): string {
  return Number.isInteger(valeur) ? String(valeur) : String(valeur).replace(".", ",");
}

/** Les valeurs proposables entre deux bornes : 1 → 10 donne 19 entrées. */
export function grilleRpe(min: number, max: number): number[] {
  const nombre = Math.round((max - min) / RPE_PAS) + 1;
  return Array.from({ length: nombre }, (_, index) => min + index * RPE_PAS);
}
