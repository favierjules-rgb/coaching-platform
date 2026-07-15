"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ProgramBuilder, type ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseExerciseLibrary } from "@/hooks/useSupabaseExerciseLibrary";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createProgram as createProgramSupabase } from "@/lib/supabase/programs";

/**
 * Creation en un seul flux continu (chantier training-builder-v2, tache #54) :
 * auparavant, apres "Enregistrer le programme", cette page affichait un
 * ecran de confirmation intermediaire (carte de succes) qui obligeait a
 * cliquer sur "Voir le programme" pour continuer -- une rupture percue
 * comme "une autre page qui s'ouvre". On redirige desormais automatiquement
 * vers la page du programme juste cree, qui reutilise le meme ProgramBuilder
 * en mode edition (bouton "Assigner a des eleves" y est deja disponible).
 */
export default function NewProgramPage() {
  const router = useRouter();
  const { state, createProgram } = useAdminData();

  const supabaseExerciseLibrary = useSupabaseExerciseLibrary();
  const exerciseLibrary = supabaseExerciseLibrary.items.length > 0 ? supabaseExerciseLibrary.items : state.exerciseLibrary;

  // Priorite Supabase des qu'au moins un programme reel existe -- meme
  // pattern que /admin/programmes. Un nouveau programme est cree en reel des
  // que Supabase est configure (jamais seulement en mock quand disponible).
  const supabasePrograms = useSupabasePrograms();

  async function handleSave(data: ProgramBuilderData) {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      const id = await createProgramSupabase(supabase, data);
      if (id) {
        await supabasePrograms.refetch();
        router.push(`/admin/programmes/${id}`);
        return;
      }
    }
    const id = createProgram({
      ...data,
      sourceTemplateId: null,
      ownerStudentId: null,
      versionNumber: 1,
      publishedAt: data.publicationStatus === "published" ? new Date().toISOString() : null,
      assignedStudentIds: [],
      sessions: data.sessions.map((s) => ({ ...s, programId: "" })),
    });
    router.push(`/admin/programmes/${id}`);
  }

  return (
    <div>
      <Link href="/admin/programmes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Programmes
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Creer un programme
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Construis la structure semaine par semaine, seance par seance, exercice par exercice.
        </p>
      </div>

      <ProgramBuilder
        initial={{
          name: "",
          goal: "",
          level: "Intermediaire",
          durationWeeks: 4,
          description: "",
          status: "brouillon",
          programType: "group",
          publicationStatus: "draft",
          coverImagePath: null,
          experienceLevel: null,
          expectedDaysPerWeek: null,
          estimatedSessionDurationMinutes: null,
          sessions: [],
        }}
        library={exerciseLibrary}
        onSave={handleSave}
        saveLabel="Enregistrer le programme"
      />
    </div>
  );
}
