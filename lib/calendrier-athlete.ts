import { weekDays } from "@/lib/admin";
import { numeroDeSemaine } from "@/lib/semaine-individuelle";

/**
 * LA DATE D'UNE SÉANCE — une seule règle, et une hiérarchie explicite.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX SOURCES, ET L'ORDRE COMPTE
 * ════════════════════════════════════════════════════════════════════════
 * 1. `workout_sessions.scheduled_date` quand elle est renseignée. C'est la
 *    seule façon de DÉPLACER une séance : changer son jour de la semaine la
 *    déplacerait aussi dans toutes les autres semaines du programme.
 * 2. Sinon, le CALCUL HISTORIQUE :
 *    `program_start_date + 7 × (semaine − 1) + index(jour)`.
 *
 * ⚠️ NULL VEUT DIRE « DATE CALCULÉE », JAMAIS « PAS DE DATE ». Les 847 séances
 * de production n'ont aucune `scheduled_date` : si NULL signifiait « absente »,
 * le calendrier de chaque athlète serait vide le jour de la migration. La
 * colonne est une SURCHARGE, pas un remplacement.
 *
 * ⚠️ SANS DATE DE DÉBUT, LE CALCUL N'A PAS DE RÉPONSE — et on n'en invente pas.
 * 12 des 19 affectations de production n'ont pas de `program_start_date` ; le
 * défaut historique retombait sur la date d'INSCRIPTION de l'élève et affichait
 * des semaines fausses. Ici, `null` est rendu, et l'écran le dit.
 *
 * ⚠️ AUCUNE FORMULE DE SEMAINE N'EST RÉÉCRITE. L'inverse de
 * `numeroDeSemaine` (7 × (semaine − 1)) est écrit une seule fois, ci-dessous,
 * et un test vérifie que les deux fonctions restent réciproques.
 */

/** Index 0..6 d'un jour français dans la semaine du programme (lundi = 0). */
export function indexDuJour(jour: string): number | null {
  const index = weekDays.indexOf(jour);
  return index === -1 ? null : index;
}

/** `AAAA-MM-JJ` d'une date, en jours calendaires locaux. */
function versIso(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

/**
 * Ajoute des jours à une date ISO, en jours CALENDAIRES.
 *
 * ⚠️ PAS D'ARITHMÉTIQUE EN MILLISECONDES. `+ n × 86 400 000` se décale d'une
 * heure aux changements d'heure d'été, ce qui suffit à faire tomber une séance
 * la veille au soir. `setDate` traverse correctement les 25 et 23 heures.
 */
export function ajouterJours(dateIso: string, jours: number): string | null {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!correspondance) return null;
  const [, annee, mois, jour] = correspondance;
  const date = new Date(Number(annee), Number(mois) - 1, Number(jour));
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + jours);
  return versIso(date);
}

/**
 * Le décalage en jours, depuis le début du programme, d'une séance de la
 * semaine `semaine` un jour `jour`.
 *
 * C'est l'INVERSE de `numeroDeSemaine` : `numeroDeSemaine(7 × (s − 1)) === s`.
 */
export function decalageDeLaSeance(semaine: number, jour: string): number | null {
  const index = indexDuJour(jour);
  if (index === null) return null;
  if (!Number.isFinite(semaine)) return null;
  const semaineUtile = Math.max(1, Math.trunc(semaine));
  return 7 * (semaineUtile - 1) + index;
}

export type OrigineDate = "planifiee" | "calculee" | "indeterminee";

export interface DateDeSeance {
  /** `AAAA-MM-JJ`, ou `null` quand aucune date n'est déterminable. */
  readonly date: string | null;
  readonly origine: OrigineDate;
}

export interface SeanceADater {
  readonly weekNumber: number;
  readonly day: string;
  /** `workout_sessions.scheduled_date`. */
  readonly scheduledDate?: string | null;
}

/**
 * La date d'une séance pour UN athlète.
 *
 * ⚠️ `scheduledDate` GAGNE TOUJOURS. Recalculer par-dessus une date posée à la
 * main annulerait silencieusement chaque déplacement du coach.
 */
export function dateDeLaSeance(seance: SeanceADater, debutDuProgramme: string | null | undefined): DateDeSeance {
  const planifiee = seance.scheduledDate?.trim();
  if (planifiee) {
    return { date: planifiee, origine: "planifiee" };
  }
  if (!debutDuProgramme) {
    return { date: null, origine: "indeterminee" };
  }
  const decalage = decalageDeLaSeance(seance.weekNumber, seance.day);
  if (decalage === null) {
    return { date: null, origine: "indeterminee" };
  }
  const date = ajouterJours(debutDuProgramme, decalage);
  return date === null ? { date: null, origine: "indeterminee" } : { date, origine: "calculee" };
}

/**
 * La semaine et le jour qu'une date IMPLIQUE, pour le programme d'un athlète.
 *
 * Sert au déplacement : déposer une séance sur le 12 octobre doit dire au
 * coach dans quelle semaine du programme elle tombe.
 *
 * ⚠️ REND `null` AVANT LE DÉBUT DU PROGRAMME. Une séance ne peut pas tomber en
 * « semaine 0 » : `numeroDeSemaine` rendrait 0, et l'afficher laisserait croire
 * à une semaine d'échauffement qui n'existe pas.
 */
export function positionDansLeProgramme(
  date: string,
  debutDuProgramme: string | null | undefined,
): { readonly semaine: number; readonly jour: string } | null {
  if (!debutDuProgramme) return null;
  const debut = /^(\d{4})-(\d{2})-(\d{2})$/.exec(debutDuProgramme.trim());
  const cible = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!debut || !cible) return null;
  const dateDebut = new Date(Number(debut[1]), Number(debut[2]) - 1, Number(debut[3]));
  const dateCible = new Date(Number(cible[1]), Number(cible[2]) - 1, Number(cible[3]));
  if (Number.isNaN(dateDebut.getTime()) || Number.isNaN(dateCible.getTime())) return null;
  const jours = Math.round((dateCible.getTime() - dateDebut.getTime()) / 86_400_000);
  if (jours < 0) return null;
  const jour = weekDays[jours % 7];
  return { semaine: numeroDeSemaine(jours), jour };
}

/* ════════════════════════════════════════════════════════════════════════
 * LA GRILLE DU MOIS
 * ════════════════════════════════════════════════════════════════════════ */

export interface CaseCalendrier {
  readonly date: string;
  readonly dansLeMois: boolean;
}

/**
 * Les six semaines d'une grille mensuelle, lundi en tête.
 *
 * ⚠️ TOUJOURS 42 CASES. Une grille dont la hauteur change d'un mois à l'autre
 * fait sauter la mise en page, et le mois de février sur 28 jours alignés sur un
 * lundi produirait quatre lignes là où mai en produit six.
 */
export function grilleDuMois(annee: number, mois: number): CaseCalendrier[] {
  const premier = new Date(annee, mois - 1, 1);
  // getDay() : 0 = dimanche … 6 = samedi → réindexé lundi = 0.
  const decalage = (premier.getDay() + 6) % 7;
  const debut = new Date(annee, mois - 1, 1 - decalage);
  const cases: CaseCalendrier[] = [];
  for (let index = 0; index < 42; index += 1) {
    const jour = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + index);
    cases.push({ date: versIso(jour), dansLeMois: jour.getMonth() === mois - 1 });
  }
  return cases;
}

export const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

export const MOIS_FRANCAIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

export function libelleDuMois(annee: number, mois: number): string {
  return `${MOIS_FRANCAIS[mois - 1]} ${annee}`;
}
