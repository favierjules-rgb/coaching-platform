"use client";

import { DocumentLibraryCard } from "@/components/student/DocumentLibraryCard";
import { useDocumentAccess } from "@/hooks/useDocumentAccess";
import type { DocumentResource, StudentDocumentAccess } from "@/types";

interface RelatedDocumentsLiveProps {
  studentId: string;
  documents: DocumentResource[];
  accessSeed: StudentDocumentAccess[];
}

export function RelatedDocumentsLive({
  studentId,
  documents,
  accessSeed,
}: RelatedDocumentsLiveProps) {
  const { getStatus } = useDocumentAccess(studentId, accessSeed);

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {documents.map((document) => (
        <DocumentLibraryCard
          key={document.id}
          document={document}
          status={getStatus(document.id)}
        />
      ))}
    </div>
  );
}
