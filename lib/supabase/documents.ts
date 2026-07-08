import type { SupabaseClient } from "@supabase/supabase-js";

import { computeDocumentAvailability, type DocumentAvailability } from "@/lib/admin";
import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type { AdminDocument } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès à la bibliothèque de documents Supabase (tables
 * `documents`, `document_assignments`, `document_levels` — voir
 * supabase/schema.sql sections 18-20bis). Ces tables existaient déjà,
 * conçues pour correspondre au type mock `AdminDocument`, mais n'avaient
 * jamais été branchées à l'app (voir docs/supabase-documents-model.md).
 *
 * `assignedStudentIds` reste un tableau (un document peut être assigné à
 * plusieurs élèves, contrairement à `nutrition_plans.student_id`) — la
 * source de vérité est `document_assignments`, jamais la table générique
 * `assignments` (déjà réservée aux programmes).
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type DocumentAssignmentRow = Database["public"]["Tables"]["document_assignments"]["Row"];

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) {
      list.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

/* ─── Row -> AdminDocument (composition) ─── */

function mapDocumentRow(row: DocumentRow, assignedStudentIds: string[]): AdminDocument {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    category: row.category,
    level: row.level,
    difficulty: row.difficulty,
    shortDescription: row.description,
    fullDescription: row.full_description,
    contentText: row.content_text,
    externalUrl: row.external_url ?? "",
    videoUrl: row.video_url ?? "",
    fileName: row.file_name,
    storagePath: row.storage_path,
    fileSizeBytes: row.file_size_bytes,
    fileMimeType: row.file_mime_type,
    status: row.status,
    important: row.important,
    distributionMode: row.distribution_mode as AdminDocument["distributionMode"],
    unlockAfterWeeks: row.unlock_after_weeks ?? 0,
    unlockAt: row.unlock_at,
    visibility: row.visibility,
    tags: row.tags,
    assignedStudentIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadDocuments(supabase: TypedSupabaseClient, rows: DocumentRow[]): Promise<AdminDocument[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((r) => r.id);
  const { data: assignmentRows, error } = await supabase
    .from("document_assignments")
    .select("document_id, student_id")
    .in("document_id", ids);
  devWarn("loadDocuments (document_assignments)", error);
  const byDoc = groupBy(assignmentRows ?? [], (a) => a.document_id);
  return rows.map((row) => mapDocumentRow(row, (byDoc.get(row.id) ?? []).map((a) => a.student_id)));
}

/* ─── Lecture (admin) ─── */

/** Liste de tous les documents Supabase pour /admin/documents, quel que soit le statut. */
export async function getDocuments(supabase: TypedSupabaseClient): Promise<AdminDocument[]> {
  const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
  devWarn("getDocuments", error);
  return loadDocuments(supabase, data ?? []);
}

/** Ids des documents assignés à chaque élève (batch), pour AdminStudent.assignedDocumentIds. */
export async function getAssignedDocumentIdsByStudent(
  supabase: TypedSupabaseClient,
  studentIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (studentIds.length === 0) {
    return map;
  }
  const { data, error } = await supabase
    .from("document_assignments")
    .select("student_id, document_id")
    .in("student_id", studentIds);
  devWarn("getAssignedDocumentIdsByStudent", error);
  for (const row of data ?? []) {
    const list = map.get(row.student_id) ?? [];
    list.push(row.document_id);
    map.set(row.student_id, list);
  }
  return map;
}

/* ─── Lecture (élève) ─── */

/**
 * Détermine la disponibilité réelle d'un document pour un élève : priorité
 * au déblocage propre à l'assignation (manuel ou date spécifique), sinon la
 * règle du document lui-même (immédiat / niveau+semaines / date précise) —
 * même calcul que lib/admin.ts::computeDocumentAvailability (mock), pour
 * rester cohérent entre les deux chemins.
 */
function computeRealDocumentAvailability(
  student: { startDate: string },
  document: AdminDocument,
  assignment: { manuallyUnlocked: boolean; unlockAt: string | null } | null,
): DocumentAvailability {
  if (assignment?.manuallyUnlocked) {
    return { available: true, unlockDate: null, manuallyUnlocked: true };
  }
  if (assignment?.unlockAt) {
    const unlockDate = new Date(assignment.unlockAt);
    if (!Number.isNaN(unlockDate.getTime())) {
      const available = Date.now() >= unlockDate.getTime();
      return { available, unlockDate: available ? null : unlockDate.toISOString().slice(0, 10), manuallyUnlocked: false };
    }
  }
  return computeDocumentAvailability(student, document, []);
}

export interface StudentDocumentWithAvailability {
  document: AdminDocument;
  availability: DocumentAvailability;
}

/**
 * Documents réellement accessibles à un élève : ceux qui lui sont assignés
 * + les documents globaux actifs (RLS ne renvoie de toute façon que les
 * documents `status = 'publié'`, voir supabase/schema.sql). La disponibilité
 * dans le temps (niveau/semaines/date) reste calculée côté app, jamais au
 * niveau RLS (même principe que le reste de l'app).
 */
export async function getStudentDocumentsWithAvailability(
  supabase: TypedSupabaseClient,
  studentId: string,
  startDate: string,
): Promise<StudentDocumentWithAvailability[]> {
  const [assignedResult, globalResult] = await Promise.all([
    supabase.from("document_assignments").select("*, documents(*)").eq("student_id", studentId),
    supabase.from("documents").select("*").eq("visibility", "global").eq("status", "publié"),
  ]);
  devWarn("getStudentDocumentsWithAvailability (assignments)", assignedResult.error);
  devWarn("getStudentDocumentsWithAvailability (global)", globalResult.error);

  const seenIds = new Set<string>();
  const composed: StudentDocumentWithAvailability[] = [];
  const student = { startDate };

  type AssignmentWithDocument = DocumentAssignmentRow & { documents: DocumentRow | null };
  for (const assignment of (assignedResult.data ?? []) as AssignmentWithDocument[]) {
    const docRow = assignment.documents;
    if (!docRow || docRow.status !== "publié" || seenIds.has(docRow.id)) continue;
    seenIds.add(docRow.id);
    const document = mapDocumentRow(docRow, []);
    const availability = computeRealDocumentAvailability(student, document, {
      manuallyUnlocked: assignment.manually_unlocked,
      unlockAt: assignment.unlock_at,
    });
    composed.push({ document, availability });
  }
  for (const docRow of globalResult.data ?? []) {
    if (seenIds.has(docRow.id)) continue;
    seenIds.add(docRow.id);
    const document = mapDocumentRow(docRow, []);
    const availability = computeRealDocumentAvailability(student, document, null);
    composed.push({ document, availability });
  }

  return composed;
}

/* ─── Écriture ─── */

type DocumentFormData = Omit<AdminDocument, "id" | "createdAt" | "updatedAt" | "assignedStudentIds">;

function documentFields(data: DocumentFormData) {
  return {
    title: data.title,
    description: data.shortDescription,
    full_description: data.fullDescription,
    content_text: data.contentText,
    type: data.type,
    category: data.category,
    level: data.level,
    difficulty: data.difficulty,
    distribution_mode: data.distributionMode,
    unlock_after_weeks: data.unlockAfterWeeks,
    unlock_at: data.unlockAt,
    external_url: data.externalUrl || null,
    video_url: data.videoUrl || null,
    storage_path: data.storagePath,
    file_name: data.fileName,
    file_size_bytes: data.fileSizeBytes,
    file_mime_type: data.fileMimeType,
    visibility: data.visibility,
    tags: data.tags,
    status: data.status,
    important: data.important,
  };
}

/**
 * Crée un nouveau document réel. `id` optionnel : permet de fournir un id
 * généré côté client (`crypto.randomUUID()`) *avant* la création de la
 * ligne, pour uploader le fichier vers `<documentId>/...` dans le bucket
 * Storage avant même que le document existe côté base (voir
 * app/admin/documents/nouveau/page.tsx) — évite un déplacement de fichier
 * après coup.
 */
export async function createDocument(
  supabase: TypedSupabaseClient,
  data: DocumentFormData,
  id?: string,
): Promise<string | null> {
  const fields: Database["public"]["Tables"]["documents"]["Insert"] = id
    ? { id, ...documentFields(data) }
    : documentFields(data);
  const { data: row, error } = await supabase
    .from("documents")
    .insert(fields)
    .select("id")
    .single();
  devWarn("createDocument", error);
  return row?.id ?? null;
}

const PARTIAL_FIELD_MAP: Partial<Record<keyof AdminDocument, string>> = {
  title: "title",
  shortDescription: "description",
  fullDescription: "full_description",
  contentText: "content_text",
  type: "type",
  category: "category",
  level: "level",
  difficulty: "difficulty",
  distributionMode: "distribution_mode",
  unlockAfterWeeks: "unlock_after_weeks",
  unlockAt: "unlock_at",
  externalUrl: "external_url",
  videoUrl: "video_url",
  storagePath: "storage_path",
  fileName: "file_name",
  fileSizeBytes: "file_size_bytes",
  fileMimeType: "file_mime_type",
  visibility: "visibility",
  tags: "tags",
  status: "status",
  important: "important",
};

type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];

/** Met à jour un document existant (mise à jour partielle réelle, seuls les champs fournis sont écrits). */
export async function updateDocument(
  supabase: TypedSupabaseClient,
  documentId: string,
  partial: Partial<AdminDocument>,
): Promise<boolean> {
  const fields: DocumentUpdate = { updated_at: new Date().toISOString() };
  for (const [appKey, dbKey] of Object.entries(PARTIAL_FIELD_MAP) as [keyof AdminDocument, keyof DocumentUpdate][]) {
    const value = partial[appKey];
    if (value === undefined) continue;
    (fields as Record<string, unknown>)[dbKey] =
      value === "" && (appKey === "externalUrl" || appKey === "videoUrl") ? null : value;
  }
  const { error } = await supabase.from("documents").update(fields).eq("id", documentId);
  devWarn("updateDocument", error);
  return !error;
}

/**
 * Assigne/retire un document réel à un élève réel via `document_assignments`
 * — jamais la table générique `assignments`. `unlockAt` (optionnel) fixe un
 * déblocage propre à cette assignation, distinct du déblocage du document.
 */
export async function setDocumentAssignment(
  supabase: TypedSupabaseClient,
  studentId: string,
  documentId: string,
  assigned: boolean,
  unlockAt: string | null = null,
): Promise<boolean> {
  if (!assigned) {
    const { error } = await supabase
      .from("document_assignments")
      .delete()
      .eq("student_id", studentId)
      .eq("document_id", documentId);
    devWarn("setDocumentAssignment (delete)", error);
    return !error;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("document_assignments")
    .select("id")
    .eq("student_id", studentId)
    .eq("document_id", documentId)
    .maybeSingle();
  devWarn("setDocumentAssignment (lookup)", lookupError);
  if (existing) {
    if (unlockAt !== null) {
      const { error } = await supabase
        .from("document_assignments")
        .update({ unlock_at: unlockAt, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      devWarn("setDocumentAssignment (update unlock_at)", error);
      return !error;
    }
    return true;
  }

  const { error: insertError } = await supabase
    .from("document_assignments")
    .insert({ student_id: studentId, document_id: documentId, unlock_at: unlockAt });
  devWarn("setDocumentAssignment (insert)", insertError);
  if (!insertError) {
    const { data: document } = await supabase.from("documents").select("title").eq("id", documentId).maybeSingle();
    await logActivityEvent(supabase, {
      studentId,
      actorType: "coach",
      eventType: "document_assigned",
      title: "Document assigné",
      description: document?.title ? `"${document.title}" assigné.` : "Un document a été assigné.",
      metadata: buildStudentActivityLink(studentId),
    });
  }
  return !insertError;
}

/**
 * Force la disponibilité d'un document verrouillé pour un élève précis
 * (bouton "Débloquer" côté /admin/eleves/[studentId]) — crée la ligne
 * `document_assignments` si elle n'existe pas encore (cas d'un document
 * global débloqué manuellement en avance pour un élève).
 */
export async function unlockDocumentForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
  documentId: string,
): Promise<boolean> {
  const { data: existing, error: lookupError } = await supabase
    .from("document_assignments")
    .select("id")
    .eq("student_id", studentId)
    .eq("document_id", documentId)
    .maybeSingle();
  devWarn("unlockDocumentForStudent (lookup)", lookupError);
  if (existing) {
    const { error } = await supabase
      .from("document_assignments")
      .update({ manually_unlocked: true, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    devWarn("unlockDocumentForStudent (update)", error);
    return !error;
  }
  const { error } = await supabase
    .from("document_assignments")
    .insert({ student_id: studentId, document_id: documentId, manually_unlocked: true });
  devWarn("unlockDocumentForStudent (insert)", error);
  return !error;
}
