import type {
  ActualDailyIntake,
  BodyMeasurement,
  CoachNotification,
  CustomMeasurement,
  DocumentItem,
  DocumentResource,
  Exercise,
  FoodPreferences,
  HydrationAndSupplements,
  InjuryNote,
  MacroTarget,
  MealFoodItem,
  MealPlan,
  MuscleGroup,
  NutritionDay,
  NutritionPlan,
  PlannedMeal,
  ProgramScheduleDay,
  ProgressPhoto,
  SportPreferences,
  StudentDocumentAccess,
  StudentGoal,
  StudentProfile,
  TrainingProgram,
  UpcomingSession,
  WeightEntry,
  WorkoutSession,
} from "@/types";

export const student: StudentProfile = {
  id: "student-alexandre-morel",
  firstName: "Alexandre",
  lastName: "Morel",
  goal: "+8 kg de masse musculaire",
  level: "Intermédiaire",
  startDate: "2026-01-12",
  weekNumber: 14,
  age: 27,
  heightCm: 179,
  currentWeightKg: 80.1,
  targetWeightKg: 82,
  trainingFrequencyPerWeek: 5,
  trainingLocation: "Salle de sport",
  coachingStatus: "actif",
};

function exercise(
  id: string,
  name: string,
  sets: number,
  reps: string,
  restSeconds: number,
  tempo: string,
  recommendedLoad: string,
  muscleGroup: MuscleGroup,
): Exercise {
  return {
    id,
    name,
    sets,
    reps,
    restSeconds,
    tempo,
    recommendedLoad,
    muscleGroup,
    videoUrl: `https://videos.seth-coaching.mock/exercices/${id}`,
  };
}

