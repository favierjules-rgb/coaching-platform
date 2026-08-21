import { MOIS_FR, ajouterJours, partiesDeDate, semaineContenant } from "@/lib/nutrition/historique";
import { WEEKDAY_KEYS, WEEKDAY_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * COURSES C1 — LA PÉRIODE : DE 1 À 7 JOURS, EN DATES RÉELLES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SEULE DATE RÉELLE DU MODÈLE EST `planned_meals.planned_on`
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ `nutrition_days.day` N'EST PAS UNE DATE. C'est un nom de jour anglais
 * (`monday`…), le même pour toutes les semaines de tous les élèves : il dit
 * QUOI est prescrit un lundi, jamais QUEL lundi. `week_start_date` est nul sur
 * l'intégralité des lignes en production. Traiter `day` comme une date
 * fabriquerait une liste de courses pour un lundi qui n'existe pas.
 *
 * Ce module fait donc l'inverse, et c'est tout ce qu'il fait : il part de
 * DATES réelles, et en déduit le nom de jour à consulter dans le plan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUNE NOUVELLE CONVENTION DE FUSEAU
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN `new Date(...)` DANS CE FICHIER. Toute l'arithmétique passe par
 * `ajouterJours` et `semaineContenant` de `lib/nutrition/historique.ts`, qui
 * possède déjà la convention (dates découpées en année/mois/jour, reconstruites
 * en heure LOCALE). Une seconde convention aurait décalé la période d'un jour
 * une nuit d'été sur deux, et personne ne l'aurait vu avant un dimanche.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/* ══════════════════════════════════════════════════════════════════════════
   LA DURÉE — 1 À 7, ET RIEN D'AUTRE
   ══════════════════════════════════════════════════════════════════════════ */

/** Les seules durées proposées. Une liste, pas un intervalle : elle se rend. */
export const DUREES_COURSES = [1, 2, 3, 4, 5, 6, 7] as const;
export type DureeCourses = (typeof DUREES_COURSES)[number];

/**
 * ⚠️ IL N'EXISTE AUCUNE DURÉE PAR DÉFAUT, ET C'EST UNE DÉCISION PRODUIT.
 *
 * Une valeur pré-cochée est une réponse que l'élève n'a pas donnée. Elle passe
 * inaperçue — on avance sans lire la question — et produit une liste de courses
 * pour une période que personne n'a choisie. « Aucun choix » et « le choix 3 »
 * sont deux états différents ; les confondre fabrique un consentement.
 *
 * La durée est donc `DureeCourses | null`, initialisée à `null`, et le parcours
 * ne peut pas avancer tant qu'elle vaut `null` : c'est `construirePeriode` qui
 * rend `null` à son tour, donc il n'y a littéralement pas de période à lire.
 *
 * ⚠️ IL N'EXISTE PLUS DE CONSTANTE `DUREE_COURSES_PAR_DEFAUT`. La retirer plutôt
 * que la mettre à `null` évite qu'un futur appelant l'importe « pour initialiser
 * proprement » et réintroduise le défaut sans le vouloir.
 *
 * (Pour mémoire, et sans que cela change quoi que ce soit : l'ancien parcours
 * abandonné ouvrait sur `useState(3)`. Ce défaut est explicitement écarté.)
 */

/** `true` si `valeur` est une durée proposée. Aucun repli : 0, 8 et `null` sont FAUX. */
export function estDureeCourses(valeur: unknown): valeur is DureeCourses {
  return (
    typeof valeur === "number" &&
    Number.isInteger(valeur) &&
    (DUREES_COURSES as readonly number[]).includes(valeur)
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LA PÉRIODE
   ══════════════════════════════════════════════════════════════════════════ */

export interface JourDeCourses {
  /** La date RÉELLE, ISO. C'est elle qui sera comparée à `planned_on`. */
  readonly date: string;
  /** Le nom de jour anglais, pour retrouver le `PlanV2Day` correspondant. */
  readonly jour: WeekdayKey;
}

export interface PeriodeCourses {
  readonly duree: DureeCourses;
  /** Première date incluse. */
  readonly debut: string;
  /** Dernière date INCLUSE — 1 jour donne debut === fin. */
  readonly fin: string;
  readonly jours: readonly JourDeCourses[];
}

/**
 * Le nom de jour d'une date réelle.
 *
 * Passe par `semaineContenant`, qui construit déjà la semaine lundi → dimanche
 * dans la bonne convention : l'indice de la date dans cette semaine EST son
 * rang, et `WEEKDAY_KEYS` est ordonné de la même façon. Aucun `getDay()` ici,
 * donc aucun risque de retomber sur la convention dimanche-en-premier.
 */
export function jourDeLaDate(iso: string): WeekdayKey | null {
  const semaine = semaineContenant(iso);
  if (semaine === null) return null;
  const rang = semaine.dates.indexOf(iso);
  return rang === -1 ? null : (WEEKDAY_KEYS[rang] ?? null);
}

/**
 * La période de `duree` jours qui COMMENCE à `depart`, bornes incluses.
 *
 * « départ lundi + 4 jours » = lundi, mardi, mercredi, jeudi. La borne de fin
 * est donc `depart + duree - 1`, jamais `depart + duree` : un jour de plus
 * ferait acheter un dîner que l'élève ne mangera pas.
 *
 * `null` si la date est mal formée ou la durée hors 1..7 — jamais de
 * troncature silencieuse à 7, qui laisserait croire que 30 a été accepté.
 *
 * ⚠️ `duree === null` REND `null`, ET C'EST LE VERROU DU PARCOURS. Tant que
 * l'élève n'a rien choisi, il n'existe aucune période : pas de dates, donc
 * aucune lecture, aucun repas, aucune liste. Le bouton désactivé n'est que
 * l'écho visible de cette absence — il n'en est pas la cause.
 */
export function construirePeriode(depart: string, duree: number | null): PeriodeCourses | null {
  if (!estDureeCourses(duree)) return null;
  const jours: JourDeCourses[] = [];
  for (let i = 0; i < duree; i += 1) {
    const date = ajouterJours(depart, i);
    if (date === null) return null;
    const jour = jourDeLaDate(date);
    if (jour === null) return null;
    jours.push({ date, jour });
  }
  return { duree, debut: jours[0].date, fin: jours[jours.length - 1].date, jours };
}

/** Les dates de la période, pour un `.gte`/`.lte` ou un `.in`. */
export function datesDeLaPeriode(periode: PeriodeCourses): readonly string[] {
  return periode.jours.map((j) => j.date);
}

/**
 * « Du lundi 17 au jeudi 20 août », « Le lundi 17 août » pour un seul jour.
 *
 * Le mois n'est écrit deux fois que s'il change, et l'année n'apparaît que si
 * la période l'enjambe — même règle que `libelleSemaine`, pour que les deux
 * titres se ressemblent. Les noms de jour viennent de `WEEKDAY_LABELS_FR` et
 * les mois de `MOIS_FR` : aucune table recopiée.
 */
export function libellePeriode(periode: PeriodeCourses): string {
  const premier = periode.jours[0];
  const dernier = periode.jours[periode.jours.length - 1];
  const d = partiesDeDate(premier.date);
  const f = partiesDeDate(dernier.date);
  if (!d || !f) return "";

  const jourD = WEEKDAY_LABELS_FR[premier.jour].toLowerCase();
  const jourF = WEEKDAY_LABELS_FR[dernier.jour].toLowerCase();
  const moisD = MOIS_FR[d.m - 1] ?? "";
  const moisF = MOIS_FR[f.m - 1] ?? "";

  if (periode.duree === 1) {
    return `Le ${jourD} ${d.j} ${moisD}`;
  }
  if (d.a !== f.a) {
    return `Du ${jourD} ${d.j} ${moisD} ${d.a} au ${jourF} ${f.j} ${moisF} ${f.a}`;
  }
  if (d.m !== f.m) {
    return `Du ${jourD} ${d.j} ${moisD} au ${jourF} ${f.j} ${moisF}`;
  }
  return `Du ${jourD} ${d.j} au ${jourF} ${f.j} ${moisF}`;
}
