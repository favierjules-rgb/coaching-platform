/**
 * LES BORNES DE LA SAISIE D'UNE COMMUNE — partagées, et sans `server-only`.
 *
 * ⚠️ ELLES VIVENT ICI, ET PAS DANS `annuaire.ts`, POUR UNE RAISON PRÉCISE.
 * `annuaire.ts` est `server-only` : il appelle un service extérieur et ne doit
 * jamais être importé par le navigateur. Mais le SCHÉMA d'entrée et le CHAMP de
 * saisie ont besoin des mêmes bornes. Les recopier en donnerait deux jeux qui
 * divergeraient, et le formulaire accepterait alors ce que le serveur refuse.
 *
 * Module FEUILLE : deux constantes, aucun import.
 */

/**
 * ⚠️ DEUX CARACTÈRES AU MINIMUM. À un caractère, l'annuaire rend des milliers
 * de communes et la suggestion devient du bruit ; l'appel partirait pour rien.
 */
export const SAISIE_MIN = 2;

/** Au-delà, ce n'est plus un nom de commune : la plus longue en fait 38. */
export const SAISIE_MAX = 60;

/**
 * ⚠️ CINQ SUGGESTIONS, PAS DIX. Une liste qu'on parcourt des yeux, pas qu'on
 * lit. Les communes sont triées par population décroissante : celle que l'élève
 * cherche est presque toujours dans les cinq premières.
 */
export const SUGGESTIONS_MAX = 5;

/**
 * ⚠️ L'ANTI-RAFALE. 300 ms, c'est le temps entre deux frappes d'une saisie
 * continue : l'élève qui tape « Marseille » déclenche UN appel, pas neuf.
 * L'énoncé le demande explicitement — « éviter de lancer une requête à chaque
 * caractère » — et c'est aussi ce qui garde l'annuaire sous sa limite de débit.
 */
export const ANTI_RAFALE_MS = 300;

/* ══════════════════════════════════════════════════════════════════════════
   LE CODE INSEE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un code INSEE de commune : cinq caractères, dont la Corse (2A, 2B).
 *
 * ⚠️ ELLE VIT ICI, ET PAS DANS `annuaire.ts`, POUR POUVOIR ÊTRE EXÉCUTÉE.
 * `annuaire.ts` est `server-only` : un harnais Node ne peut pas l'importer, et
 * la règle la plus importante du chantier — ce qui est accepté comme identité
 * de commune — serait alors seulement affirmée, jamais éprouvée.
 *
 * ⚠️ ET ELLE EST APPLIQUÉE DES DEUX CÔTÉS. L'annuaire filtre ce qu'il reçoit de
 * l'amont, la route de recherche refiltre ce qu'elle reçoit du navigateur : les
 * deux ne se font pas confiance, ils appliquent la MÊME règle.
 */
export function codeInseeValide(code: string): boolean {
  return /^[0-9][0-9AB][0-9]{3}$/.test(code.trim().toUpperCase());
}

/** `83137` → `83`, `2A004` → `2A`. */
export function departementDuCodeInsee(code: string): string {
  return code.trim().toUpperCase().slice(0, 2);
}
