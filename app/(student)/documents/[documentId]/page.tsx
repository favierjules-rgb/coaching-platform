import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Lock, PlayCircle } from "lucide-react";

import { DocumentStatusLive } from "@/components/student/DocumentStatusLive";
import { ImportantBadge } from "@/components/student/ImportantBadge";
import { RelatedDocumentsLive } from "@/components/student/RelatedDocumentsLive";
import { computeStudentDocumentAvailability, documentCategoryLabels, documentTypeLabels } from "@/lib/documents";
import {
  documentResources,
  getDocumentResource,
  student,
  studentDocumentAccess,
} from "@/data/student";

export function generateStaticParams() {
  return documentResources.map((document) => ({ documentId: document.id }));
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const document = getDocumentResource(documentId);

  if (!document) {
    notFound();
  }

  const availability = computeStudentDocumentAvailability(document, student.weekNumber);

  if (!availability.available) {
    return (
      <div>
        <Link
          href="/documents"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Documents
        </Link>
        <div className="flex flex-col items-center gap-4 border border-border bg-card p-12 text-center">
          <Lock size={32} className="text-muted-foreground" />
          <h1 className="font-heading text-xl font-bold uppercase text-foreground">Bientôt disponible</h1>
          <p className="text-sm text-muted-foreground">
            Ce document sera débloqué à la semaine {availability.unlockAtWeek} de ton programme.
          </p>
        </div>
      </div>
    );
  }

  const relatedDocuments = document.relatedDocumentIds
    .map((id) => getDocumentResource(id))
    .filter((related): related is NonNullable<typeof related> => Boolean(related))
    .filter((related) => computeStudentDocumentAvailability(related, student.weekNumber).available);

  return (
    <div>
      <Link
        href="/documents"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Documents
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>{documentTypeLabels[document.type]}</span>
            <span>·</span>
            <span>{documentCategoryLabels[document.category]}</span>
            <span>·</span>
            <span>Ajouté le {document.createdAt}</span>
          </div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {document.title}
          </h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          {document.important && <ImportantBadge />}
          <DocumentStatusLive
            studentId={student.id}
            documentId={document.id}
            accessSeed={studentDocumentAccess}
          />
        </div>
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-2 font-heading text-sm font-bold uppercase text-foreground">
          Description
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {document.description}
        </p>
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-2 font-heading text-sm font-bold uppercase text-foreground">
          Aperçu du contenu
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {document.previewContent}
        </p>
      </div>

      {document.type === "vidéo" && (
        <div className="mb-8 flex flex-col items-center justify-center gap-4 border border-border bg-background p-12 text-center">
          <PlayCircle size={40} className="text-primary" />
          <p className="text-sm text-muted-foreground">
            Vidéo hébergée par ton coach.
          </p>
          <button
            type="button"
            className="border border-primary px-6 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Lire la vidéo
          </button>
        </div>
      )}

      {document.type === "lien" && (
        <div className="mb-8 flex flex-col items-start gap-3 border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <ExternalLink size={16} className="text-primary" />
            Lien externe
          </div>
          <button
            type="button"
            className="border border-primary px-6 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Ouvrir le lien
          </button>
        </div>
      )}

      {document.type === "pdf" && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Download size={16} className="text-primary" />
            Document PDF
          </div>
          <button
            type="button"
            className="border border-primary px-6 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Télécharger
          </button>
        </div>
      )}

      {relatedDocuments.length > 0 && (
        <div>
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Documents recommandés
          </h2>
          <RelatedDocumentsLive
            studentId={student.id}
            documents={relatedDocuments}
            accessSeed={studentDocumentAccess}
            weekNumber={student.weekNumber}
          />
        </div>
      )}
    </div>
  );
}
