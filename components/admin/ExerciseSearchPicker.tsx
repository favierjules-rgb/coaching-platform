"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";

import { exerciseCategoryLabels, matchesExerciseSearch } from "@/lib/admin";
import type { ExerciseLibraryItem } from "@/types";

export function ExerciseSearchPicker({
  library,
  onPick,
}: {
  library: ExerciseLibraryItem[];
  onPick: (item: ExerciseLibraryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const results = query.trim() ? library.filter((item) => matchesExerciseSearch(item, query)).slice(0, 6) : [];

  return (
    <div className="relative border border-dashed border-border p-3">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher dans la banque d'exercices (nom, muscle, matériel, tag)..."
          className="w-full border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
        />
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
                  {item.muscleGroup} · {exerciseCategoryLabels[item.category]}
                </span>
              </span>
              <Plus size={13} className="flex-shrink-0 text-primary" />
            </button>
          ))}
        </div>
      )}
      {query.trim() && results.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Aucun exercice trouvé dans la banque.</p>
      )}
    </div>
  );
}
