"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Users } from "lucide-react";

import { AssignContentToStudentModal } from "@/components/admin/AssignContentToStudentModal";
import { CreateStudentModal } from "@/components/admin/CreateStudentModal";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, studentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { formatDate, fullName, matchesStudentSearch, studentStatusLabels, weightProgressLabel } from "@/lib/admin";
import { paymentSummaryLabel } from "@/lib/payments";
import type { StudentAccountStatus } from "@/types";

type StatusFilter = "tous" | StudentAccountStatus;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "actif", label: "Actif" },
  { value: "pause", label: "En pause" },
  { value: "terminé", label: "Terminé" },
];

export default function AdminStudentsPage() {
  const { state, createStudent, setAssignment } = useAdminData();
  const { programs, nutritionPlans, documents } = state;

  // Supabase a la priorité dès qu'il a au moins un élève réel ; sinon on
  // retombe sur la liste mock (localStorage), sans jamais rien casser tant
  // que Supabase n'est pas configuré ou n'a encore aucune donnée — voir
  // hooks/useSupabaseStudents.ts. Programmes/plans/documents restent mock
  // dans tous les cas (non migrés à cette étape).
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students.length > 0 ? supabaseStudents.students : state.students;

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [goalFilter, setGoalFilter] = useState("tous");

  const goals = useMemo(() => {
    const unique = new Set(students.map((s) => s.goal));
    return ["tous", ...Array.from(unique)];
  }, [students]);

  const filtered = students.filter(
    (s) =>
      matchesStudentSearch(s, query) &&
      (statusFilter === "tous" || s.status === statusFilter) &&
      (goalFilter === "tous" || s.goal === goalFilter),
  );

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Élèves
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{students.length} élèves au total.</p>
        </div>
        <CreateStudentModal onCreate={createStudent} />
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher par nom ou email..." />
        <div className="flex flex-wrap items-center gap-4">
          <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
          <select
            value={goalFilter}
            onChange={(e) => setGoalFilter(e.target.value)}
            className="border border-border bg-background px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground"
          >
            {goals.map((g) => (
              <option key={g} value={g}>
                {g === "tous" ? "Tous les objectifs" : g}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users size={16} />
          Aucun élève ne correspond à ta recherche.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((student) => {
            const program = programs.find((p) => student.assignedProgramIds.includes(p.id));
            const plan = nutritionPlans.find((p) => student.assignedNutritionPlanIds.includes(p.id));
            return (
              <div
                key={student.id}
                className="flex flex-col gap-4 border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Élève</span>
                    <span className="font-heading text-lg font-bold text-foreground">{fullName(student)}</span>
                    <span className="block text-xs text-muted-foreground">{student.email}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Objectif</span>
                    <span className="text-sm text-foreground">{student.goal}</span>
                    <span className="mt-1 block">
                      <StatusBadge label={studentStatusLabels[student.status]} tone={studentStatusTone(student.status)} />
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Programme / plan</span>
                    <span className="block text-sm text-foreground">{program?.name ?? "Aucun programme"}</span>
                    <span className="block text-sm text-muted-foreground">{plan?.name ?? "Aucun plan"}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Poids · Début</span>
                    <span className="block text-sm text-foreground">{weightProgressLabel(student)}</span>
                    <span className="block text-xs text-muted-foreground">Depuis le {formatDate(student.startDate)}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Paiement</span>
                    <span className="block text-sm text-foreground">{paymentSummaryLabel(student.paymentProfile)}</span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/eleves/${student.id}`}
                    className="flex items-center gap-1.5 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <Eye size={13} />
                    Voir profil
                  </Link>
                  <AssignContentToStudentModal
                    student={student}
                    programs={programs}
                    nutritionPlans={nutritionPlans}
                    documents={documents}
                    onSetAssignment={setAssignment}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
