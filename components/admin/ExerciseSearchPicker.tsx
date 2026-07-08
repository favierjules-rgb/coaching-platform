"use client";

import { useMemo, useState } from "react";
import { PlayCircle, Plus, Search } from "lucide-react";

import { exerciseCategoryLabels, exerciseEquipmentLabels, matchesExerciseSearch } from "@/lib/admin";
import { muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type { ExerciseEquipment, ExerciseLibraryItem, MuscleGroup } from "@/types";

const muscleFilterOptions = [{ value: "tous", label: "Tous les muscles" }, ...muscleGroupOrder.map((g) => ({ value: g, label: muscleGroupLabels[g] }))];

export function ExerciseSearchPicker({
  library,
  onPick,
}: {
  library: ExerciseLibraryItem[];
  onPick: (item: ExerciseLibraryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | "tous">("tous");
  const [equipmentFilter, setEquipmentFilter] = useState<ExerciseEquipment | "tous">("tous");

  // La banque active uniquement : un exercice archivé ne doit jamais pouvoir
  // être ajouté à une nouvelle séance (voir docs/supabase-exercise-library-model.md).
  const activeLibrary = useMemo(() => library.filter((item) => item.status === "active"), [library]);
  const equipmentOptions = useMemo(
    () => Array.from(new Set(activeLibrary.map((item) => item.equipment))).sort(),
    [activeLibrary],
  );

  const results = useMemo(() => {
    const filtered = activeLibrary.filter(
      (item) =>
        (muscleFilter === "tous" || item.muscleGroup === muscleFilter) &&
        (equipmentFilter === "tous" || item.equipment === equipmentFilter) &&
        matchesExerciseSearch(item, query),
    );
    return query.trim() || muscleFilter !== "tous" || equipmentFilter !== "tous" ? filtered.slice(0, 8) : [];
  }, [activeLibrary, query, muscleFilter, equipmentFilter]);

  return (
    <div className="relative border border-dashed border-border p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher dans la banque d'exercices (nom, muscle, matériel, tag)..."
            className="w-full border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>
        <select
          value={muscleFilter}
          onChange={(event) => setMuscleFilter(event.target.value as MuscleGroup | "tous")}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          {muscleFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={equipmentFilter}
          onChange={(event) => setEquipmentFilter(event.target.value as ExerciseEquipment | "tous")}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Tout matériel</option>
          {equipmentOptions.map((equipment) => (
            <option key={equipment} value={equipment}>
              {exerciseEquipmentLabels[equipment]}
            </option>
          ))}
        </select>
      </div>
      {results.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onPick(item);
                setQuery("");
              }}
              className="flex items-center justify-between gap-2 border border-border px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary"
            >
              <span>
                {item.name}
                <span className="ml-2 text-muted-foreground">
                  {muscleGroupLabels[item.muscleGroup] ?? item.muscleGroup} · {exerciseCategoryLabels[item.category]}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                {(item.videoUrl.trim() || item.alternativeVideoUrl.trim()) && (
                  <PlayCircle size={13} className="text-muted-foreground" />
                )}
                <Plus size={13} className="text-primary" />
              </span>
            </button>
          ))}
        </div>
      )}
      {(query.trim() || muscleFilter !== "tous" || equipmentFilter !== "tous") && results.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Aucun exercice trouvé dans la banque.</p>
      )}
    </div>
  );
}
