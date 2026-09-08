"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Dumbbell, Loader2, Plus, Trash2 } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { ExerciseLibraryManager } from "@/components/admin/ExerciseLibraryManager";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabaseExerciseLibrary } from "@/hooks/useSupabaseExerciseLibrary";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, matchesTextSearch, totalSessions, totalWeeks } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  createExerciseLibraryItem,
  deleteExerciseLibraryItem,
  setExerciseLibraryStatus,
  updateExerciseLibraryItem,
} from "@/lib/supabase/exercise-library";
import { deleteProgram, duplicateProgram } from "@/lib/supabase/programs";
import { Loader } from "@/components/ui/Loader";
import type { AdminContentStatus, ExerciseLibraryItem } from "@/types";

type StatusFilter = "tous" | AdminContentStatus;
type Tab = "programmes" | "banque";

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

export default function AdminProgramsPage() {
  const { state, setAssignment, createLibraryExercise, updateLibraryExercise } = useAdminData();
  const router = useRouter();

  /*
   * ════════════════════════════════════════════════════════════════════
   * LA SOURCE DÉPEND DE LA CONFIGURATION, PLUS DU NOMBRE DE LIGNES
   * ════════════════════════════════════════════════════════════════════
   * La règle était `programs.length > 0 ? supabase : mock`. Elle a l'air
   * prudente et elle est fausse : au PREMIER rendu la requête n'a pas
   * répondu, la liste est donc vide, et la page affichait les fixtures de
   * `data/admin.ts` — « 3 programmes créés », Force & Hypertrophie, Sèche
   * Estivale, Remise en Route — pendant toute la durée de la requête, à
   * chaque ouverture. Ces trois programmes n'existent nulle part en base :
   * l'audit du 08/09/2026 a compté 16 programmes réels et ZÉRO mock.
   *
   * ⚠️ « SUPABASE EST-IL CONFIGURÉ » EST LA BONNE QUESTION. Une liste vide
   * après chargement veut dire « aucun programme », pas « montre-moi des
   * faux ». C'est déjà le contrat de /admin/nutrition et /admin/documents
   * (`supabaseActive ? … : state…`) ; ces deux pages-ci en étaient restées
   * à l'ancienne règle, et ce sont exactement les deux où des données de
   * démonstration apparaissaient.
   *
   * Le repli mock survit pour le seul cas où il a un sens : Supabase non
   * configuré — développement local, démonstration.
   */
  const supabaseActive = isSupabaseConfigured();
  const supabasePrograms = useSupabasePrograms();
  const programs = supabaseActive ? supabasePrograms.programs : state.programs;
  // Duplication (V3 étape 4) : Supabase uniquement, pas de repli mock — voir
  // lib/supabase/programs.ts#duplicateProgram. `duplicatingId` retient le
  // programme en cours de duplication pour désactiver son bouton le temps de
  // la requête, sans bloquer le reste de la page.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  async function handleDuplicate(programId: string) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setDuplicatingId(programId);
    const newId = await duplicateProgram(supabase, programId);
    if (newId) {
      await supabasePrograms.refetch();
      router.push(`/admin/programmes/${newId}/builder`);
      return;
    }
    setDuplicatingId(null);
  }
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  /*
   * ⚠️ L'ÉCRITURE RÉELLE NE DÉPEND PLUS DU NOMBRE DE LIGNES CHARGÉES, et
   * c'était le défaut le plus grave. `useContentAssignment` retombe sur
   * `setAssignment` — donc sur localStorage — quand ce drapeau est faux, ET
   * REND `true`. Tant que la condition était `programs.length > 0 &&
   * students.length > 0`, un coach qui cliquait « Assigner » avant la fin
   * des deux requêtes voyait « Assignation mise à jour » sans qu'une seule
   * ligne n'atteigne `assignments`.
   *
   * Le garde de chargement plus bas rend ce clic impossible ; ce drapeau est
   * la seconde barrière, celle qui tient même si le garde saute.
   */
  const handleSetAssignment = useContentAssignment(
    { programme: supabaseActive },
    setAssignment,
    supabasePrograms.refetch,
  );

  const supabaseExerciseLibrary = useSupabaseExerciseLibrary();
  const isLibrarySupabaseActive = supabaseExerciseLibrary.items.length > 0;
  const exerciseLibrary = isLibrarySupabaseActive ? supabaseExerciseLibrary.items : state.exerciseLibrary;

  async function handleCreateExercise(data: Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">) {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      const id = await createExerciseLibraryItem(supabase, data);
      if (id) {
        await supabaseExerciseLibrary.refetch();
        return;
      }
    }
    createLibraryExercise(data);
  }

  async function handleUpdateExercise(id: string, partial: Partial<ExerciseLibraryItem>) {
    if (isLibrarySupabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        await updateExerciseLibraryItem(supabase, id, partial);
        await supabaseExerciseLibrary.refetch();
        return;
      }
    }
    updateLibraryExercise(id, partial);
  }

  async function handleSetExerciseStatus(id: string, status: "active" | "archived") {
    if (isLibrarySupabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        await setExerciseLibraryStatus(supabase, id, status);
        await supabaseExerciseLibrary.refetch();
        return;
      }
    }
    updateLibraryExercise(id, { status });
  }

  async function handleDeleteExercise(id: string) {
    if (isLibrarySupabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        await deleteExerciseLibraryItem(supabase, id);
        await supabaseExerciseLibrary.refetch();
      }
    }
  }

  // Suppression définitive d'un programme (pas un archivage) — Supabase
  // uniquement, même repli que handleDuplicate. deleteProgram nettoie
  // aussi les lignes `assignments` correspondantes (pas de FK réelle sur
  // cette table, voir lib/supabase/programs.ts).
  const [pendingDeleteProgramId, setPendingDeleteProgramId] = useState<string | null>(null);
  const [deletingProgramId, setDeletingProgramId] = useState<string | null>(null);

  async function handleDeleteProgram(programId: string) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setDeletingProgramId(programId);
    await deleteProgram(supabase, programId);
    await supabasePrograms.refetch();
    setDeletingProgramId(null);
    setPendingDeleteProgramId(null);
  }

  const [tab, setTab] = useState<Tab>("programmes");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [levelFilter, setLevelFilter] = useState("tous");

  const levels = useMemo(() => ["tous", ...Array.from(new Set(programs.map((p) => p.level)))], [programs]);

  /*
   * ⚠️ RIEN N'EST RENDU TANT QUE LES DEUX LISTES SONT EN VOL. Les élèves
   * comptent autant que les programmes : la modale « Assigner » les affiche,
   * et une liste d'élèves encore vide y ferait apparaître les 7 fixtures
   * `@mail.mock`. Même contrat que /admin/nutrition (ligne 141) et
   * /admin/documents (ligne 76).
   *
   * ⚠️ APRÈS TOUS LES HOOKS, JAMAIS AVANT. Un retour anticipé placé plus haut
   * sauterait le `useMemo` ci-dessus au premier rendu puis l'exécuterait au
   * second : React interdit qu'un hook change de position entre deux rendus.
   */
  if (supabaseActive && (supabasePrograms.loading || supabaseStudents.loading)) {
    return <Loader libelle="Chargement…" variante="ligne" />;
  }

  const filtered = programs.filter(
    (p) =>
      matchesTextSearch([p.name, p.goal], query) &&
      (statusFilter === "tous" || p.status === statusFilter) &&
      (levelFilter === "tous" || p.level === levelFilter),
  );

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Programmes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "programmes" ? `${programs.length} programmes créés.` : `${exerciseLibrary.length} exercices dans la banque.`}
          </p>
        </div>
        {tab === "programmes" && (
          <Link
            href="/admin/programmes/nouveau"
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Plus size={14} />
            Créer programme
          </Link>
        )}
      </div>

      <div className="mb-6 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("programmes")}
          aria-pressed={tab === "programmes"}
          className={`min-h-[44px] rounded-control border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            tab === "programmes" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Programmes
        </button>
        <button
          type="button"
          onClick={() => setTab("banque")}
          aria-pressed={tab === "banque"}
          className={`min-h-[44px] rounded-control border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            tab === "banque" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Banque d&apos;exercices
        </button>
      </div>

      {tab === "banque" ? (
        <ExerciseLibraryManager
          items={exerciseLibrary}
          onCreate={handleCreateExercise}
          onUpdate={handleUpdateExercise}
          onSetStatus={handleSetExerciseStatus}
          onDelete={handleDeleteExercise}
        />
      ) : (
        <>
      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un programme..." />
        <div className="flex flex-wrap items-center gap-4">
          <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="min-h-[44px] appearance-none rounded-control border border-border bg-surface-soft px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
          >
            {levels.map((l) => (
              <option key={l} value={l}>
                {l === "tous" ? "Tous les niveaux" : l}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Dumbbell size={16} />
          Aucun programme ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {filtered.map((program) => (
            <div key={program.id} className="flex flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-soft transition-colors hover:border-border-strong">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold uppercase text-foreground">{program.name}</h2>
                  <p className="text-sm text-muted-foreground">{program.goal}</p>
                </div>
                <StatusBadge label={contentStatusLabels[program.status]} tone={contentStatusTone(program.status)} />
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm text-foreground">
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Niveau</span>
                  {program.level}
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Durée</span>
                  {program.durationWeeks} sem.
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Séances</span>
                  {totalSessions(program)} ({totalWeeks(program)} sem. planifiées)
                </div>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                  Élèves assignés ({program.assignedStudentIds.length})
                </span>
                <span className="text-sm text-muted-foreground">
                  {program.assignedStudentIds.length === 0
                    ? "Aucun"
                    : students
                        .filter((s) => program.assignedStudentIds.includes(s.id))
                        .map((s) => `${s.firstName} ${s.lastName}`)
                        .join(", ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/admin/programmes/${program.id}`}
                  className="pressable flex min-h-[44px] items-center rounded-control border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Voir
                </Link>
                <Link
                  href={`/admin/programmes/${program.id}`}
                  className="pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Modifier
                </Link>
                {supabaseActive && (
                  <button
                    type="button"
                    onClick={() => void handleDuplicate(program.id)}
                    disabled={duplicatingId === program.id}
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                  >
                    {duplicatingId === program.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                    Dupliquer
                  </button>
                )}
                <AssignStudentsModal
                  contentLabel={program.name}
                  contentType="programme"
                  contentId={program.id}
                  students={students}
                  assignedStudentIds={program.assignedStudentIds}
                  onSetAssignment={handleSetAssignment}
                />
                {supabaseActive &&
                  (pendingDeleteProgramId === program.id ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteProgram(program.id)}
                      disabled={deletingProgramId === program.id}
                      className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive bg-destructive/10 px-4 py-2 text-xs uppercase tracking-widest text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50"
                    >
                      {deletingProgramId === program.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Confirmer la suppression
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteProgramId(program.id)}
                      className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/40 px-4 py-2 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                    >
                      <Trash2 size={13} />
                      Supprimer
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
