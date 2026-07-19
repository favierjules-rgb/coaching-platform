"use client";

import { useState } from "react";
import { Copy, Dumbbell, Layers, Trash2 } from "lucide-react";

import { SessionTemplateEditModal } from "@/components/admin/SessionTemplateEditModal";
import { SearchInput } from "@/components/admin/SearchAndFilters";
import type { SessionTemplate, SessionType } from "@/types";

export const sessionTypeLabels: Record<SessionType, string> = {
  strength: "Musculation",
  cardio: "Cardio",
  mixed: "Mixte",
};

interface SessionTemplateLibraryManagerProps {
  templates: SessionTemplate[];
  onUpdate: (
    id: string,
    partial: { name: string; description: string; sessionType: SessionType; muscleGroup: string; durationMinutes: number | null },
  ) => void | Promise<void>;
  onDuplicate: (template: SessionTemplate) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

/**
 * Banque de séances dédiée (/admin/seances) — même principe visuel que
 * ExerciseLibraryManager (composants/admin/ExerciseLibraryManager.tsx),
 * mais pour des modèles de séance complets (`session_templates`, V3
 * chantier module Programmation, étape 3). L'authoring du contenu
 * (exercices/cardio) reste dans le builder : cette page gère les
 * métadonnées, la duplication et la suppression des modèles déjà créés.
 */
export function SessionTemplateLibraryManager({ templates, onUpdate, onDuplicate, onDelete }: SessionTemplateLibraryManagerProps) {
  const [query, setQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? templates.filter((t) => `${t.name} ${t.description} ${t.muscleGroup}`.toLowerCase().includes(q))
    : templates;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher par nom, description, muscle..." />
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers size={16} />
          Aucun modèle ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => {
            const exerciseCount = template.content.exercises.length;
            const cardioCount = template.content.cardioBlocks.length;
            return (
              <div key={template.id} className="flex flex-col gap-3 border border-border bg-card p-5">
                <div>
                  <h3 className="font-heading text-base font-bold uppercase text-foreground">{template.name}</h3>
                  {template.muscleGroup && <p className="text-xs text-muted-foreground">{template.muscleGroup}</p>}
                </div>

                <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="border border-border px-2 py-0.5">{sessionTypeLabels[template.sessionType]}</span>
                  {template.durationMinutes ? <span className="border border-border px-2 py-0.5">{template.durationMinutes} min</span> : null}
                  {template.sessionType !== "cardio" && (
                    <span className="border border-border px-2 py-0.5">
                      {exerciseCount} exercice{exerciseCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {template.sessionType !== "strength" && (
                    <span className="border border-border px-2 py-0.5">
                      {cardioCount} bloc{cardioCount > 1 ? "s" : ""} cardio
                    </span>
                  )}
                </div>

                {template.description && <p className="text-xs text-muted-foreground">{template.description}</p>}

                <div className="mt-1 flex flex-wrap gap-2">
                  <SessionTemplateEditModal template={template} onSave={(partial) => onUpdate(template.id, partial)} />
                  <button
                    type="button"
                    onClick={() => onDuplicate(template)}
                    className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Copy size={12} />
                    Dupliquer
                  </button>
                  {pendingDeleteId === template.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(template.id);
                        setPendingDeleteId(null);
                      }}
                      className="flex items-center gap-1.5 border border-red-500 bg-red-500/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400"
                    >
                      <Trash2 size={12} />
                      Confirmer la suppression
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(template.id)}
                      className="flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {templates.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Dumbbell size={14} />
          Aucun modèle enregistré pour l&apos;instant — construis une séance dans un programme puis « Enregistrer comme
          modèle » pour l&apos;ajouter à la banque.
        </p>
      )}
    </div>
  );
}
