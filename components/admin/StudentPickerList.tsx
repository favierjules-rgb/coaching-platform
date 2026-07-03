"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { CheckboxField } from "@/components/admin/AdminFormFields";
import { fullName, matchesStudentSearch } from "@/lib/admin";
import type { AdminStudent, StudentAccountStatus } from "@/types";

type StatusFilter = "tous" | StudentAccountStatus;

const statusFilterOptions: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous les statuts" },
  { value: "actif", label: "Actifs" },
  { value: "pause", label: "En pause" },
  { value: "terminé", label: "Terminés" },
];

interface StudentPickerListProps {
  students: AdminStudent[];
  selectedIds: string[];
  onToggle: (studentId: string, checked: boolean) => void;
}

/**
 * Liste d'élèves à cocher avec recherche (prénom/nom/email) et filtre par
 * statut — réutilisée dans toutes les modales d'assignation élèves
 * (programme, plan nutrition, document...). La sélection vit dans les
 * données du parent (assignedStudentIds), donc un élève coché reste coché
 * même s'il disparaît temporairement du filtre.
 */
export function StudentPickerList({ students, selectedIds, onToggle }: StudentPickerListProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");

  const filtered = students.filter(
    (student) => matchesStudentSearch(student, query) && (statusFilter === "tous" || student.status === statusFilter),
  );

  function selectAllResults() {
    filtered.forEach((student) => {
      if (!selectedIds.includes(student.id)) onToggle(student.id, true);
    });
  }

  function deselectAll() {
    selectedIds.forEach((id) => onToggle(id, false));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher par prénom, nom ou email..."
            className="w-full border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="border border-border bg-background px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground"
        >
          {statusFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {selectedIds.length} élève{selectedIds.length > 1 ? "s" : ""} sélectionné{selectedIds.length > 1 ? "s" : ""}
        </span>
        <div className="flex gap-3">
          <button type="button" onClick={selectAllResults} className="text-primary hover:underline">
            Tout sélectionner les résultats
          </button>
          <button type="button" onClick={deselectAll} className="text-muted-foreground hover:text-foreground hover:underline">
            Tout désélectionner
          </button>
        </div>
      </div>

      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto border border-border p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève trouvé.</p>
        ) : (
          filtered.map((student) => (
            <CheckboxField
              key={student.id}
              label={`${fullName(student)} · ${student.email}`}
              checked={selectedIds.includes(student.id)}
              onChange={(checked) => onToggle(student.id, checked)}
            />
          ))
        )}
      </div>
    </div>
  );
}
