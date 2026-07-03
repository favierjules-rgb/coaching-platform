"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Archive, Pencil } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { ProgramBuilder, type ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { contentStatusLabels, fullName, weekDays } from "@/lib/admin";

export default function ProgramDetailPage() {
  const params = useParams<{ programId: string }>();
  const { state, updateProgram, setAssignment } = useAdminData();
  const [editing, setEditing] = useState(false);

  const program = state.programs.find((p) => p.id === params.programId);

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
  const assignedStudents = state.students.filter((s) => program.assignedStudentIds.includes(s.id));

  function handleSave(data: ProgramBuilderData) {
    updateProgram(program!.id, {
      ...data,
      sessions: data.sessions.map((s) => ({ ...s, programId: program!.id })),
    });
    setEditing(false);
  }

  return (
    <div>
      <Link href="/admin/programmes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Programmes
      </Link>

      {editing ? (
        <>
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              Modifier — {program.name}
            </h1>
          </div>
          <ProgramBuilder
            initial={{
              name: program.name,
              goal: program.goal,
              level: program.level,
              durationWeeks: program.durationWeeks,
              description: program.description,
              status: program.status,
              sessions: program.sessions,
            }}
            library={state.exerciseLibrary}
            onSave={handleSave}
            saveLabel="Enregistrer les modifications"
          />
        </>
      ) : (
        <>
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
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
              >
                <Pencil size={13} />
                Modifier
              </button>
              <AssignStudentsModal
                contentLabel={program.name}
                contentType="programme"
                contentId={program.id}
                students={state.students}
                assignedStudentIds={program.assignedStudentIds}
                onSetAssignment={setAssignment}
                triggerLabel="Assigner à des élèves"
              />
              <button
                type="button"
                onClick={() => updateProgram(program.id, { status: "archivé" })}
                className="flex items-center gap-1.5 border border-red-500/50 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
              >
                <Archive size={13} />
                Archiver
              </button>
            </div>
          </div>

          <div className="mb-6 border border-border bg-card p-6">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Résumé</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">Niveau</span>
                <span className="text-sm text-foreground">{program.level}</span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">Durée</span>
                <span className="text-sm text-foreground">{program.durationWeeks} semaines</span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">Séances planifiées</span>
                <span className="text-sm text-foreground">{program.sessions.filter((s) => !s.isRestDay).length}</span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">Élèves assignés</span>
                <span className="text-sm text-foreground">{assignedStudents.length}</span>
              </div>
            </div>
            {program.description && <p className="mt-4 text-sm text-muted-foreground">{program.description}</p>}
          </div>

          <div className="mb-6 border border-border bg-card p-6">
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
                            className={`border p-3 text-xs ${
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

          <div className="mb-6 border border-border bg-card p-6">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Liste des séances et exercices
            </h2>
            <div className="flex flex-col gap-4">
              {program.sessions
                .filter((s) => !s.isRestDay)
                .map((session) => (
                  <div key={session.id} className="border border-border p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-foreground">
                        S{session.weekNumber} · {session.day} — {session.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{session.durationMinutes} min</span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {session.exercises.map((ex) => (
                        <li key={ex.id} className="text-sm text-muted-foreground">
                          {ex.order}. {ex.name || "(sans nom)"} — {ex.sets} x {ex.reps}
                          {ex.recommendedLoad && ` · ${ex.recommendedLoad}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>

          <div className="border border-border bg-card p-6">
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
                    className="border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary"
                  >
                    {fullName(s)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
