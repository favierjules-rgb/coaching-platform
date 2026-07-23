"use client";

import { useState } from "react";
import { Copy, Layers, Save } from "lucide-react";

import { Field, TextareaField } from "@/components/admin/AdminFormFields";
import { BannerUploadField } from "@/components/admin/BannerUploadField";
import { SessionTemplatePicker } from "@/components/admin/SessionTemplatePicker";
import { SessionBlockList } from "@/components/admin/blocks/SessionBlockList";
import { SessionBlockAnalysis } from "@/components/admin/blocks/SessionBlockAnalysis";
import { blockCategoryLabel } from "@/components/admin/blocks/block-view-model";
import { deriveBuilderSessionState, regenerateBlockIdsForDuplication, type BuilderWorkoutSession } from "@/lib/training-block-editing";
import type { ExerciseLibraryItem, SessionTemplate } from "@/types";

/**
 * Panneau d'édition d'une séance dans le builder canonique (Lot 4). Conserve
 * les champs GÉNÉRAUX + la banque de séances (modèles CANONIQUES, dernière
 * passe Lot 4) et remplace la zone exercices/cardio + le sélecteur `sessionType`
 * par `SessionBlockList` + l'analyse. Le type global est un ÉTAT DÉRIVÉ (badge).
 *
 * L'état réel de la séance est `session.blocks[]` : ce panneau ne lit ni n'écrit
 * `session.exercises` / `session.cardioBlocks`. L'application d'un modèle
 * régénère tous les ids (`new-block:` / `new-exercise:`).
 */
export function SessionBlockPanel({
  session,
  library,
  onChange,
  onDuplicate,
  canDuplicate,
  templates,
  onSaveAsTemplate,
}: {
  session: BuilderWorkoutSession;
  library: ExerciseLibraryItem[];
  onChange: (next: BuilderWorkoutSession) => void;
  onDuplicate: () => void;
  canDuplicate: boolean;
  templates?: SessionTemplate[];
  onSaveAsTemplate?: (session: BuilderWorkoutSession, name: string, description: string) => Promise<boolean>;
}) {
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showSaveTemplateForm, setShowSaveTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const derived = deriveBuilderSessionState(session);
  const typeLabel =
    derived.type === "rest"
      ? "Repos"
      : derived.type === "mixed"
        ? "Mixte"
        : blockCategoryLabel(derived.type === "cardio" ? "cardio" : "strength");

  function applyTemplate(template: SessionTemplate) {
    // Application CANONIQUE : nouveaux ids temporaires stricts pour chaque bloc
    // et exercice, ordre / couleurs / prescriptions conservés, source inchangée.
    const blocks = regenerateBlockIdsForDuplication(template.blocks);
    onChange({
      ...session,
      blocks,
      isRestDay: blocks.length === 0,
      name: session.name.trim() ? session.name : template.name,
      muscleGroup: template.muscleGroup || session.muscleGroup,
      durationMinutes: template.durationMinutes ?? session.durationMinutes,
      warmup: template.content.warmup,
      coachNotes: template.content.coachNotes,
    });
    setShowTemplatePicker(false);
  }

  async function saveAsTemplate() {
    if (!onSaveAsTemplate || !templateName.trim()) return;
    setSavingTemplate(true);
    const ok = await onSaveAsTemplate(session, templateName.trim(), templateDescription.trim());
    setSavingTemplate(false);
    if (ok) {
      setTemplateName("");
      setTemplateDescription("");
      setShowSaveTemplateForm(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">{session.day}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {typeLabel}
          </span>
        </div>
        {canDuplicate && (
          <button
            type="button"
            onClick={onDuplicate}
            title="Dupliquer sur la semaine suivante"
            className="inline-flex min-h-11 items-center gap-1 px-1 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors duration-150 ease-out hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Copy size={12} />
            Dupliquer
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4">
        <BannerUploadField
          label="Photo bannière de la séance"
          kind="sessions"
          entityId={session.id}
          value={session.bannerUrl}
          onChange={(bannerUrl) => onChange({ ...session, bannerUrl })}
        />
        <Field label="Nom de la séance" value={session.name} onChange={(v) => onChange({ ...session, name: v })} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Groupe musculaire" value={session.muscleGroup} onChange={(v) => onChange({ ...session, muscleGroup: v })} />
          <Field
            label="Durée (min)"
            type="number"
            value={String(session.durationMinutes)}
            onChange={(v) => onChange({ ...session, durationMinutes: Number(v) || 0 })}
          />
        </div>
        <TextareaField label="Échauffement" value={session.warmup} onChange={(v) => onChange({ ...session, warmup: v })} rows={2} />
        <TextareaField label="Notes coach" value={session.coachNotes} onChange={(v) => onChange({ ...session, coachNotes: v })} rows={2} />

        {(templates || onSaveAsTemplate) && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-4">
              {templates && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplatePicker((v) => !v);
                    setShowSaveTemplateForm(false);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors duration-150 ease-out hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Layers size={12} />
                  Utiliser un modèle
                </button>
              )}
              {onSaveAsTemplate && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSaveTemplateForm((v) => !v);
                    setShowTemplatePicker(false);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors duration-150 ease-out hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Save size={12} />
                  Enregistrer comme modèle
                </button>
              )}
            </div>

            {showTemplatePicker && templates && <SessionTemplatePicker templates={templates} onPick={applyTemplate} />}

            {showSaveTemplateForm && onSaveAsTemplate && (
              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3">
                <Field label="Nom du modèle" value={templateName} onChange={setTemplateName} placeholder="Ex : Haut du corps - Force" />
                <Field label="Description (optionnel)" value={templateDescription} onChange={setTemplateDescription} />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={saveAsTemplate}
                    disabled={savingTemplate || !templateName.trim()}
                    className="inline-flex min-h-11 items-center border border-primary bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savingTemplate ? "Enregistrement..." : "Enregistrer"}
                  </button>
                  <button type="button" onClick={() => setShowSaveTemplateForm(false)} className="min-h-11 text-xs text-muted-foreground hover:text-foreground">
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-border pt-4">
          <SessionBlockList session={session} library={library} onSessionChange={onChange} />
        </div>

        <SessionBlockAnalysis session={session} />
      </div>
    </div>
  );
}
