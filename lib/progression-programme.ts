/**
 * LA PROGRESSION D'UN PROGRAMME — COMPTÉE EN SÉANCES, JAMAIS EN SEMAINES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * `toEleveTrainingProgram` calculait la barre de progression ainsi :
 *
 *     progressPercent = round(min(weekNumber, durationWeeks) / durationWeeks × 100)
 *
 * C'est-à-dire : le TEMPS ÉCOULÉ depuis la date de début, pas le travail
 * fait. Un élève qui n'a ouvert aucune séance depuis six semaines lisait
 * « 50 % ». La barre ne mesurait rien de ce qu'elle prétendait mesurer.
 *
 * Ici, une séance terminée vaut une fraction, et rien d'autre ne compte.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX SEMAINES, DEUX QUESTIONS — ELLES NE SE CONFONDENT PAS
 * ════════════════════════════════════════════════════════════════════════
 *   • la semaine CALENDAIRE (`computeCurrentWeekNumber`, lib/training-schedule)
 *     répond à « quelles séances afficher aujourd'hui ? ». Elle dépend de la
 *     date de début de l'affectation et de rien d'autre. Ce module n'y touche
 *     pas ;
 *   • la semaine de PROGRESSION (`semaineDeProgression`, ici) répond à « où en
 *     est l'élève ? ». Elle dépend des séances réellement validées.
 *
 * Elles divergent dès qu'un élève prend du retard, et c'est normal. Les
 * fusionner sous un seul nom ferait qu'un écran finirait par répondre à la
 * question de l'autre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI COMPTE, ET CE QUI NE COMPTE PAS
 * ════════════════════════════════════════════════════════════════════════
 * Une séance est TERMINÉE quand l'élève a coché « Séance terminée », c'est-à-
 * dire quand `workout_feedback.completed` vaut `true` (le trigger en dérive
 * `session_status = 'done'`). Donc :
 *   • séance prévue et non faite → aucune ligne, ne compte pas ;
 *   • retour envoyé SANS la case → `completed = false`, ne compte pas ;
 *   • séance validée → compte.
 *
 * ⚠️ LE DÉNOMINATEUR EST L'ÉTAT ACTUEL DU PROGRAMME, PAS UN TOTAL FIGÉ.
 * Il est recalculé depuis les séances telles qu'elles existent au moment du
 * calcul : ajouter une séance fait baisser le pourcentage, en supprimer une le
 * fait monter, et aucune de ces deux règles n'a besoin d'être écrite — elles
 * découlent du fait qu'on ne stocke aucun total.
 *
 * ⚠️ LES JOURS DE REPOS NE SONT PAS DES SÉANCES. Sur les 882 séances de
 * production, 342 sont des jours de repos : les compter ferait plafonner tout
 * programme à 61 %. Même règle que `totalSessions` (lib/admin.ts), volontairement.
 *
 * ⚠️ UNE COMPLÉTION ORPHELINE NE COMPTE PAS, ET ON NE LA DEVINE PAS.
 * `workout_feedback.session_id` est `ON DELETE SET NULL` : supprimer une séance
 * détache ses complétions. Mesuré le 24/09/2026 : 40 des 88 retours complets
 * n'ont plus de `session_id`, et leur `session_key` ne correspond à AUCUNE
 * séance existante. Ce module ne travaille que sur des identifiants de séances
 * réelles — reconstituer un rattachement depuis un `session_key` mort
 * fabriquerait des complétions sur des séances qui n'existent plus.
 */

/** Une séance telle que le programme la porte AUJOURD'HUI. */
export interface SeancePlanifiee {
  readonly id: string;
  readonly weekNumber: number;
  readonly isRestDay: boolean;
}

