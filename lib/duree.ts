/**
 * LA SEULE FAÇON D'ÉCRIRE UNE DURÉE DANS CETTE APPLICATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Trois écritures concurrentes coexistaient : « 1min30 » (lib/cardio.ts),
 * « 1 h 08 » (lib/session-completion.ts) et « 60s repos » écrit à la main
 * dans deux composants élève. Le même repos de 90 secondes s'affichait donc
 * « 1min30 » sous un bloc cardio et « 90s » sous un exercice de musculation,
 * dans la MÊME page. Ce module fixe une règle et une seule ; tout le reste
 * y délègue.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA RÈGLE
 * ════════════════════════════════════════════════════════════════════════
 *   < 60 s              → « X s »                     30   → « 30 s »
 *   60 s .. 3599 s      → « X min » si reste nul      600  → « 10 min »
 *                       → « X min Y s » sinon         90   → « 1 min 30 s »
 *   >= 3600 s           → « X h » si reste nul        3600 → « 1 h »
 *                       → « X h Y min » sinon         3660 → « 1 h 1 min »
 *
 * ⚠️ AU-DELÀ DE L'HEURE, LES SECONDES DISPARAISSENT — c'est voulu. « 1 h
 * 30 min 12 s » n'informe personne sur la durée d'une séance ; la précision
 * affichée doit rester proportionnée à la grandeur lue. Les secondes sont
 * TRONQUÉES et non arrondies : une durée affichée n'est jamais supérieure à
 * la durée réelle, donc « 1 h » ne peut pas désigner 59 min 59 s.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * - Une ALLURE (`formatPace`, « 4'00/km ») n'est pas une durée : c'est un
 *   rapport, et sa notation minutes-apostrophe est une convention du sport.
 * - Un TIMECODE vidéo (« 03:42 ») et une HEURE d'horloge (« 14:30 ») sont
 *   des positions, pas des durées. Ils gardent leur largeur fixe.
 * - Le cadran du chronomètre (« 01:30 ») est également un affichage à
 *   largeur fixe, pour que les chiffres ne sautent pas d'une seconde à
 *   l'autre — voir components/student/ChronometreSeance.tsx, qui utilise en
 *   revanche `formaterDuree` pour son libellé accessible.
 */

const SECONDES_PAR_MINUTE = 60;
const SECONDES_PAR_HEURE = 3600;

/**
 * Formate une durée exprimée en SECONDES selon la règle ci-dessus.
 *
 * Une valeur non finie ou négative est traitée comme zéro : une fonction
 * d'affichage ne doit pas jeter au milieu d'un rendu. Les valeurs
 * fractionnaires sont arrondies à la seconde avant application de la règle
 * (`89.6` est une durée de 90 secondes, pas de 89).
 */
export function formaterDuree(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes <= 0) return "0 s";
  const total = Math.round(secondes);

  if (total < SECONDES_PAR_MINUTE) return `${total} s`;

  if (total < SECONDES_PAR_HEURE) {
    const minutes = Math.floor(total / SECONDES_PAR_MINUTE);
    const reste = total % SECONDES_PAR_MINUTE;
    return reste === 0 ? `${minutes} min` : `${minutes} min ${reste} s`;
  }

  const heures = Math.floor(total / SECONDES_PAR_HEURE);
  // Troncature volontaire : les secondes restantes ne sont PAS remontées en
  // minutes. `3659` (1 h 0 min 59 s) s'écrit « 1 h », pas « 1 h 1 min ».
  const minutes = Math.floor((total % SECONDES_PAR_HEURE) / SECONDES_PAR_MINUTE);
  return minutes === 0 ? `${heures} h` : `${heures} h ${minutes} min`;
}

/**
 * Même règle, pour une durée déjà exprimée en MINUTES (durée prévue d'une
 * séance, bilan de fin de séance). Passe par `formaterDuree` : il n'existe
 * volontairement aucune seconde implémentation de la règle.
 */
export function formaterDureeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 s";
  return formaterDuree(Math.round(minutes) * SECONDES_PAR_MINUTE);
}
