"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Dumbbell, Plus } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { contentStatusLabels, matchesTextSearch, totalSessions, totalWeeks } from "@/lib/admin";
import type { AdminContentStatus } from "@/types";

type StatusFilter = "tous" | AdminContentStatus;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

export default function AdminProgramsPage() {
  const { state, setAssignment } = useAdminData();
  const { programs, students } = state;

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
          <p className="mt-1 text-sm text-muted-foreground">{programs.length} programmes créés.</p>
        </div>
        <Link
          href="/admin/programmes/nouveau"
          className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
        >
          <Plus size={14} />
          Créer programme
        </Link>
      </div>

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
                  onSetAssignment={setAssignment}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
