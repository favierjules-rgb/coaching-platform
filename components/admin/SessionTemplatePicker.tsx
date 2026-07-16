"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import type { SessionTemplate } from "@/types";

const sessionTypeLabels: Record<string, string> = {
  strength: "Musculation",
  cardio: "Cardio",
  mixed: "Mixte",
};

/**
 * Picker de la banque de séances (`session_templates`), même principe que
 * ExerciseSearchPicker mais pour des séances complètes plutôt que des
 * exercices individuels — voir DayCard, bouton "Utiliser un modèle".
 */
export function SessionTemplatePicker({
  templates,
  onPick,
}: {
  templates: SessionTemplate[];
  onPick: (template: SessionTemplate) => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? templates.filter((t) => `${t.name} ${t.description} ${t.muscleGroup}`.toLowerCase().includes(q))
      : templates;
    return filtered.slice(0, 8);
  }, [templates, query]);

  if (templates.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucun modèle enregistré pour le moment.</p>;
  }

  return (
    <div className="relative border border-dashed border-border p-3">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un modèle de séance..."
          className="w-full border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
        />
      </div>
      {results.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {results.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                onPick(template);
                setQuery("");
              }}
              className="flex items-center justify-between gap-2 border border-border px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary"
            >
              <span>
                {template.name}
                <span className="ml-2 text-muted-foreground">
                  {sessionTypeLabels[template.sessionType] ?? template.sessionType}
                  {template.muscleGroup ? ` · ${template.muscleGroup}` : ""}
                </span>
              </span>
              <Plus size={13} className="flex-shrink-0 text-primary" />
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Aucun modèle trouvé.</p>
      )}
    </div>
  );
}