export const workoutSessions: WorkoutSession[] = [
  {
    id: "session-upper",
    programId: "prog-1",
    day: "Lundi",
    name: "Upper Body — Pectoraux / Triceps",
    muscleGroups: "Pectoraux, triceps",
    durationMinutes: 60,
    warmup: "5 min vélo + mobilité épaules et poignets avec bande élastique.",
    exercises: [
      exercise("ex-1", "Développé couché barre", 4, "8-10", 90, "2-0-1-0", "60 kg", "pectoraux"),
      exercise("ex-2", "Développé incliné haltères", 4, "10-12", 75, "2-0-1-0", "24 kg / haltère", "pectoraux"),
      exercise("ex-3", "Écarté poulie vis-à-vis", 3, "12-15", 60, "2-0-1-1", "15 kg", "pectoraux"),
      exercise("ex-4", "Dips lestés", 3, "8-10", 90, "2-0-1-1", "+10 kg", "pectoraux"),
      exercise("ex-5", "Extension triceps poulie haute", 3, "12-15", 60, "2-0-1-0", "25 kg", "triceps"),
      exercise("ex-6", "Barre au front", 3, "10-12", 75, "3-0-1-0", "30 kg", "triceps"),
    ],
    coachNotes:
      "Concentre-toi sur l'amplitude complète au développé couché. Réduis la charge si la douleur à l'épaule réapparaît.",
  },
  {
    id: "session-lower",
    programId: "prog-1",
    day: "Mercredi",
    name: "Lower Body — Quadriceps / Ischios",
    muscleGroups: "Jambes",
    durationMinutes: 55,
    warmup: "5 min rameur + mobilité hanches et chevilles.",
    exercises: [
      exercise("ex-7", "Squat barre", 4, "6-8", 120, "3-0-1-0", "90 kg", "quadriceps"),
      exercise("ex-8", "Presse à cuisses", 4, "10-12", 90, "2-0-1-0", "160 kg", "quadriceps"),
      exercise("ex-9", "Fentes marchées haltères", 3, "12 / jambe", 75, "2-0-1-0", "16 kg / haltère", "quadriceps"),
      exercise("ex-10", "Leg curl allongé", 3, "12-15", 60, "2-0-1-1", "35 kg", "ischios"),
      exercise("ex-11", "Mollets debout", 4, "15-20", 45, "2-0-1-2", "50 kg", "mollets"),
    ],
    coachNotes: "Garde le dos neutre sur le squat, descends jusqu'à parallèle minimum.",
  },
  {
    id: "session-push",
    programId: "prog-1",
    day: "Vendredi",
    name: "Push — Épaules / Triceps",
    muscleGroups: "Épaules, triceps",
    durationMinutes: 50,
    warmup: "5 min vélo + rotations d'épaules avec élastique léger.",
    exercises: [
      exercise("ex-12", "Développé militaire barre", 4, "8-10", 90, "2-0-1-0", "40 kg", "épaules"),
      exercise("ex-13", "Élévations latérales", 4, "12-15", 60, "2-0-1-1", "8 kg", "épaules"),
      exercise("ex-14", "Développé Arnold haltères", 3, "10-12", 75, "2-0-1-0", "14 kg", "épaules"),
      exercise("ex-15", "Extension triceps nuque haltère", 3, "12-15", 60, "2-0-1-1", "18 kg", "triceps"),
      exercise("ex-16", "Dips triceps", 3, "10-12", 75, "2-0-1-0", "Poids du corps", "triceps"),
    ],
    coachNotes: "Attention à ne pas cambrer le bas du dos sur le développé militaire.",
  },
  {
    id: "session-pull",
    programId: "prog-1",
    day: "Samedi",
    name: "Pull — Dos / Biceps",
    muscleGroups: "Dos, biceps",
    durationMinutes: 55,
    warmup: "5 min rameur + tirage léger poulie haute, 2 x 15 répétitions.",
    exercises: [
      exercise("ex-17", "Tractions lestées", 4, "6-8", 120, "2-0-1-1", "+5 kg", "dos"),
      exercise("ex-18", "Rowing barre", 4, "8-10", 90, "2-0-1-0", "60 kg", "dos"),
      exercise("ex-19", "Tirage horizontal poulie", 3, "10-12", 75, "2-0-1-1", "55 kg", "dos"),
      exercise("ex-20", "Curl biceps barre EZ", 3, "10-12", 60, "2-0-1-0", "25 kg", "biceps"),
      exercise("ex-21", "Curl marteau haltères", 3, "12-15", 60, "2-0-1-1", "12 kg", "biceps"),
    ],
    coachNotes: "Serre bien les omoplates en fin de mouvement sur le rowing.",
  },
  {
    id: "session-fba",
    programId: "prog-0",
    day: "Lundi",
    name: "Full Body A",
    muscleGroups: "Corps entier",
    durationMinutes: 40,
    warmup: "5 min marche rapide + mobilité articulaire générale.",
    exercises: [
      exercise("ex-22", "Squat gobelet", 3, "12", 60, "2-0-1-0", "16 kg", "quadriceps"),
      exercise("ex-23", "Pompes (genoux ou complètes)", 3, "10", 60, "2-0-1-1", "Poids du corps", "pectoraux"),
      exercise("ex-24", "Rowing élastique", 3, "12", 60, "2-0-1-0", "Élastique moyen", "dos"),
      exercise("ex-25", "Gainage planche", 3, "30 sec", 45, "Statique", "Poids du corps", "abdos"),
    ],
    coachNotes: "Priorité à la technique plutôt qu'à la charge, prends le temps d'apprendre chaque mouvement.",
  },
  {
    id: "session-fbb",
    programId: "prog-0",
    day: "Jeudi",
    name: "Full Body B",
    muscleGroups: "Corps entier",
    durationMinutes: 40,
    warmup: "5 min vélo + mobilité hanches et épaules.",
    exercises: [
      exercise("ex-26", "Soulevé de terre kettlebell", 3, "10", 75, "2-0-1-0", "20 kg", "ischios"),
      exercise("ex-27", "Développé couché haltères", 3, "10", 75, "2-0-1-0", "14 kg / haltère", "pectoraux"),
      exercise("ex-28", "Tirage poulie haute", 3, "12", 60, "2-0-1-1", "40 kg", "dos"),
      exercise("ex-29", "Fentes statiques", 3, "10 / jambe", 60, "2-0-1-0", "Poids du corps", "quadriceps"),
    ],
    coachNotes: "Bonne progression sur ce cycle, on augmente légèrement les charges au prochain programme.",
  },
  {
    id: "session-fbi",
    programId: "prog-2",
    day: "Lundi",
    name: "Full Body Intensif",
    muscleGroups: "Corps entier",
    durationMinutes: 45,
    warmup: "8 min vélo + activation complète (fessiers, épaules, gainage).",
    exercises: [
      exercise("ex-30", "Squat gobelet lourd", 4, "12-15", 45, "2-0-1-0", "20 kg", "quadriceps"),
      exercise("ex-31", "Développé couché haltères", 4, "12-15", 45, "2-0-1-0", "16 kg / haltère", "pectoraux"),
      exercise("ex-32", "Rowing barre", 4, "12-15", 45, "2-0-1-0", "45 kg", "dos"),
      exercise("ex-33", "Fentes sautées", 3, "12 / jambe", 45, "Explosif", "Poids du corps", "quadriceps"),
      exercise("ex-34", "Gainage dynamique", 3, "45 sec", 30, "Continu", "Poids du corps", "abdos"),
    ],
    coachNotes: "Repos courts volontairement : l'objectif est cardio autant que musculaire.",
  },
  {
    id: "session-hiit",
    programId: "prog-2",
    day: "Mardi",
    name: "Cardio HIIT",
    muscleGroups: "Cardio, corps entier",
    durationMinutes: 30,
    warmup: "3 min corde à sauter légère + mobilité chevilles et hanches.",
    exercises: [
      exercise("ex-35", "Sprint tapis", 8, "40 sec effort", 20, "—", "Intensité max", "cardio"),
      exercise("ex-36", "Burpees", 8, "40 sec effort", 20, "—", "Poids du corps", "full-body"),
      exercise("ex-37", "Mountain climbers", 8, "40 sec effort", 20, "—", "Poids du corps", "cardio"),
      exercise("ex-38", "Corde à sauter", 8, "40 sec effort", 20, "—", "Intensité max", "cardio"),
    ],
    coachNotes: "Adapte l'intensité si besoin, mais garde le rythme 40/20 le plus régulier possible.",
  },
];

