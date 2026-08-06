import { MEAL_SLOT_KEYS, type MealSlotAllocation, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type { PlanV2Day, PlanV2Week, PrescribedMeal } from "@/lib/nutrition/plan-v2-week";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * ÉTAT DE FORMULAIRE de la semaine alimentaire — logique PURE.
 *
 * Comme `recipe-form.ts` pour les recettes : aucune dépendance à React ni à
 * Supabase, donc entièrement testable sans rendu. Le composant se contente
 * d'appeler ces fonctions et d'afficher leur résultat.
 *
 * DEUX CHOSES SE RÈGLENT ICI, ET RIEN D'AUTRE :
 *   - quel PROFIL chaque jour utilise ;
 *   - quels REPAS le coach prescrit manuellement ce jour-là.
 *
 * Le solveur n'intervient jamais : un repas prescrit est du texte et des
 * nombres saisis par le coach. La bibliothèque de recettes est un autre outil.
 *
 * LES PROFILS ADDITIONNELS partagent la RÉPARTITION du profil principal
 * (parts P/G/L et parts par créneau) et n'en changent que les calories
 * quotidiennes. C'est ce que décrit le besoin — « standard 2 000 »,
 * « training_high 2 200 », « rest 1 900 » — et cela évite de dupliquer six
 * curseurs par profil. Un profil ayant besoin d'une répartition propre reste
 * possible côté base et côté RPC : c'est l'interface qui ne l'expose pas.
 */

/** Un profil de la semaine, du point de vue du formulaire. */
export interface WeekProfileForm {
  readonly profileKey: string;
  readonly label: string;
  readonly dailyCalories: number;
}

export interface WeekFormState {
  readonly mainProfileKey: string;
  readonly profiles: readonly WeekProfileForm[];
  readonly days: readonly PlanV2Day[];
}

/** Format d'une clé de profil : miroir exact de la contrainte CHECK en base. */
export const PROFILE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

let compteur = 0;

/** Identifiant local d'un repas. Le client les génère, comme pour les recettes. */
export function newMealId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  compteur += 1;
  return `meal-local-${compteur}`;
}

/** Sept jours, tous rattachés au profil principal, aucun repas. */
export function createBlankWeek(mainProfileKey: string, dailyCalories: number): WeekFormState {
  return {
    mainProfileKey,
    profiles: [{ profileKey: mainProfileKey, label: "Standard", dailyCalories }],
    days: WEEKDAY_KEYS.map((jour) => ({
      id: `nouveau:${jour}`,
      day: jour,
      profileKey: mainProfileKey,
      status: "non-commence",
      meals: [],
    })),
  };
}

/** État de formulaire depuis une semaine relue en base. */
export function createWeekFormFromPlan(
  week: PlanV2Week,
  mainProfileKey: string,
): WeekFormState {
  const profils = week.profiles.map((p) => ({
    profileKey: p.profileKey,
    label: p.profileKey,
    dailyCalories: p.dailyCalories,
  }));
  const parJour = new Map(week.days.map((d) => [d.day, d]));
  return {
    mainProfileKey,
    profiles: profils.length > 0 ? profils : [{ profileKey: mainProfileKey, label: mainProfileKey, dailyCalories: 0 }],
    days: WEEKDAY_KEYS.map(
      (jour) =>
        parJour.get(jour) ?? {
          id: `nouveau:${jour}`,
          day: jour,
          profileKey: mainProfileKey,
          status: "non-commence",
          meals: [],
        },
    ),
  };
}

/* ─────────────────────────── Profils ─────────────────────────── */

export function addProfile(
  state: WeekFormState,
  profileKey: string,
  dailyCalories: number,
): WeekFormState {
  if (!PROFILE_KEY_PATTERN.test(profileKey)) return state;
  if (state.profiles.some((p) => p.profileKey === profileKey)) return state;
  return {
    ...state,
    profiles: [...state.profiles, { profileKey, label: profileKey, dailyCalories }],
  };
}

export function setProfileCalories(
  state: WeekFormState,
  profileKey: string,
  dailyCalories: number,
): WeekFormState {
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.profileKey === profileKey ? { ...p, dailyCalories } : p,
    ),
  };
}

/**
 * Retire un profil. Le profil PRINCIPAL n'est jamais retirable, et les jours
 * qui utilisaient le profil retiré retombent sur le principal — sans quoi la
 * clé étrangère composite refuserait la sauvegarde.
 */
export function removeProfile(state: WeekFormState, profileKey: string): WeekFormState {
  if (profileKey === state.mainProfileKey) return state;
  return {
    ...state,
    profiles: state.profiles.filter((p) => p.profileKey !== profileKey),
    days: state.days.map((d) =>
      d.profileKey === profileKey ? { ...d, profileKey: state.mainProfileKey } : d,
    ),
  };
}

/* ─────────────────────────── Jours ─────────────────────────── */

export function setDayProfile(
  state: WeekFormState,
  day: WeekdayKey,
  profileKey: string,
): WeekFormState {
  if (!state.profiles.some((p) => p.profileKey === profileKey)) return state;
  return {
    ...state,
    days: state.days.map((d) => (d.day === day ? { ...d, profileKey } : d)),
  };
}

