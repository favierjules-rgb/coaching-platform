"use client";

import { DocumentLibrary } from "@/components/student/DocumentLibrary";
import { RealDocumentLibrary } from "@/components/student/RealDocumentLibrary";
import { documentResources, student, studentDocumentAccess } from "@/data/student";
import { useSupabaseStudentDocuments } from "@/hooks/useSupabaseStudentDocuments";

/**
 * Priorité Supabase dès qu'un compte élève réel est identifié (même
 * principe que /nutrition) : les documents réellement accessibles
 * (globaux actifs + assignés, voir lib/supabase/documents.ts) remplacent
 * alors entièrement data/student.ts.
 */
export default function DocumentsPage() {
  const supabaseDocuments = useSupabaseStudentDocuments();

  if (!supabaseDocuments.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Documents
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          La bibliothèque de ressources partagées par ton coach.
        </p>
      </div>

      {supabaseDocuments.active ? (
        <RealDocumentLibrary documents={supabaseDocuments.documents} />
      ) : (
        <DocumentLibrary
          studentId={student.id}
          documents={documentResources}
          accessSeed={studentDocumentAccess}
          weekNumber={student.weekNumber}
        />
      )}
    </div>
  );
}