const activeProgramSchedule: ProgramScheduleDay[] = [
  { day: "Lundi", isToday: true, sessionId: "session-upper" },
  { day: "Mardi", sessionId: null },
  { day: "Mercredi", sessionId: "session-lower" },
  { day: "Jeudi", sessionId: null },
  { day: "Vendredi", sessionId: "session-push" },
  { day: "Samedi", sessionId: "session-pull" },
  { day: "Dimanche", sessionId: null },
];

const finishedProgramSchedule: ProgramScheduleDay[] = [
  { day: "Lundi", sessionId: "session-fba" },
  { day: "Mardi", sessionId: null },
  { day: "Mercredi", sessionId: null },
  { day: "Jeudi", sessionId: "session-fbb" },
  { day: "Vendredi", sessionId: null },
  { day: "Samedi", sessionId: null },
  { day: "Dimanche", sessionId: null },
];

const upcomingProgramSchedule: ProgramScheduleDay[] = [
  { day: "Lundi", sessionId: "session-fbi" },
  { day: "Mardi", sessionId: "session-hiit" },
  { day: "Mercredi", sessionId: null },
  { day: "Jeudi", sessionId: "session-fbi" },
  { day: "Vendredi", sessionId: null },
  { day: "Samedi", sessionId: "session-hiit" },
  { day: "Dimanche", sessionId: null },
];

export const trainingPrograms: TrainingProgram[] = [
  {
    id: "prog-1",
    name: "Force & Hypertrophie",
    goal: "Prise de masse musculaire",
    level: "Intermédiaire",
    durationWeeks: 12,
    status: "actif",
    sessionsPerWeek: 4,
    currentWeek: 5,
    progressPercent: 42,
    schedule: activeProgramSchedule,
  },
  {
    id: "prog-0",
    name: "Remise en route",
    goal: "Reprise progressive après pause",
    level: "Débutant",
    durationWeeks: 6,
    status: "terminé",
    sessionsPerWeek: 2,
    currentWeek: 6,
    progressPercent: 100,
    schedule: finishedProgramSchedule,
  },
  {
    id: "prog-2",
    name: "Sèche Estivale",
    goal: "Définition musculaire",
    level: "Intermédiaire",
    durationWeeks: 8,
    status: "à venir",
    sessionsPerWeek: 4,
    currentWeek: 0,
    progressPercent: 0,
    schedule: upcomingProgramSchedule,
  },
];

export const activeProgram: TrainingProgram =
  trainingPrograms.find((program) => program.status === "actif") ??
  trainingPrograms[0];

export const upcomingSession: UpcomingSession = {
  id: "session-1",
  name: "Upper Body — Pectoraux / Triceps",
  day: "Aujourd'hui",
  time: "18h00",
  durationMinutes: 60,
  exerciseCount: 8,
};

export function getTrainingProgram(id: string): TrainingProgram | undefined {
  return trainingPrograms.find((program) => program.id === id);
}

export function getWorkoutSession(id: string): WorkoutSession | undefined {
  return workoutSessions.find((session) => session.id === id);
}

export function getHighlightedScheduleDay(
  schedule: ProgramScheduleDay[],
): ProgramScheduleDay | null {
  const today = schedule.find((day) => day.isToday && day.sessionId);
  if (today) {
    return today;
  }
  return schedule.find((day) => day.sessionId) ?? null;
}

export const mealPlans: MealPlan[] = [
  {
    id: "meal-1",
    name: "Plan Prise de Masse",
    goal: "Prise de masse",
    calories: 2800,
    protein: 180,
    carbs: 320,
    fat: 80,
    status: "actif",
  },
  {
    id: "meal-0",
    name: "Plan Rééquilibrage",
    goal: "Rééquilibrage alimentaire",
    calories: 2200,
    protein: 140,
    carbs: 230,
    fat: 70,
    status: "ancien",
  },
  {
    id: "meal-2",
    name: "Plan Sèche",
    goal: "Définition musculaire",
    calories: 2300,
    protein: 190,
    carbs: 180,
    fat: 60,
    status: "prochain",
  },
];

export const activeMealPlan: MealPlan =
  mealPlans.find((plan) => plan.status === "actif") ?? mealPlans[0];

/* ─── Budget calorique hebdomadaire (Nutrition) ─── */

const WEEK_START_DATE = "2026-06-29"; // lundi

function macro(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
): MacroTarget {
  return { calories, protein, carbs, fat };
}

function foodItem(name: string, quantity: string): MealFoodItem {
  return { name, quantity };
}

