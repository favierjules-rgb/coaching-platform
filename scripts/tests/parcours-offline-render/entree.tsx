/**
 * HARNAIS REACT — LE PARCOURS iPHONE COMPLET, DANS UN VRAI NAVIGATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL
 * ════════════════════════════════════════════════════════════════════════
 * Les DEUX PAGES telles quelles (`app/(student)/entrainement/page.tsx` et
 * `app/(student)/entrainement/seance/[sessionId]/page.tsx`), leurs hooks,
 * `DepotOffline`, `MoteurIndexedDB`, IndexedDB, React et `createRoot`.
 *
 * INJECTÉ : le réseau seul (voir `supabase-mode.ts`), et les contextes que
 * Next fournit normalement au routeur — sans eux, `<Link>` et `useParams`
 * n'ont rien à lire hors application.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA BASE PORTE LE NOM DE PRODUCTION, ET C'EST VOULU
 * ════════════════════════════════════════════════════════════════════════
 * Les pages construisent `new MoteurIndexedDB()` : c'est le code de
 * production, il vise la base de production, et le rendre injectable
 * uniquement pour ce test reviendrait à ne plus tester le vrai chemin.
 * L'isolement est donc obtenu autrement : chaque cas tourne dans un
 * CONTEXTE DE NAVIGATEUR NEUF, créé puis détruit par le test. Aucune donnée
 * d'élève n'y a jamais existé.
 */
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathParamsContext,
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import DashboardPage from "@/app/(student)/dashboard/page";
import DocumentsPage from "@/app/(student)/documents/page";
import ProfilPage from "@/app/(student)/profil/page";
import NutritionPage from "@/app/(student)/nutrition/page";
import NutritionPlanPage from "@/app/(student)/nutrition/[planId]/page";
import EntrainementPage from "@/app/(student)/entrainement/page";
import ProgrammePage from "@/app/(student)/entrainement/[programId]/page";
import SeancePage from "@/app/(student)/entrainement/seance/[sessionId]/page";
import { DepotOffline } from "@/lib/offline/depot";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import { dateMetier } from "@/lib/offline/seance-du-jour";
import type { ContenuSnapshot } from "@/lib/offline/snapshot-seance";
import type { Exercise, WorkoutSession } from "@/types";

const USER = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SEANCE = "33333333-3333-4333-8333-777777777777";
const PROGRAMME = "99999999-9999-4999-8999-999999999999";
const FICHE = "88888888-8888-4888-8888-666666666666";

const EXERCICE: Exercise = {
  id: "66666666-6666-4666-8666-333333333333",
  name: "Tirage pronation à la smith machine",
  sets: 2,
  reps: "8-13",
  restSeconds: 180,
  tempo: "2-0-X-0",
  recommendedLoad: "RIR 1",
  videoUrl: "",
  muscleGroup: "Dos",
  libraryExerciseId: FICHE,
  recommendedRpe: "8",
};

const SESSION_REELLE = {
  id: SEANCE,
  programId: "99999999-9999-4999-8999-999999999999",
  name: "Pull — Dos / Biceps",
  day: "Dimanche",
  durationMinutes: 60,
  muscleGroups: ["Dos"],
  warmup: "",
  coachNotes: "",
  exercises: [EXERCICE],
  cardioBlocks: [],
  // Modèle canonique `TrainingBlock` — la forme que l'écran consomme
  // réellement (`category`, `position`, `colorKey`), pas une approximation.
  blocks: [
    {
      id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
      category: "strength",
      position: 1,
      title: "Bloc principal",
      colorKey: "neutral",
      exercises: [EXERCICE],
    },
  ],
} as unknown as WorkoutSession;

const REMPLACANTS: ContenuSnapshot["remplacants"] = {
  [FICHE]: [
    {
      id: "aaaa1111-2222-4333-8444-555566667777",
      name: "Tirage vertical prise neutre",
      videoUrl: "",
      alternativeVideoUrl: "",
      muscleGroup: "Dos",
      equipment: "Poulie",
      level: "Intermédiaire",
    },
    {
      id: "bbbb1111-2222-4333-8444-555566667777",
      name: "Tirage horizontal poulie basse",
      videoUrl: "",
      alternativeVideoUrl: "",
      muscleGroup: "Dos",
      equipment: "Poulie",
      level: "Intermédiaire",
    },
  ],
};

