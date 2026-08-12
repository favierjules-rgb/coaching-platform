import { BASIS_POINTS_TOTAL } from "@/lib/nutrition/basis-points";
import { internalProfileKeyForDay, MAIN_DAY_PROFILE_KEY } from "@/lib/nutrition/day-profile-keys";
import { rebalanceDailyMacros, rebalanceSlotMacro } from "@/lib/nutrition/macro-rebalance";
import {
  MEAL_SLOT_KEYS,
  createEmptyAllocations,
  normalizeDisabledSlots,
  type MacroKey,
  type MealSlotAllocation,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import {
  distributeRestForMacro,
  setDailyCalories,
  setDailyMacroBp,
  setSlotEnabled,
  toggleSlotLock,
  type LockedSlots,
  type PlanV2FormState,
} from "@/lib/nutrition/plan-v2-form";
import {
  NUTRITION_MODEL_VERSION_STRUCTURED,
  type NutritionPlanV2,
  type NutritionPlanV2Profile,
} from "@/lib/nutrition/plan-v2-validation";
import type { PlanV2Week, PrescribedMeal } from "@/lib/nutrition/plan-v2-week";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * ÉTAT DE FORMULAIRE DE LA SEMAINE — logique PURE.
 *
 * ═══ LE MODÈLE ═══
 *
 * Le coach construit UNE SEMAINE : sept jours, chacun portant DIRECTEMENT
 * toute sa configuration — ses calories, sa répartition P/G/L, ses parts par
 * créneau, ses verrous et ses repas prescrits. Il n'y a plus d'objectif
 * quotidien global, plus de profils à nommer, plus d'affectation d'un profil
 * à un jour. Le mot « profil » a disparu de l'interface.
 *
 * ═══ LES PROFILS, DÉTAIL TECHNIQUE ═══
 *
 * La base, elle, continue d'exiger qu'une journée désigne un profil par une
 * clé étrangère composite. On la satisfait sans jamais l'exposer : chaque
 * jour possède SON profil interne, dérivé de son nom
 * (`monday → day_monday`, voir day-profile-keys.ts). Sept jours, sept
 * profils, aucune saisie, aucun doublon possible.
 *
 * Conséquence directe, et c'est le but : deux jours ne partagent jamais un
 * profil. Modifier mardi ne peut donc pas déplacer lundi, même si les deux
 * partageaient le même profil dans le plan d'origine.
 *
 * ═══ AUCUNE FORMULE RÉÉCRITE ═══
 *
 * Les calories, les grammes et les parts restent calculés par les
 * bibliothèques existantes. Ce module n'appelle que des fonctions déjà
 * éprouvées de `plan-v2-form.ts` : il place l'état de macros d'UN JOUR
 * là où ces fonctions attendent celui d'un plan, puis récupère le résultat.
 * Ni 4, ni 4, ni 9 n'apparaissent ici.
 */

/* ═════════════════════ Types ═════════════════════ */

/** La configuration nutritionnelle d'un jour — sans le vocabulaire de plan. */
export interface DayTargetsForm {
  readonly dailyCalories: number;
  readonly proteinBp: number;
  readonly carbBp: number;
  readonly fatBp: number;
  readonly slots: readonly MealSlotAllocation[];
  readonly locked: LockedSlots;
}

export interface WeekDayForm extends DayTargetsForm {
  /** Identifiant de la ligne `nutrition_days`, ou « nouveau:<jour> ». */
  readonly id: string;
  readonly day: WeekdayKey;
  readonly status: string;
  readonly meals: readonly PrescribedMeal[];
  /**
   * Clé du profil que ce jour utilisait AVANT reprise, ou `null` pour un jour
   * neuf. Purement informative : elle n'est jamais affichée et jamais
   * renvoyée en base — la sauvegarde normalise vers `day_<jour>`. Elle sert
   * à prouver, dans les tests, qu'un plan existant a bien été repris.
   */
  readonly sourceProfileKey: string | null;
}

export interface WeekFormState {
  /** Toujours SEPT jours, dans l'ordre canonique lundi → dimanche. */
  readonly days: readonly WeekDayForm[];
}

const AUCUN_VERROU: LockedSlots = { protein: [], carb: [], fat: [] };

/** Champs de plan neutres — voir `avecEtatMacros`. */
const META_NEUTRE = {
  planId: null,
  name: "",
  description: "",
  goalType: "",
  status: "",
  coachNotes: "",
  hydrationTip: "",
} as const;

/**
 * ADAPTATEUR — l'état de macros d'un jour, présenté comme un `PlanV2FormState`.
 *
 * Les fonctions de `plan-v2-form.ts` (`setDailyCalories`, `setSlotMacroBp`,
 * `distributeRestForMacro`, `deriveDailyTargets`, `buildRecap`…) portent
 * TOUT le métier des objectifs et de la répartition, et sont couvertes par
 * des dizaines de tests. Les redéfinir pour un jour serait dupliquer ce
 * métier — exactement ce qu'il ne faut pas faire.
 *
 * On les réutilise donc telles quelles : cette fonction habille l'état d'un
 * jour des champs de plan qu'elles n'utilisent jamais, et
 * `avecEtatMacros` récupère le résultat. Les deux adaptateurs sont
 * volontairement triviaux et sans condition.
 */
export function dayTargetsAsFormState(jour: DayTargetsForm): PlanV2FormState {
  return {
    ...META_NEUTRE,
    dailyCalories: jour.dailyCalories,
    proteinBp: jour.proteinBp,
    carbBp: jour.carbBp,
    fatBp: jour.fatBp,
    slots: jour.slots,
    locked: jour.locked,
  };
}

function avecEtatMacros<T extends DayTargetsForm>(jour: T, etat: PlanV2FormState): T {
  return {
    ...jour,
    dailyCalories: etat.dailyCalories,
    proteinBp: etat.proteinBp,
    carbBp: etat.carbBp,
    fatBp: etat.fatBp,
    slots: etat.slots,
    locked: etat.locked,
  };
}

/* ═════════════════════ Identifiants de repas ═════════════════════ */

let compteur = 0;

/** Identifiant local d'un repas. Le client les génère, comme pour les recettes. */
export function newMealId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  compteur += 1;
  return `meal-local-${compteur}`;
}