function buildDailyMeals(planId: string, dayId: string): PlannedMeal[] {
  return [
    {
      id: `${dayId}-petit-dejeuner`,
      planId,
      dayId,
      slot: "Petit déjeuner",
      name: "Porridge avoine, whey, banane",
      items: [
        foodItem("Flocons d'avoine", "80 g"),
        foodItem("Whey protéine", "1 dose (30 g)"),
        foodItem("Banane", "1 pièce"),
        foodItem("Lait demi-écrémé", "200 ml"),
      ],
      macros: macro(550, 35, 70, 12),
      coachNotes: "À prendre dans l'heure suivant le réveil.",
    },
    {
      id: `${dayId}-collation-matin`,
      planId,
      dayId,
      slot: "Collation matin",
      name: "Yaourt grec, amandes, miel",
      items: [
        foodItem("Yaourt grec", "150 g"),
        foodItem("Amandes", "20 g"),
        foodItem("Miel", "1 cuillère à café"),
      ],
      macros: macro(280, 18, 22, 12),
      coachNotes: "Optionnelle si tu n'as pas faim en fin de matinée.",
    },
    {
      id: `${dayId}-midi`,
      planId,
      dayId,
      slot: "Midi",
      name: "Poulet, riz basmati, brocolis, huile d'olive",
      items: [
        foodItem("Blanc de poulet", "180 g"),
        foodItem("Riz basmati cuit", "200 g"),
        foodItem("Brocolis", "150 g"),
        foodItem("Huile d'olive", "1 cuillère à soupe"),
      ],
      macros: macro(720, 55, 80, 18),
      coachNotes: "Priorité aux légumes verts pour la satiété.",
    },
    {
      id: `${dayId}-collation-apres-midi`,
      planId,
      dayId,
      slot: "Collation après-midi",
      name: "Shaker whey, flocons d'avoine, beurre de cacahuète",
      items: [
        foodItem("Whey protéine", "1 dose (30 g)"),
        foodItem("Flocons d'avoine", "40 g"),
        foodItem("Beurre de cacahuète", "1 cuillère à café"),
      ],
      macros: macro(420, 30, 35, 15),
      coachNotes: "Idéal juste avant l'entraînement.",
    },
    {
      id: `${dayId}-diner`,
      planId,
      dayId,
      slot: "Dîner",
      name: "Saumon, patate douce, légumes vapeur",
      items: [
        foodItem("Saumon", "150 g"),
        foodItem("Patate douce", "200 g"),
        foodItem("Légumes vapeur", "150 g"),
      ],
      macros: macro(650, 45, 55, 20),
      coachNotes: "Cuisson vapeur ou four, éviter la friture.",
    },
    {
      id: `${dayId}-complements`,
      planId,
      dayId,
      slot: "Compléments",
      name: "Créatine 5g, oméga-3, multivitamines",
      items: [
        foodItem("Créatine monohydrate", "5 g"),
        foodItem("Oméga-3", "1 capsule"),
        foodItem("Multivitamines", "1 comprimé"),
      ],
      macros: macro(20, 0, 0, 2),
      coachNotes: "À prendre avec un repas.",
    },
  ];
}

function buildWeekDays(
  planId: string,
  dailyTarget: MacroTarget,
  validated: { day: string; actual: MacroActualInput }[],
  todayDay: string,
): NutritionDay[] {
  const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

  return days.map((day) => {
    const dayId = `${planId}-${day.toLowerCase()}`;
    const validatedEntry = validated.find((entry) => entry.day === day);
    const isToday = day === todayDay;

    let actual: ActualDailyIntake | null = null;
    let status: NutritionDay["status"] = "non-commence";

    if (validatedEntry) {
      actual = {
        studentId: student.id,
        planId,
        dayId,
        macros: macro(
          validatedEntry.actual.calories,
          validatedEntry.actual.protein,
          validatedEntry.actual.carbs,
          validatedEntry.actual.fat,
        ),
        comment: validatedEntry.actual.comment,
        hunger: validatedEntry.actual.hunger,
        energy: validatedEntry.actual.energy,
        digestion: validatedEntry.actual.digestion,
        validatedAt: `${WEEK_START_DATE}T20:00:00.000Z`,
      };
      status = "valide";
    } else if (isToday) {
      status = "en-cours";
    }

    return {
      id: dayId,
      planId,
      weekStartDate: WEEK_START_DATE,
      day,
      isToday,
      status,
      target: dailyTarget,
      meals: buildDailyMeals(planId, dayId),
      actual,
    };
  });
}

interface MacroActualInput {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  comment: string;
  hunger: string;
  energy: string;
  digestion: string;
}

const activePlanDailyTarget = macro(2800, 180, 320, 80);