export interface ProgressionProgramme {
  /** Séances réelles actuellement prévues (jours de repos exclus). */
  readonly seancesPrevues: number;
  /** Parmi elles, celles que l'élève a validées. */
  readonly seancesTerminees: number;
  /** 0 à 100. `100` exige `seancesPrevues > 0` ET l'égalité des deux comptes. */
  readonly pourcentage: number;
  /** Nombre de semaines qui portent au moins une séance (repos compris). */
  readonly semainesPlanifiees: number;
  /**
   * La PREMIÈRE semaine contenant encore une séance non terminée.
   *
   * `null` a deux sens, distingués par `termine` : programme entièrement
   * terminé, ou programme sans aucune séance à faire.
   */
  readonly semaineDeProgression: number | null;
  readonly termine: boolean;
}

/**
 * La progression d'un programme pour UN élève.
 *
 * `seancesTerminees` est l'ensemble des identifiants de `workout_sessions`
 * que cet élève a validés — l'appelant l'a lu, ce module ne lit rien.
 */
export function progressionDuProgramme(entree: {
  readonly seances: readonly SeancePlanifiee[];
  readonly seancesTerminees: ReadonlySet<string>;
}): ProgressionProgramme {
  const { seances, seancesTerminees } = entree;

  // ⚠️ DÉDOUBLONNAGE PAR IDENTIFIANT. Deux lignes portant le même id seraient
  // la même séance comptée deux fois — le dénominateur mentirait sans que rien
  // ne le signale.
  const parId = new Map<string, SeancePlanifiee>();
  for (const seance of seances) {
    if (!parId.has(seance.id)) parId.set(seance.id, seance);
  }
  const uniques = [...parId.values()];

  const aFaire = uniques.filter((s) => !s.isRestDay);
  const faites = aFaire.filter((s) => seancesTerminees.has(s.id));

  const seancesPrevues = aFaire.length;
  const nbTerminees = faites.length;

  /*
   * ⚠️ AUCUNE SÉANCE PRÉVUE N'EST PAS « TOUT TERMINÉ ».
   *
   * Un programme vide, ou une semaine entièrement en repos, ne contient rien à
   * valider. Rendre 100 % annoncerait un programme bouclé à un élève qui n'a
   * rien fait — et `termine` servirait alors à peindre en vert un programme
   * vide. La seule réponse honnête est 0 %, non terminé.
   */
  const termine = seancesPrevues > 0 && nbTerminees === seancesPrevues;
  const pourcentage = seancesPrevues > 0 ? Math.round((nbTerminees / seancesPrevues) * 100) : 0;

  /*
   * ⚠️ UNE SEMAINE 100 % REPOS N'EST JAMAIS « LA SEMAINE COURANTE ». Elle ne
   * contient aucune séance à terminer : s'y arrêter bloquerait la progression
   * sur une semaine que l'élève ne peut pas finir.
   */
  const semainesRestantes = aFaire.filter((s) => !seancesTerminees.has(s.id)).map((s) => s.weekNumber);
  const semaineDeProgression = semainesRestantes.length > 0 ? Math.min(...semainesRestantes) : null;

  return {
    seancesPrevues,
    seancesTerminees: nbTerminees,
    pourcentage,
    semainesPlanifiees: new Set(uniques.map((s) => s.weekNumber)).size,
    semaineDeProgression,
    termine,
  };
}

/**
 * « Sem. 3 / 8 », « Terminé », ou « — » — le libellé compact des cartes.
 *
 * ⚠️ `Y` EST LE NOMBRE DE SEMAINES RÉELLEMENT PLANIFIÉES, pas `duration_weeks`.
 * Les deux divergent (un programme de 12 semaines dont 6 sont construites), et
 * annoncer « Sem. 3 / 12 » sur un programme qui n'a que 6 semaines de séances
 * promettrait un contenu qui n'existe pas. Même arbitrage que `totalWeeks`
 * (lib/admin.ts), qui affiche déjà « K sem. planifiées ».
 */
export function libelleProgression(progression: ProgressionProgramme): string {
  if (progression.seancesPrevues === 0) return "—";
  if (progression.termine) return "Terminé";
  if (progression.semaineDeProgression === null) return "—";
  return `Sem. ${progression.semaineDeProgression} / ${progression.semainesPlanifiees}`;
}
