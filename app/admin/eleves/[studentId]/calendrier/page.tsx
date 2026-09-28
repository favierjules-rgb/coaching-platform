"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CalendrierAthlete } from "@/components/admin/cardio/CalendrierAthlete";
import { Loader } from "@/components/ui/Loader";
import { useSupabaseStudentDetail } from "@/hooks/useSupabaseStudentDetail";
import { fullName } from "@/lib/admin";

/**
 * LE CALENDRIER D'UN ATHLÈTE — page dédiée.
 *
 * ⚠️ RÉSERVÉE À UN ÉLÈVE RÉEL. Le calendrier lit `assignments`,
 * `workout_sessions` et `training_blocks` par `student_id` : sur une fiche de
 * démonstration il n'y a rien à lire, et une grille vide passerait pour une
 * panne. La page le dit, comme la page Progression.
 */
export default function AdminStudentCalendrierPage() {
  const params = useParams<{ studentId: string }>();
  const detail = useSupabaseStudentDetail(params.studentId);

  if (detail.loading) {
    return <Loader libelle="Chargement de l'élève…" variante="ligne" />;
  }

  return (
    <div>
      <Link
        href={`/admin/eleves/${params.studentId}`}
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Fiche élève
      </Link>

      {detail.student ? (
        <CalendrierAthlete studentId={detail.student.id} nomEleve={fullName(detail.student)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Calendrier indisponible : cet élève n&apos;est pas relié à un compte Supabase réel.
        </p>
      )}
    </div>
  );
}
