"use client";

import { useId, useState } from "react";
import { Search } from "lucide-react";

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
            className="w-full rounded-control border border-border bg-surface-soft py-2 pl-8 pr-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="rounded-control border border-border bg-surface-soft px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
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
          <button
            type="button"
            onClick={selectAllResults}
            className="rounded-control text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Tout sélectionner les résultats
          </button>
          <button
            type="button"
            onClick={deselectAll}
            className="rounded-control text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Tout désélectionner
          </button>
        </div>
      </div>

      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-panel border border-border p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève trouvé.</p>
        ) : (
          filtered.map((student) => (
            <StudentPickerRow
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

/**
 * Ligne d'élève sélectionnable : le `<label>` lui-même est la cible cliquable
 * (min 44 px de haut, toute la largeur), tandis que la case native reste à
 * 16 px (non agrandie, comme demandé). Le clic sur n'importe quelle partie de
 * la ligne (case ou nom) coche/décoche ; le focus clavier de la case affiche
 * un anneau visible sur toute la ligne (`focus-within`). Composant local à
 * StudentPickerList — n'affecte pas le `CheckboxField` partagé (utilisé par le
 * builder, intouchable).
 */
function StudentPickerRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-soft/60 focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/40"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 flex-shrink-0 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}
