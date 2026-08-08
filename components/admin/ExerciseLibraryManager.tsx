"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Library, PlayCircle, Trash2 } from "lucide-react";

import { ExerciseLibraryItemModal } from "@/components/admin/ExerciseLibraryItemModal";
import { SearchInput } from "@/components/admin/SearchAndFilters";
import {
  exerciseCategoryLabels,
  exerciseEquipmentLabels,
  exerciseLevelLabels,
  matchesExerciseSearch,
} from "@/lib/admin";
import { movementPatternLabels } from "@/lib/movement-patterns";
import { muscleGroupLabels } from "@/lib/training-metrics";
import type { ExerciseLibraryItem, MuscleGroup } from "@/types";

interface ExerciseLibraryManagerProps {
  items: ExerciseLibraryItem[];
  onCreate: (data: Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">) => void;
  onUpdate: (id: string, partial: Partial<ExerciseLibraryItem>) => void;
  onSetStatus: (id: string, status: "active" | "archived") => void;
  onDelete: (id: string) => void | Promise<void>;
}

function muscleLabel(group: MuscleGroup): string {
  return muscleGroupLabels[group] ?? group;
}

export function ExerciseLibraryManager({ items, onCreate, onUpdate, onSetStatus, onDelete }: ExerciseLibraryManagerProps) {
  const [query, setQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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
              className={`flex flex-col gap-3 rounded-card border bg-card p-5 shadow-soft transition-colors ${item.status === "archived" ? "border-border opacity-60" : "border-border hover:border-border-strong"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-heading text-base font-bold uppercase text-foreground">{item.name}</h3>
                  <p className="text-xs text-muted-foreground">{muscleLabel(item.muscleGroup)}</p>
                </div>
                {item.status === "archived" && (
                  <span className="flex-shrink-0 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                    Archivée
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="rounded-full border border-border px-2 py-0.5">{exerciseCategoryLabels[item.category]}</span>
                <span className="rounded-full border border-border px-2 py-0.5">{exerciseEquipmentLabels[item.equipment]}</span>
                <span className="rounded-full border border-border px-2 py-0.5">{exerciseLevelLabels[item.level]}</span>
                {/* Le pattern porte une bordure marquée : c'est lui qui
                    décide des remplacements côté élève, pas les autres
                    étiquettes. Absent quand il n'est pas renseigné — aucune
                    mention inutile sur une banque qui n'en a pas encore. */}
                {item.movementPattern && (
                  <span className="rounded-full border border-border-strong px-2 py-0.5 text-foreground">
                    {movementPatternLabels[item.movementPattern]}
                  </span>
                )}
              </div>
              {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
              {item.technicalNote && <p className="text-xs text-muted-foreground">{item.technicalNote}</p>}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
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
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  >
                    <Archive size={12} />
                    Archiver
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetStatus(item.id, "active")}
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <ArchiveRestore size={12} />
                    Réactiver
                  </button>
                )}
                {pendingDeleteId === item.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(item.id);
                      setPendingDeleteId(null);
                    }}
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive bg-destructive/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  >
                    <Trash2 size={12} />
                    Confirmer la suppression
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(item.id)}
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  >
                    <Trash2 size={12} />
                    Supprimer
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