export const nutritionPlans: NutritionPlan[] = [
  {
    id: "nutri-1",
    studentId: student.id,
    name: "Plan Prise de Masse",
    goalType: "prise-de-masse",
    dailyTarget: activePlanDailyTarget,
    weeklyTargetCalories: activePlanDailyTarget.calories * 7,
    status: "actif",
    shoppingList: [
      "Blanc de poulet",
      "Saumon",
      "Riz basmati",
      "Patate douce",
      "Flocons d'avoine",
      "Whey protéine",
      "Yaourt grec",
      "Amandes",
      "Brocolis",
      "Légumes vapeur",
      "Huile d'olive",
      "Bananes",
    ],
    days: buildWeekDays(
      "nutri-1",
      activePlanDailyTarget,
      [
        {
          day: "Lundi",
          actual: {
            calories: 3300,
            protein: 210,
            carbs: 360,
            fat: 100,
            comment: "Repas de famille le soir, un peu plus copieux que prévu.",
            hunger: "Faim élevée le soir",
            energy: "Bonne énergie",
            digestion: "Normale",
          },
        },
        {
          day: "Mardi",
          actual: {
            calories: 2500,
            protein: 175,
            carbs: 260,
            fat: 70,
            comment: "Journée chargée, moins faim le soir.",
            hunger: "Faible en fin de journée",
            energy: "Un peu fatigué",
            digestion: "Normale",
          },
        },
      ],
      "Mercredi",
    ),
  },
  {
    id: "nutri-0",
    studentId: student.id,
    name: "Plan Rééquilibrage",
    goalType: "maintien",
    dailyTarget: macro(2200, 140, 230, 70),
    weeklyTargetCalories: 2200 * 7,
    status: "ancien",
    shoppingList: [
      "Œufs",
      "Fromage blanc",
      "Quinoa",
      "Légumes de saison",
      "Poisson blanc",
      "Fruits frais",
    ],
    days: buildWeekDays("nutri-0", macro(2200, 140, 230, 70), [], ""),
  },
  {
    id: "nutri-2",
    studentId: student.id,
    name: "Plan Sèche",
    goalType: "perte-de-poids",
    dailyTarget: macro(2300, 190, 180, 60),
    weeklyTargetCalories: 2300 * 7,
    status: "prochain",
    shoppingList: [
      "Blanc de poulet",
      "Poisson blanc",
      "Œufs",
      "Légumes verts",
      "Riz complet",
      "Avoine",
    ],
    days: buildWeekDays("nutri-2", macro(2300, 190, 180, 60), [], ""),
  },
];

export const activeNutritionPlan: NutritionPlan =
  nutritionPlans.find((plan) => plan.status === "actif") ?? nutritionPlans[0];

export function getNutritionPlan(id: string): NutritionPlan | undefined {
  return nutritionPlans.find((plan) => plan.id === id);
}

export const hydrationAndSupplements: HydrationAndSupplements = {
  waterTarget: "3 L / jour",
  supplements: ["Whey protéine", "Créatine monohydrate", "Oméga-3", "Multivitamines"],
  tipOfTheDay:
    "Bois un grand verre d'eau au réveil pour relancer ton métabolisme.",
};

export const documents: DocumentItem[] = [
  {
    id: "doc-1",
    title: "Guide nutrition prise de masse",
    description: "Les bases pour structurer ton alimentation en période de prise de masse.",
    type: "pdf",
    category: "nutrition",
    addedAt: "28/06/2026",
  },
  {
    id: "doc-2",
    title: "Vidéo technique squat",
    description: "Décomposition complète de la technique et des erreurs fréquentes.",
    type: "vidéo",
    category: "entrainement",
    addedAt: "25/06/2026",
  },
  {
    id: "doc-3",
    title: "Fiche étirements post-séance",
    description: "Routine d'étirements à faire après chaque entraînement.",
    type: "pdf",
    category: "entrainement",
    addedAt: "20/06/2026",
  },
  {
    id: "doc-4",
    title: "Guide gestion des macros",
    description: "Comprendre et ajuster tes macronutriments au quotidien.",
    type: "guide",
    category: "nutrition",
    addedAt: "15/06/2026",
  },
  {
    id: "doc-5",
    title: "Facture — Juin 2026",
    description: "Facture de ton abonnement coaching du mois en cours.",
    type: "pdf",
    category: "administratif",
    addedAt: "01/06/2026",
  },
  {
    id: "doc-6",
    title: "Vidéo mobilité épaules",
    description: "Routine de mobilité à faire avant les séances haut du corps.",
    type: "vidéo",
    category: "entrainement",
    addedAt: "28/05/2026",
  },
  {
    id: "doc-7",
    title: "Guide sommeil & récupération",
    description: "Optimiser ton sommeil pour mieux récupérer entre les séances.",
    type: "guide",
    category: "administratif",
    addedAt: "20/05/2026",
  },
  {
    id: "doc-8",
    title: "Menu type — semaine",
    description: "Exemple de semaine complète adaptée à ton plan actuel.",
    type: "pdf",
    category: "nutrition",
    addedAt: "12/05/2026",
  },
  {
    id: "doc-9",
    title: "Contrat de coaching",
    description: "Ton contrat d'accompagnement et ses conditions.",
    type: "lien",
    category: "administratif",
    addedAt: "12/01/2026",
  },
];

export const recentDocuments: DocumentItem[] = documents.slice(0, 3);

/* ─── Bibliothèque de documents (onglet Documents) ─── */

