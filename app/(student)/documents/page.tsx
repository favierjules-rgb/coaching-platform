import { DocumentLibrary } from "@/components/student/DocumentLibrary";
import { documentResources, student, studentDocumentAccess } from "@/data/student";

export default function DocumentsPage() {
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

      <DocumentLibrary
        studentId={student.id}
        documents={documentResources}
        accessSeed={studentDocumentAccess}
      />
    </div>
  );
}
