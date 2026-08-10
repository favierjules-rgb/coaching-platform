"use client";

import { SectionIndisponible } from "@/components/pwa/SectionIndisponible";
import { DocumentLibrary } from "@/components/student/DocumentLibrary";
import { RealDocumentLibrary } from "@/components/student/RealDocumentLibrary";
import { documentResources, student, studentDocumentAccess } from "@/data/student";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useSupabaseStudentDocuments } from "@/hooks/useSupabaseStudentDocuments";

/**
 * Priorité Supabase dès qu'un compte élève réel est identifié (même
 * principe que /nutrition) : les documents réellement accessibles
 * (globaux actifs + assignés, voir lib/supabase/documents.ts) remplacent
 * alors entièrement data/student.ts.
 *
 * ════════════════════════════════════════════════════════════════════════
 * `active: false` NE VEUT PAS DIRE « DÉMONSTRATION »
 * ════════════════════════════════════════════════════════════════════════
 * Il voulait dire quatre choses à la fois, dont « pas de réseau ». Un élève
 * réel en avion recevait donc la bibliothèque de démonstration : des
 * documents qui ne sont pas les siens, présentés comme les siens, avec un
 * suivi de lecture par-dessus. Le pourquoi est désormais demandé au
 * diagnostic partagé, et la démonstration n'est atteinte que si Supabase
 * n'est pas configuré.
 */
function EnTete() {
  return (
    <div className="mb-8">
      <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
        Documents
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        La bibliothèque de ressources partagées par ton coach.
      </p>
    </div>
  );
}

export default function DocumentsPage() {
  const supabaseDocuments = useSupabaseStudentDocuments();
  const local = useEtatOfflineEleve(supabaseDocuments.ready && !supabaseDocuments.active);

  if (!supabaseDocuments.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseDocuments.active) {
    return (
      <div>
        <EnTete />
        <RealDocumentLibrary documents={supabaseDocuments.documents} />
      </div>
    );
  }

  if (local.etat === "chargement") {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (local.etat !== "mock") {
    return (
      <SectionIndisponible
        zone="/documents"
        titre="Documents"
        etat={local.etat}
        lignes={{ auth: local.identite ? "oui" : "non" }}
      />
    );
  }

  /* ── DÉMONSTRATION ──────────────────────────────────────────────────
   * Seul `local.etat === "mock"` arrive ici : Supabase non configuré. */
  return (
    <div>
      <EnTete />
      <DocumentLibrary
        studentId={student.id}
        documents={documentResources}
        accessSeed={studentDocumentAccess}
        weekNumber={student.weekNumber}
      />
    </div>
  );
}
