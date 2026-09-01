import { MEAL_SLOT_DEFAULT_ORDER, MEAL_SLOT_LABELS_FR, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import {
  progressionDesChoix,
  selectionDepuisComposition,
  type SelectionDeChoix,
} from "@/lib/nutrition/meal-choice-selection";
import { MOIS_FR, partiesDeDate } from "@/lib/nutrition/historique";
import { jourDeLaDate } from "@/lib/nutrition/periode-courses";
import type { RepasDeLaPeriode } from "@/lib/nutrition/repas-de-la-periode";
import { WEEKDAY_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * COURSES C1.1 — LES REPAS SE LISENT PAR JOUR, PAS EN LISTE PLATE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT CORRIGÉ
 * ────────────────────────────────────────────────────────────────────────────
 * C1 rendait vingt et une lignes identifiées par « Lundi · 2026-08-17 ». Trois
 * repas du même jour se ressemblaient trait pour trait, et le CRÉNEAU — la
 * seule information qui les distingue — n'apparaissait nulle part. On regroupe
 * donc par JOUR, et chaque carte dit son créneau en français.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUN REPAS N'EST INVENTÉ
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE COMPLÈTE JAMAIS UNE JOURNÉE. Si le plan du coach ne prescrit qu'un
 * petit-déjeuner et un dîner ce jour-là, le groupe contient DEUX cartes. Il
 * serait facile — et faux — d'afficher les six créneaux « pour faire propre » :
 * l'élève croirait devoir composer un déjeuner qui n'existe pas, et le
 * chercherait en vain.
 *
 * ⚠️ AUCUN MAPPING PARALLÈLE. Les libellés viennent de `MEAL_SLOT_LABELS_FR` et
 * l'ordre de `MEAL_SLOT_DEFAULT_ORDER` — les tables du modèle nutrition, déjà
 * utilisées par l'écran du plan. En recopier une ici garantirait qu'un jour
 * « Collation du matin » s'appelle autrement selon l'écran.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/** Une carte repas, telle qu'elle se lit. */
export interface CarteRepas {
  readonly repas: RepasDeLaPeriode;
  /** « Petit déjeuner », « Collation du matin »… — table du modèle nutrition. */
  readonly libelleCreneau: string;
  /**
   * Le nom donné par le coach, UNIQUEMENT s'il apporte quelque chose.
   * `null` quand il répète le créneau : l'afficher deux fois n'informe pas.
   */
  readonly nomPersonnalise: string | null;
  /** « 5 / 5 choix » — total = occurrences du repas. */
  readonly total: number;
  readonly choisis: number;
  /** `true` quand toutes les occurrences ont un choix. */
  readonly pret: boolean;
  /**
   * `true` si le repas était prêt mais qu'un choix n'est PLUS autorisé par le
   * snapshot actuel du coach. Il faut alors le recomposer — jamais le
   * remplacer en silence.
   */
  readonly aRecomposer: boolean;
  /** `true` si le repas a été déclaré consommé : sa composition est verrouillée. */
  readonly consomme: boolean;
}

export interface GroupeDeJour {
  /** La date réelle, ISO. */
  readonly date: string;
  readonly jour: WeekdayKey;
  /** « LUNDI ». */
  readonly libelleJour: string;
  /** « 17 août ». */
  readonly libelleDate: string;
  readonly cartes: readonly CarteRepas[];
  readonly total: number;
  readonly prets: number;
}

/**
 * `true` si le nom du repas apporte quelque chose de plus que son créneau.
 *
 * Comparaison insensible à la casse et aux accents — « PETIT DÉJEUNER » et
 * « Petit dejeuner » disent la même chose que « Petit déjeuner ». Ce n'est
 * PAS une heuristique de contenu : on compare deux libellés d'affichage entre
 * eux, jamais un nom d'aliment à une catégorie.
 */
function nomUtile(nom: string, libelleCreneau: string): string | null {
  const normaliser = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const propre = nom.trim();
  if (propre === "") return null;
  return normaliser(propre) === normaliser(libelleCreneau) ? null : propre;
}

/**
 * La composition affichée d'un repas, sous forme de sélection.
 *
 * ⚠️ PAR `choice_slot_id` + IDENTITÉ, JAMAIS PAR NOM — c'est
 * `selectionDepuisComposition` de N1 qui le fait, on ne le refait pas ici.
 * Une option retirée du snapshot depuis la validation ne se retrouve PAS :
 * l'occurrence redevient sans choix, et la carte passe « À RECOMPOSER ».
 */
export function selectionAffichee(repas: RepasDeLaPeriode): SelectionDeChoix | null {
  return repas.composition === null
    ? null
    // ⚠️ N1.7 — LES OCCURRENCES ÉCARTÉES ACCOMPAGNENT LES ALIMENTS. La carte
    // du repas affiche « x / y choix » : sans elles, un repas dont l'élève a
    // tout réglé afficherait 2/3 et se dirait à recomposer.
    : selectionDepuisComposition(repas.occurrences, repas.composition, repas.compositionIgnorees);
}

/** La carte d'un repas, progression comprise. */
export function carteDuRepas(repas: RepasDeLaPeriode): CarteRepas {
  const libelleCreneau = MEAL_SLOT_LABELS_FR[repas.slot as MealSlotKey] ?? repas.slot;
  const selection = selectionAffichee(repas);
  const progression = progressionDesChoix(repas.occurrences, selection ?? {});
  // ⚠️ CORRECTIF D-3 — « VALIDÉ EN BASE » ET « ENCORE VALIDE » SONT DEUX
  // CHOSES, et la distinction vit désormais dans le MODÈLE
  // (`repasDeLaPeriode`), pas dans la carte. La recalculer ici aurait laissé
  // deux vérités : celle de l'écran et celle du moteur de proposition — et
  // c'est précisément l'écart qui faisait disparaître un repas en silence.
  return {
    repas,
    libelleCreneau,
    nomPersonnalise: nomUtile(repas.nom, libelleCreneau),
    total: progression.total,
    choisis: progression.choisis,
    pret: repas.pret,
    aRecomposer: repas.aRecomposer,
    consomme: repas.consomme,
  };
}

/**
 * Les repas de la période, groupés par jour puis triés par créneau canonique.
 *
 * `repas` arrive déjà chronologique (`repasDeLaPeriode`) ; on préserve cet
 * ordre d'apparition des jours plutôt que de retrier des chaînes de dates.
 */
export function groupesParJour(repas: readonly RepasDeLaPeriode[]): readonly GroupeDeJour[] {
  const parDate = new Map<string, RepasDeLaPeriode[]>();
  for (const r of repas) {
    const liste = parDate.get(r.date) ?? [];
    liste.push(r);
    parDate.set(r.date, liste);
  }

  const groupes: GroupeDeJour[] = [];
  for (const [date, duJour] of parDate) {
    const jour = jourDeLaDate(date);
    if (jour === null) continue;
    const parties = partiesDeDate(date);
    const cartes = [...duJour]
      .sort(
        (a, b) =>
          (MEAL_SLOT_DEFAULT_ORDER[a.slot as MealSlotKey] ?? 99) -
          (MEAL_SLOT_DEFAULT_ORDER[b.slot as MealSlotKey] ?? 99),
      )
      .map(carteDuRepas);
    groupes.push({
      date,
      jour,
      libelleJour: WEEKDAY_LABELS_FR[jour].toUpperCase(),
      libelleDate: parties ? `${parties.j} ${MOIS_FR[parties.m - 1] ?? ""}` : date,
      cartes,
      total: cartes.length,
      prets: cartes.filter((c) => c.pret).length,
    });
  }
  return groupes;
}

/** « 12 repas prêts sur 21 » — le compte global, sans reparcourir l'arbre. */
export function compterCartes(groupes: readonly GroupeDeJour[]): {
  readonly total: number;
  readonly prets: number;
  readonly aRecomposer: number;
} {
  let total = 0;
  let prets = 0;
  let aRecomposer = 0;
  for (const groupe of groupes) {
    for (const carte of groupe.cartes) {
      total += 1;
      if (carte.pret) prets += 1;
      if (carte.aRecomposer) aRecomposer += 1;
    }
  }
  return { total, prets, aRecomposer };
}