/* ═════════════════════ Construction ═════════════════════ */

/** Un jour vide : aucune calorie, aucune part, six créneaux actifs, aucun repas. */
function jourVierge(day: WeekdayKey): WeekDayForm {
  return {
    id: `nouveau:${day}`,
    day,
    status: "non-commence",
    dailyCalories: 0,
    proteinBp: 0,
    carbBp: 0,
    fatBp: 0,
    slots: createEmptyAllocations(),
    locked: AUCUN_VERROU,
    meals: [],
    sourceProfileKey: null,
  };
}

/** Une semaine neuve : sept jours vierges et indépendants. */
export function createBlankWeek(): WeekFormState {
  return { days: WEEKDAY_KEYS.map(jourVierge) };
}

/** Les six créneaux, complétés et remis dans l'ordre canonique. */
function normaliserCreneaux(slots: readonly MealSlotAllocation[]): MealSlotAllocation[] {
  const parClé = new Map(slots.map((s) => [s.slot, s]));
  return createEmptyAllocations().map((vide) => {
    const existant = parClé.get(vide.slot);
    return existant ? { ...existant } : { ...vide, enabled: false };
  });
}

/**
 * État de formulaire depuis une semaine relue en base.
 *
 * REPRISE D'UN PLAN EXISTANT — la règle, en une phrase : chaque jour REÇOIT
 * UNE COPIE des valeurs du profil qu'il utilisait, et devient ensuite
 * indépendant.
 *
 * Si lundi et mardi partageaient le profil `default`, les deux reçoivent les
 * mêmes valeurs de départ, mais dans DEUX états séparés. Modifier mardi ne
 * touche plus lundi. C'est exactement le comportement demandé, et il est
 * obtenu sans rien réécrire en base : la normalisation vers `day_<jour>` ne
 * se produit qu'à la prochaine sauvegarde.
 *
 * Aucun repas, aucune note, aucun objectif n'est perdu : les repas sont
 * repris tels quels avec leurs identifiants, donc la RPC les met à jour au
 * lieu de les recréer.
 */
