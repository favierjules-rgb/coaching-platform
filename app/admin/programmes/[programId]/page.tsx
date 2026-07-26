"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Archive, Pencil } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { SessionBlockChips } from "@/components/student/SessionBlockChips";
import { StatCard } from "@/components/shared/StatCard";
import { orderedAdminSessionBlocks } from "@/lib/admin-program-preview";
import {
  AnalysisFilterLabel,
  FilteredExerciseList,
  MuscleGroupBars,
  MuscleGroupFilterSelect,
  TrainingStatCards,
  UntaggedExercisesAlert,
} from "@/components/shared/TrainingMetricsSummary";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, fullName, weekDays } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateProgramStatus as updateProgramStatusSupabase } from "@/lib/supabase/programs";
import { calculateTrainingMetrics, calculateWeekMetrics, formatSets, formatTonnage, formatVolume, muscleGroupLabels } from "@/lib/training-metrics";
import type { MuscleGroupFilter } from "@/types";

/**
 * Page de détail — reste un aperçu en lecture seule (résumé, analyse,
 * calendrier, élèves assignés). L'édition se fait désormais exclusivement
 * dans le builder plein écran (/admin/programmes/[programId]/builder,
 * voir V3) : "Modifier" y redirige au lieu de basculer un mode d'édition
 * inline ici.
 */
