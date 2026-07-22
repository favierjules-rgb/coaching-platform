"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProgramBuilderFullscreen, type BuilderData } from "@/components/admin/ProgramBuilderFullscreen";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseExerciseLibrary } from "@/hooks/useSupabaseExerciseLibrary";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseSessionTemplates } from "@/hooks/useSupabaseSessionTemplates";
import { nextBuilderState, orchestrateBuilderSave } from "@/lib/admin-builder-save";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateProgram as updateProgramSupabase } from "@/lib/supabase/programs";
import { createSessionTemplate } from "@/lib/supabase/session-templates";
import type { AdminProgram, AdminWorkoutSession } from "@/types";

/**
 * Builder plein écran V3 (/admin/programmes/[programId]/builder) : route
 * indépendante de la page de détail (/admin/programmes/[programId]), qui
 * reste l'aperçu en lecture seule. AdminShell détecte cette route par
 * pattern d'URL et retire sidebar/menu — voir components/admin/AdminShell.tsx.
 */
export default function ProgramBuilderPage() {
  const params = useParams<{ programId: string }>();
  const { state } = useAdminData();

  const supabasePrograms = useSupabasePrograms();
  const isSupabaseActive = supabasePrograms.programs.length > 0;
  const programs = isSupabaseActive ? supabasePrograms.programs : state.programs;
  const derivedProgram = programs.find((p) => p.id === params.programId);

  // Snapshot de page + révision qui pilotent le remount du builder.
  // `savedProgram` n'est écrit QUE dans le handler de sauvegarde (jamais dans un
  // effet), sur un succès réel (sauvegarde + refetch OK). Le programme actif est
  // DÉRIVÉ au render : le snapshot sauvegardé prime tant qu'il concerne ce
  // programId, sinon on retombe sur la version du cache. Un changement
  // SECONDAIRE du cache ne remonte donc pas le builder (la `key` ne change pas).
  // La `key` n'utilise PLUS `program.updatedAt` (non fiable : la RPC bumpe
  // workout_sessions.updated_at, pas forcément programs.updated_at) mais une
  // révision incrémentée explicitement.
  const [savedProgram, setSavedProgram] = useState<AdminProgram | null>(null);
  const [builderRevision, setBuilderRevision] = useState(0);
  const activeProgram = savedProgram && savedProgram.id === params.programId ? savedProgram : derivedProgram;

  const supabaseExerciseLibrary = useSupabaseExerciseLibrary();
  const library = supabaseExerciseLibrary.items.length > 0 ? supabaseExerciseLibrary.items : state.exerciseLibrary;

  const sessionTemplates = useSupabaseSessionTemplates();

  async function handleSaveAsTemplate(session: AdminWorkoutSession, name: string, description: string): Promise<boolean> {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return false;
    const id = await createSessionTemplate(supabase, session, name, description);
    if (id) await sessionTemplates.refetch();
    return Boolean(id);
  }

  async function handleSave(data: BuilderData): Promise<boolean> {
    if (!activeProgram) return false;
    if (!isSupabaseActive) return true;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return true;

    const programId = activeProgram.id;
    const outcome = await orchestrateBuilderSave({
      save: () => updateProgramSupabase(supabase, programId, data),
      // refetch RETOURNE la liste fraîche (jamais un état périmé) → on en extrait
      // le snapshot à jour (UUID réels + nouveaux updatedAt de séances).
      refetch: async () => {
        const list = await supabasePrograms.refetch();
        return list.find((p) => p.id === programId) ?? null;
      },
    });

    // Seul un succès remplace le snapshot et incrémente la révision → UN unique
    // remount depuis les données fraîches. STALE / refetch-failed / error :
    // aucun setState → aucun remount, état local (édits non enregistrés) conservé.
    if (outcome.kind === "success") {
      const next = nextBuilderState({ program: activeProgram, revision: builderRevision }, outcome);
      setSavedProgram(next.program);
      setBuilderRevision(next.revision);
      return true;
    }
    return false;
  }

  if (supabasePrograms.loading && !isSupabaseActive && !activeProgram) {
    return <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Chargement…</div>;
  }

  if (!activeProgram) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
        <p>Programme introuvable.</p>
        <Link href="/admin/programmes" className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
          <ArrowLeft size={14} />
          Retour aux programmes
        </Link>
      </div>
    );
  }

  return (
    // key contrôlée par la page : ne change qu'au remplacement explicite du
    // snapshot (sauvegarde réussie via builderRevision) ou au changement de
    // programId. Le builder se réinitialise alors depuis le snapshot frais.
    <ProgramBuilderFullscreen
      key={`${activeProgram.id}:${builderRevision}`}
      program={activeProgram}
      library={library}
      onSave={handleSave}
      templates={sessionTemplates.items}
      onSaveAsTemplate={handleSaveAsTemplate}
    />
  );
}
