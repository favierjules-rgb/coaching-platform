"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Library, PlayCircle } from "lucide-react";

import { ExerciseLibraryItemModal } from "@/components/admin/ExerciseLibraryItemModal";
import { SearchInput } from "@/components/admin/SearchAndFilters";
import {
  exerciseCategoryLabels,
  exerciseEquipmentLabels,
  exerciseLevelLabels,
  matchesExerciseSearch,
} from "@/lib/admin";
import { muscleGroupLabels } from "@/lib/training-metrics";
import type { ExerciseLibraryItem, MuscleGroup } from "@/types";

interface ExerciseLibraryManagerProps {
  items: ExerciseLibraryItem[];
  onCreate: (data: Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">) => void;
  onUpdate: (id: string, partial: Partial<ExerciseLibraryItem>) => void;
  onSetStatus: (id: string, status: "active" | "archived") => void;
}

function muscleLabel(group: MuscleGroup): string {
  return muscleGroupLabels[group] ?? group;
}

export function ExerciseLibraryManager({ items, onCreate, onUpdate, onSetStatus }: ExerciseLibraryManagerProps) {
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
            <div
              key={item.id}
              className={`flex flex-col gap-3 border bg-card p-5 ${item.status === "archived" ? "border-border opacity-60" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-heading text-base font-bold uppercase text-foreground">{item.name}</h3>
                  <p className="text-xs text-muted-foreground">{muscleLabel(item.muscleGroup)}</p>
                </div>
                {item.status === "archived" && (
                  <span className="flex-shrink-0 border border-red-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-400">
                    Archivée
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="border border-border px-2 py-0.5">{exerciseCategoryLabels[item.category]}</span>
                <span className="border border-border px-2 py-0.5">{exerciseEquipmentLabels[item.equipment]}</span>
                <span className="border border-border px-2 py-0.5">{exerciseLevelLabels[item.level]}</span>
              </div>
              {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
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
                {(item.videoUrl.trim() || item.alternativeVideoUrl.trim()) && (
                  <a
                    href={item.videoUrl.trim() || item.alternativeVideoUrl.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <PlayCircle size={12} />
                    Voir la démo
                  </a>
                )}
                <ExerciseLibraryItemModal item={item} onSave={(data) => onUpdate(item.id, data)} />
                {item.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => onSetStatus(item.id, "archived")}
                    className="flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <Archive size={12} />
                    Archiver
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetStatus(item.id, "active")}
                    className="flex items-center gap-1.5 border border-primary/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/10"
                  >
                    <ArchiveRestore size={12} />
                    Réactiver
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