export function createWeekFormFromPlan(week: PlanV2Week): WeekFormState {
  const parJour = new Map(week.days.map((d) => [d.day, d]));
  const parProfil = new Map(week.profiles.map((p) => [p.profileKey, p]));

  // Profil de repli quand un jour est absent de la base : le même que celui
  // qu'utiliserait `findDefaultProfile`, sans le dupliquer ici.
  const repli =
    parProfil.get("default") ??
    parProfil.get("legacy_default") ??
    week.profiles.slice().sort((a, b) => a.profileKey.localeCompare(b.profileKey))[0] ??
    null;

  return {
    days: WEEKDAY_KEYS.map((jour) => {
      const enBase = parJour.get(jour);
      const profil: NutritionPlanV2Profile | null =
        (enBase ? parProfil.get(enBase.profileKey) : undefined) ?? repli;
      const vierge = jourVierge(jour);
      if (!profil) {
        return enBase
          ? { ...vierge, id: enBase.id, status: enBase.status, meals: enBase.meals, sourceProfileKey: enBase.profileKey }
          : vierge;
      }
      return {
        ...vierge,
        id: enBase?.id ?? vierge.id,
        status: enBase?.status ?? vierge.status,
        // COPIE : les sept jours ne partagent aucun tableau ni aucun objet.
        dailyCalories: profil.dailyCalories,
        proteinBp: profil.proteinBp,
        carbBp: profil.carbBp,
        fatBp: profil.fatBp,
        slots: normaliserCreneaux(profil.slots),
        meals: enBase?.meals ?? [],
        sourceProfileKey: enBase?.profileKey ?? profil.profileKey,
      };
    }),
  };
}

/* ═════════════════════ Lecture ═════════════════════ */

export function findDay(state: WeekFormState, day: WeekdayKey): WeekDayForm | null {
  return state.days.find((d) => d.day === day) ?? null;
}

function remplacerJour(
  state: WeekFormState,
  day: WeekdayKey,
  transformer: (jour: WeekDayForm) => WeekDayForm,
): WeekFormState {
  return { ...state, days: state.days.map((d) => (d.day === day ? transformer(d) : d)) };
}

/* ═════════════════════ Zone 1 — objectifs du jour ═════════════════════ */

export function setDayCalories(state: WeekFormState, day: WeekdayKey, calories: number): WeekFormState {
  return remplacerJour(state, day, (jour) =>
    avecEtatMacros(jour, setDailyCalories(dayTargetsAsFormState(jour), calories)),
  );
}

/**
 * Déplace UN curseur de macro. Les deux autres absorbent le reste : le total
 * des trois vaut toujours 100 %, sans intervention du coach.
 *
 * `setDailyMacroBp` reste utilisée pour le contrôle de domaine (une valeur
 * hors [0, 10 000] n'entre pas dans l'état) : la solidarité s'ajoute au
 * contrôle existant, elle ne le remplace pas.
 */
export function setDayMacroBp(
  state: WeekFormState,
  day: WeekdayKey,
  macro: MacroKey,
  bp: number,
): WeekFormState {
  return remplacerJour(state, day, (jour) => {
    const équilibré = rebalanceDailyMacros(jour, macro, bp);
    let etat = dayTargetsAsFormState(jour);
    etat = setDailyMacroBp(etat, "protein", équilibré.proteinBp);
    etat = setDailyMacroBp(etat, "carb", équilibré.carbBp);
    etat = setDailyMacroBp(etat, "fat", équilibré.fatBp);
    return avecEtatMacros(jour, etat);
  });
}

/* ═════════════════════ Zone 2 — répartition par créneau ═════════════════════ */

