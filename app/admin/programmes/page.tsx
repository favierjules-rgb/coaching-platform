"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Dumbbell, Plus } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { ExerciseLibraryManager } from "@/components/admin/ExerciseLibraryManager";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useProgramAssignment } from "@/hooks/useProgramAssignment";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, matchesTextSearch, totalSessions, totalWeeks } from "@/lib/admin";
import type { AdminContentStatus } from "@/types";

type StatusFilter = "tous" | AdminContentStatus;
type Tab = "programmes" | "banque";

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

export default function AdminProgramsPage() {
  const { state, setAssignment, createLibraryExercise, updateLibraryExercise, deleteLibraryExercise } = useAdminData();
  const { exerciseLibrary } = state;

  // Priorité Supabase dès qu'au moins un programme/élève réel existe, sinon
  // repli sur les listes mock — même pattern que /admin/eleves. Les deux
  // priorités sont indépendantes (un coach peut avoir des élèves réels sans
  // avoir encore créé de programme réel, ou l'inverse) ; l'assignation
  // réelle (table `assignments`) n'est activée que si les deux le sont.
  const supabasePrograms = useSupabasePrograms();
  const programs = supabasePrograms.programs.length > 0 ? supabasePrograms.programs : state.programs;
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students.length > 0 ? supabaseStudents.students : state.students;
  const handleSetAssignment = useProgramAssignment(
    supabasePrograms.programs.length > 0 && supabaseStudents.students.length > 0,
    setAssignment,
    supabasePrograms.refetch,
  );

  const [tab, setTab] = useState<Tab>("programmes");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [levelFilter, setLevelFilter] = useState("tous");

  const levels = useMemo(() => ["tous", ...Array.from(new Set(programs.map((p) => p.level)))], [programs]);

  const filtered = programs.filter(
    (p) =>
      matchesTextSearch([p.name, p.goal], query) &&
      (statusFilter === "tous" || p.status === statusFilter) &&
      (levelFilter === "tous" || p.level === levelFilter),
  );

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Programmes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "programmes" ? `${programs.length} programmes créés.` : `${exerciseLibrary.length} exercices dans la banque.`}
          </p>
        </div>
        {tab === "programmes" && (
          <Link
            href="/admin/programmes/nouveau"
            className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
          >
            <Plus size={14} />
            Créer programme
          </Link>
        )}
      </div>

      <div className="mb-6 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("programmes")}
          className={`border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === "programmes" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Programmes
        </button>
        <button
          type="button"
          onClick={() => setTab("banque")}
          className={`border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === "banque" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Banque d&apos;exercices
        </button>
      </div>

      {tab === "banque" ? (
        <ExerciseLibraryManager
          items={exerciseLibrary}
          onCreate={createLibraryExercise}
          onUpdate={updateLibraryExercise}
          onDelete={deleteLibraryExercise}
        />
      ) : (
        <>
      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un programme..." />
        <div className="flex flex-wrap items-center gap-4">
          <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="border border-border bg-background px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground"
          >
            {levels.map((l) => (
              <option key={l} value={l}>
                {l === "tous" ? "Tous les niveaux" : l}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Dumbbell size={16} />
          Aucun programme ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {filtered.map((program) => (
            <div key={program.id} className="flex flex-col gap-4 border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold uppercase text-foreground">{program.name}</h2>
                  <p className="text-sm text-muted-foreground">{program.goal}</p>
                </div>
                <StatusBadge label={contentStatusLabels[program.status]} tone={contentStatusTone(program.status)} />
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm text-foreground">
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Niveau</span>
                  {program.level}
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Durée</span>
                  {program.durationWeeks} sem.
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Séances</span>
                  {totalSessions(program)} ({totalWeeks(program)} sem. planifiées)
                </div>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                  Élèves assignés ({program.assignedStudentIds.length})
                </span>
                <span className="text-sm text-muted-foreground">
                  {program.assignedStudentIds.length === 0
                    ? "Aucun"
                    : students
                        .filter((s) => program.assignedStudentIds.includes(s.id))
                        .map((s) => `${s.firstName} ${s.lastName}`)
                        .join(", ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/admin/programmes/${program.id}`}
                  className="border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  Voir
                </Link>
                <Link
                  href={`/admin/programmes/${program.id}`}
                  className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  Modifier
                </Link>
                <AssignStudentsModal
                  contentLabel={program.name}
                  contentType="programme"
                  contentId={program.id}
                  students={students}
                  assignedStudentIds={program.assignedStudentIds}
                  onSetAssignment={handleSetAssignment}
                />
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
