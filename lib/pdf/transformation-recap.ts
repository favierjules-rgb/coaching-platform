import { jsPDF } from "jspdf";

/**
 * Génération du PDF "Récapitulatif transformation" (chantier
 * "supabase-progress-photos-before-after-export"). Pensé comme un document
 * remis à l'élève (récap propre, professionnel, lisible), PAS comme un
 * visuel marketing Instagram — mise en page simple, texte structuré,
 * aucune surcharge graphique. jsPDF choisi comme unique nouvelle dépendance :
 * léger, 100% client-side, aucun binding natif, aucune bibliothèque PDF
 * n'existait déjà dans le repo (voir audit — package.json).
 */

export interface TransformationRecapPhoto {
  /** URL affichable au moment de la génération (URL signée Storage ou data URL). */
  url: string;
  date: string;
  weightKg: number | null;
}

export interface TransformationRecapInput {
  studentFirstName: string;
  studentLastName: string;
  before: TransformationRecapPhoto;
  after: TransformationRecapPhoto;
  mainGoal?: string | null;
  startWeightKg?: number | null;
  currentWeightKg?: number | null;
  sessionsCompleted?: number | null;
  /** Résumé nutrition déjà formaté en une phrase (ex: "Moyenne 2 100 kcal/j cette semaine"), simple exigé par la consigne. */
  nutritionSummary?: string | null;
  coachComment?: string | null;
  nextObjective?: string | null;
}

interface LoadedImage {
  dataUrl: string;
  format: "JPEG" | "PNG" | "WEBP";
  width: number;
  height: number;
}

function mimeToFormat(mime: string): "JPEG" | "PNG" | "WEBP" {
  if (mime.includes("png")) return "PNG";
  if (mime.includes("webp")) return "WEBP";
  return "JPEG";
}

async function loadImage(url: string): Promise<LoadedImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = dataUrl;
    });
    return { dataUrl, format: mimeToFormat(blob.type || "image/jpeg"), width, height };
  } catch {
    return null;
  }
}

function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return "Date non renseignée";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date non renseignée";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function daysBetween(a: string, b: string): number | null {
  const timeA = new Date(a).getTime();
  const timeB = new Date(b).getTime();
  if (Number.isNaN(timeA) || Number.isNaN(timeB)) return null;
  return Math.round(Math.abs(timeB - timeA) / 86_400_000);
}

