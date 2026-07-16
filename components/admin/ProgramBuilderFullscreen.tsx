"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Dumbbell,
  Eye,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
} from "lucide-react";

import { DayCard, restDaySession } from "@/components/admin/ProgramBuilder";
import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { contentStatusLabels, generateId, weekDays } from "@/lib/admin";
import { cloneCardioBlock } from "@/lib/cardio";
import type { AdminContentStatus, AdminProgram, AdminWorkoutSession, ExerciseLibraryItem } from "@/types";

const levelOptions = [
  { value: "Débutant", label: "Débutant" },
  { value: "Intermédiaire", label: "Intermédiaire" },
  { value: "Avancé", label: "Avancé" },
];

const statusOptions: { value: AdminContentStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface BuilderData {
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  description: string;
  status: AdminContentStatus;
  sessions: AdminWorkoutSession[];
}

/**
 * Petit résumé compact d'une séance pour une cellule de la grille 7 jours —
 * volontairement minimal (nom + nombre d'exercices), l'édition complète se
 * fait dans le panneau de droite via DayCard (voir ProgramBuilder.tsx),
 * réutilisé tel quel plutôt que dupliqué.
 */
function DayGridCell({
  session,
  isSelected,
  onSelect,
}: {
  session: AdminWorkoutSession;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-h-[140px] flex-col gap-2 border p-3 text-left transition-colors ${
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{session.day}</span>
      {session.isRestDay ? (
        <span className="text-xs text-muted-foreground">Repos</span>
      ) : (
        <>
          <span className="text-sm font-bold text-foreground">{session.name || "(sans nom)"}</span>
          {(session.sessionType ?? "strength") !== "cardio" && (
            <span className="text-[11px] text-muted-foreground">
              {session.exercises.length} exercice{session.exercises.length > 1 ? "s" : ""}
            </span>
          )}
          {(session.sessionType ?? "strength") !== "strength" && (
            <span className="text-[11px] text-muted-foreground">
              {(session.cardioBlocks ?? []).length} bloc{(session.cardioBlocks ?? []).length > 1 ? "s" : ""} cardio
            </span>
          )}
          {session.exercises.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {session.exercises.slice(0, 3).map((ex) => (
                <li key={ex.id} className="truncate text-[11px] text-muted-foreground">
                  {ex.name || "(sans nom)"}
                </li>
              ))}
              {session.exercises.length > 3 && (
                <li className="text-[11px] text-muted-foreground">+{session.exercises.length - 3} autre(s)</li>
              )}
            </ul>
          )}
        </>
      )}
    </button>
  );
}

export function ProgramBuilderFullscreen({
  program,
  library,
  onSave,
}: {
  program: AdminProgram;
  library: ExerciseLibraryItem[];
  onSave: (data: BuilderData) => Promise<boolean>;
}) {
  const [name, setName] = useState(program.name);
  const [goal, setGoal] = useState(program.goal);
  const [level, setLevel] = useState(program.level);
  const [durationWeeks, setDurationWeeks] = useState(program.durationWeeks);
  const [description, setDescription] = useState(program.description);
  const [status, setStatus] = useState<AdminContentStatus>(program.status);
  const [sessions, setSessions] = useState<AdminWorkoutSession[]>(program.sessions);

  const weekNumbers = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.weekNumber))).sort((a, b) => a - b),
    [sessions],
  );
  const [selectedWeek, setSelectedWeek] = useState<number>(weekNumbers[0] ?? 1);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Raccourci clavier Cmd/Ctrl+S pour sauvegarder sans quitter le clavier,
  // et "[" pour basculer les deux panneaux latéraux (voir spec V3 —
  // panneaux repliables, raccourci clavier pour les masquer/afficher).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      } else if (event.key === "[" && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault();
        setLeftOpen((v) => !v);
        setRightOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, goal, level, durationWeeks, description, status, sessions]);

  function markDirty() {
    setSaveStatus("dirty");
  }

  async function handleSave() {
    setSaveStatus("saving");
    const ok = await onSave({ name, goal, level, durationWeeks, description, status, sessions });
    if (ok) {
      setSaveStatus("saved");
      setSavedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    } else {
      setSaveStatus("error");
    }
  }

  function cloneWeekSessions(sourceWeek: number, targetWeek: number): AdminWorkoutSession[] {
    return sessions
      .filter((s) => s.weekNumber === sourceWeek)
      .map((s) => ({
        ...s,
        id: generateId("sess"),
        weekNumber: targetWeek,
        exercises: s.exercises.map((ex) => ({ ...ex, id: generateId("ex") })),
        cardioBlocks: (s.cardioBlocks ?? []).map(cloneCardioBlock),
      }));
  }

  function addWeek(copyPrevious: boolean) {
    const nextWeek = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;
    if (copyPrevious && weekNumbers.length > 0) {
      const sourceWeek = Math.max(...weekNumbers);
      setSessions((prev) => [...prev, ...cloneWeekSessions(sourceWeek, nextWeek)]);
    } else {
      setSessions((prev) => [...prev, ...weekDays.map((day) => restDaySession(nextWeek, day))]);
    }
    setDurationWeeks((prev) => Math.max(prev, nextWeek));
    setSelectedWeek(nextWeek);
    markDirty();
  }

  function duplicateWeek(sourceWeek: number) {
    const nextWeek = Math.max(...weekNumbers) + 1;
    setSessions((prev) => [...prev, ...cloneWeekSessions(sourceWeek, nextWeek)]);
    setDurationWeeks((prev) => Math.max(prev, nextWeek));
    setSelectedWeek(nextWeek);
    markDirty();
  }

  function updateSession(sessionId: string, updated: AdminWorkoutSession) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
    markDirty();
  }

  function duplicateSessionToNextWeek(session: AdminWorkoutSession) {
    const target = sessions.find((s) => s.weekNumber === session.weekNumber + 1 && s.day === session.day);
    if (!target) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === target.id
          ? {
              ...session,
              id: target.id,
              weekNumber: target.weekNumber,
              exercises: session.exercises.map((ex) => ({ ...ex, id: generateId("ex") })),
              cardioBlocks: (session.cardioBlocks ?? []).map(cloneCardioBlock),
            }
          : s,
      ),
    );
    markDirty();
  }

  const weekSessions = sessions
    .filter((s) => s.weekNumber === selectedWeek)
    .sort((a, b) => weekDays.indexOf(a.day) - weekDays.indexOf(b.day));
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  function saveIndicatorLabel(): string {
    if (saveStatus === "saving") return "Enregistrement…";
    if (saveStatus === "error") return "Échec de l'enregistrement";
    if (saveStatus === "dirty") return "Modifications non enregistrées";
    if (saveStatus === "saved" && savedAt) return `Enregistré à ${savedAt}`;
    return "À jour";
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Barre du haut — jamais de sidebar admin ni de menu tableau de bord ici (voir AdminShell). */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/admin/programmes/${program.id}`}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Retour
          </Link>
          <span className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="truncate text-sm font-bold uppercase tracking-wide text-foreground hover:text-primary"
            title="Ouvrir les réglages du programme"
          >
            {name || "(sans nom)"}
          </button>
          <StatusBadge label={contentStatusLabels[status]} tone={contentStatusTone(status)} />
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className={`hidden text-[11px] uppercase tracking-widest sm:inline ${
              saveStatus === "error"
                ? "text-red-400"
                : saveStatus === "dirty"
                  ? "text-amber-400"
                  : "text-muted-foreground"
            }`}
          >
            {saveIndicatorLabel()}
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Settings size={13} />
            Réglages
          </button>
          <Link
            href={`/admin/programmes/${program.id}`}
            className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Eye size={13} />
            Aperçu
          </Link>
          <button
            type="button"
            onClick={() => {
              setStatus((prev) => (prev === "actif" ? "brouillon" : "actif"));
              markDirty();
            }}
            className="flex items-center gap-1.5 border border-primary bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
          >
            {status === "actif" ? "Repasser en brouillon" : "Publier"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saveStatus === "saving"}
            className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {saveStatus === "saving" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Enregistrer
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Panneau gauche — navigation semaines (repliable). */}
        {leftOpen && (
          <div className="flex w-56 flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Semaines</span>
              <button type="button" onClick={() => setLeftOpen(false)} aria-label="Masquer le panneau" className="text-muted-foreground hover:text-foreground">
                <PanelLeftClose size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {weekNumbers.map((weekNumber) => (
                <div key={weekNumber} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedWeek(weekNumber)}
                    className={`flex-1 border px-3 py-2 text-left text-xs uppercase tracking-widest transition-colors ${
                      selectedWeek === weekNumber ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    Semaine {weekNumber}
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateWeek(weekNumber)}
                    title="Dupliquer cette semaine"
                    className="text-muted-foreground hover:text-primary"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addWeek(true)}
              className="flex items-center justify-center gap-1.5 border border-primary bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
            >
              <Plus size={13} />
              Semaine
            </button>
            <button
              type="button"
              onClick={() => addWeek(false)}
              className="border border-border px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Semaine vide
            </button>
          </div>
        )}

        {/* Zone centrale — grille 7 jours, jamais de scroll horizontal (voir spec V3). */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!leftOpen && (
                <button type="button" onClick={() => setLeftOpen(true)} aria-label="Afficher le panneau semaines" className="text-muted-foreground hover:text-foreground">
                  <PanelLeftOpen size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedWeek((w) => Math.max(weekNumbers[0] ?? 1, w - 1))}
                disabled={weekNumbers.indexOf(selectedWeek) <= 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <h2 className="text-sm font-bold uppercase tracking-widest text-primary">Semaine {selectedWeek}</h2>
              <button
                type="button"
                onClick={() => setSelectedWeek((w) => Math.min(weekNumbers[weekNumbers.length - 1] ?? 1, w + 1))}
                disabled={weekNumbers.indexOf(selectedWeek) >= weekNumbers.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {!rightOpen && (
              <button type="button" onClick={() => setRightOpen(true)} aria-label="Afficher le panneau d'édition" className="text-muted-foreground hover:text-foreground">
                <PanelRightOpen size={16} />
              </button>
            )}
          </div>

          {weekNumbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune semaine pour le moment. Ajoute une semaine dans le panneau de gauche.</p>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {weekSessions.map((session) => (
                <DayGridCell
                  key={session.id}
                  session={session}
                  isSelected={selectedSessionId === session.id}
                  onSelect={() => setSelectedSessionId(session.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Panneau droit — édition détaillée de la séance sélectionnée (repliable). */}
        {rightOpen && (
          <div className="flex w-[420px] flex-shrink-0 flex-col overflow-y-auto border-l border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Édition de la séance</span>
              <button type="button" onClick={() => setRightOpen(false)} aria-label="Masquer le panneau" className="text-muted-foreground hover:text-foreground">
                <PanelRightClose size={14} />
              </button>
            </div>
            {selectedSession ? (
              <DayCard
                key={selectedSession.id}
                session={selectedSession}
                nextWeekSession={sessions.find((s) => s.weekNumber === selectedSession.weekNumber + 1 && s.day === selectedSession.day)}
                library={library}
                onUpdate={(updated) => updateSession(selectedSession.id, updated)}
                onDuplicate={() => duplicateSessionToNextWeek(selectedSession)}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                <Dumbbell size={20} />
                Sélectionne une séance dans la grille pour la modifier.
              </div>
            )}
          </div>
        )}
      </div>

      {settingsOpen && (
        <Modal title="Réglages du programme" onClose={() => setSettingsOpen(false)} maxWidth="max-w-lg">
          <div className="flex flex-col gap-4">
            <Field label="Nom du programme" value={name} onChange={(v) => { setName(v); markDirty(); }} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Objectif" value={goal} onChange={(v) => { setGoal(v); markDirty(); }} />
              <SelectField label="Niveau" value={level} onChange={(v) => { setLevel(v); markDirty(); }} options={levelOptions} />
            </div>
            <Field
              label="Durée (semaines)"
              type="number"
              value={String(durationWeeks)}
              onChange={(v) => { setDurationWeeks(Number(v) || 0); markDirty(); }}
            />
            <TextareaField label="Description" value={description} onChange={(v) => { setDescription(v); markDirty(); }} rows={3} />
            <SelectField
              label="Statut"
              value={status}
              onChange={(v) => { setStatus(v as AdminContentStatus); markDirty(); }}
              options={statusOptions}
            />
            <PrimaryButton
              onClick={() => {
                setSettingsOpen(false);
                void handleSave();
              }}
            >
              Enregistrer et fermer
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
