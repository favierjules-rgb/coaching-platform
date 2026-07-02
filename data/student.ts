import type {
  CoachNotification,
  DocumentItem,
  MealPlan,
  StudentProfile,
  TrainingProgram,
  UpcomingSession,
  WeightEntry,
} from "@/types";

export const student: StudentProfile = {
  firstName: "Alexandre",
  lastName: "Morel",
  goal: "+8 kg de masse musculaire",
  level: "Intermédiaire",
  startDate: "2026-01-12",
  weekNumber: 14,
};

export const activeProgram: TrainingProgram = {
  id: "prog-1",
  name: "Force & Hypertrophie",
  goal: "Prise de masse musculaire",
  level: "Intermédiaire",
  durationWeeks: 12,
  status: "actif",
};

export const upcomingSession: UpcomingSession = {
  id: "session-1",
  name: "Upper Body — Pectoraux / Triceps",
  day: "Aujourd'hui",
  time: "18h00",
  durationMinutes: 60,
  exerciseCount: 8,
};

export const activeMealPlan: MealPlan = {
  id: "meal-1",
  name: "Plan Prise de Masse",
  goal: "Prise de masse",
  calories: 2800,
  protein: 180,
  carbs: 320,
  fat: 80,
  status: "actif",
};

export const recentDocuments: DocumentItem[] = [
  {
    id: "doc-1",
    title: "Guide nutrition prise de masse",
    type: "pdf",
    addedAt: "28/06/2026",
  },
  {
    id: "doc-2",
    title: "Vidéo technique squat",
    type: "vidéo",
    addedAt: "25/06/2026",
  },
  {
    id: "doc-3",
    title: "Fiche étirements post-séance",
    type: "pdf",
    addedAt: "20/06/2026",
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
