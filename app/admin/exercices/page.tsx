"use client";

import { useMemo, useState } from "react";
import { Library } from "lucide-react";

import { ExerciseLibraryManager } from "@/components/admin/ExerciseLibraryManager";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseExerciseLibrary } from "@/hooks/useSupabaseExerciseLibrary";
import { exerciseCategoryLabels, exerciseEquipmentLabels, exerciseLevelLabels } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  createExerciseLibraryItem,
  deleteExerciseLibraryItem,
  setExerciseLibraryStatus,
  updateExerciseLibraryItem,
} from "@/lib/supabase/exercise-library";
import { muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type { ExerciseCategory, ExerciseEquipment, ExerciseLevel, ExerciseLibraryItem, ExerciseLibraryStatus, MuscleGroup } from "@/types";

type StatusFilter = "tous" | ExerciseLibraryStatus;

export default function AdminExercicesPage() {
  const { state, createLibraryExercise, updateLibraryExercise } = useAdminData();
  const supabaseExerciseLibrary = useSupabaseExerciseLibrary();
  const isLibrarySupabaseActive = supabaseExerciseLibrary.items.length > 0;
  const exerciseLibrary = isLibrarySupabaseActive ? supabaseExerciseLibrary.items : state.exerciseLibrary;

  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | "tous">("tous");
  const [categoryFilter, setCategoryFilter] = useState<ExerciseCategory | "tous">("tous");
  const [equipmentFilter, setEquipmentFilter] = useState<ExerciseEquipment | "tous">("tous");
  const [levelFilter, setLevelFilter] = useState<ExerciseLevel | "tous">("tous");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");

  const filtered = useMemo(
    () =>
      exerciseLibrary.filter(
        (item) =>
          (muscleFilter === "tous" || item.muscleGroup === muscleFilter) &&
          (categoryFilter === "tous" || item.category === categoryFilter) &&
          (equipmentFilter === "tous" || item.equipment === equipmentFilter) &&
          (levelFilter === "tous" || item.level === levelFilter) &&
          (statusFilter === "tous" || item.status === statusFilter),
      ),
    [exerciseLibrary, muscleFilter, categoryFilter, equipmentFilter, levelFilter, statusFilter],
  );

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

  async function handleSetExerciseStatus(id: string, status: ExerciseLibraryStatus) {
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
        return;
      }
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Bibliothèque d&apos;exercices
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {exerciseLibrary.length} exercice{exerciseLibrary.length > 1 ? "s" : ""} dans la banque
          {!isLibrarySupabaseActive && exerciseLibrary.length > 0 ? " (démo)" : ""}.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <select
          value={muscleFilter}
          onChange={(e) => setMuscleFilter(e.target.value as MuscleGroup | "tous")}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Tous les muscles</option>
          {muscleGroupOrder.map((group) => (
            <option key={group} value={group}>
              {muscleGroupLabels[group]}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as ExerciseCategory | "tous")}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Toutes les catégories</option>
          {Object.entries(exerciseCategoryLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={equipmentFilter}
          onChange={(e) => setEquipmentFilter(e.target.value as ExerciseEquipment | "tous")}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Tout matériel</option>
          {Object.entries(exerciseEquipmentLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as ExerciseLevel | "tous")}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Tous les niveaux</option>
          {Object.entries(exerciseLevelLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-border bg-background px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          <option value="tous">Actifs et archivés</option>
          <option value="active">Actifs seulement</option>
          <option value="archived">Archivés seulement</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Library size={16} />
          Aucun exercice ne correspond à ces filtres.
        </p>
      ) : (
        <ExerciseLibraryManager
          items={filtered}
          onCreate={handleCreateExercise}
          onUpdate={handleUpdateExercise}
          onSetStatus={handleSetExerciseStatus}
          onDelete={handleDeleteExercise}
        />
      )}
    </div>
  );
}