export function setDaySlotEnabled(
  state: WeekFormState,
  day: WeekdayKey,
  slot: MealSlotKey,
  enabled: boolean,
): WeekFormState {
  return remplacerJour(state, day, (jour) =>
    avecEtatMacros(jour, setSlotEnabled(dayTargetsAsFormState(jour), slot, enabled)),
  );
}

/**
 * Déplace le curseur d'UN créneau pour UNE macro. Les autres créneaux actifs
 * et non verrouillés absorbent le reste : la somme de la macro sur les
 * créneaux actifs vaut toujours 10 000 points de base.
 *
 * Même solidarité qu'en zone 1, et le MÊME algorithme : `rebalanceSlotMacro`
 * compose le tableau d'entrées puis délègue à `rebalanceToTotal`. Rien n'est
 * recopié.
 */
export function setDaySlotMacroBp(
  state: WeekFormState,
  day: WeekdayKey,
  slot: MealSlotKey,
  macro: MacroKey,
  bp: number,
): WeekFormState {
  return remplacerJour(state, day, (jour) => ({
    ...jour,
    slots: rebalanceSlotMacro(jour.slots, macro, slot, bp, { lockedSlots: jour.locked[macro] }),
  }));
}

export function toggleDaySlotLock(
  state: WeekFormState,
  day: WeekdayKey,
  macro: MacroKey,
  slot: MealSlotKey,
): WeekFormState {
  return remplacerJour(state, day, (jour) =>
    avecEtatMacros(jour, toggleSlotLock(dayTargetsAsFormState(jour), macro, slot)),
  );
}

export type DayDistributeOutcome =
  | { readonly ok: true; readonly state: WeekFormState }
  | { readonly ok: false; readonly message: string };

/** « Répartir le reste équitablement », pour un jour et une macro. */
export function distributeDayRest(
  state: WeekFormState,
  day: WeekdayKey,
  macro: MacroKey,
): DayDistributeOutcome {
  const jour = findDay(state, day);
  if (!jour) return { ok: false, message: "Jour introuvable." };
  const résultat = distributeRestForMacro(dayTargetsAsFormState(jour), macro);
  if (!résultat.ok) return { ok: false, message: résultat.message };
  return {
    ok: true,
    state: remplacerJour(state, day, (j) => avecEtatMacros(j, résultat.state)),
  };
}

/* ═════════════════════ Zone 3 — repas prescrits ═════════════════════ */

export function addMeal(
  state: WeekFormState,
  day: WeekdayKey,
  slot: MealSlotKey = "breakfast",
): WeekFormState {
  const repas: PrescribedMeal = {
    id: newMealId(),
    slot,
    name: "",
    items: [],
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    coachNotes: "",
  };
  return remplacerJour(state, day, (jour) => ({ ...jour, meals: [...jour.meals, repas] }));
}

export function updateMeal(
  state: WeekFormState,
  day: WeekdayKey,
  mealId: string,
  patch: Partial<Omit<PrescribedMeal, "id">>,
): WeekFormState {
  return remplacerJour(state, day, (jour) => ({
    ...jour,
    meals: jour.meals.map((m) => (m.id === mealId ? { ...m, ...patch } : m)),
  }));
}

export function removeMeal(state: WeekFormState, day: WeekdayKey, mealId: string): WeekFormState {
  return remplacerJour(state, day, (jour) => ({
    ...jour,
    meals: jour.meals.filter((m) => m.id !== mealId),
  }));
}

/* ═════════════════════ Zone 4 — actions du jour ═════════════════════ */

/**
 * Copie INTÉGRALE d'un jour vers un ou plusieurs autres : calories,
 * répartition P/G/L, parts par créneau, verrous, repas et notes.
 *
 * Les repas copiés reçoivent de NOUVEAUX identifiants. Sans cela la RPC
 * verrait le même repas rattaché à deux jours et refuserait l'écriture
 * (`MEAL_FROM_ANOTHER_DAY`).
 *
 * L'identifiant de la journée de destination, lui, est CONSERVÉ : c'est la
 * ligne `nutrition_days` existante que l'on remplit, on n'en crée pas une
 * seconde.
 */
