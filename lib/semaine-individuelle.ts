import { daysBetween } from "@/lib/admin";

/**
 * LE CALENDRIER INDIVIDUEL D'UN ÉLÈVE — UNE SEULE FORMULE, DANS UN SEUL FICHIER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * La semaine affichée à un élève se calculait dans `computeCurrentWeekNumber`
 * (lib/training-schedule.ts), qui exige un `AdminProgram` COMPLET et un
 * `AdminStudent`. La carte admin, elle, ne dispose que d'un résumé. Deux issues
 * se présentaient :
 *   · dupliquer `floor(jours / 7) + 1` dans la carte — c'est exactement ce que
 *     la fiche élève faisait avant le lot « calendrier », et c'est ce qui l'a
 *     rendue fausse : deux implémentations de la même règle divergent toujours,
 *     et la seconde n'est jamais corrigée en même temps que la première ;
 *   · extraire la partie PURE, et n'en garder qu'une.
 *
 * C'est la seconde. `computeCurrentWeekNumber` appelle `semaineDepuis` et ne
 * calcule plus rien elle-même ; son comportement est inchangé pour tous les
 * cas valides (voir scripts/tests/calendrier-semaines.mts, section I).
 *
 * ⚠️ `numeroDeSemaine` EST LE SEUL ENDROIT OÙ LA FORMULE EST ÉCRITE. Les deux
 * fonctions publiques ci-dessous y passent toutes les deux. Si un jour la
 * règle change (des semaines de 5 jours, une semaine 0…), il n'y a qu'une
 * ligne à changer — et un test structurel garde cette unicité.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX SEMAINES, DEUX QUESTIONS — ELLES NE SE CONFONDENT TOUJOURS PAS
 * ════════════════════════════════════════════════════════════════════════
 *   · la semaine CALENDAIRE (ici) répond à « où en est l'élève DANS LE TEMPS ? ».
 *     Elle ne dépend que de sa date de début individuelle ;
 *   · le POURCENTAGE (lib/progression-programme.ts) répond à « combien de
 *     travail a-t-il fait ? ». Il ne dépend que des séances validées.
 *
 * Une séance en retard ne bloque PLUS la semaine : c'est la règle du 27/09/2026
 * (option B). Un élève à la semaine 4 qui n'a rien validé lit « Sem. 4 / 12 »
 * et « 0 % » — les deux sont vrais, et ils disent deux choses différentes.
 */

/**
 * `floor(jours / 7) + 1` — la formule, et rien d'autre.
 *
 * Jour 0 (le jour du début) est la semaine 1 ; le jour 7 ouvre la semaine 2.
 * Donc : 28 à 34 jours → semaine 5 ; 35 jours exactement → semaine 6.
 *
 * Non bornée volontairement : la borne dépend du programme (`durationWeeks`),
 * pas du calendrier, et l'imposer ici mélangerait deux responsabilités.
 */
export function numeroDeSemaine(joursEcoules: number): number {
  return Math.floor(joursEcoules / 7) + 1;
}

/**
 * La semaine calendaire d'une date de début, ou `null` quand la question n'a
 * pas de réponse : date illisible, ou début dans le FUTUR.
 *
 * ⚠️ `daysSinceStart < 0` EST REDONDANT AVEC LA BORNE `Math.max(1, …)` DES
 * APPELANTS, et le sabotage l'avait montré du temps où cette garde vivait dans
 * `computeCurrentWeekNumber` : la retirer ne rougissait aucun test, parce
 * qu'une date antérieure donne `floor(-7/7)+1 = 0`, que la borne ramenait à 1.
 * Elle reste, et elle est désormais UTILE en plus d'être intentionnelle :
 * `etatSemaineIndividuelle` s'en sert pour distinguer « à venir » de
 * « semaine 1 », ce que la carte admin doit afficher différemment.
 *
 * `Number.isFinite`, lui, a toujours été indispensable : il attrape le NaN
 * d'une date illisible, que `Math.max` propagerait.
 */
export function semaineDepuis(dateDebut: string, reference: Date): number | null {
  const daysSinceStart = daysBetween(dateDebut, reference);
  if (!Number.isFinite(daysSinceStart) || daysSinceStart < 0) {
    return null;
  }
  return numeroDeSemaine(daysSinceStart);
}

