"use client";

import { Layers } from "lucide-react";

import { SessionTemplateLibraryManager } from "@/components/admin/SessionTemplateLibraryManager";
import { useSupabaseSessionTemplates } from "@/hooks/useSupabaseSessionTemplates";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deleteSessionTemplate, duplicateSessionTemplate, updateSessionTemplateMeta } from "@/lib/supabase/session-templates";
import type { SessionTemplate, SessionType } from "@/types";

/**
 * Banque de séances dédiée (V3 chantier module Programmation, étape 3) —
 * pendant de /admin/exercices pour les modèles de séance complets
 * (`session_templates`). L'authoring du contenu (exercices, blocs cardio)
 * reste dans le builder ("Enregistrer comme modèle") ; cette page gère la
 * banque déjà constituée : recherche, métadonnées, duplication, suppression.
 */
export default function AdminSeancesPage() {
  const { loading, items, refetch } = useSupabaseSessionTemplates();

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

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers size={16} />
          Chargement…
        </p>
      ) : (
        <SessionTemplateLibraryManager templates={items} onUpdate={handleUpdate} onDuplicate={handleDuplicate} onDelete={handleDelete} />
      )}
    </div>
  );
}
