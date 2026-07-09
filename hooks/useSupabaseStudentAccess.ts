"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getStudentAccessStatus, updateStudentAccess, type UpdateStudentAccessInput } from "@/lib/supabase/student-access";
import { getStudentProfile } from "@/lib/supabase/students";
import type { StudentAccessStatus } from "@/types";

export interface SupabaseStudentAccessState {
  loading: boolean;
  status: StudentAccessStatus | null;
  assignedTemplateId: string | null;
  accessNote: string;
  refetch: () => Promise<void>;
  save: (input: UpdateStudentAccessInput) => Promise<boolean>;
}

/** Bloc "Accès au site" de la fiche élève admin (chantier "supabase-stripe-access-control", étendu par "supabase-subscription-templates"). */
export function useSupabaseStudentAccess(studentId: string | undefined): SupabaseStudentAccessState {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StudentAccessStatus | null>(null);
  const [assignedTemplateId, setAssignedTemplateId] = useState<string | null>(null);
  const [accessNote, setAccessNote] = useState("");

  const refetch = useCallback(async () => {
    if (!studentId) {
      setStatus(null);
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setStatus(null);
      setLoading(false);
      return;
    }
    const [accessStatus, profile] = await Promise.all([
      getStudentAccessStatus(supabase, studentId),
      getStudentProfile(supabase, studentId),
    ]);
    setStatus(accessStatus);
    setAssignedTemplateId(profile?.assignedSubscriptionTemplateId ?? null);
    setAccessNote(profile?.accessNote ?? "");
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      if (!studentId) {
        if (!cancelled) {
          setStatus(null);
          setLoading(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setStatus(null);
          setLoading(false);
        }
        return;
      }
      const [accessStatus, profile] = await Promise.all([
        getStudentAccessStatus(supabase, studentId),
        getStudentProfile(supabase, studentId),
      ]);
      if (!cancelled) {
        setStatus(accessStatus);
        setAssignedTemplateId(profile?.assignedSubscriptionTemplateId ?? null);
        setAccessNote(profile?.accessNote ?? "");
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const save = useCallback(
    async (input: UpdateStudentAccessInput): Promise<boolean> => {
      if (!studentId) return false;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      const ok = await updateStudentAccess(supabase, studentId, input);
      await refetch();
      return ok;
    },
    [studentId, refetch],
  );

  return { loading, status, assignedTemplateId, accessNote, refetch, save };
}