export function addMeal(state: WeekFormState, day: WeekdayKey, slot: MealSlotKey = "breakfast"): WeekFormState {
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
  return {
    ...state,
    days: state.days.map((d) => (d.day === day ? { ...d, meals: [...d.meals, repas] } : d)),
  };
}

export function updateMeal(
  state: WeekFormState,
  day: WeekdayKey,
  mealId: string,
  patch: Partial<Omit<PrescribedMeal, "id">>,
): WeekFormState {
  return {
    ...state,
    days: state.days.map((d) =>
      d.day === day
        ? { ...d, meals: d.meals.map((m) => (m.id === mealId ? { ...m, ...patch } : m)) }
        : d,
    ),
  };
}

export function removeMeal(state: WeekFormState, day: WeekdayKey, mealId: string): WeekFormState {
  return {
    ...state,
    days: state.days.map((d) =>
      d.day === day ? { ...d, meals: d.meals.filter((m) => m.id !== mealId) } : d,
    ),
  };
}

/**
 * Duplique le contenu d'un jour vers un autre. Les repas copiés reçoivent de
 * NOUVEAUX identifiants : sans cela la RPC verrait le même repas rattaché à
 * deux jours et refuserait l'écriture (`MEAL_FROM_ANOTHER_DAY`).
 */
export function duplicateDay(
  state: WeekFormState,
  source: WeekdayKey,
  cible: WeekdayKey,
): WeekFormState {
  const jourSource = state.days.find((d) => d.day === source);
  if (!jourSource || source === cible) return state;
  return {
    ...state,
    days: state.days.map((d) =>
      d.day === cible
        ? {
            ...d,
            profileKey: jourSource.profileKey,
            meals: jourSource.meals.map((m) => ({ ...m, id: newMealId() })),
          }
        : d,
    ),
  };
}

/* ─────────────────────────── Aliments ─────────────────────────── */

/** Texte multi-lignes → aliments. « Nom — quantité » ou « Nom - quantité ». */
export function textToItems(texte: string): readonly { name: string; quantity: string }[] {
  return texte
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter(Boolean)
    .map((ligne) => {
      const séparateur = ligne.includes(" — ") ? " — " : " - ";
      const [nom, quantité = ""] = ligne.split(séparateur);
      return { name: nom.trim(), quantity: quantité.trim() };
    });
}

/** Aliments → texte multi-lignes, pour le champ de saisie. */
export function itemsToText(items: readonly { name: string; quantity: string }[]): string {
  return items.map((i) => (i.quantity ? `${i.name} — ${i.quantity}` : i.name)).join("\n");
}

/* ─────────────────────────── Charge utile ─────────────────────────── */

/**
 * La partie `profiles` + `days` de la charge utile de
 * `save_nutrition_plan_v2`.
 *
 * Les profils additionnels reprennent les parts du profil principal : c'est
 * la décision décrite en tête de fichier. Les sept jours sont TOUJOURS
 * envoyés, dans l'ordre canonique.
 */
export function toWeekSavePayload(
  state: WeekFormState,
  principal: {
    proteinBp: number;
    carbBp: number;
    fatBp: number;
    slots: readonly MealSlotAllocation[];
  },
): { profiles: unknown[]; days: unknown[]; main_profile_key: string } {
  const slots = principal.slots.map((a) => ({
    slot: a.slot,
    enabled: a.enabled,
    protein_bp: a.proteinBp,
    carb_bp: a.carbBp,
    fat_bp: a.fatBp,
    display_order: a.displayOrder,
  }));

  return {
    main_profile_key: state.mainProfileKey,
    profiles: state.profiles.map((p) => ({
      profile_key: p.profileKey,
      daily_calories: p.dailyCalories,
      protein_bp: principal.proteinBp,
      carb_bp: principal.carbBp,
      fat_bp: principal.fatBp,
      slots,
    })),
    days: WEEKDAY_KEYS.map((jour) => {
      const d = state.days.find((x) => x.day === jour);
      return {
        day: jour,
        profile_key: d?.profileKey ?? state.mainProfileKey,
        meals: (d?.meals ?? [])
          .slice()
          .sort((a, b) => MEAL_SLOT_KEYS.indexOf(a.slot) - MEAL_SLOT_KEYS.indexOf(b.slot))
          .map((m) => ({
            // Un identifiant LOCAL (« nouveau:… », « meal-local-… ») n'est pas
            // un UUID : on le laisse à la base, qui en génère un.
            id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
              ? m.id
              : null,
            slot: m.slot,
            name: m.name.trim(),
            items: m.items.filter((i) => i.name.trim() !== ""),
            calories: m.calories,
            protein: m.protein,
            carbs: m.carbs,
            fat: m.fat,
            coach_notes: m.coachNotes.trim(),
          })),
      };
    }),
  };
}

/**
 * Total calorique de la semaine — la SOMME des sept jours selon leur profil.
 * Miroir exact de `weeklyCaloriesFromDays` et du calcul de la RPC.
 */
export function weeklyCaloriesFromForm(state: WeekFormState): number {
  return state.days.reduce((total, jour) => {
    const profil = state.profiles.find((p) => p.profileKey === jour.profileKey);
    return total + (profil?.dailyCalories ?? 0);
  }, 0);
}
