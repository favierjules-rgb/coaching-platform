/**
 * LES DEUX HOOKS DE CHARGEMENT EN LIGNE, EN MODE `online`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CEUX-LÀ SONT SUBSTITUÉS, ET PAS LES AUTRES
 * ════════════════════════════════════════════════════════════════════════
 * Les cas HORS LIGNE utilisent les VRAIS hooks : c'est justement leur
 * verdict (`active: false` sur panne réseau) qui a produit le bogue, il faut
 * donc qu'il soit réel.
 *
 * Les cas EN LIGNE, eux, ne cherchent pas à vérifier Supabase : ils
 * vérifient que la page rend les DONNÉES RÉELLES quand elles arrivent.
 * Reproduire ici toute la couche SQL (programmes, semaines, assignations)
 * reviendrait à réimplémenter le serveur pour prouver une propriété de
 * l'écran. On rend donc, en mode `online` seulement, ce que le vrai hook
 * rendrait — et on délègue au vrai hook dans tous les autres modes.
 */
import {
  useSupabaseTrainingProgram as vraiHookProgrammes,
} from "../../../hooks/useSupabaseTrainingProgram";
import {
  useSupabaseStudentProfile as vraiHookProfil,
} from "../../../hooks/useSupabaseStudentProfile";
import {
  useSupabaseNutritionForStudent as vraiHookNutrition,
} from "../../../hooks/useSupabaseNutritionForStudent";
import {
  useSupabaseStudentDocuments as vraiHookDocuments,
} from "../../../hooks/useSupabaseStudentDocuments";
import {
  useStudentNutritionPlanV2 as vraiHookPlanV2,
} from "../../../hooks/useStudentNutritionPlanV2";

function enLigne(): boolean {
  return (globalThis as unknown as { __MODE_RESEAU?: string }).__MODE_RESEAU === "online";
}

function programmeReel() {
  return (globalThis as unknown as { __PROGRAMME_REEL?: unknown }).__PROGRAMME_REEL as never;
}

function profilReel() {
  return (globalThis as unknown as { __PROFIL_REEL?: unknown }).__PROFIL_REEL as never;
}

export function useSupabaseTrainingProgram(): ReturnType<typeof vraiHookProgrammes> {
  const reel = vraiHookProgrammes();
  if (!enLigne()) return reel;
  const p = programmeReel() as unknown as { id: string } | null;
  return {
    ready: true,
    active: true,
    studentId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    student: profilReel(),
    programs: p ? [p] : [],
    activeProgram: p,
    refetch: async () => {},
  } as unknown as ReturnType<typeof vraiHookProgrammes>;
}

export function useSupabaseStudentProfile(): ReturnType<typeof vraiHookProfil> {
  const reel = vraiHookProfil();
  if (!enLigne()) return reel;
  return {
    ready: true,
    state: (globalThis as unknown as { __ETAT_PROFIL?: unknown }).__ETAT_PROFIL,
  } as unknown as ReturnType<typeof vraiHookProfil>;
}

/** Le plan alimentaire RÉEL des cas en ligne. */
export function useSupabaseNutritionForStudent(): ReturnType<typeof vraiHookNutrition> {
  const reel = vraiHookNutrition();
  if (!enLigne()) return reel;
  const plan = (globalThis as unknown as { __PLAN_REEL?: unknown }).__PLAN_REEL;
  return {
    ready: true,
    active: true,
    // `null` À DESSEIN : le suivi hebdomadaire n'est monté qu'avec un
    // studentId, et il ouvrirait ses propres requêtes. Ce test porte sur ce
    // que la PAGE affiche, pas sur le tracker.
    studentId: null,
    plans: plan ? [plan] : [],
    activePlan: plan ?? null,
  } as unknown as ReturnType<typeof vraiHookNutrition>;
}

/** Les documents RÉELS des cas en ligne. */
export function useSupabaseStudentDocuments(): ReturnType<typeof vraiHookDocuments> {
  const reel = vraiHookDocuments();
  if (!enLigne()) return reel;
  return {
    ready: true,
    active: true,
    studentId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    documents: (globalThis as unknown as { __DOCS_REELS?: unknown[] }).__DOCS_REELS ?? [],
  } as unknown as ReturnType<typeof vraiHookDocuments>;
}

/**
 * La semaine v2 : jamais chargée dans ce harnais. La page retombe alors sur
 * l'objectif unique du plan — un chemin qu'elle sait tenir, et qui suffit à
 * prouver qu'elle affiche le plan RÉEL.
 */
export function useStudentNutritionPlanV2(
  planId: string | null,
): ReturnType<typeof vraiHookPlanV2> {
  const reel = vraiHookPlanV2(enLigne() ? null : planId);
  if (!enLigne()) return reel;
  return { week: null, recipes: [] } as unknown as ReturnType<typeof vraiHookPlanV2>;
}