export default function ProgramDetailPage() {
  const params = useParams<{ programId: string }>();
  const { state, updateProgram, setAssignment } = useAdminData();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");

  // Priorité Supabase dès qu'au moins un programme/élève réel existe — même
  // pattern que /admin/programmes. Quand actif, ce programme précis est
  // garanti réel (la liste bascule entièrement, jamais de mélange mock/réel).
  const supabasePrograms = useSupabasePrograms();
  const isSupabaseProgramsActive = supabasePrograms.programs.length > 0;
  const programs = isSupabaseProgramsActive ? supabasePrograms.programs : state.programs;
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students.length > 0 ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { programme: isSupabaseProgramsActive && supabaseStudents.students.length > 0 },
    setAssignment,
    supabasePrograms.refetch,
  );

  const program = programs.find((p) => p.id === params.programId);

  // Évite un flash "Programme introuvable." pendant la requête Supabase
  // initiale (mock encore affiché le temps que la vraie liste arrive, dont
  // les ids ne correspondent jamais à un vrai programme) — même garde que
  // /admin/programmes/[programId]/builder/page.tsx.
  if (supabasePrograms.loading && !isSupabaseProgramsActive) {
    return <div className="text-sm text-muted-foreground">Chargement…</div>;
  }

  if (!program) {
    return (
      <div>
        <Link href="/admin/programmes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} />
          Programmes
        </Link>
        <p className="text-sm text-muted-foreground">Programme introuvable.</p>
      </div>
    );
  }

  const weekNumbers = Array.from(new Set(program.sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);
  const assignedStudents = students.filter((s) => program.assignedStudentIds.includes(s.id));
  const programMetrics = calculateTrainingMetrics(program.sessions, selectedMuscleGroup);
  const weekMetricsList = weekNumbers.map((weekNumber) =>
    calculateWeekMetrics(program.sessions, weekNumber, selectedMuscleGroup),
  );

  async function handleArchive() {
    if (isSupabaseProgramsActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        await updateProgramStatusSupabase(supabase, program!.id, "archivé");
        await supabasePrograms.refetch();
        return;
      }
    }
    updateProgram(program!.id, { status: "archivé" });
  }

  return (
    <div>
      <Link href="/admin/programmes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Programmes
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
                  {program.name}
                </h1>
                <StatusBadge label={contentStatusLabels[program.status]} tone={contentStatusTone(program.status)} />
              </div>
              <p className="text-sm text-muted-foreground">{program.goal}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/programmes/${program.id}/builder`}
                className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Pencil size={13} />
                Modifier
              </Link>
              <AssignStudentsModal
                contentLabel={program.name}
                contentType="programme"
                contentId={program.id}
                students={students}
                assignedStudentIds={program.assignedStudentIds}
                onSetAssignment={handleSetAssignment}
                triggerLabel="Assigner à des élèves"
              />
              <button
                type="button"
                onClick={handleArchive}
                className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/50 px-4 py-2 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
              >
                <Archive size={13} />
                Archiver
              </button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Niveau" value={program.level} size="lg" />
            <StatCard label="Durée" value={`${program.durationWeeks} semaines`} size="lg" />
            <StatCard
              label="Séances planifiées"
              value={String(program.sessions.filter((s) => !s.isRestDay).length)}
              size="lg"
            />
            <StatCard label="Élèves assignés" value={String(assignedStudents.length)} size="lg" />
          </div>
          {program.description && <p className="mb-6 text-sm text-muted-foreground">{program.description}</p>}

          <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Analyse du programme</h2>
            {weekNumbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune séance planifiée pour le moment.</p>
            ) : (
              <div className="flex flex-col gap-6">
                <MuscleGroupFilterSelect value={selectedMuscleGroup} onChange={setSelectedMuscleGroup} />
                <UntaggedExercisesAlert show={programMetrics.hasUntaggedExercises} />
                <AnalysisFilterLabel selected={selectedMuscleGroup} />

                <TrainingStatCards
                  totalSets={programMetrics.totalSets}
                  totalVolume={programMetrics.totalVolume}
                  totalTonnageKg={programMetrics.totalTonnageKg}
                />

                {selectedMuscleGroup === "tous" ? (
                  <div>
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Groupes musculaires les plus sollicités (programme entier)
                    </h3>
                    <MuscleGroupBars breakdown={programMetrics.muscleGroupBreakdown} />
                  </div>
                ) : (
                  <FilteredExerciseList exercises={programMetrics.exercises} />
                )}

                <div>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Comparaison semaine par semaine
                  </h3>
                  <div className="overflow-x-auto">
                    <div className="flex gap-3">
                      {weekMetricsList.map((week) => (
                        <div key={week.weekNumber} className="w-44 flex-shrink-0 rounded-panel border border-border p-4">
                          <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-primary">
                            Semaine {week.weekNumber}
                          </span>
                          <div className="flex flex-col gap-1.5 text-xs text-foreground">
                            <span>{formatSets(week.totalSets)}</span>
                            <span>{formatVolume(week.totalVolume)}</span>
                            <span>{formatTonnage(week.totalTonnageKg)}</span>
                          </div>
                          {week.mostTrainedMuscleGroup && (
                            <span className="mt-2 block rounded-full border border-border px-2 py-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
                              {muscleGroupLabels[week.mostTrainedMuscleGroup]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Calendrier semaine par semaine
            </h2>
            {weekNumbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune séance planifiée.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {weekNumbers.map((weekNumber) => (
                  <div key={weekNumber}>
                    <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">
                      Semaine {weekNumber}
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                      {weekDays.map((day) => {
                        const session = program.sessions.find(
                          (s) => s.weekNumber === weekNumber && s.day === day,
                        );
                        return (
                          <div
                            key={day}
                            className={`rounded-panel border p-3 text-xs ${
                              session && !session.isRestDay ? "border-primary/40 bg-primary/5" : "border-border"
                            }`}
                          >
                            <span className="block uppercase tracking-wide text-muted-foreground">{day}</span>
                            <span className="mt-1 block text-foreground">
                              {session && !session.isRestDay ? session.name : "Repos"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Liste des séances et blocs
            </h2>
            <div className="flex flex-col gap-4">
              {program.sessions
                .filter((s) => !s.isRestDay)
                .map((session) => {
                  // Source d'affichage = `blocks[]` (déjà composé, ordonné et
                  // coloré par lib/supabase/programs.ts), avec repli legacy UNE
                  // fois à la frontière — toute la logique vit dans le helper pur
                  // testé `orderedAdminSessionBlocks` (jamais de rendu direct
                  // depuis exercises[]/cardioBlocks[]). SessionBlockChips ne
                  // reçoit QUE des TrainingBlock ordonnés.
                  const orderedBlocks = orderedAdminSessionBlocks(session);
                  return (
                    <div key={session.id} className="rounded-panel border border-border p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-foreground">
                          S{session.weekNumber} · {session.day} — {session.name}
                        </span>
                        <span className="text-xs text-muted-foreground">{session.durationMinutes} min</span>
                      </div>
                      {orderedBlocks.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Séance sans bloc pour le moment.</p>
                      ) : (
                        <SessionBlockChips blocks={orderedBlocks} max={orderedBlocks.length} />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="rounded-card border border-border bg-card p-6 shadow-soft">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Élèves assignés
            </h2>
            {assignedStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun élève assigné.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignedStudents.map((s) => (
                  <Link
                    key={s.id}
                    href={`/admin/eleves/${s.id}`}
                    className="pressable flex min-h-[44px] items-center rounded-control border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {fullName(s)}
                  </Link>
                ))}
              </div>
            )}
          </div>
    </div>
  );
}
