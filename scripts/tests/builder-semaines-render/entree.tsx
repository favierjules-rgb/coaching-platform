/**
 * HARNAIS — LA BANDE DES SEMAINES, DANS UN VRAI NAVIGATEUR.
 *
 * Monte le VRAI `ProgramBuilderFullscreen` avec un programme de trois semaines.
 * Rien n'est substitué : le composant ne parle à personne au montage, il reçoit
 * son programme en propriété et rend `onSave` sans jamais l'appeler seul.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { ProgramBuilderFullscreen } from "@/components/admin/ProgramBuilderFullscreen";
import type { AdminProgram, AdminWorkoutSession } from "@/types";

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const NOMS: Record<string, string> = {
  lundi: "Tirage N°1",
  mardi: "Squat N°1",
  jeudi: "Poussée N°1",
  vendredi: "Squat N°2",
  samedi: "Tirage N°2",
};

/** Un exercice COMPLET — tous les champs du modèle, aucun `undefined`. */
function exercice(
  id: string,
  order: number,
  name: string,
  sets: number,
  reps: string,
  restSeconds: number,
  tempo: string,
  recommendedLoad: string,
) {
  return { id, order, name, sets, reps, restSeconds, tempo, recommendedLoad, recommendedRpe: "", videoUrl: "", notes: "", muscleGroup: "" };
}

function seance(semaine: number, jour: string): AdminWorkoutSession {
  const nom = NOMS[jour] ?? "";
  const repos = nom === "";
  return {
    id: `s-${semaine}-${jour}`,
    programId: "prog",
    weekNumber: semaine,
    day: jour,
    isRestDay: repos,
    name: nom,
    muscleGroup: "",
    durationMinutes: 0,
    warmup: "",
    coachNotes: "",
    exercises: [],
    sessionType: "strength",
    cardioBlocks: [],
    bannerUrl: null,
    updatedAt: "2026-08-21T10:00:00.000Z",
    blocks: repos
      ? []
      : [
          {
            id: `b-${semaine}-${jour}`,
            category: "strength",
            title: "Musculation",
            colorKey: "amber",
            position: 0,
            // Trois exercices : de quoi vérifier qu'ils se rangent côte à côte.
            exercises: [
              exercice(`e-${semaine}-${jour}-1`, 0, "Warm Up Squat", 3, "8-10", 60, "2-0-1-0", ""),
              exercice(`e-${semaine}-${jour}-2`, 1, "Back Squat", 5, "5", 180, "3-1-1-0", "80 kg"),
              exercice(`e-${semaine}-${jour}-3`, 2, "Fentes bulgares", 3, "10-12", 90, "", ""),
            ],
          },
        ],
  } as unknown as AdminWorkoutSession;
}

const PROGRAMME = {
  id: "prog",
  name: "Programme Sacha",
  goal: "Force",
  level: "Intermédiaire",
  durationWeeks: 3,
  description: "",
  status: "actif",
  sessions: [1, 2, 3].flatMap((semaine) => JOURS.map((jour) => seance(semaine, jour))),
  assignedStudentIds: [],
  bannerUrl: null,
  programMode: "individuel",
  groupStartDate: null,
  isPublic: false,
  publicSubscriptionTemplateId: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
} as unknown as AdminProgram;

createRoot(document.getElementById("racine")!).render(
  createElement(ProgramBuilderFullscreen, {
    program: PROGRAMME,
    library: [],
    templates: [],
    onSave: async () => true,
    onSaveAsTemplate: async () => true,
  }),
);

(globalThis as unknown as { __harnais: unknown }).__harnais = {
  texte: () => document.body.innerText,
  // Les confirmations natives bloqueraient le navigateur : on les décide ici.
  confirmerToujours: () => {
    window.confirm = () => true;
  },
  refuserToujours: () => {
    window.confirm = () => false;
  },
};
