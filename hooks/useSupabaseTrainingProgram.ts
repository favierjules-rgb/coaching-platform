"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId, getCurrentStudentProfile } from "@/lib/supabase/current-student";
import { getAssignedProgramsForStudent } from "@/lib/supabase/programs";
import type { AdminProgram, AdminStudent } from "@/types";

/**
 * Programmes réellement assignés à l'élève connecté, pour les pages
 * /entrainement — même principe que useSupabaseWorkoutFeedback :
 * `ready` passe à `true` une fois la vérification terminée, `active` ne
 * vaut `true` que si un compte élève Supabase est réellement identifié
 * (sinon l'appelant retombe sur data/student.ts, comme actuellement).
 * `programs` reste un tableau vide tant que l'élève réel n'a aucun
 * programme assigné ("Aucun programme attribué"), même si `active` est vrai.
 * `activeProgram` est celui à mettre en avant (statut "actif", sinon le
 * plus récemment assigné).
 *
 * Mise à jour en direct (V3 étape 5) : une fois les programmes assignés
 * connus, on souscrit à Realtime Postgres Changes sur `programs` et
 * `workout_sessions` (les deux seules tables enregistrées dans la
 * publication `supabase_realtime` — voir
 * supabase/migrations/20260716_training_v3_realtime_rls.sql) pour que
 * l'élève voie une modification du coach sans recharger la page. Écouter
 * ces deux tables suffit : diffProgramStructure (lib/supabase/programs.ts)
 * fait toujours un UPDATE workout_sessions pour chaque séance existante à
 * chaque sauvegarde du coach, même quand seuls les exercices ou les blocs
 * cardio de cette séance changent. Un debounce (500ms) coalesce les rafales
 * d'événements d'une même sauvegarde en un seul refetch.
 */
export function useSupabaseTrainingProgram() {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [student, setStudent] = useState<AdminStudent | null>(null);
  const [programs, setPrograms] = useState<AdminProgram[]>([]);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setReady(true);
      return;
    }
    const id = await getCurrentStudentId(supabase);
    if (!id) {
      setReady(true);
      return;
    }
    const [studentProfile, assignedPrograms] = await Promise.all([
      getCurrentStudentProfile(supabase),
      getAssignedProgramsForStudent(supabase, id),
    ]);
    setStudentId(id);
    setStudent(studentProfile);
    setPrograms(assignedPrograms);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const id = await getCurrentStudentId(supabase);
      if (!id) {
        if (!cancelled) setReady(true);
        return;
      }
      const [studentProfile, assignedPrograms] = await Promise.all([
        getCurrentStudentProfile(supabase),
        getAssignedProgramsForStudent(supabase, id),
      ]);
      if (!cancelled) {
        setStudentId(id);
        setStudent(studentProfile);
        setPrograms(assignedPrograms);
        setReady(true);
      }
    }

    initialLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const programIdsKey = programs.map((p) => p.id).join(",");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!studentId || !programIdsKey) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const programIds = programIdsKey.split(",");

    function scheduleRefetch() {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void load();
      }, 500);
    }

    const channel = supabase
      .channel(`training-program-updates-${studentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "programs", filter: `id=in.(${programIds.join(",")})` },
        scheduleRefetch,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workout_sessions", filter: `program_id=in.(${programIds.join(",")})` },
        scheduleRefetch,
      )
      .subscribe();

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      supabase.removeChannel(channel);
    };
  }, [studentId, programIdsKey, load]);

  const activeProgram = programs.find((p) => p.status === "actif") ?? programs[0] ?? null;

  return { ready, active: ready && studentId !== null, studentId, student, programs, activeProgram, refetch: load };
}
