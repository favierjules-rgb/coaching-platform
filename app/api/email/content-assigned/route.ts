import { NextResponse } from "next/server";

import { composeDocumentAssignedEmail, composeNutritionAssignedEmail, composeProgramAssignedEmail } from "@/lib/email/templates";
import { sendTransactionalEmail, wasEmailRecentlySent } from "@/lib/email/send-transactional-email";
import { getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentById } from "@/lib/supabase/students";
import type { EmailType } from "@/types";

type ContentType = "programme" | "nutrition" | "document";
const VALID_CONTENT_TYPES: ContentType[] = ["programme", "nutrition", "document"];

/**
 * POST /api/email/content-assigned — envoie l'email "programme/plan
 * nutritionnel/document attribué" (chantier
 * "supabase-resend-transactional-emails"). Réservé admin/coach. Body :
 * `{ studentId, contentType, contentId }` — le titre du contenu n'est
 * jamais fourni par le client, toujours relu côté serveur, et
 * l'attribution elle-même est vérifiée en base avant tout envoi (empêche
 * qu'un contentId arbitraire déclenche un email pour un contenu non
 * réellement attribué à cet élève).
 */
export async function POST(request: Request) {
  let body: { studentId?: string; contentType?: string; contentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { studentId, contentId } = body;
  const contentType = body.contentType as ContentType | undefined;
  if (!studentId || !contentId || !contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "studentId, contentId et contentType (programme|nutrition|document) sont requis." }, { status: 400 });
  }

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  // Client service role : `email_logs` n'a aucune policy d'insert/update
  // pour un rôle authentifié (voir supabase/schema.sql), seul le service
  // role peut y écrire.
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const student = await getStudentById(supabase, studentId);
  if (!student?.email) {
    return NextResponse.json({ error: "Élève introuvable ou sans email." }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const emailType: EmailType = `${contentType === "programme" ? "program" : contentType}_assigned` as EmailType;

  let subject: string;
  let html: string;
  let text: string;
  // `programs`/`documents` sont des modèles réutilisables entre élèves (via
  // les tables de jonction `assignments`/`document_assignments`) —
  // l'identifiant utilisé pour l'idempotence doit donc être celui de la
  // ligne de jonction (unique par élève), jamais `contentId` seul (sinon
  // attribuer le même programme à deux élèves à quelques secondes
  // d'intervalle ferait ignorer le second email par erreur). `nutrition_plans`
  // est en revanche déjà 1:1 avec un élève (colonne student_id directe) :
  // contentId y est intrinsèquement propre à cet élève.
  let dedupeEntityId: string = contentId;

  if (contentType === "programme") {
    const { data: assignment } = await supabase
      .from("assignments")
      .select("id")
      .eq("student_id", studentId)
      .eq("content_type", "programme")
      .eq("content_id", contentId)
      .maybeSingle();
    if (!assignment) {
      return NextResponse.json({ error: "Ce programme n'est pas attribué à cet élève." }, { status: 400 });
    }
    dedupeEntityId = assignment.id;
    const { data: program } = await supabase.from("programs").select("name").eq("id", contentId).maybeSingle();
    if (!program) {
      return NextResponse.json({ error: "Programme introuvable." }, { status: 404 });
    }
    const email = composeProgramAssignedEmail({
      firstName: student.firstName,
      programName: program.name,
      startDate: null,
      trainingUrl: `${appUrl}/entrainement`,
    });
    ({ subject, html, text } = email);
  } else if (contentType === "nutrition") {
    const { data: plan } = await supabase.from("nutrition_plans").select("name, student_id").eq("id", contentId).maybeSingle();
    if (!plan || plan.student_id !== studentId) {
      return NextResponse.json({ error: "Ce plan nutritionnel n'est pas attribué à cet élève." }, { status: 400 });
    }
    const email = composeNutritionAssignedEmail({
      firstName: student.firstName,
      planName: plan.name,
      nutritionUrl: `${appUrl}/nutrition`,
    });
    ({ subject, html, text } = email);
  } else {
    const { data: assignment } = await supabase
      .from("document_assignments")
      .select("id")
      .eq("student_id", studentId)
      .eq("document_id", contentId)
      .maybeSingle();
    if (!assignment) {
      return NextResponse.json({ error: "Ce document n'est pas attribué à cet élève." }, { status: 400 });
    }
    dedupeEntityId = assignment.id;
    const { data: document } = await supabase.from("documents").select("title").eq("id", contentId).maybeSingle();
    if (!document) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }
    const email = composeDocumentAssignedEmail({
      firstName: student.firstName,
      documentTitle: document.title,
      documentsUrl: `${appUrl}/documents`,
    });
    ({ subject, html, text } = email);
  }

  const alreadySent = await wasEmailRecentlySent(supabase, {
    emailType,
    relatedEntityType: contentType,
    relatedEntityId: dedupeEntityId,
  });
  if (alreadySent) {
    return NextResponse.json({ status: "skipped", reason: "already_sent_recently" });
  }

  const result = await sendTransactionalEmail(supabase, {
    emailType,
    recipientEmail: student.email,
    recipientUserId: student.userId,
    subject,
    html,
    text,
    relatedEntityType: contentType,
    relatedEntityId: dedupeEntityId,
    metadata: { studentId, contentId },
  });

  return NextResponse.json({ status: result.status });
}