function formatWeightDelta(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded} kg`;
}

/** Dessine une image en la faisant tenir dans une boîte donnée, aspect ratio préservé, centrée. */
function drawImageContained(doc: jsPDF, image: LoadedImage, boxX: number, boxY: number, boxW: number, boxH: number): void {
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const offsetX = boxX + (boxW - drawW) / 2;
  const offsetY = boxY + (boxH - drawH) / 2;
  doc.addImage(image.dataUrl, image.format, offsetX, offsetY, drawW, drawH, undefined, "FAST");
}

function drawEmptyPhotoBox(doc: jsPDF, boxX: number, boxY: number, boxW: number, boxH: number): void {
  doc.setDrawColor(200);
  doc.setFillColor(245, 245, 245);
  doc.rect(boxX, boxY, boxW, boxH, "FD");
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.text("Photo indisponible", boxX + boxW / 2, boxY + boxH / 2, { align: "center" });
  doc.setTextColor(0);
}

export async function generateTransformationRecapPdf(input: TransformationRecapInput): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 18;
  let y = 16;

  doc.setFontSize(9);
  doc.setTextColor(130);
  doc.text("SETH — Préparation Physique", marginX, y);
  doc.setTextColor(0);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Récapitulatif transformation", marginX, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const fullName = `${input.studentFirstName} ${input.studentLastName}`.trim() || "Élève";
  doc.text(fullName, marginX, y);
  y += 6;

  doc.setFontSize(9);
  doc.setTextColor(130);
  doc.text(`Généré le ${formatDateFr(new Date().toISOString())}`, marginX, y);
  doc.setTextColor(0);
  y += 8;

  const [beforeImage, afterImage] = await Promise.all([loadImage(input.before.url), loadImage(input.after.url)]);

  const photoBoxW = (pageWidth - marginX * 2 - 8) / 2;
  const photoBoxH = 85;
  const photosTop = y;

  if (beforeImage) {
    drawImageContained(doc, beforeImage, marginX, photosTop, photoBoxW, photoBoxH);
  } else {
    drawEmptyPhotoBox(doc, marginX, photosTop, photoBoxW, photoBoxH);
  }
  const afterBoxX = marginX + photoBoxW + 8;
  if (afterImage) {
    drawImageContained(doc, afterImage, afterBoxX, photosTop, photoBoxW, photoBoxH);
  } else {
    drawEmptyPhotoBox(doc, afterBoxX, photosTop, photoBoxW, photoBoxH);
  }

  y = photosTop + photoBoxH + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Avant", marginX, y);
  doc.text("Après", afterBoxX, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(formatDateFr(input.before.date), marginX, y);
  doc.text(formatDateFr(input.after.date), afterBoxX, y);
  y += 5;

  const beforeWeightLabel = input.before.weightKg !== null ? `${input.before.weightKg} kg` : "Poids non renseigné";
  const afterWeightLabel = input.after.weightKg !== null ? `${input.after.weightKg} kg` : "Poids non renseigné";
  doc.text(beforeWeightLabel, marginX, y);
  doc.text(afterWeightLabel, afterBoxX, y);
  y += 8;

  doc.setDrawColor(220);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Résumé de la progression", marginX, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const summaryLines: string[] = [];
  if (input.before.weightKg !== null && input.after.weightKg !== null) {
    summaryLines.push(`Variation de poids entre les deux photos : ${formatWeightDelta(input.after.weightKg - input.before.weightKg)}`);
  }
  const duration = daysBetween(input.before.date, input.after.date);
  if (duration !== null) {
    summaryLines.push(`Durée entre les deux photos : ${duration} jour${duration > 1 ? "s" : ""}`);
  }
  if (input.mainGoal) {
    summaryLines.push(`Objectif principal : ${input.mainGoal}`);
  }
  if (input.startWeightKg !== null && input.startWeightKg !== undefined) {
    summaryLines.push(`Poids de départ (coaching) : ${input.startWeightKg} kg`);
  }
  if (input.currentWeightKg !== null && input.currentWeightKg !== undefined) {
    summaryLines.push(`Poids actuel : ${input.currentWeightKg} kg`);
  }
  if (
    input.startWeightKg !== null &&
    input.startWeightKg !== undefined &&
    input.currentWeightKg !== null &&
    input.currentWeightKg !== undefined
  ) {
    summaryLines.push(`Évolution totale depuis le début du coaching : ${formatWeightDelta(input.currentWeightKg - input.startWeightKg)}`);
  }
  if (input.sessionsCompleted !== null && input.sessionsCompleted !== undefined) {
    summaryLines.push(`Séances d'entraînement complétées : ${input.sessionsCompleted}`);
  }
  if (input.nutritionSummary) {
    summaryLines.push(`Nutrition : ${input.nutritionSummary}`);
  }
  if (summaryLines.length === 0) {
    summaryLines.push("Aucune donnée de progression complémentaire disponible pour le moment.");
  }

  for (const line of summaryLines) {
    const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 5 + 1.5;
  }

  if (input.coachComment) {
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Commentaire du coach", marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(input.coachComment, pageWidth - marginX * 2);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 5 + 2;
  }

  if (input.nextObjective) {
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Prochain objectif", marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(input.nextObjective, pageWidth - marginX * 2);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 5 + 2;
  }

  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("SETH — Préparation Physique — Document généré automatiquement, à usage personnel.", marginX, pageHeight - 10);

  return doc.output("blob");
}

export interface TransformationRecapProgressContext {
  firstName: string;
  lastName: string;
  mainGoal: string;
  startWeightKg: number | null;
  currentWeightKg: number | null;
  sessionsCompleted: number;
  nutrition?: {
    hasActivePlan: boolean;
    averageCalories: number | null;
    targetCaloriesPerDay: number | null;
  } | null;
}

/** Construit l'input du PDF à partir des données déjà chargées par lib/supabase/progress.ts (résumé + nutrition) — évite de dupliquer cette logique entre /progression et /admin/eleves/[studentId]/progression. */
export function buildTransformationRecapInput(
  context: TransformationRecapProgressContext,
  before: TransformationRecapPhoto,
  after: TransformationRecapPhoto,
  extras: { coachComment?: string | null; nextObjective?: string | null } = {},
): TransformationRecapInput {
  const nutritionSummary =
    context.nutrition?.hasActivePlan && context.nutrition.averageCalories !== null
      ? `Moyenne ${context.nutrition.averageCalories} kcal/j cette semaine${
          context.nutrition.targetCaloriesPerDay ? ` (objectif ${context.nutrition.targetCaloriesPerDay} kcal/j)` : ""
        }`
      : null;

  return {
    studentFirstName: context.firstName,
    studentLastName: context.lastName,
    before,
    after,
    mainGoal: context.mainGoal || null,
    startWeightKg: context.startWeightKg,
    currentWeightKg: context.currentWeightKg,
    sessionsCompleted: context.sessionsCompleted,
    nutritionSummary,
    coachComment: extras.coachComment ?? null,
    nextObjective: extras.nextObjective ?? null,
  };
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
