"use client";

import { useState } from "react";
import { Library, Trash2 } from "lucide-react";

import { ExerciseLibraryItemModal } from "@/components/admin/ExerciseLibraryItemModal";
import { SearchInput } from "@/components/admin/SearchAndFilters";
import {
  exerciseCategoryLabels,
  exerciseEquipmentLabels,
  exerciseLevelLabels,
  matchesExerciseSearch,
} from "@/lib/admin";
import type { ExerciseLibraryItem } from "@/types";

interface ExerciseLibraryManagerProps {
  items: ExerciseLibraryItem[];
  onCreate: (data: Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">) => void;
  onUpdate: (id: string, partial: Partial<ExerciseLibraryItem>) => void;
  onDelete: (id: string) => void;
}

export function ExerciseLibraryManager({ items, onCreate, onUpdate, onDelete }: ExerciseLibraryManagerProps) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) => matchesExerciseSearch(item, query));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher par nom, muscle, matériel, tag..." />
        <ExerciseLibraryItemModal onSave={onCreate} />
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Library size={16} />
          Aucun exercice ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 border border-border bg-card p-5">
              <div>
                <h3 className="font-heading text-base font-bold uppercase text-foreground">{item.name}</h3>
                <p className="text-xs text-muted-foreground">{item.muscleGroup}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="border border-border px-2 py-0.5">{exerciseCategoryLabels[item.category]}</span>
                <span className="border border-border px-2 py-0.5">{exerciseEquipmentLabels[item.equipment]}</span>
                <span className="border border-border px-2 py-0.5">{exerciseLevelLabels[item.level]}</span>
              </div>
              {item.technicalNote && <p className="text-xs text-muted-foreground">{item.technicalNote}</p>}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span key={tag} className="border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-2">
                <ExerciseLibraryItemModal item={item} onSave={(data) => onUpdate(item.id, data)} />
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={12} />
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