export function duplicateDay(
  state: WeekFormState,
  source: WeekdayKey,
  cibles: readonly WeekdayKey[],
): WeekFormState {
  const jourSource = state.days.find((d) => d.day === source);
  if (!jourSource) return state;
  const destinations = new Set(cibles.filter((c) => c !== source));
  if (destinations.size === 0) return state;

  return {
    ...state,
    days: state.days.map((jour) =>
      destinations.has(jour.day)
        ? {
            ...jour,
            dailyCalories: jourSource.dailyCalories,
            proteinBp: jourSource.proteinBp,
            carbBp: jourSource.carbBp,
            fatBp: jourSource.fatBp,
            slots: jourSource.slots.map((s) => ({ ...s })),
            locked: {
              protein: [...jourSource.locked.protein],
              carb: [...jourSource.locked.carb],
              fat: [...jourSource.locked.fat],
            },
            meals: jourSource.meals.map((m) => ({ ...m, id: newMealId() })),
          }
        : jour,
    ),
  };
}

/** « Appliquer à toute la semaine » — le jour ouvert vers les six autres. */
export function applyDayToWholeWeek(state: WeekFormState, source: WeekdayKey): WeekFormState {
  return duplicateDay(
    state,
    source,
    WEEKDAY_KEYS.filter((j) => j !== source),
  );
}

/**
 * « Réinitialiser ce jour » — objectifs, parts, verrous ET repas.
 *
 * L'identifiant de la journée est conservé : on vide une journée existante,
 * on ne la remplace pas par une nouvelle.
 */
export function resetDay(state: WeekFormState, day: WeekdayKey): WeekFormState {
  return remplacerJour(state, day, (jour) => ({
    ...jourVierge(day),
    id: jour.id,
    status: jour.status,
    sourceProfileKey: jour.sourceProfileKey,
  }));
}

/**
 * « Initialiser les sept jours avec les mêmes objectifs » — action
 * FACULTATIVE de démarrage.
 *
 * Elle écrit une bonne fois les mêmes objectifs dans les sept jours, puis
 * s'efface : elle ne devient JAMAIS une seconde source de vérité. Après
 * l'appel, chaque jour est indépendant et peut diverger librement.
 *
 * Les repas déjà saisis ne sont pas touchés : on initialise des objectifs,
 * pas une semaine entière.
 */
export function initializeAllDays(
  state: WeekFormState,
  objectifs: { dailyCalories: number; proteinBp: number; carbBp: number; fatBp: number },
  options: { readonly distributeSlotsEqually?: boolean } = {},
): WeekFormState {
  let suivant: WeekFormState = {
    ...state,
    days: state.days.map((jour) => ({
      ...jour,
      dailyCalories: Math.max(0, Math.round(objectifs.dailyCalories)),
      proteinBp: objectifs.proteinBp,
      carbBp: objectifs.carbBp,
      fatBp: objectifs.fatBp,
      slots: jour.slots.map((s) => ({ ...s })),
    })),
  };
  if (options.distributeSlotsEqually !== false) {
    for (const jour of WEEKDAY_KEYS) {
      for (const macro of ["protein", "carb", "fat"] as const) {
        const résultat = distributeDayRest(suivant, jour, macro);
        if (résultat.ok) suivant = résultat.state;
      }
    }
  }
  return suivant;
}

/* ═════════════════════ Aliments ═════════════════════ */

