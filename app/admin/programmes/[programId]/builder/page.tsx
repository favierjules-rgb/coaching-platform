"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProgramBuilderFullscreen, type BuilderData } from "@/components/admin/ProgramBuilderFullscreen";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseExerciseLibrary } from "@/hooks/useSupabaseExerciseLibrary";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateProgram as updateProgramSupabase } from "@/lib/supabase/programs";

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
  const program = programs.find((p) => p.id === params.programId);

  const supabaseExerciseLibrary = useSupabaseExerciseLibrary();
  const library = supabaseExerciseLibrary.items.length > 0 ? supabaseExerciseLibrary.items : state.exerciseLibrary;

  async function handleSave(data: BuilderData): Promise<boolean> {
    if (!program) return false;
    if (isSupabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const ok = await updateProgramSupabase(supabase, program.id, data);
        await supabasePrograms.refetch();
        return ok;
      }
    }
    return true;
  }

  if (supabasePrograms.loading && !isSupabaseActive) {
    return <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Chargement…</div>;
  }

  if (!program) {
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

  return <ProgramBuilderFullscreen program={program} library={library} onSave={handleSave} />;
}
