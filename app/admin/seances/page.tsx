"use client";

import { useMemo, useState } from "react";
import { Layers } from "lucide-react";

import { SessionTemplateLibraryManager, sessionTypeLabels } from "@/components/admin/SessionTemplateLibraryManager";
import { useSupabaseSessionTemplates } from "@/hooks/useSupabaseSessionTemplates";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deleteSessionTemplate, duplicateSessionTemplate, updateSessionTemplateMeta } from "@/lib/supabase/session-templates";
import type { SessionTemplate, SessionType } from "@/types";

type SessionTypeFilter = "tous" | SessionType;

/**
 * Banque de séances dédiée (V3 chantier module Programmation, étape 3) —
 * pendant de /admin/exercices pour les modèles de séance complets
 * (`session_templates`). L'authoring du contenu (exercices, blocs cardio)
 * reste dans le builder ("Enregistrer comme modèle") ; cette page gère la
 * banque déjà constituée : recherche, métadonnées, duplication, suppression.
 *
 * Filtre "type de séance" ajouté ici (audit design juillet 2026, Lot 2) pour
 * la parité visuelle avec /admin/exercices — c'est le seul champ typé
 * (enum) disponible côté séances : `muscleGroup` y est du texte libre
 * (`session_templates.muscle_group: string`, pas un enum comme côté
 * exercices), donc pas de filtre muscle équivalent sans changer le schéma.
 */
export default function AdminSeancesPage() {
  const { loading, items, refetch } = useSupabaseSessionTemplates();
  const [sessionTypeFilter, setSessionTypeFilter] = useState<SessionTypeFilter>("tous");

  const filtered = useMemo(
    () => (sessionTypeFilter === "tous" ? items : items.filter((t) => t.sessionType === sessionTypeFilter)),
    [items, sessionTypeFilter],
  );

  async function handleUpdate(
    id: string,
    partial: { name: string; description: string; sessionType: SessionType; muscleGroup: string; durationMinutes: number | null },
  ) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await updateSessionTemplateMeta(supabase, id, partial);
    await refetch();
  }

  async function handleDuplicate(template: SessionTemplate) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await duplicateSessionTemplate(supabase, template);
    await refetch();
  }

  async function handleDelete(id: string) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await deleteSessionTemplate(supabase, id);
    await refetch();
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Banque de séances</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length} modèle{items.length > 1 ? "s" : ""} de séance réutilisable{items.length > 1 ? "s" : ""}.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <select
          value={sessionTypeFilter}
          onChange={(e) => setSessionTypeFilter(e.target.value as SessionTypeFilter)}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Tous les types</option>
          {Object.entries(sessionTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers size={16} />
          Chargement…
        </p>
      ) : filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers size={16} />
          Aucun modèle ne correspond à ces filtres.
        </p>
      ) : (
        <SessionTemplateLibraryManager templates={filtered} onUpdate={handleUpdate} onDuplicate={handleDuplicate} onDelete={handleDelete} />
      )}
    </div>
  );
}