/**
 * Texte multi-lignes → aliments. « Nom — quantité » ou « Nom - quantité ».
 *
 * ────────────────────────────────────────────────────────────────────────
 * LES LIGNES VIDES SONT DES DONNÉES
 * ────────────────────────────────────────────────────────────────────────
 * Cette fonction faisait `.filter(Boolean)` : toute ligne vide disparaissait
 * AVANT d'atteindre la base. Un coach qui écrivait
 *
 *     PROTÉINES
 *     150 g fromage blanc 0 %
 *                                ← ligne vide, volontaire
 *     GLUCIDES
 *     100 g riz
 *
 * enregistrait quatre aliments collés, et aucune règle CSS ne pouvait le
 * rattraper : la séparation n'existait plus nulle part. La perte était donc
 * à la PERSISTANCE, pas au rendu.
 *
 * Une ligne vide devient maintenant `{ name: "", quantity: "" }` — une
 * valeur que le modèle actuel accepte déjà (la RPC `save_nutrition_plan_v2`
 * fait `coalesce(…, '')` sur les deux champs) et que l'affichage rend comme
 * une respiration. Aucune migration, aucun changement de forme.
 *
 * Les lignes vides de BORD sont retirées : elles viennent d'un retour à la
 * ligne de frappe, jamais d'une intention de mise en page, et les conserver
 * ferait grandir le bloc à chaque aller-retour saisie ↔ relecture.
 */
export function textToItems(texte: string): readonly { name: string; quantity: string }[] {
  const lignes = texte.split("\n").map((ligne) => ligne.trim());
  while (lignes.length > 0 && lignes[0] === "") lignes.shift();
  while (lignes.length > 0 && lignes[lignes.length - 1] === "") lignes.pop();
  return lignes.map((ligne) => {
    if (ligne === "") return { name: "", quantity: "" };
    const séparateur = ligne.includes(" — ") ? " — " : " - ";
    const [nom, quantité = ""] = ligne.split(séparateur);
    return { name: nom.trim(), quantity: quantité.trim() };
  });
}

/**
 * Aliments → texte multi-lignes, pour le champ de saisie.
 * Un aliment vide rend une ligne vide : l'aller-retour
 * `textToItems(itemsToText(x))` est donc stable, y compris sur les
 * respirations voulues par le coach.
 */
export function itemsToText(items: readonly { name: string; quantity: string }[]): string {
  return items.map((i) => (i.quantity ? `${i.name} — ${i.quantity}` : i.name)).join("\n");
}

/* ═════════════════════ Validation ═════════════════════ */

/**
 * La semaine projetée vers la forme canonique attendue par la validation
 * PR 1 — un profil par jour. Sert à valider les sept jours d'un coup
 * (`validatePlanV2Draft`) sans réécrire un seul contrôle.
 */
export function toValidationPlan(state: WeekFormState, planId: string | null, name: string): NutritionPlanV2 {
  return {
    id: planId ?? "",
    nutritionModelVersion: NUTRITION_MODEL_VERSION_STRUCTURED,
    name,
    profiles: state.days.map(toProfile),
  };
}

/**
 * Un SEUL jour projeté en plan canonique. `validatePlanV2Assignable` ne
 * contrôle qu'un profil ; on l'appelle donc jour par jour, ce qui donne la
 * bonne granularité de message sans dupliquer la moindre règle.
 */
export function toValidationPlanForDay(
  state: WeekFormState,
  day: WeekdayKey,
  planId: string | null,
  name: string,
): NutritionPlanV2 | null {
  const jour = findDay(state, day);
  if (!jour) return null;
  return {
    id: planId ?? "",
    nutritionModelVersion: NUTRITION_MODEL_VERSION_STRUCTURED,
    name,
    profiles: [toProfile(jour)],
  };
}

function toProfile(jour: WeekDayForm): NutritionPlanV2Profile {
  return {
    profileKey: internalProfileKeyForDay(jour.day),
    dailyCalories: jour.dailyCalories,
    proteinBp: jour.proteinBp,
    carbBp: jour.carbBp,
    fatBp: jour.fatBp,
    slots: jour.slots,
  };
}

/** Les trois macros d'un jour totalisent-elles exactement 100 % ? */
export function isDaySplitComplete(jour: DayTargetsForm): boolean {
  return jour.proteinBp + jour.carbBp + jour.fatBp === BASIS_POINTS_TOTAL;
}

/* ═════════════════════ Charge utile ═════════════════════ */