export const documentResources: DocumentResource[] = [
  {
    id: "res-1",
    title: "Guide nutrition prise de masse",
    description:
      "Les bases pour structurer ton alimentation en période de prise de masse : répartition des macros, fréquence des repas et exemples de menus.",
    type: "guide",
    category: "nutrition",
    createdAt: "28/06/2026",
    important: true,
    level: 1,
    distributionMode: "immediat",
    assignedStudentIds: [student.id],
    previewContent:
      "Sommaire : 1) Calculer son besoin calorique · 2) Répartir ses macronutriments · 3) Structurer ses repas autour des séances · 4) Exemples de menus types · 5) Erreurs fréquentes à éviter.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-1.pdf",
    relatedDocumentIds: ["res-4", "res-8"],
  },
  {
    id: "res-2",
    title: "Vidéo technique squat",
    description:
      "Décomposition complète de la technique et des erreurs fréquentes, filmée sous plusieurs angles.",
    type: "vidéo",
    category: "entrainement",
    createdAt: "25/06/2026",
    important: false,
    level: 1,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "Durée : 8 min. Chapitres : placement des pieds, respiration, profondeur, erreurs courantes (valgus de genou, dos rond).",
    videoUrl: "https://videos.seth-coaching.mock/documents/res-2",
    relatedDocumentIds: ["res-6", "res-10"],
  },
  {
    id: "res-3",
    title: "Fiche étirements post-séance",
    description: "Routine d'étirements à faire après chaque entraînement.",
    type: "pdf",
    category: "entrainement",
    createdAt: "20/06/2026",
    important: false,
    level: 1,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "8 étirements, 30 secondes chacun, dans l'ordre : ischios, quadriceps, fessiers, dos, épaules, pectoraux, mollets, hanches.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-3.pdf",
    relatedDocumentIds: ["res-2"],
  },
  {
    id: "res-4",
    title: "Guide gestion des macros",
    description: "Comprendre et ajuster tes macronutriments au quotidien.",
    type: "guide",
    category: "nutrition",
    createdAt: "15/06/2026",
    important: false,
    level: 2,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "Comment lire une étiquette nutritionnelle, ajuster ses glucides selon l'activité du jour, et gérer les écarts occasionnels sans culpabiliser.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-4.pdf",
    relatedDocumentIds: ["res-1", "res-8"],
  },
  {
    id: "res-5",
    title: "Facture — Juin 2026",
    description: "Facture de ton abonnement coaching du mois en cours.",
    type: "pdf",
    category: "administratif",
    createdAt: "01/06/2026",
    important: false,
    level: 1,
    distributionMode: "immediat",
    assignedStudentIds: [student.id],
    previewContent: "Facture n°2026-06-014 · Formule Élite · 249 € · Payée le 01/06/2026.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-5.pdf",
    relatedDocumentIds: ["res-9"],
  },
  {
    id: "res-6",
    title: "Vidéo mobilité épaules",
    description: "Routine de mobilité à faire avant les séances haut du corps.",
    type: "vidéo",
    category: "entrainement",
    createdAt: "28/05/2026",
    important: false,
    level: 2,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "Durée : 5 min. Rotation externe/interne, décoaptation à la bande, chandelle allemande.",
    videoUrl: "https://videos.seth-coaching.mock/documents/res-6",
    relatedDocumentIds: ["res-2", "res-10"],
  },
  {
    id: "res-7",
    title: "Guide sommeil & récupération",
    description: "Optimiser ton sommeil pour mieux récupérer entre les séances.",
    type: "guide",
    category: "administratif",
    createdAt: "20/05/2026",
    important: true,
    level: 1,
    distributionMode: "immediat",
    assignedStudentIds: [student.id],
    previewContent:
      "Hygiène de sommeil, gestion des écrans le soir, sieste et récupération active les jours de repos.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-7.pdf",
    relatedDocumentIds: ["res-12"],
  },
  {
    id: "res-8",
    title: "Menu type — semaine",
    description: "Exemple de semaine complète adaptée à ton plan actuel.",
    type: "pdf",
    category: "nutrition",
    createdAt: "12/05/2026",
    important: false,
    level: 2,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "7 jours de menus détaillés (petit déjeuner à dîner) calibrés sur 2800 kcal, avec liste de courses associée.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-8.pdf",
    relatedDocumentIds: ["res-1", "res-4"],
  },
  {
    id: "res-9",
    title: "Contrat de coaching",
    description: "Ton contrat d'accompagnement et ses conditions.",
    type: "lien",
    category: "administratif",
    createdAt: "12/01/2026",
    important: true,
    level: 1,
    distributionMode: "immediat",
    assignedStudentIds: [student.id],
    previewContent:
      "Contrat d'accompagnement Formule Élite, engagement mensuel sans durée minimale, conditions de résiliation incluses.",
    externalUrl: "https://contrats.seth-coaching.mock/documents/res-9",
    relatedDocumentIds: ["res-5"],
  },
  {
    id: "res-10",
    title: "Checklist matériel salle à domicile",
    description:
      "Le matériel minimal recommandé pour reproduire les séances à la maison.",
    type: "image",
    category: "entrainement",
    createdAt: "05/05/2026",
    important: false,
    level: 3,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "Infographie : barre + disques, banc réglable, élastiques (3 tensions), kettlebell 16-24 kg, corde à sauter.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-10.png",
    relatedDocumentIds: ["res-2", "res-6"],
  },
  {
    id: "res-11",
    title: "Grille de suivi des mensurations",
    description:
      "Un tableau simple pour noter tes mensurations chaque mois et suivre ta progression.",
    type: "pdf",
    category: "administratif",
    createdAt: "03/05/2026",
    important: false,
    level: 2,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "Colonnes : date, poids, tour de taille, hanches, poitrine, bras, cuisse, mollet. Une ligne par mois.",
    fileUrl: "https://documents.seth-coaching.mock/fichiers/res-11.pdf",
    relatedDocumentIds: ["res-7"],
  },
  {
    id: "res-12",
    title: "Playlist motivation entraînement",
    description: "La sélection musicale recommandée pour tes séances les plus intenses.",
    type: "lien",
    category: "entrainement",
    createdAt: "22/04/2026",
    important: false,
    level: 3,
    distributionMode: "deblocage-auto",
    assignedStudentIds: [student.id],
    previewContent:
      "Playlist de 45 titres, rythme croissant, pensée pour accompagner l'échauffement jusqu'aux séries les plus lourdes.",
    externalUrl: "https://musique.seth-coaching.mock/playlists/res-12",
    relatedDocumentIds: ["res-7"],
  },
];

