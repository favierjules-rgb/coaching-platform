import type {
  BodyMeasurements,
  CoachNotification,
  DayCalorieTarget,
  DocumentItem,
  Exercise,
  FoodPreferences,
  HydrationAndSupplements,
  Meal,
  MealPlan,
  ProgramScheduleDay,
  SportPreferences,
  StudentProfile,
  TrainingProgram,
  UpcomingSession,
  WeightEntry,
  WorkoutSession,
} from "@/types";

export const student: StudentProfile = {
  firstName: "Alexandre",
  lastName: "Morel",
  goal: "+8 kg de masse musculaire",
  level: "Intermédiaire",
  startDate: "2026-01-12",
  weekNumber: 14,
  age: 27,
  heightCm: 179,
  currentWeightKg: 80.1,
};

function exercise(
  id: string,
  name: string,
  sets: number,
  reps: string,
  restSeconds: number,
  tempo: string,
  recommendedLoad: string,
): Exercise {
  return {
    id,
    name,
    sets,
    reps,
    restSeconds,
    tempo,
    recommendedLoad,
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
      exercise("ex-1", "Développé couché barre", 4, "8-10", 90, "2-0-1-0", "60 kg"),
      exercise("ex-2", "Développé incliné haltères", 4, "10-12", 75, "2-0-1-0", "24 kg / haltère"),
      exercise("ex-3", "Écarté poulie vis-à-vis", 3, "12-15", 60, "2-0-1-1", "15 kg"),
      exercise("ex-4", "Dips lestés", 3, "8-10", 90, "2-0-1-1", "+10 kg"),
      exercise("ex-5", "Extension triceps poulie haute", 3, "12-15", 60, "2-0-1-0", "25 kg"),
      exercise("ex-6", "Barre au front", 3, "10-12", 75, "3-0-1-0", "30 kg"),
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
      exercise("ex-7", "Squat barre", 4, "6-8", 120, "3-0-1-0", "90 kg"),
      exercise("ex-8", "Presse à cuisses", 4, "10-12", 90, "2-0-1-0", "160 kg"),
      exercise("ex-9", "Fentes marchées haltères", 3, "12 / jambe", 75, "2-0-1-0", "16 kg / haltère"),
      exercise("ex-10", "Leg curl allongé", 3, "12-15", 60, "2-0-1-1", "35 kg"),
      exercise("ex-11", "Mollets debout", 4, "15-20", 45, "2-0-1-2", "50 kg"),
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
      exercise("ex-12", "Développé militaire barre", 4, "8-10", 90, "2-0-1-0", "40 kg"),
      exercise("ex-13", "Élévations latérales", 4, "12-15", 60, "2-0-1-1", "8 kg"),
      exercise("ex-14", "Développé Arnold haltères", 3, "10-12", 75, "2-0-1-0", "14 kg"),
      exercise("ex-15", "Extension triceps nuque haltère", 3, "12-15", 60, "2-0-1-1", "18 kg"),
      exercise("ex-16", "Dips triceps", 3, "10-12", 75, "2-0-1-0", "Poids du corps"),
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
      exercise("ex-17", "Tractions lestées", 4, "6-8", 120, "2-0-1-1", "+5 kg"),
      exercise("ex-18", "Rowing barre", 4, "8-10", 90, "2-0-1-0", "60 kg"),
      exercise("ex-19", "Tirage horizontal poulie", 3, "10-12", 75, "2-0-1-1", "55 kg"),
      exercise("ex-20", "Curl biceps barre EZ", 3, "10-12", 60, "2-0-1-0", "25 kg"),
      exercise("ex-21", "Curl marteau haltères", 3, "12-15", 60, "2-0-1-1", "12 kg"),
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
      exercise("ex-22", "Squat gobelet", 3, "12", 60, "2-0-1-0", "16 kg"),
      exercise("ex-23", "Pompes (genoux ou complètes)", 3, "10", 60, "2-0-1-1", "Poids du corps"),
      exercise("ex-24", "Rowing élastique", 3, "12", 60, "2-0-1-0", "Élastique moyen"),
      exercise("ex-25", "Gainage planche", 3, "30 sec", 45, "Statique", "Poids du corps"),
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
      exercise("ex-26", "Soulevé de terre kettlebell", 3, "10", 75, "2-0-1-0", "20 kg"),
      exercise("ex-27", "Développé couché haltères", 3, "10", 75, "2-0-1-0", "14 kg / haltère"),
      exercise("ex-28", "Tirage poulie haute", 3, "12", 60, "2-0-1-1", "40 kg"),
      exercise("ex-29", "Fentes statiques", 3, "10 / jambe", 60, "2-0-1-0", "Poids du corps"),
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
      exercise("ex-30", "Squat gobelet lourd", 4, "12-15", 45, "2-0-1-0", "20 kg"),
      exercise("ex-31", "Développé couché haltères", 4, "12-15", 45, "2-0-1-0", "16 kg / haltère"),
      exercise("ex-32", "Rowing barre", 4, "12-15", 45, "2-0-1-0", "45 kg"),
      exercise("ex-33", "Fentes sautées", 3, "12 / jambe", 45, "Explosif", "Poids du corps"),
      exercise("ex-34", "Gainage dynamique", 3, "45 sec", 30, "Continu", "Poids du corps"),
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
      exercise("ex-35", "Sprint tapis", 8, "40 sec effort", 20, "—", "Intensité max"),
      exercise("ex-36", "Burpees", 8, "40 sec effort", 20, "—", "Poids du corps"),
      exercise("ex-37", "Mountain climbers", 8, "40 sec effort", 20, "—", "Poids du corps"),
      exercise("ex-38", "Corde à sauter", 8, "40 sec effort", 20, "—", "Intensité max"),
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

export const weeklyCalorieTargets: DayCalorieTarget[] = [
  { day: "Lundi", isToday: true, calories: 2800 },
  { day: "Mardi", calories: 2800 },
  { day: "Mercredi", calories: 2800 },
  { day: "Jeudi", calories: 2800 },
  { day: "Vendredi", calories: 2800 },
  { day: "Samedi", calories: 3000 },
  { day: "Dimanche", calories: 2600 },
];

export const todayMeals: Meal[] = [
  {
    slot: "Petit déjeuner",
    name: "Porridge avoine, whey, banane",
    calories: 550,
    protein: 35,
    carbs: 70,
    fat: 12,
  },
  {
    slot: "Collation matin",
    name: "Yaourt grec, amandes, miel",
    calories: 280,
    protein: 18,
    carbs: 22,
    fat: 12,
  },
  {
    slot: "Midi",
    name: "Poulet, riz basmati, brocolis, huile d'olive",
    calories: 720,
    protein: 55,
    carbs: 80,
    fat: 18,
  },
  {
    slot: "Collation après-midi",
    name: "Shaker whey, flocons d'avoine, beurre de cacahuète",
    calories: 420,
    protein: 30,
    carbs: 35,
    fat: 15,
  },
  {
    slot: "Dîner",
    name: "Saumon, patate douce, légumes vapeur",
    calories: 650,
    protein: 45,
    carbs: 55,
    fat: 20,
  },
  {
    slot: "Compléments",
    name: "Créatine 5g, oméga-3, multivitamines",
    calories: 20,
    protein: 0,
    carbs: 0,
    fat: 2,
  },
];

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

export const bodyMeasurements: BodyMeasurements = {
  waist: 82,
  hips: 96,
  chest: 104,
  arm: 36,
  thigh: 58,
  calf: 39,
};

export const foodPreferences: FoodPreferences = {
  liked: ["Poulet", "Riz", "Patate douce", "Fruits rouges"],
  disliked: ["Poisson blanc", "Choux de Bruxelles"],
  intolerances: ["Lactose"],
  diet: "Omnivore",
  mealsPerDay: 5,
};

export const sportPreferences: SportPreferences = {
  mainGoal: "Prise de masse musculaire",
  sports: ["Musculation", "Course à pied occasionnelle"],
  injuries: "Légère gêne à l'épaule droite (surveillance)",
  equipment: ["Salle de sport équipée", "Élastiques", "Banc à domicile"],
  location: "Salle de sport",
  sessionsPerWeek: 5,
};
