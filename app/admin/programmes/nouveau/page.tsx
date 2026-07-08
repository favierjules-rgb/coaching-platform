"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { ProgramBuilder, type ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createProgram as createProgramSupabase } from "@/lib/supabase/programs";

export default function NewProgramPage() {
  const router = useRouter();
  const { state, createProgram, setAssignment } = useAdminData();
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Priorité Supabase dès qu'au moins un programme/élève réel existe — même
  // pattern que /admin/programmes. Un nouveau programme est créé en réel dès
  // que Supabase est configuré (jamais seulement en mock quand disponible),
  // pour que "Créer programme" produise directement un programme utilisable
  // par un élève réel.
  const supabasePrograms = useSupabasePrograms();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students.length > 0 ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { programme: supabasePrograms.programs.length > 0 && supabaseStudents.students.length > 0 },
    setAssignment,
    supabasePrograms.refetch,
  );

  async function handleSave(data: ProgramBuilderData) {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      const id = await createProgramSupabase(supabase, data);
      if (id) {
        await supabasePrograms.refetch();
        setCreatedId(id);
        return;
      }
    }
    const id = createProgram({
      ...data,
      assignedStudentIds: [],
      sessions: data.sessions.map((s) => ({ ...s, programId: "" })),
    });
    setCreatedId(id);
  }

  const programs = supabasePrograms.programs.length > 0 ? supabasePrograms.programs : state.programs;
  const createdProgram = createdId ? programs.find((p) => p.id === createdId) : null;

  return (
    <div>
      <Link href="/admin/programmes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Programmes
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Créer un programme
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Construis la structure semaine par semaine, séance par séance, exercice par exercice.
        </p>
      </div>

      {createdProgram ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            <CheckCircle size={18} className="flex-shrink-0" />
            Programme &quot;{createdProgram.name}&quot; enregistré.
          </div>
          <div className="flex flex-wrap gap-3">
            <AssignStudentsModal
              contentLabel={createdProgram.name}
              contentType="programme"
              contentId={createdProgram.id}
              students={students}
              assignedStudentIds={createdProgram.assignedStudentIds}
              onSetAssignment={handleSetAssignment}
              triggerLabel="Assigner à des élèves"
              triggerVariant="primary"
            />
            <button
              type="button"
              onClick={() => router.push(`/admin/programmes/${createdProgram.id}`)}
              className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Voir le programme
            </button>
          </div>
        </div>
      ) : (
        <ProgramBuilder
          initial={{
            name: "",
            goal: "",
            level: "Intermédiaire",
            durationWeeks: 4,
            description: "",
            status: "brouillon",
            sessions: [],
          }}
          library={state.exerciseLibrary}
          onSave={handleSave}
          saveLabel="Enregistrer le programme"
        />
      )}
    </div>
  );
}