/**
 * Le programme RÉEL des cas en ligne — forme `AdminProgram`, celle que
 * `useSupabaseTrainingProgram` rend vraiment. Aucun de ses libellés
 * n'apparaît dans `data/student.ts` : si l'écran affiche « Hypertrophie —
 * bloc 2 », il l'a lu ici et nulle part ailleurs.
 */
const PROGRAMME_REEL = {
  id: PROGRAMME,
  name: "Hypertrophie — bloc 2",
  goal: "Volume haut du corps",
  status: "actif",
  level: "Intermédiaire",
  durationWeeks: 8,
  sessionsPerWeek: 4,
  startDate: "2026-07-06",
  sessions: [],
  assignedAt: "2026-07-06",
};

/** Le plan alimentaire RÉEL : aucun de ses libellés n'est dans data/student.ts. */
const PLAN_REEL = {
  id: "aaaa2222-3333-4444-8555-666677778888",
  name: "Sèche progressive — bloc 2",
  status: "actif",
  caloriesPerDay: 2400,
  protein: 190,
  carbs: 220,
  fat: 70,
  weeklyTargetCalories: 16800,
  hydrationTip: "",
  supplements: [],
  coachNotes: "",
};

const PROFIL_REEL = {
  profile: {
    firstName: "Camille",
    lastName: "Réelle",
    level: "Intermédiaire",
    goal: "Prise de force",
    coachingStatus: "actif",
    weekNumber: 5,
  },
  weightHistory: [],
  measurements: [],
  customMeasurements: [],
  measurementHistory: [],
  photos: [],
};

let racine: Root | null = null;

const routeurFactice = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {},
  prefetch: async () => {},
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]["value"];

function avecContexteNext(chemin: string, params: Record<string, string>, enfant: ReactNode) {
  return createElement(
    AppRouterContext.Provider,
    { value: routeurFactice },
    createElement(
      PathnameContext.Provider,
      { value: chemin },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(PathParamsContext.Provider, { value: params }, enfant),
      ),
    ),
  );
}

function monterDans(element: ReactNode) {
  racine?.unmount();
  document.getElementById("racine")!.innerHTML = "";
  racine = createRoot(document.getElementById("racine")!);
  racine.render(element);
}