export function getDocumentResource(id: string): DocumentResource | undefined {
  return documentResources.find((document) => document.id === id);
}

export const studentDocumentAccess: StudentDocumentAccess[] = [
  { studentId: student.id, documentId: "res-1", viewedAt: null },
  { studentId: student.id, documentId: "res-2", viewedAt: null },
  {
    studentId: student.id,
    documentId: "res-3",
    viewedAt: "2026-06-21T09:00:00.000Z",
  },
  {
    studentId: student.id,
    documentId: "res-4",
    viewedAt: "2026-06-16T09:00:00.000Z",
  },
  { studentId: student.id, documentId: "res-5", viewedAt: null },
  {
    studentId: student.id,
    documentId: "res-6",
    viewedAt: "2026-05-29T09:00:00.000Z",
  },
  { studentId: student.id, documentId: "res-7", viewedAt: null },
  {
    studentId: student.id,
    documentId: "res-8",
    viewedAt: "2026-05-13T09:00:00.000Z",
  },
  {
    studentId: student.id,
    documentId: "res-9",
    viewedAt: "2026-01-12T09:00:00.000Z",
  },
  { studentId: student.id, documentId: "res-10", viewedAt: null },
  { studentId: student.id, documentId: "res-11", viewedAt: null },
  {
    studentId: student.id,
    documentId: "res-12",
    viewedAt: "2026-04-23T09:00:00.000Z",
  },
];

export const weightHistory: WeightEntry[] = [
  { month: "Jan", kg: 72 },
  { month: "Fév", kg: 73.5 },
  { month: "Mar", kg: 75.2 },
  { month: "Avr", kg: 77 },
  { month: "Mai", kg: 78.8 },
  { month: "Jun", kg: 80.1 },
];

export const coachNotifications: CoachNotification[] = [
  {
    id: "notif-1",
    message: "Ton plan alimentaire de la semaine est prêt",
    time: "Il y a 2h",
    unread: true,
  },
  {
    id: "notif-2",
    message: "Séance Upper Body à 18h — ne l'oublie pas",
    time: "Hier",
    unread: false,
  },
  {
    id: "notif-3",
    message: "Ton coach a ajusté ta charge sur le squat",
    time: "Il y a 3 jours",
    unread: false,
  },
];