/**
 * L'état du calendrier individuel, DISTINGUÉ — parce que la carte admin doit
 * dire des choses différentes selon le cas, et qu'un simple nombre ne le
 * permet pas.
 *
 * ⚠️ « SANS DATE » N'EST PAS « SEMAINE 1 ». C'est le défaut que ce lot ferme :
 * 12 des 19 affectations de production n'ont aucune date, et retombaient en
 * silence sur `students.start_date` — la date d'INSCRIPTION. Un élève inscrit
 * il y a cinq semaines et démarrant lundi lisait « Semaine 5 / 12 ». Il n'y a
 * pas de réponse à inventer : l'état se nomme, et l'écran le montre.
 */
export type EtatSemaineIndividuelle =
  | { readonly etat: "sans-date" }
  | { readonly etat: "date-illisible" }
  | { readonly etat: "a-venir" }
  | { readonly etat: "en-cours"; readonly semaine: number };

export function etatSemaineIndividuelle(
  dateDebut: string | null | undefined,
  durationWeeks: number,
  reference: Date,
): EtatSemaineIndividuelle {
  if (!dateDebut) {
    return { etat: "sans-date" };
  }
  const jours = daysBetween(dateDebut, reference);
  if (!Number.isFinite(jours)) {
    return { etat: "date-illisible" };
  }
  if (jours < 0) {
    return { etat: "a-venir" };
  }
  /*
   * ⚠️ LA BORNE HAUTE EST `durationWeeks`, PAS `semainesPlanifiees`. Décision
   * du 27/09/2026 : « Y = durationWeeks du programme ». Un programme déclaré 12
   * semaines affiche donc « / 12 », même si 6 semaines seulement sont
   * construites — et la semaine affichée ne peut pas dépasser ce même 12, sans
   * quoi « Sem. 14 / 12 » serait atteignable dès qu'un élève dépasse la durée.
   */
  return { etat: "en-cours", semaine: Math.min(borneDeSemaines(durationWeeks), numeroDeSemaine(jours)) };
}

/** `durationWeeks` utilisable : au moins 1, jamais NaN. */
function borneDeSemaines(durationWeeks: number): number {
  return Number.isFinite(durationWeeks) ? Math.max(1, Math.trunc(durationWeeks)) : 1;
}

/**
 * CE QUE LA CARTE AFFICHE POUR UN ÉLÈVE — libellé, état, semaine.
 *
 * ⚠️ « TERMINÉ » PASSE AVANT LE CALENDRIER, et c'est une règle, pas une
 * commodité d'affichage. Un élève qui a validé ses 48 séances en semaine 7 a
 * fini son programme ; lui annoncer « Sem. 7 / 12 » nierait le travail fait.
 * L'inverse est vrai aussi : semaine 12 avec 47 séances sur 48 n'est PAS
 * terminé — la date n'achève rien.
 */
export interface AffichageSemaine {
  /** « Terminé », « À venir », « — / 12 », « Sem. 3 / 12 ». */
  readonly libelle: string;
  readonly etat: "termine" | "a-venir" | "sans-date" | "date-illisible" | "en-cours";
  /** Le numéro, quand il en existe un — pour les libellés accessibles. */
  readonly semaine: number | null;
  /** `Y` : `durationWeeks` normalisé. Rendu pour que l'appelant ne le recalcule pas. */
  readonly total: number;
}

export function affichageSemaineDeLEleve(entree: {
  /** `progressionDuProgramme(...).termine` — jamais recalculé ici. */
  readonly termine: boolean;
  readonly dateDebut: string | null | undefined;
  readonly durationWeeks: number;
  readonly reference: Date;
}): AffichageSemaine {
  const total = borneDeSemaines(entree.durationWeeks);
  if (entree.termine) {
    return { libelle: "Terminé", etat: "termine", semaine: null, total };
  }
  const etat = etatSemaineIndividuelle(entree.dateDebut, entree.durationWeeks, entree.reference);
  switch (etat.etat) {
    case "a-venir":
      return { libelle: "À venir", etat: "a-venir", semaine: null, total };
    case "sans-date":
      return { libelle: `— / ${total}`, etat: "sans-date", semaine: null, total };
    case "date-illisible":
      return { libelle: `— / ${total}`, etat: "date-illisible", semaine: null, total };
    case "en-cours":
      return { libelle: `Sem. ${etat.semaine} / ${total}`, etat: "en-cours", semaine: etat.semaine, total };
  }
}

/** La phrase montrée au coach sous un libellé « — / Y ». */
export const MESSAGE_DATE_ABSENTE = "Date de début non renseignée";
