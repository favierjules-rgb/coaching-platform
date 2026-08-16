import {
  borneMaximale,
  solveMealChoices,
  type MealChoiceSolution,
  type MealMacroTarget,
  type SelectedFoodForMealSolver,
} from "@/lib/nutrition/meal-choice-solver";
import type { ChoiceOption, MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";

/**
 * N1.4 — LA COMPOSITION D'UN REPAS PAR L'ÉLÈVE, EN FONCTIONS PURES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'UNE SÉLECTION EST, ET CE QU'ELLE N'EST PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ UNE SÉLECTION DÉSIGNE UNE LIGNE DU SNAPSHOT, PAS UN ALIMENT.
 * `occurrenceId → optionId`, jamais `occurrenceId → alimentId`. Un même repas
 * peut porter « Choix de ta protéine » deux fois, et « Poulet » figurer dans
 * les deux : l'identifiant de l'aliment ne dirait pas laquelle des deux
 * occurrences a été servie. `meal_choice_options.id` le dit, lui, et c'est
 * exactement ce dont N1.5 aura besoin pour calculer les quantités.
 *
 * ⚠️ RIEN ICI N'ÉCRIT NULLE PART. Aucune importation de Supabase, aucune
 * promesse, aucun effet. Choisir un aliment en N1.4 ne crée NI repas consommé,
 * NI entrée, NI repas planifié : c'est un brouillon de composition, tenu en
 * mémoire. Un rafraîchissement le remet à zéro, et c'est assumé pour ce lot —
 * la persistance viendra avec le calcul, pas avant.
 */

/** `occurrenceId → optionId`. Une occurrence, un choix, jamais deux. */
export type SelectionDeChoix = Readonly<Record<string, string>>;

export const AUCUNE_SELECTION: SelectionDeChoix = Object.freeze({});

/**
 * La portée d'un brouillon : CE repas, CE jour.
 *
 * ⚠️ LE JOUR FAIT PARTIE DE LA CLÉ, MÊME SI L'IDENTIFIANT DE REPAS SUFFIRAIT
 * AUJOURD'HUI. Un repas prescrit appartient déjà à un seul jour du plan ; mais
 * le même plan est consulté semaine après semaine, et une composition du lundi
 * 3 n'a rien à faire dans le lundi 10. Nommer la date ici rend la portée
 * explicite plutôt que dépendante d'une propriété du schéma qui pourrait
 * changer.
 */
export function cleDeComposition(mealId: string, date: string | null): string {
  return `${mealId}|${date ?? "sans-date"}`;
}

/**
 * Choisit — ou REMPLACE — l'option d'une occurrence.
 *
 * ⚠️ IL N'Y A JAMAIS DEUX CHOIX ACTIFS POUR UNE OCCURRENCE : la clé est
 * l'occurrence, donc écrire remplace. Et les autres occurrences ne sont pas
 * touchées, ce qui est la garantie d'indépendance demandée.
 */
export function choisirOption(
  selection: SelectionDeChoix,
  slotId: string,
  optionId: string,
): SelectionDeChoix {
  return { ...selection, [slotId]: optionId };
}

/** L'option retenue pour cette occurrence, ou `null`. */
export function optionChoisieId(selection: SelectionDeChoix, slotId: string): string | null {
  return selection[slotId] ?? null;
}

export function estChoisie(selection: SelectionDeChoix, slotId: string): boolean {
  return optionChoisieId(selection, slotId) !== null;
}

/**
 * L'option elle-même, retrouvée DANS le snapshot de cette occurrence.
 *
 * ⚠️ ON CHERCHE DANS `occurrence.options`, ET NULLE PART AILLEURS. Une
 * sélection qui désignerait une option d'une autre occurrence — ou une option
 * disparue du snapshot — rend `null` plutôt qu'un aliment trouvé de travers.
 */
export function optionChoisie(
  occurrence: MealChoiceSlot,
  selection: SelectionDeChoix,
): ChoiceOption | null {
  const id = optionChoisieId(selection, occurrence.id);
  if (id === null) return null;
  return occurrence.options.find((o) => o.optionId === id) ?? null;
}

/**
 * Une option est EXPLOITABLE si son identité a pu être nommée.
 *
 * ⚠️ LE CAS EST EXCEPTIONNEL ET IL EST TRAITÉ, PAS IGNORÉ. Une option dont la
 * source a disparu reste dans le snapshot — on ne la retire pas, le repas doit
 * rester ouvrable — mais on ne la propose pas comme un choix normal : N1.5 ne
 * saurait pas en calculer la quantité, faute de macros à lire. Elle est donc
 * affichée, nommée « Aliment indisponible », et DÉSACTIVÉE.
 */
export function optionExploitable(option: ChoiceOption): boolean {
  return typeof option.optionId === "string" && typeof option.displayName === "string";
}

export interface ProgressionDesChoix {
  readonly total: number;
  readonly choisis: number;
  readonly complet: boolean;
}

/**
 * Combien d'occurrences, combien de choix faits, et si le repas est complet.
 *
 * ⚠️ « COMPLET » EST FAUX SUR UN REPAS SANS OCCURRENCE. Un repas libre n'a rien
 * à compléter : le dire « complet » laisserait croire à N1.5 qu'il y a une
 * composition à calculer là où il n'y en a aucune.
 */
export function progressionDesChoix(
  occurrences: readonly MealChoiceSlot[],
  selection: SelectionDeChoix,
): ProgressionDesChoix {
  const total = occurrences.length;
  const choisis = occurrences.filter((o) => optionChoisie(o, selection) !== null).length;
  return { total, choisis, complet: total > 0 && choisis === total };
}

/**
 * La composition retenue, prête pour N1.5 : une occurrence, son option.
 *
 * Les occurrences non choisies sont ABSENTES — on ne fabrique pas un choix par
 * défaut. L'ordre est celui des occurrences, donc celui du coach.
 */
export interface ChoixResolu {
  readonly slotId: string;
  readonly optionId: string;
  readonly option: ChoiceOption;
}

export function choixResolus(
  occurrences: readonly MealChoiceSlot[],
  selection: SelectionDeChoix,
): readonly ChoixResolu[] {
  const resolus: ChoixResolu[] = [];
  for (const occurrence of occurrences) {
    const option = optionChoisie(occurrence, selection);
    if (option?.optionId) {
      resolus.push({ slotId: occurrence.id, optionId: option.optionId, option });
    }
  }
  return resolus;
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.5 — DU CHOIX AU CALCUL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Une option est CALCULABLE si ses faits nutritionnels ont pu être hydratés.
 *
 * ⚠️ CE N'EST PAS LA MÊME QUESTION QU'`optionExploitable`. Celle-là demande
 * « peut-on la NOMMER, donc la proposer ? » ; celle-ci demande « peut-on la
 * CALCULER ? ». Elles répondent aujourd'hui ensemble — nom et macros viennent
 * de la même ligne du catalogue, et disparaissent ensemble — mais les
 * confondre reviendrait à faire dépendre un calcul de la présence d'un
 * libellé, ce qui est une coïncidence, pas une règle.
 *
 * ⚠️ UNE OPTION AFFICHÉE « ALIMENT INDISPONIBLE » NE PEUT PAS ÊTRE CALCULÉE.
 * On ne lui invente pas 0/0/0 : un aliment sans macros connues n'est pas un
 * aliment à zéro calorie, et le traiter comme tel ferait mentir la cible du
 * repas entier.
 */
export function optionCalculable(option: ChoiceOption): boolean {
  const n = option.nutrition;
  if (!n) return false;
  if (typeof option.optionId !== "string") return false;
  if (![n.proteinPer100, n.carbPer100, n.fatPer100].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return false;
  }
  return contrainteCoherente(option, n.unit);
}

/**
 * N1.5.2 — UN MINIMUM SUPÉRIEUR AU PLAFOND N'EST PAS CALCULABLE.
 *
 * ⚠️ ET C'EST ICI QUE ÇA SE JOUE, PAS DANS LE SOLVEUR. Mesuré : si le solveur
 * reçoit « minimum 350 g » avec un plafond de 300 g, la borne haute écrase
 * silencieusement la borne basse et affiche 300 — la garantie du coach est
 * trahie sans un mot. On refuse donc de produire l'entrée : le repas affiche
 * l'état explicite « non calculable », et personne ne ment.
 *
 * ⚠️ ET PAS SEULEMENT À L'ÉCRITURE. Le writer refuse déjà `min > plafond` au
 * moment où le coach saisit ; mais un snapshot FIGÉ hier resterait incohérent
 * si le plafond baissait demain. Cette seconde couche est celle qui protège le
 * passé.
 *
 * ⚠️ AUCUNE CONTRAINTE SQL N'EN FAIT AUTANT, ET C'EST VOULU : le plafond est
 * une décision produit qui vit dans le solveur. L'écrire en base en ferait une
 * seconde vérité, et le jour où il bougerait il faudrait une migration.
 */
function contrainteCoherente(option: ChoiceOption, unit: "g" | "ml"): boolean {
  const minimum = option.minimumQuantity;
  if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum <= 0) return true;
  // Le minimum ne s'applique que si son unité est celle du calcul ; sinon il
  // est ignoré plus bas, et il ne peut donc pas rendre l'option incalculable.
  if (option.quantityUnit !== unit) return true;
  return minimum <= borneMaximale(unit);
}

/**
 * L'ENTRÉE DU SOLVEUR N1.5 — construite UNIQUEMENT depuis `choixResolus`.
 *
 * ⚠️ AUCUNE AUTRE SOURCE. Ni la bibliothèque (`food_lists`), ni un second
 * état de sélection, ni les items texte du coach : ce que l'élève a choisi,
 * et rien d'autre.
 *
 * ⚠️ L'ORDRE EST CELUI DU COACH, et il est conservé jusqu'à l'écran. Trier
 * par quantité ou par nom ferait danser les lignes à chaque changement de
 * choix.
 *
 * ⚠️ DEUX OCCURRENCES DU MÊME ALIMENT RESTENT DEUX ENTRÉES. On ne déduplique
 * pas par `option.id` : « poulet » dans la protéine principale et « poulet »
 * dans la garniture sont deux variables distinctes du système, et les fondre
 * en une seule changerait le problème posé.
 *
 * Rend `null` dès qu'UN choix n'est pas calculable — on ne calcule pas un
 * repas amputé d'un de ses aliments.
 */
export function alimentsPourLeSolveur(
  resolus: readonly ChoixResolu[],
): readonly SelectedFoodForMealSolver[] | null {
  const aliments: SelectedFoodForMealSolver[] = [];
  for (const resolu of resolus) {
    if (!optionCalculable(resolu.option)) return null;
    const n = resolu.option.nutrition as NonNullable<ChoiceOption["nutrition"]>;
    const uniteCoherente = resolu.option.quantityUnit === n.unit;
    aliments.push({
      optionId: resolu.optionId,
      slotId: resolu.slotId,
      name: resolu.option.displayName ?? "",
      unit: n.unit === "ml" ? "ml" : "g",
      proteinPer100: n.proteinPer100,
      carbPer100: n.carbPer100,
      fatPer100: n.fatPer100,
      // ⚠️ N1.5.1/N1.5.2 — LES DEUX QUANTITÉS NE SONT RETENUES QUE SI LEUR
      // UNITÉ EST CELLE DU CALCUL. Un snapshot figé en `g` sur un aliment
      // devenu `ml` décrirait une échelle qui n'est plus la sienne : on
      // préfère calculer sans contrainte plutôt qu'avec une contrainte fausse.
      preferredQuantity: uniteCoherente ? (resolu.option.preferredQuantity ?? null) : null,
      minimumQuantity: uniteCoherente ? (resolu.option.minimumQuantity ?? null) : null,
    });
  }
  return aliments;
}

/**
 * L'ÉTAT DU CALCUL D'UN REPAS — une fonction, quatre réponses possibles.
 *
 * ⚠️ C'EST ICI QUE SE DÉCIDE S'IL Y A DES QUANTITÉS, PAS DANS LE RENDU. Le
 * composant ne fait que traduire ces quatre cas en pixels ; les tester exige
 * donc de tester une fonction, pas de deviner un DOM.
 *
 *   incomplet      — il manque au moins un choix. AUCUNE quantité. Un repas à
 *                    moitié composé n'a pas de « demi-solution » : les trois
 *                    macros se répartissent entre TOUS les aliments.
 *   sans-cible     — le jour n'a pas de cible exploitable (profil introuvable,
 *                    créneau désactivé). Il n'y a rien à viser.
 *   non-calculable — la composition est complète, mais un aliment n'a plus de
 *                    faits nutritionnels. On le DIT plutôt que de calculer
 *                    sans lui.
 *   calcule        — la solution, quantités comprises.
 */
export type EtatDuCalculDuRepas =
  | { readonly etat: "incomplet" }
  | { readonly etat: "sans-cible" }
  | { readonly etat: "non-calculable" }
  | { readonly etat: "calcule"; readonly solution: MealChoiceSolution };

export function calculDuRepas(
  occurrences: readonly MealChoiceSlot[],
  selection: SelectionDeChoix,
  cible: MealMacroTarget | null,
): EtatDuCalculDuRepas {
  // ⚠️ L'ORDRE DES TESTS COMPTE. « Incomplet » vient d'abord : tant que
  // l'élève n'a pas fini de composer, l'absence de cible n'a aucun intérêt à
  // être signalée.
  if (!progressionDesChoix(occurrences, selection).complet) return { etat: "incomplet" };

  const aliments = alimentsPourLeSolveur(choixResolus(occurrences, selection));
  if (aliments === null) return { etat: "non-calculable" };
  if (cible === null || aliments.length === 0) return { etat: "sans-cible" };

  const solution = solveMealChoices(aliments, cible);

  // ⚠️ N1.5.3 — LA SEULE RAISON QUI RESTE DE NE PAS AFFICHER DE QUANTITÉS.
  // Depuis ce lot, `impossible` n'en est plus une : un repas hors cible montre
  // la MEILLEURE solution réalisable. Mais une solution non CERTIFIÉE — entrée
  // non finie, oscillation d'ensemble actif, garde-fou d'itérations atteint —
  // n'est pas « un peu moins bonne » : on ne sait pas ce qu'elle vaut, donc on
  // ne la montre pas. C'est l'exception structurelle du §8 de l'arbitrage.
  if (!solution.determinism.converged) return { etat: "non-calculable" };

  return { etat: "calcule", solution };
}

/* ══════════════════════════════════════════════════════════════════════════
   COURSES C0 — RESTAURER UNE COMPOSITION VALIDÉE, ET LA COMPARER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un choix tel qu'il est PERSISTÉ dans `planned_meal_items`.
 *
 * ⚠️ TYPE STRUCTUREL, VOLONTAIREMENT. Il décrit la forme d'une ligne, pas son
 * origine : ce module est pur et n'importe rien de `lib/supabase`. Un
 * `ItemValide` lu en base y est assignable sans conversion.
 */
export interface ChoixPersiste {
  readonly slotId: string;
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  readonly quantity: number;
  readonly unit: string;
}

/** L'identité d'une option du snapshot, sous la forme des colonnes de la base. */
function identiteDeLOption(option: ChoiceOption): {
  catalogFoodId: string | null;
  productId: string | null;
} {
  return {
    catalogFoodId: option.type === "aliment" ? option.id : null,
    productId: option.type === "produit" ? option.id : null,
  };
}

/**
 * COURSES C0 — RECONSTRUIT LA SÉLECTION À PARTIR DE LA COMPOSITION VALIDÉE.
 *
 * ⚠️ LA CORRESPONDANCE SE FAIT PAR `choice_slot_id` + IDENTITÉ, JAMAIS PAR NOM.
 * Chercher « Poulet » dans les options rattacherait la ligne à n'importe lequel
 * des homonymes du catalogue — l'audit N1 a mesuré que « bœuf » recouvre 51
 * aliments dont les protéines vont de 17,2 à 39,2 g/100 g. Une identité est un
 * UUID ou n'est rien.
 *
 * ⚠️ UNE LIGNE ORPHELINE EST IGNORÉE, PAS DEVINÉE. Si le coach a retiré
 * l'aliment de l'occurrence depuis la validation, la ligne ne correspond plus à
 * aucune option : on ne la restaure pas, et l'occurrence redevient « à
 * choisir ». Approcher au plus proche inventerait un choix que l'élève n'a pas
 * fait.
 */
export function selectionDepuisComposition(
  occurrences: readonly MealChoiceSlot[],
  items: readonly ChoixPersiste[],
): SelectionDeChoix {
  const parOccurrence = new Map(occurrences.map((o) => [o.id, o] as const));
  const selection: Record<string, string> = {};

  for (const item of items) {
    const occurrence = parOccurrence.get(item.slotId);
    if (!occurrence) continue;
    const option = occurrence.options.find((candidate) => {
      const identite = identiteDeLOption(candidate);
      return (
        identite.catalogFoodId === item.catalogFoodId && identite.productId === item.productId
      );
    });
    if (!option || typeof option.optionId !== "string") continue;
    selection[item.slotId] = option.optionId;
  }

  return Object.freeze(selection);
}

/**
 * COURSES C0 — LA COMPOSITION AFFICHÉE EST-ELLE CELLE QUI EST EN BASE ?
 *
 * Compare occurrence par occurrence : même ensemble d'occurrences, même
 * identité, même quantité ENTIÈRE, même unité.
 *
 * ⚠️ LA QUANTITÉ FAIT PARTIE DE LA COMPARAISON, ET C'EST DÉLIBÉRÉ. Deux
 * causes peuvent faire diverger l'écran de la base : l'élève a changé un choix,
 * ou le calcul a changé sous lui — portion préférée modifiée par le coach,
 * minimum ajouté, solveur amélioré. Les deux méritent le même signal :
 * « modifications non validées », et une décision explicite de l'élève. Ne
 * comparer que les identités laisserait une quantité périmée partir en courses
 * sans que personne ne l'ait vu.
 *
 * ⚠️ ET C'EST CE QUI PROTÈGE LA COMPOSITION VALIDÉE. Elle n'est JAMAIS
 * réécrite par un simple rechargement : il faut un clic.
 */
export function compositionIdentique(
  occurrences: readonly MealChoiceSlot[],
  affichee: readonly {
    readonly slotId: string;
    readonly optionId: string;
    readonly displayQuantity: number;
    readonly unit: string;
  }[],
  persistee: readonly ChoixPersiste[],
): boolean {
  if (affichee.length !== persistee.length) return false;

  const identiteParOption = new Map<string, { catalogFoodId: string | null; productId: string | null }>();
  for (const occurrence of occurrences) {
    for (const option of occurrence.options) {
      if (typeof option.optionId === "string") {
        identiteParOption.set(option.optionId, identiteDeLOption(option));
      }
    }
  }

  const parSlot = new Map(persistee.map((item) => [item.slotId, item] as const));
  for (const item of affichee) {
    const attendu = parSlot.get(item.slotId);
    if (!attendu) return false;
    const identite = identiteParOption.get(item.optionId);
    if (!identite) return false;
    if (identite.catalogFoodId !== attendu.catalogFoodId) return false;
    if (identite.productId !== attendu.productId) return false;
    if (item.displayQuantity !== attendu.quantity) return false;
    if (item.unit !== attendu.unit) return false;
  }
  return true;
}
