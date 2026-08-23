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

/**
 * ⚠️ LA CHAÎNE RÉELLE DES CONTENEURS, REPRODUITE À L'IDENTIQUE.
 *
 * Le défaut de défilement ne vit pas dans le builder seul : il naît de
 * l'empilement `html` → `body` → `<main>` d'AdminShell → builder. Monter le
 * composant nu dans un `<div>` vide aurait montré un écran parfait et prouvé
 * exactement rien. Les classes ci-dessous sont copiées de :
 *   · app/layout.tsx            <html class="h-full"> / <body class="flex min-h-full flex-col …">
 *   · components/admin/AdminShell.tsx   branche builder : <main class="h-dvh w-full overflow-hidden">
 */
document.documentElement.className = "h-full";
document.body.className = "flex min-h-full flex-col bg-background font-body text-foreground antialiased";
const racine = document.getElementById("racine")!;
racine.className = "h-dvh w-full overflow-hidden bg-background";

createRoot(racine).render(
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
  /**
   * ⚠️ ON MESURE LE DÉFILEMENT, ON NE LE DEVINE PAS. Un test de classe
   * Tailwind aurait dit « la classe est là » ; seule la mesure dit s'il
   * existe un SECOND défilement autour du builder.
   */
  mesures: () => {
    const doc = document.documentElement;
    // Le conteneur qui défile réellement : le plus profond dont le contenu
    // dépasse la boîte et dont l'overflow-y n'est ni visible ni hidden.
    const scrollables = [...document.querySelectorAll<HTMLElement>("div, main, section")].filter((el) => {
      const st = getComputedStyle(el).overflowY;
      return (st === "auto" || st === "scroll") && el.scrollHeight > el.clientHeight + 1;
    });
    const interne = scrollables[scrollables.length - 1] ?? null;
    return {
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      viewport: window.innerHeight,
      nbScrollables: scrollables.length,
      interneScrollHeight: interne?.scrollHeight ?? 0,
      interneClientHeight: interne?.clientHeight ?? 0,
      interneClasses: interne?.className ?? "(aucun)",
    };
  },
  defilerInterneEnBas: () => {
    const scrollables = [...document.querySelectorAll<HTMLElement>("div, main, section")].filter((el) => {
      const st = getComputedStyle(el).overflowY;
      return (st === "auto" || st === "scroll") && el.scrollHeight > el.clientHeight + 1;
    });
    const interne = scrollables[scrollables.length - 1];
    if (interne) interne.scrollTop = interne.scrollHeight;
    return interne ? interne.scrollTop + interne.clientHeight : 0;
  },
  // Les confirmations natives bloqueraient le navigateur : on les décide ici.
  confirmerToujours: () => {
    window.confirm = () => true;
  },
  refuserToujours: () => {
    window.confirm = () => false;
  },
};
