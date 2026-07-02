import { DocumentsBrowser } from "@/components/student/DocumentsBrowser";
import { documents } from "@/data/student";

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

      <DocumentsBrowser documents={documents} />
    </div>
  );
}