export const bodyMeasurements: BodyMeasurement[] = [
  {
    id: "meas-poids",
    studentId: student.id,
    type: "poids",
    unit: "kg",
    startValue: 72,
    currentValue: 80.1,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-cou",
    studentId: student.id,
    type: "cou",
    unit: "cm",
    startValue: 39,
    currentValue: 40,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-epaules",
    studentId: student.id,
    type: "epaules",
    unit: "cm",
    startValue: 112,
    currentValue: 118,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-poitrine",
    studentId: student.id,
    type: "poitrine",
    unit: "cm",
    startValue: 98,
    currentValue: 104,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-taille",
    studentId: student.id,
    type: "taille",
    unit: "cm",
    startValue: 86,
    currentValue: 82,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-nombril",
    studentId: student.id,
    type: "nombril",
    unit: "cm",
    startValue: 88,
    currentValue: 85,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-hanches",
    studentId: student.id,
    type: "hanches",
    unit: "cm",
    startValue: 98,
    currentValue: 96,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-bras-droit",
    studentId: student.id,
    type: "bras-droit",
    unit: "cm",
    startValue: 33,
    currentValue: 36.5,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-bras-gauche",
    studentId: student.id,
    type: "bras-gauche",
    unit: "cm",
    startValue: 32.5,
    currentValue: 36,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-avant-bras-droit",
    studentId: student.id,
    type: "avant-bras-droit",
    unit: "cm",
    startValue: 27,
    currentValue: 29,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-avant-bras-gauche",
    studentId: student.id,
    type: "avant-bras-gauche",
    unit: "cm",
    startValue: 26.5,
    currentValue: 28.5,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-cuisse-droite",
    studentId: student.id,
    type: "cuisse-droite",
    unit: "cm",
    startValue: 54,
    currentValue: 58.5,
    note: "Mesure prise à mi-cuisse, debout.",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-cuisse-gauche",
    studentId: student.id,
    type: "cuisse-gauche",
    unit: "cm",
    startValue: 53.5,
    currentValue: 58,
    note: "Mesure prise à mi-cuisse, debout.",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-mollet-droit",
    studentId: student.id,
    type: "mollet-droit",
    unit: "cm",
    startValue: 37,
    currentValue: 39.5,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
  {
    id: "meas-mollet-gauche",
    studentId: student.id,
    type: "mollet-gauche",
    unit: "cm",
    startValue: 36.5,
    currentValue: 39,
    note: "",
    lastUpdatedAt: "2026-06-28",
  },
];

export const customMeasurements: CustomMeasurement[] = [
  {
    id: "custom-cheville",
    studentId: student.id,
    name: "Tour de cheville",
    unit: "cm",
    startValue: 22,
    currentValue: 23,
    note: "Ajoutée à la demande du coach pour le suivi de mobilité.",
    lastUpdatedAt: "2026-06-20",
  },
];

export const foodPreferences: FoodPreferences = {
  studentId: student.id,
  liked: ["Poulet", "Riz", "Patate douce", "Fruits rouges"],
  disliked: ["Poisson blanc", "Choux de Bruxelles"],
  intolerances: ["Lactose"],
  allergies: ["Fruits à coque"],
  diet: "Omnivore",
  mealsPerDay: 5,
  mealTimes: ["7h30", "10h30", "12h30", "16h00", "19h30"],
  socialConstraints:
    "Déjeuners professionnels fréquents le midi, peu de contrôle sur le menu proposé.",
  updatedAt: "2026-06-15",
};

export const sportPreferences: SportPreferences = {
  studentId: student.id,
  mainGoal: "Prise de masse musculaire",
  sports: ["Musculation", "Course à pied occasionnelle"],
  equipment: ["Salle de sport équipée", "Élastiques", "Banc à domicile"],
  location: "Salle de sport",
  sessionsPerWeek: 5,
  preferredExercises: ["Développé couché", "Squat", "Tractions"],
  exercisesToAvoid: [
    "Développé militaire nuque",
    "Rowing barre buste très penché",
  ],
  weeklyAvailability: [
    "Lundi soir",
    "Mardi matin",
    "Jeudi soir",
    "Vendredi soir",
    "Samedi matin",
  ],
  updatedAt: "2026-06-15",
};

export const injuryNote: InjuryNote = {
  studentId: student.id,
  currentInjuries: [
    "Légère gêne à l'épaule droite en fin d'amplitude sur le développé militaire",
  ],
  pastInjuries: ["Entorse de la cheville droite (2023, guérie)"],
  recurringPain: ["Tensions lombaires après les séances longues en position assise"],
  movementsToAvoid: [
    "Développé militaire nuque",
    "Squat profond à charge maximale sans échauffement complet",
  ],
  coachRemarks:
    "Bien surveiller l'épaule droite : prioriser les rotations externes en échauffement avant tout mouvement au-dessus de la tête.",
  updatedAt: "2026-06-15",
};

export const studentGoal: StudentGoal = {
  studentId: student.id,
  mainGoal: "Prise de masse musculaire propre (+8 kg depuis le début du coaching)",
  secondaryGoals: [
    "Développé couché à 100 kg",
    "Améliorer la mobilité de l'épaule droite",
    "Stabiliser le sommeil à 7h30 par nuit",
  ],
  targetDate: "2026-12-31",
  priority: "haute",
  trackedIndicators: ["poids", "mensurations", "photos", "performance", "sommeil"],
  updatedAt: "2026-06-15",
};

export const progressPhotos: ProgressPhoto[] = [
  {
    id: "photo-1",
    studentId: student.id,
    type: "avant",
    date: "2026-01-12",
    weightKg: 72,
    note: "Photo de départ, avant le début du programme.",
    imageUrl: null,
    storagePath: null,
    pending: false,
  },
  {
    id: "photo-2",
    studentId: student.id,
    type: "mensuelle",
    date: "2026-02-12",
    weightKg: 73.5,
    note: "Premier mois, prise de poids régulière.",
    imageUrl: null,
    storagePath: null,
    pending: false,
  },
  {
    id: "photo-3",
    studentId: student.id,
    type: "mensuelle",
    date: "2026-03-12",
    weightKg: 75.2,
    note: "Bonne progression sur les épaules et le dos.",
    imageUrl: null,
    storagePath: null,
    pending: false,
  },
  {
    id: "photo-4",
    studentId: student.id,
    type: "mensuelle",
    date: "2026-04-12",
    weightKg: 77,
    note: "Léger relâchement nutrition pendant les vacances.",
    imageUrl: null,
    storagePath: null,
    pending: false,
  },
  {
    id: "photo-5",
    studentId: student.id,
    type: "mensuelle",
    date: "2026-05-12",
    weightKg: 78.8,
    note: "Reprise sérieuse, silhouette plus dense.",
    imageUrl: null,
    storagePath: null,
    pending: false,
  },
  {
    id: "photo-6",
    studentId: student.id,
    type: "actuelle",
    date: "2026-06-28",
    weightKg: 80.1,
    note: "Photo la plus récente, bonne évolution générale.",
    imageUrl: null,
    storagePath: null,
    pending: false,
  },
  {
    id: "photo-7",
    studentId: student.id,
    type: "objectif",
    date: "2026-12-31",
    weightKg: null,
    note: "Objectif visuel fixé avec le coach pour la fin d'année.",
    imageUrl: null,
    storagePath: null,
    pending: true,
  },
];
