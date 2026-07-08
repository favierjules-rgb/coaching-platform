"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";

import { DocumentModal } from "@/components/admin/DocumentModal";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { ImportantMark } from "@/components/admin/ImportantMark";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabaseDocuments } from "@/hooks/useSupabaseDocuments";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import {
  distributionModeLabels,
  documentCategoryLabels,
  documentDifficultyLabels,
  documentStatusLabels,
  documentTypeLabels,
  formatDate,
  matchesTextSearch,
} from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { updateDocument as updateDocumentSupabase } from "@/lib/supabase/documents";
import type { AdminDocument, AdminDocumentStatus } from "@/types";

type StatusFilter = "tous" | AdminDocumentStatus;
type LevelFilter = "tous" | 1 | 2 | 3 | 4;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "brouillon", label: "Brouillon" },
  { value: "publié", label: "Publié" },
  { value: "archivé", label: "Archivé" },
];

export default function AdminDocumentsPage() {
  const { state, updateDocument, setAssignment } = useAdminData();

  // Dès que Supabase est configuré, /admin/documents n'affiche QUE les
  // vrais documents — jamais de mélange avec les documents mock/
  // localStorage, même si la table est vide (état vide plutôt que démo),
  // même principe que /admin/nutrition (voir docs/supabase-documents-model.md).
  const supabaseActive = isSupabaseConfigured();
  const supabaseDocuments = useSupabaseDocuments();
  const documents = supabaseActive ? supabaseDocuments.documents : state.documents;
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { document: supabaseActive },
    setAssignment,
    supabaseDocuments.refetch,
  );

  async function handleSave(documentId: string, partial: Partial<AdminDocument>) {
    if (supabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        await updateDocumentSupabase(supabase, documentId, partial);
        await supabaseDocuments.refetch();
        return;
      }
    }
    updateDocument(documentId, partial);
  }

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [typeFilter, setTypeFilter] = useState("tous");
  const [categoryFilter, setCategoryFilter] = useState("tous");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("tous");

  if (supabaseActive && supabaseDocuments.loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const filtered = documents.filter(
    (d) =>
      matchesTextSearch([d.title, d.shortDescription], query) &&
      (statusFilter === "tous" || d.status === statusFilter) &&
      (typeFilter === "tous" || d.type === typeFilter) &&
      (categoryFilter === "tous" || d.category === categoryFilter) &&
      (levelFilter === "tous" || d.level === levelFilter),
  );

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Documents
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{documents.length} documents créés.</p>
        </div>
        <Link
          href="/admin/documents/nouveau"
          className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
        >
          <Plus size={14} />
          Ajouter document
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un document..." />
        <div className="flex flex-wrap items-center gap-4">
          <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-border bg-background px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground"
          >
            <option value="tous">Tous les types</option>
            {Object.entries(documentTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-border bg-background px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground"
          >
            <option value="tous">Toutes les catégories</option>
            {Object.entries(documentCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value === "tous" ? "tous" : (Number(e.target.value) as 1 | 2 | 3 | 4))}
            className="border border-border bg-background px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground"
          >
            <option value="tous">Tous les niveaux</option>
            <option value="1">Niveau 1</option>
            <option value="2">Niveau 2</option>
            <option value="3">Niveau 3</option>
            <option value="4">Niveau 4</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText size={16} />
          Aucun document ne correspond à ta recherche.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col gap-4 border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-lg font-bold text-foreground">{doc.title}</span>
                    {doc.important && <ImportantMark />}
                  </div>
                  <span className="block text-xs text-muted-foreground">{doc.shortDescription}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Type · Catégorie</span>
                  <span className="text-sm text-foreground">
                    {documentTypeLabels[doc.type]} · {documentCategoryLabels[doc.category]}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Niveau · Difficulté</span>
                  <span className="text-sm text-foreground">
                    Niveau {doc.level} · {documentDifficultyLabels[doc.difficulty]}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{distributionModeLabels[doc.distributionMode]}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">Ajouté le</span>
                  <span className="text-sm text-foreground">{formatDate(doc.createdAt)}</span>
                  <span className="mt-1 block">
                    <StatusBadge label={documentStatusLabels[doc.status]} tone={contentStatusTone(doc.status)} />
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Élèves ayant accès
                  </span>
                  <span className="text-sm text-foreground">{doc.assignedStudentIds.length}</span>
                </div>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-2">
                <DocumentModal
                  document={doc}
                  students={students}
                  onSave={(partial) => handleSave(doc.id, partial)}
                  onSetAssignment={handleSetAssignment}
                  triggerLabel="Voir"
                />
                <DocumentModal
                  document={doc}
                  students={students}
                  onSave={(partial) => handleSave(doc.id, partial)}
                  onSetAssignment={handleSetAssignment}
                  triggerLabel="Modifier"
                  initialEditing
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
