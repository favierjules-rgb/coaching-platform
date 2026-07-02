"use client";

import { useEffect } from "react";

import { DocumentStatusBadge } from "@/components/student/DocumentStatusBadge";
import { useDocumentAccess } from "@/hooks/useDocumentAccess";
import type { StudentDocumentAccess } from "@/types";

interface DocumentStatusLiveProps {
  studentId: string;
  documentId: string;
  accessSeed: StudentDocumentAccess[];
}

/**
 * Marque le document comme consulté à l'ouverture de la page détail, et
 * affiche le badge de statut à jour (partagé avec /documents via le hook
 * useDocumentAccess).
 */
export function DocumentStatusLive({
  studentId,
  documentId,
  accessSeed,
}: DocumentStatusLiveProps) {
  const { getStatus, markViewed } = useDocumentAccess(studentId, accessSeed);

  useEffect(() => {
    markViewed(documentId);
  }, [documentId, markViewed]);

  return <DocumentStatusBadge status={getStatus(documentId)} />;
}