/**
 * La charge utile de `save_nutrition_plan_v2` : SEPT profils internes et
 * SEPT jours, un jour par profil.
 *
 * Le profil principal est celui de lundi — la RPC ne s'en sert que pour
 * reconstituer le `daily_target` de compatibilité.
 *
 * Les créneaux désactivés sont remis à zéro AVANT l'envoi
 * (`normalizeDisabledSlots`), et les six créneaux partent toujours, avec
 * leur `enabled` explicite.
 */
export function toWeekSavePayload(state: WeekFormState): {
  profiles: unknown[];
  days: unknown[];
  main_profile_key: string;
} {
  return {
    main_profile_key: MAIN_DAY_PROFILE_KEY,
    profiles: state.days.map((jour) => ({
      profile_key: internalProfileKeyForDay(jour.day),
      daily_calories: jour.dailyCalories,
      protein_bp: jour.proteinBp,
      carb_bp: jour.carbBp,
      fat_bp: jour.fatBp,
      slots: normalizeDisabledSlots(jour.slots).map((a) => ({
        slot: a.slot,
        enabled: a.enabled,
        protein_bp: a.proteinBp,
        carb_bp: a.carbBp,
        fat_bp: a.fatBp,
        display_order: a.displayOrder,
      })),
    })),
    days: state.days.map((jour) => ({
      day: jour.day,
      profile_key: internalProfileKeyForDay(jour.day),
      meals: jour.meals
        .slice()
        .sort((a, b) => MEAL_SLOT_KEYS.indexOf(a.slot) - MEAL_SLOT_KEYS.indexOf(b.slot))
        .map((m) => ({
          // Un identifiant LOCAL (« meal-local-… ») n'est pas un UUID : on le
          // laisse à la base, qui en génère un. Un UUID existant est renvoyé
          // tel quel, donc le repas est MIS À JOUR, jamais dupliqué.
          id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id) ? m.id : null,
          slot: m.slot,
          name: m.name.trim(),
          items: m.items.filter((i) => i.name.trim() !== ""),
          calories: m.calories,
          protein: m.protein,
          carbs: m.carbs,
          fat: m.fat,
          coach_notes: m.coachNotes.trim(),
        })),
    })),
  };
}

/**
 * La même semaine, mais pour une COPIE — chaque repas perd son identifiant.
 *
 * `toWeekSavePayload` renvoie l'UUID d'un repas déjà enregistré pour que la
 * RPC le mette à jour au lieu d'en créer un second. Sur une duplication, c'est
 * exactement ce qu'il ne faut pas : ces UUID appartiennent aux jours du plan
 * d'ORIGINE, et les réutiliser déplacerait ses repas vers la copie. `null`
 * demande à la base d'en générer de nouveaux.
 *
 * Les jours et les profils, eux, n'ont pas d'identifiant dans la charge utile
 * — ils sont désignés par `day` et `profile_key`, tous deux relatifs au plan
 * écrit. Il n'y a donc rien à neutraliser de ce côté.
 */
export function toDuplicateWeekPayload(state: WeekFormState): {
  profiles: unknown[];
  days: unknown[];
  main_profile_key: string;
} {
  const payload = toWeekSavePayload(state);
  return {
    ...payload,
    days: payload.days.map((jour) => {
      const j = jour as { meals?: readonly Record<string, unknown>[] };
      return {
        ...(jour as Record<string, unknown>),
        meals: (j.meals ?? []).map((repas) => ({ ...repas, id: null })),
      };
    }),
  };
}

/**
 * Les objectifs du jour PRINCIPAL (lundi), pour le profil de compatibilité
 * envoyé au premier niveau de la charge utile. Ce n'est pas une source de
 * vérité : la RPC privilégie `profiles` dès qu'il est présent.
 */
export function mainDayTargets(state: WeekFormState): DayTargetsForm {
  return findDay(state, "monday") ?? jourVierge("monday");
}

/**
 * Total calorique de la semaine : la SOMME des sept jours.
 * Jamais « calories globales × 7 » — il n'existe plus de calories globales.
 */
export function weeklyCaloriesFromForm(state: WeekFormState): number {
  return state.days.reduce((total, jour) => total + jour.dailyCalories, 0);
}