const harnais = {
  constantes: () => ({
    USER, ELEVE, SEANCE, FICHE, PROGRAMME,
    nomSeance: SESSION_REELLE.name,
    nomProgrammeReel: PROGRAMME_REEL.name,
    PLAN: PLAN_REEL.id,
    nomPlanReel: PLAN_REEL.name,
    prenomReel: PROFIL_REEL.profile.firstName,
  }),

  /** L'humeur du réseau pour les prochains rendus. Lue à chaque appel. */
  reseau(mode: "offline" | "erreur" | "online" | "non_configure") {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__MODE_RESEAU = mode;
    g.__PROGRAMME_REEL = PROGRAMME_REEL;
    g.__PROFIL_REEL = PROFIL_REEL;
    g.__ETAT_PROFIL = PROFIL_REEL;
    g.__PLAN_REEL = PLAN_REEL;
    g.__DOCS_REELS = [];
  },

  /** Écrit le snapshot EXACTEMENT comme le fait le chemin en ligne. */
  async semer(options: { remplacants?: boolean; businessDate?: string } = {}) {
    const businessDate = options.businessDate ?? dateMetier();
    const depot = new DepotOffline(new MoteurIndexedDB());
    const contenu: ContenuSnapshot = {
      studentId: ELEVE,
      session: SESSION_REELLE,
      programId: "99999999-9999-4999-8999-999999999999",
      programName: "Hypertrophie — bloc 2",
      feedbackExistant: null,
      historique: [],
      remplacants: options.remplacants === false ? {} : REMPLACANTS,
      accessType: "coaching",
    };
    await depot.ecrireSnapshot({
      userId: USER,
      businessDate,
      sessionId: SEANCE,
      payload: contenu,
      maintenant: Date.now(),
    });
  },

  monterEntrainement() {
    monterDans(avecContexteNext("/entrainement", {}, createElement(EntrainementPage)));
  },

  monterDashboard() {
    monterDans(avecContexteNext("/dashboard", {}, createElement(DashboardPage)));
  },

  monterNutrition() {
    monterDans(avecContexteNext("/nutrition", {}, createElement(NutritionPage)));
  },

  monterPlan(planId: string) {
    monterDans(
      avecContexteNext(`/nutrition/${planId}`, { planId }, createElement(NutritionPlanPage)),
    );
  },

  monterProfil() {
    monterDans(avecContexteNext("/profil", {}, createElement(ProfilPage)));
  },

  monterDocuments() {
    monterDans(avecContexteNext("/documents", {}, createElement(DocumentsPage)));
  },

  monterProgramme(programId: string) {
    monterDans(
      avecContexteNext(`/entrainement/${programId}`, { programId }, createElement(ProgrammePage)),
    );
  },

  monterSeance(sessionId: string) {
    monterDans(
      avecContexteNext(
        `/entrainement/seance/${sessionId}`,
        { sessionId },
        createElement(SeancePage),
      ),
    );
  },

  /** Le texte rendu, et les liens — ce qu'un élève voit et ce qu'il peut toucher. */
  vu() {
    const racineDom = document.getElementById("racine")!;
    return {
      texte: racineDom.textContent ?? "",
      liens: Array.from(racineDom.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? ""),
      boutons: Array.from(racineDom.querySelectorAll("button")).map((b) => b.textContent ?? ""),
      champsFichier: racineDom.querySelectorAll('input[type="file"]').length,
      diagnostics: Array.from(racineDom.querySelectorAll("[data-diagnostic-offline]")).map(
        (n) => n.textContent ?? "",
      ),
    };
  },

  /** Ouvre le sélecteur de remplaçants du premier exercice et rend ce qu'il propose. */
  async ouvrirRemplacants(): Promise<string[]> {
    const racineDom = document.getElementById("racine")!;
    // Le formulaire s'ouvre dans un `<fieldset disabled>` tant que le
    // brouillon n'est pas restauré — et un bouton dans un fieldset désactivé
    // ne reçoit AUCUN clic. Attendre ce moment n'est pas une complaisance de
    // test : c'est ce que fait l'élève, qui ne peut pas cliquer plus tôt.
    const attenduHydratation = Date.now() + 3000;
    while (racineDom.querySelector("fieldset[disabled]") && Date.now() < attenduHydratation) {
      await new Promise((ok) => setTimeout(ok, 25));
    }
    if (racineDom.querySelector("fieldset[disabled]")) return ["FORMULAIRE JAMAIS RESTAURÉ"];

    const declencheur = Array.from(racineDom.querySelectorAll("button")).find((b) =>
      /Exercice indisponible/i.test(b.textContent ?? ""),
    );
    if (!declencheur) return ["AUCUN BOUTON DE REMPLACEMENT"];
    declencheur.click();
    // On ATTEND que le sélecteur ait fini, au lieu de parier sur un délai :
    // « Recherche des remplaçants… » est son état intermédiaire, et un
    // sleep fixe rendait ce test intermittent.
    const limite = Date.now() + 3000;
    let panneau = "";
    for (;;) {
      panneau = racineDom.textContent ?? "";
      const fini =
        /Aucun remplaçant enregistré/i.test(panneau) ||
        (/Choisis un remplaçant/.test(panneau) && !/Recherche des remplaçants/.test(panneau));
      if (fini || Date.now() > limite) break;
      await new Promise((ok) => setTimeout(ok, 25));
    }
    if (/Aucun remplaçant enregistré/i.test(panneau)) return [];
    if (!/Choisis un remplaçant/.test(panneau)) return ["PANNEAU JAMAIS OUVERT"];
    return Array.from(racineDom.querySelectorAll("button, li, label"))
      .map((n) => n.textContent ?? "")
      .filter((t) => /Tirage vertical|Tirage horizontal/.test(t));
  },
};

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
