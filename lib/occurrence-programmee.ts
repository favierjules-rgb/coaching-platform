/**
 * L'OCCURRENCE PROGRAMMÉE D'UNE SÉANCE — fonctions PURES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'EST UNE OCCURRENCE, ET POURQUOI ELLE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Un exercice peut être programmé PLUSIEURS FOIS dans la même semaine —
 * mesuré en production : 744 couples (semaine, exercice) répartis sur
 * plusieurs jours, jusqu'à trois jours pour un même exercice. « La dernière
 * performance » ne suffit donc pas à désigner une référence : le mercredi
 * d'une semaine doit se comparer au mercredi de la précédente, et jamais au
 * lundi de la semaine en cours, qui est pourtant plus récent.
 *
 * Une OCCURRENCE est le couple (numéro de semaine du programme, jour). C'est
 * l'identité que `workout_sessions` porte déjà — une ligne par
 * (program_week_id, day) — et que le retour conserve.
 *
 * ════════════════════════════════════════════════════════════════════════
 * D'OÙ ELLE SE LIT, ET DANS QUEL ORDRE
 * ════════════════════════════════════════════════════════════════════════
 *  1. `prescribed_snapshot.day` + `weekNumber` — la photographie du prescrit,
 *     posée par le serveur à la soumission et rendue IMMUABLE par le trigger
 *     `workout_feedback_protect_snapshot`. C'est la source la plus solide :
 *     elle survit à la suppression du programme, à une réassignation, à une
 *     copie individuelle. Mesuré : 78 retours sur 125 en production.
 *  2. `resoudreSeance` — un résolveur INJECTÉ, qui remonte (semaine, jour)
 *     depuis l'identifiant de séance. Il vit hors de ce module parce qu'il
 *     demande une lecture de `workout_sessions` : ce fichier reste pur et
 *     testable sans base. Mesuré : 34 retours de plus, à condition que la
 *     séance existe encore.
 *
 * ⚠️ AUCUN REPLI SUR LA DATE. Déduire le jour de `performed_at` serait
 * recréer exactement le défaut qu'on corrige : `performed_at` est le jour où
 * l'élève a RÉALISÉ la séance, pas le jour où elle était PROGRAMMÉE. Un élève
 * qui rattrape son mercredi le jeudi ne change pas d'occurrence. Et cette
 * date est écrite en UTC dans le chemin de repli, ce qui la décale d'un jour
 * entre 00:00 et 02:00 à Paris.
 *
 * ⚠️ 12 RETOURS SUR 125 N'ONT AUCUNE OCCURRENCE IDENTIFIABLE (ni snapshot
 * exploitable, ni séance vivante). Ils rendent `null` ici, et ne participent
 * donc à aucune référence de progression. Ils restent visibles dans la ligne
 * « Dernières perfs », qui continue de s'appuyer sur l'index chronologique.
 */
import { isPrescribedSnapshot } from "@/lib/workout-history";

/** Le couple qui identifie une séance dans le calendrier d'un programme. */
export interface OccurrenceProgrammee {
  /** Numéro de semaine du programme (1-based), comme `program_weeks.week_number`. */
  readonly weekNumber: number;
  /** Jour tel que `workout_sessions.day` : « Lundi » … « Dimanche ». */
  readonly day: string;
}

/**
 * Forme minimale d'un retour pour en lire l'occurrence. Volontairement plus
 * étroite que `AdminStudentFeedback` : ce module n'a besoin que de ces deux
 * champs, et l'annoncer évite de le coupler au type complet.
 */
export interface RetourAvecOccurrence {
  readonly sessionId?: string;
  readonly prescribedSnapshot?: unknown;
}

/** Remonte (semaine, jour) depuis un identifiant de séance. Injecté par l'appelant. */
export type ResoudreSeance = (sessionId: string) => OccurrenceProgrammee | null;

/**
 * Jour normalisé pour la COMPARAISON : minuscules, accents retirés, espaces
 * repliés. « Mercredi », « mercredi » et « MERCREDI  » sont le même jour.
 *
 * ⚠️ ON NE NORMALISE QUE POUR COMPARER, jamais pour afficher : le libellé
 * d'origine reste celui du programme.
 */
export function normaliserJour(day: string): string {
  return day
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/** Un numéro de semaine exploitable : entier fini, supérieur ou égal à 1. */
function semaineValide(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 1;
}

/**
 * L'occurrence d'un retour, ou `null` si elle n'est pas identifiable.
 *
 * ⚠️ `null` N'EST PAS UN ÉCHEC À CONTOURNER. Un retour sans occurrence ne
 * doit produire AUCUNE recommandation : c'est préférable à une recommandation
 * calculée sur la mauvaise séance.
 */
export function occurrenceDuRetour(
  retour: RetourAvecOccurrence,
  resoudreSeance?: ResoudreSeance,
): OccurrenceProgrammee | null {
  if (isPrescribedSnapshot(retour.prescribedSnapshot)) {
    const { day, weekNumber } = retour.prescribedSnapshot;
    // Les deux champs sont typés `| null` : un snapshot peut exister sans
    // porter l'occurrence. Les deux sont exigés, jamais l'un sans l'autre —
    // une semaine sans jour ne désigne rien.
    if (typeof day === "string" && day.trim() !== "" && semaineValide(weekNumber)) {
      return { weekNumber, day };
    }
  }
  if (resoudreSeance && retour.sessionId) {
    const resolue = resoudreSeance(retour.sessionId);
    if (resolue && semaineValide(resolue.weekNumber) && resolue.day.trim() !== "") {
      return { weekNumber: resolue.weekNumber, day: resolue.day };
    }
  }
  return null;
}

/** Deux occurrences désignent-elles le même jour de la même semaine ? */
export function memeOccurrence(a: OccurrenceProgrammee, b: OccurrenceProgrammee): boolean {
  return a.weekNumber === b.weekNumber && normaliserJour(a.day) === normaliserJour(b.day);
}

/**
 * Le MÊME JOUR, UNE SEMAINE PLUS TÔT.
 *
 * ⚠️ ELLE NE REMONTE PAS PLUS LOIN QU'UNE SEMAINE, ET C'EST LA RÈGLE TELLE
 * QU'ÉNONCÉE : « même occurrence + semaine précédente ». Si l'occurrence N-1
 * n'a pas été réalisée, il n'y a pas de référence — on n'ira pas chercher
 * N-2 sans décision produit explicite. Remonter en silence reviendrait à
 * comparer le mercredi de cette semaine à celui d'il y a trois semaines sans
 * que personne ne l'ait demandé.
 *
 * `null` en semaine 1 : il n'existe pas de semaine 0.
 */
export function occurrencePrecedente(occurrence: OccurrenceProgrammee): OccurrenceProgrammee | null {
  if (occurrence.weekNumber <= 1) return null;
  return { weekNumber: occurrence.weekNumber - 1, day: occurrence.day };
}

/**
 * Clé d'index « identité d'exercice + occurrence ».
 *
 * L'identité est déjà calculée par l'appelant (`exercise_library_id` ou nom
 * normalisé) : ce module ne décide pas comment on reconnaît un exercice, il
 * ne fait que lui accrocher son occurrence.
 */
export function cleOccurrence(identiteExercice: string, occurrence: OccurrenceProgrammee): string {
  return `${identiteExercice}|${occurrence.weekNumber}|${normaliserJour(occurrence.day)}`;
}
