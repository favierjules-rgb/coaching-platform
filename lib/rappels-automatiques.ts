import { weekDays } from "@/lib/admin";

/**
 * LES RAPPELS AUTOMATIQUES — LES RÈGLES, ET RIEN QUE LES RÈGLES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE MODULE NE LIT RIEN ET N'ENVOIE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Il répond à deux questions, sur des données déjà lues :
 *   • « faut-il rappeler sa séance à cet élève, aujourd'hui ? »
 *   • « faut-il lui rappeler de compléter sa journée alimentaire ? »
 *
 * Les lectures vivent dans lib/notifications/rappels.ts, l'envoi dans
 * lib/notifications/execution.ts, la planification dans les deux campagnes
 * système. Ici, uniquement les conditions — pour qu'elles soient prouvables
 * sans base, sans réseau et sans horloge.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES DEUX CONDITIONS, TELLES QU'ELLES ONT ÉTÉ DEMANDÉES
 * ════════════════════════════════════════════════════════════════════════
 *   ENTRAÎNEMENT = séance prévue aujourd'hui
 *                + séance NON terminée
 *                + rappels entraînement activés pour cet élève
 *
 *   NUTRITION    = journée alimentaire INCOMPLÈTE en fin de journée
 *                + rappels nutrition activés pour cet élève
 *
 * ⚠️ « PAS DE SÉANCE » ET « SÉANCE DÉJÀ FAITE » DONNENT LE MÊME SILENCE, et
 * c'est voulu : dans les deux cas, il n'y a rien à rappeler. Un élève qui
 * s'entraîne à 06:30 et valide sa séance ne doit pas recevoir à 08:00 un
 * rappel de faire ce qu'il vient de faire — c'est le genre de notification qui
 * fait couper les notifications.
 *
 * ⚠️ AUCUN REPAS PLANIFIÉ N'EST PAS UNE JOURNÉE INCOMPLÈTE. Un élève sans plan
 * alimentaire, ou dont la journée n'a rien de prévu, n'a rien à compléter :
 * lui envoyer « complète ta journée » serait un reproche sans objet.
 */

export const GENRES_RAPPEL = ["entrainement", "nutrition"] as const;
export type GenreRappel = (typeof GENRES_RAPPEL)[number];

/**
 * LA DÉFINITION DES DEUX CAMPAGNES SYSTÈME — la même ici et dans la migration.
 *
 * ⚠️ CETTE TABLE EST DOUBLÉE EN BASE, VOLONTAIREMENT, comme la liste des
 * destinations l'est déjà (voir lib/push/destinations.ts) : la migration
 * `20260927090000` insère exactement ces valeurs. `scripts/tests/rappels-automatiques.mts`
 * compare les deux et échoue si elles divergent — une définition doublée qui
 * dérive serait pire qu'une seule.
 */
export interface DefinitionRappel {
  readonly titre: string;
  readonly corps: string;
  /** Doit appartenir à la liste fermée de lib/push/destinations.ts. */
  readonly destination: string;
  /** Heure LOCALE d'envoi (fuseau de la campagne, Europe/Paris). */
  readonly heure: number;
  readonly minute: number;
}

export const DEFINITIONS_RAPPEL: Readonly<Record<GenreRappel, DefinitionRappel>> = {
  entrainement: {
    titre: "Séance du jour",
    corps: "Ta séance t'attend aujourd'hui.",
    destination: "/entrainement",
    heure: 8,
    minute: 0,
  },
  nutrition: {
    titre: "Journée alimentaire",
    corps: "Il reste des repas à compléter pour aujourd'hui.",
    destination: "/nutrition",
    heure: 20,
    minute: 30,
  },
};

/** Le fuseau des deux campagnes : « 08:00 » veut dire 08:00 ICI. */
export const FUSEAU_RAPPELS = "Europe/Paris";

/**
 * Le nom du jour tel que `workout_sessions.day` le stocke (« Lundi »…).
 *
 * ⚠️ LA MÊME LISTE QUE LE RESTE DE L'APPLICATION (`weekDays`, lib/admin.ts),
 * pas une seconde. `getDay()` rend 0 pour dimanche : l'index doit être décalé,
 * et se tromper d'un jour ferait rappeler la séance de la veille.
 */
export function jourDeLaSemaineFr(reference: Date): string {
  const index = (reference.getDay() + 6) % 7; // lundi = 0
  return weekDays[index] as string;
}

/** Une séance du programme, réduite à ce que la décision exige. */
export interface SeancePourRappel {
  readonly id: string;
  readonly day: string;
  readonly weekNumber: number;
  readonly isRestDay: boolean;
}

/**
 * Les séances RÉELLES prévues aujourd'hui, dans la semaine calendaire donnée.
 *
 * `semaineCalendaire` vient de `computeCurrentWeekNumber` — inchangé, et
 * toujours la seule autorité sur « quelle semaine du programme on est ».
 */
export function seancesDuJour(entree: {
  readonly seances: readonly SeancePourRappel[];
  readonly semaineCalendaire: number;
  readonly jour: string;
}): readonly SeancePourRappel[] {
  return entree.seances.filter(
    (s) => s.weekNumber === entree.semaineCalendaire && s.day === entree.jour && !s.isRestDay,
  );
}

/**
 * Faut-il rappeler sa séance à cet élève ?
 *
 * `true` seulement si au moins une séance est prévue aujourd'hui ET qu'aucune
 * des séances du jour n'est encore validée. Une séance déjà terminée ne se
 * rappelle pas.
 */
export function rappelEntrainementDu(entree: {
  readonly seances: readonly SeancePourRappel[];
  readonly semaineCalendaire: number;
  readonly jour: string;
  readonly seancesTerminees: ReadonlySet<string>;
}): boolean {
  const duJour = seancesDuJour(entree);
  if (duJour.length === 0) return false;
  // Plusieurs séances le même jour : il reste quelque chose à faire tant qu'une
  // seule n'est pas validée. Exiger qu'AUCUNE ne le soit ferait taire le rappel
  // dès la première terminée.
  return duJour.some((s) => !entree.seancesTerminees.has(s.id));
}

/** Un repas planifié, réduit à ce que la décision exige. */
export interface RepasPourRappel {
  readonly id: string;
  /** `true` dès qu'une consommation est rattachée (`consumed_meal_id`). */
  readonly consomme: boolean;
}

/**
 * Faut-il rappeler à cet élève de compléter sa journée ?
 *
 * `true` seulement s'il reste au moins un repas planifié non consommé. Aucun
 * repas planifié ⇒ `false` : rien à compléter.
 */
export function rappelNutritionDu(entree: { readonly repas: readonly RepasPourRappel[] }): boolean {
  if (entree.repas.length === 0) return false;
  return entree.repas.some((r) => !r.consomme);
}
