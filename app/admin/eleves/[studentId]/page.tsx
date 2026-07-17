"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, Archive, History, Lock, Pause, Play, Trash2, TrendingUp, Unlock } from "lucide-react";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { AddCoachNoteModal } from "@/components/admin/AddCoachNoteModal";
import { AdminOnboardingDetailModal } from "@/components/admin/AdminOnboardingDetailModal";
import { AdminSection, InfoRow, TagList } from "@/components/admin/AdminSection";
import { AssignContentToStudentModal } from "@/components/admin/AssignContentToStudentModal";
import { EditStudentModal } from "@/components/admin/EditStudentModal";
import { NutritionWeekSummaryCard } from "@/components/admin/NutritionWeekSummaryCard";
import { StatusBadge, feedbackStatusTone, studentStatusTone } from "@/components/admin/StatusBadge";
import { PaymentSection } from "@/components/admin/PaymentSection";
import { StudentSubscriptionSection } from "@/components/admin/StudentSubscriptionSection";
import { MeasurementsSection } from "@/components/student/MeasurementsSection";
import { ProgressPhotoGallerySection } from "@/components/student/ProgressPhotoGallerySection";
import { WeightEvolutionCard } from "@/components/student/WeightEvolutionCard";
import {
  AnalysisFilterLabel,
  FilteredExerciseList,
  MuscleGroupBars,
  MuscleGroupFilterSelect,
  TrainingStatCards,
  UntaggedExercisesAlert,
} from "@/components/shared/TrainingMetricsSummary";
import { LINKED_STUDENT_ID } from "@/data/admin";
import {
  bodyMeasurements as elveMeasurements,
  customMeasurements as elveCustomMeasurements,
  progressPhotos as elveProgressPhotos,
  student as elveStudentSeed,
  weightHistory as elveWeightHistory,
} from "@/data/student";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useSupabaseDocuments } from "@/hooks/useSupabaseDocuments";
import { useSupabaseDocumentsForStudent } from "@/hooks/useSupabaseDocumentsForStudent";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseStudentDetail } from "@/hooks/useSupabaseStudentDetail";
import {
  computeDocumentAvailability,
  daysBetween,
  feedbackStatusLabels,
  feedbackTypeLabels,
  formatDate,
  formatDateTime,
  fullName,
  generateId,
  normalizeAdminStudent,
  studentStatusLabels,
} from "@/lib/admin";
import { bodyMeasurementLabels, nextWeightHistoryMonth } from "@/lib/profile";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { unlockDocumentForStudent as unlockDocumentForStudentSupabase } from "@/lib/supabase/documents";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { calculatePlannedVsActualMetrics, calculateWeekMetrics, formatTonnage } from "@/lib/training-metrics";
import type {
  AdminStudent,
  BodyMeasurementType,
  MeasurementLogEntry,
  MuscleGroupFilter,
  ProgressPhoto,
  StudentPaymentProfile,
} from "@/types";
import type { CustomMeasurementInput } from "@/components/student/UpdateMeasurementsModal";

/**
 * Un profil élève Supabase pas encore complété (student_profiles absent)
 * renvoie 0/"" pour ses champs de coaching — affichés tels quels, "0 ans"
 * ou "0 kg" auraient l'air d'une vraie valeur plutôt que d'un champ vide.
 */
function formatNumberOrEmpty(value: number, suffix: string) {
  return value > 0 ? `${value}${suffix}` : "Non renseigné";
}

function formatTextOrEmpty(value: string) {
  return value.trim().length > 0 ? value : "Non renseigné";
}

export default function AdminStudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const router = useRouter();
  const { state, updateStudent, addCoachNote, setAssignment, unlockDocumentForStudent, unlockAllDocumentsForStudent } =
    useAdminData();
  const { students, feedback, manualDocumentUnlocks } = state;
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");
  const [statusActionError, setStatusActionError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  // Priorité Supabase dès qu'au moins un programme/plan réel existe — même
  // pattern que /admin/programmes, /admin/nutrition et /admin/eleves.
  // L'assignation réelle n'est activée que si l'élève affiché est lui-même
  // réel (isSupabaseStudent, défini plus bas).
  const supabasePrograms = useSupabasePrograms();
  const programs = supabasePrograms.programs.length > 0 ? supabasePrograms.programs : state.programs;
  // Nutrition : dès que Supabase est configuré, jamais de repli mock (voir
  // /admin/nutrition) — un élève réel sans plan réel affiche "Aucun plan
  // attribué", jamais un plan mock.
  const supabaseNutritionActive = isSupabaseConfigured();
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const nutritionPlans = supabaseNutritionActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  // Documents : même principe, jamais de repli mock une fois Supabase
  // configuré (voir /admin/documents).
  const supabaseDocumentsActive = isSupabaseConfigured();
  const supabaseDocuments = useSupabaseDocuments();
  const documents = supabaseDocumentsActive ? supabaseDocuments.documents : state.documents;

  // Toujours monté (règle des hooks), même si l'élève affiché n'est pas
  // l'élève relié — utilisé uniquement quand isLinked est vrai.
  const linkedProfile = useStudentProfile(LINKED_STUDENT_ID, {
    profile: elveStudentSeed,
    weightHistory: elveWeightHistory,
    measurements: elveMeasurements,
    customMeasurements: elveCustomMeasurements,
    measurementHistory: [],
    photos: elveProgressPhotos,
  });

  // Priorité à Supabase quand l'id de l'URL correspond à un élève réel
  // (UUID) ; sinon la page retombe sur la logique mock existante
  // (isLinked / useAdminData) — voir hooks/useSupabaseStudentDetail.ts.
  const supabaseDetail = useSupabaseStudentDetail(params.studentId);
  const isSupabaseStudent = supabaseDetail.student !== null;
  const canAssignRealPrograms = isSupabaseStudent && supabasePrograms.programs.length > 0;
  const canAssignRealNutrition = isSupabaseStudent && supabaseNutritionActive && supabaseNutritionPlans.plans.length > 0;
  const canAssignRealDocuments = isSupabaseStudent && supabaseDocumentsActive && supabaseDocuments.documents.length > 0;

  // Documents réellement accessibles à cet élève précis (disponibilité
  // incluse) — hook toujours monté (règle des hooks), no-op si l'élève
  // affiché n'est pas réel.
  const studentDocuments = useSupabaseDocumentsForStudent(
    isSupabaseStudent ? (supabaseDetail.student?.id ?? null) : null,
    isSupabaseStudent ? (supabaseDetail.student?.startDate ?? null) : null,
  );

  const handleSetAssignment = useContentAssignment(
    { programme: canAssignRealPrograms, nutrition: canAssignRealNutrition, document: canAssignRealDocuments },
    setAssignment,
    () => {
      void supabasePrograms.refetch();
      void supabaseNutritionPlans.refetch();
      void supabaseDocuments.refetch();
      void studentDocuments.refetch();
    },
  );

  const rawStudent = isSupabaseStudent ? supabaseDetail.student : students.find((s) => s.id === params.studentId);

  if (!rawStudent) {
    if (supabaseDetail.loading) {
      return <p className="text-sm text-muted-foreground">Chargement…</p>;
    }
    return (
      <div>
        <Link href="/admin/eleves" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} />
          Élèves
        </Link>
        <p className="text-sm text-muted-foreground">Élève introuvable.</p>
      </div>
    );
  }

  // Un enregistrement élève admin peut dater d'avant l'ajout de certains
  // champs (mensurations, photos, préférences...) — on normalise pour ne
  // jamais planter sur une liste undefined plus bas dans la page.
  const student = normalizeAdminStudent(rawStudent);

  // Fiche student_profiles brute (tous les champs du questionnaire
  // onboarding) pour un élève Supabase — les cartes résumé plus bas
  // (Préférences alimentaires/sportives, Objectifs, Blessures) doivent lire
  // ces vraies colonnes plutôt que student.foodPreferences/sportPreferences/
  // injuries, qui ne portent qu'un sous-ensemble ancien/différent des champs
  // (voir "Voir le questionnaire complet", même source ici).
  const onboardingProfile = isSupabaseStudent ? supabaseDetail.profile : null;

  const isLinked = !isSupabaseStudent && student.id === LINKED_STUDENT_ID;

  const weightProfile = isLinked
    ? linkedProfile.state.profile
    : {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        goal: student.goal,
        level: student.level,
        startDate: student.startDate,
        weekNumber: 1,
        age: student.age,
        heightCm: student.heightCm,
        currentWeightKg: student.currentWeightKg,
        targetWeightKg: student.targetWeightKg,
        // Champ additionnel (absent de StudentProfile) utilisé en repli par
        // computeWeightEvolution quand l'élève n'a pas encore d'historique
        // de poids valide.
        startWeightKg: student.startWeightKg,
        trainingFrequencyPerWeek: student.trainingFrequencyPerWeek,
        trainingLocation: student.trainingLocation,
        coachingStatus: student.status,
      };
  const weightHistory = isLinked ? linkedProfile.state.weightHistory : student.weightHistory;
  const measurements = isLinked ? linkedProfile.state.measurements : student.measurements;
  const customMeasurements = isLinked ? linkedProfile.state.customMeasurements : student.customMeasurements;
  const measurementHistory = isLinked ? linkedProfile.state.measurementHistory : student.measurementHistory;
  const photos = isLinked ? linkedProfile.state.photos : student.progressPhotos;

  function handleUpdateWeight(weightKg: number): Promise<boolean> | void {
    if (isSupabaseStudent) {
      return supabaseDetail.updateWeight(weightKg);
    }
    if (isLinked) {
      linkedProfile.updateWeight(weightKg);
      return;
    }
    const currentHistory = Array.isArray(student!.weightHistory) ? student!.weightHistory : [];
    const newHistory = [...currentHistory, { month: nextWeightHistoryMonth(currentHistory), kg: weightKg }];
    updateStudent(student!.id, { currentWeightKg: weightKg, weightHistory: newHistory });
  }

  function handleUpdateTarget(targetKg: number): Promise<boolean> | void {
    if (isSupabaseStudent) {
      return supabaseDetail.updateTarget(targetKg);
    }
    if (isLinked) {
      linkedProfile.updateProfile({ targetWeightKg: targetKg });
      return;
    }
    updateStudent(student!.id, { targetWeightKg: targetKg });
  }

  function handleUpdateMeasurements(
    values: Partial<Record<BodyMeasurementType, number>>,
    date: string,
    note: string,
    custom: CustomMeasurementInput | null,
  ) {
    if (isSupabaseStudent) {
      supabaseDetail.updateMeasurements(values, date, note, custom);
      return;
    }
    if (isLinked) {
      linkedProfile.updateMeasurements(values, date, note, custom);
      return;
    }
    const newHistoryEntries: MeasurementLogEntry[] = [];
    const measuredAt = date || new Date().toISOString().slice(0, 10);
    const createdAt = new Date().toISOString();

    const seenTypes = new Set<BodyMeasurementType>();
    const nextMeasurements = student!.measurements.map((m) => {
      const newValue = values[m.type];
      if (newValue === undefined) return m;
      seenTypes.add(m.type);
      newHistoryEntries.push({
        id: generateId("meas-log"),
        studentId: student!.id,
        key: m.type,
        label: bodyMeasurementLabels[m.type] ?? m.type,
        value: newValue,
        unit: m.unit,
        measuredAt,
        note,
        createdAt,
      });
      return { ...m, currentValue: newValue, note: note || m.note, lastUpdatedAt: date };
    });

    // Une mensuration préréglée saisie pour la première fois (aucun
    // enregistrement existant pour ce type chez cet élève) doit créer une
    // nouvelle ligne plutôt que d'être silencieusement ignorée — valeur de
    // départ = valeur actuelle ("Première mesure", évolution à 0).
    for (const type of Object.keys(values) as BodyMeasurementType[]) {
      const newValue = values[type];
      if (newValue === undefined || seenTypes.has(type)) continue;
      const unit = type === "poids" ? "kg" : "cm";
      nextMeasurements.push({
        id: generateId("meas"),
        studentId: student!.id,
        type,
        unit,
        startValue: newValue,
        currentValue: newValue,
        note,
        lastUpdatedAt: date,
      });
      newHistoryEntries.push({
        id: generateId("meas-log"),
        studentId: student!.id,
        key: type,
        label: bodyMeasurementLabels[type] ?? type,
        value: newValue,
        unit,
        measuredAt,
        note,
        createdAt,
      });
    }

    // Une mesure personnalisée déjà existante (même nom) est mise à jour
    // plutôt que dupliquée : la valeur de départ reste exploitable comme
    // historique (voir hooks/useStudentProfile.ts pour la même logique).
    let nextCustom = student!.customMeasurements;
    if (custom) {
      const normalizedName = custom.name.trim().toLowerCase();
      const existing = nextCustom.find((m) => m.name.trim().toLowerCase() === normalizedName);
      if (existing) {
        nextCustom = nextCustom.map((m) =>
          m.id === existing.id
            ? { ...m, currentValue: custom.value, note: custom.note || m.note, lastUpdatedAt: date }
            : m,
        );
        newHistoryEntries.push({
          id: generateId("meas-log"),
          studentId: student!.id,
          key: existing.id,
          label: existing.name,
          value: custom.value,
          unit: custom.unit,
          measuredAt,
          note: custom.note,
          createdAt,
        });
      } else {
        const newCustomId = generateId("custom");
        nextCustom = [
          ...nextCustom,
          {
            id: newCustomId,
            studentId: student!.id,
            name: custom.name,
            unit: custom.unit,
            startValue: custom.value,
            currentValue: custom.value,
            note: custom.note,
            lastUpdatedAt: date,
          },
        ];
        newHistoryEntries.push({
          id: generateId("meas-log"),
          studentId: student!.id,
          key: newCustomId,
          label: custom.name,
          value: custom.value,
          unit: custom.unit,
          measuredAt,
          note: custom.note,
          createdAt,
        });
      }
    }
    updateStudent(student!.id, {
      measurements: nextMeasurements,
      customMeasurements: nextCustom,
      measurementHistory: [...student!.measurementHistory, ...newHistoryEntries],
    });
  }

  function handleAddPhoto(photo: ProgressPhoto) {
    if (isSupabaseStudent) {
      supabaseDetail.addPhoto(photo);
      return;
    }
    if (isLinked) {
      linkedProfile.addPhoto(photo);
      return;
    }
    updateStudent(student!.id, { progressPhotos: [...student!.progressPhotos, photo] });
  }

  function handleDeletePhoto(photoId: string) {
    if (isSupabaseStudent) {
      supabaseDetail.deletePhoto(photoId);
      return;
    }
    if (isLinked) {
      linkedProfile.removePhoto(photoId);
      return;
    }
    updateStudent(student!.id, {
      progressPhotos: student!.progressPhotos.filter((photo) => photo.id !== photoId),
    });
  }

  function handleUpdatePayment(nextPaymentProfile: StudentPaymentProfile) {
    if (isSupabaseStudent) {
      supabaseDetail.updatePayment(nextPaymentProfile);
      return;
    }
    updateStudent(student!.id, { paymentProfile: nextPaymentProfile });
  }

  function applyStudentUpdate(partial: Partial<AdminStudent>): Promise<boolean> | void {
    if (isSupabaseStudent) {
      return supabaseDetail.updateStudentFields(partial);
    }
    updateStudent(student!.id, partial);
  }

  function handleAddCoachNote(text: string) {
    if (isSupabaseStudent) {
      supabaseDetail.addCoachNote(text);
      return;
    }
    addCoachNote(student!.id, text);
  }

  const assignedProgram = programs.find((p) => student.assignedProgramIds.includes(p.id));
  const assignedPlan = nutritionPlans.find((p) => student.assignedNutritionPlanIds.includes(p.id));
  // Documents : élève réel -> disponibilité réelle (déblocage propre à
  // l'assignation puis règle du document, voir lib/supabase/documents.ts) ;
  // élève mock -> calcul existant (computeDocumentAvailability + déblocages
  // manuels localStorage).
  const documentsWithAvailability = isSupabaseStudent
    ? studentDocuments.documents
    : documents
        .filter((d) => student.assignedDocumentIds.includes(d.id))
        .map((d) => ({
          document: d,
          availability: computeDocumentAvailability(
            student,
            d,
            manualDocumentUnlocks.filter((u) => u.studentId === student.id),
          ),
        }));
  const availableDocuments = documentsWithAvailability.filter((d) => d.availability.available);
  const lockedDocuments = documentsWithAvailability.filter((d) => !d.availability.available);

  async function handleUnlockDocument(documentId: string) {
    if (isSupabaseStudent) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        await unlockDocumentForStudentSupabase(supabase, student!.id, documentId);
        await studentDocuments.refetch();
        return;
      }
    }
    unlockDocumentForStudent(student!.id, documentId);
  }

  async function handleUnlockAllDocuments() {
    if (isSupabaseStudent) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        for (const { document } of lockedDocuments) {
          await unlockDocumentForStudentSupabase(supabase, student!.id, document.id);
        }
        await studentDocuments.refetch();
        return;
      }
    }
    unlockAllDocumentsForStudent(student!.id);
  }

  /**
   * Suppression complète et définitive (chantier "bouton suppression
   * élève") — fiche, toutes les données liées (cascade FK), fichiers
   * Storage de progression et compte de connexion. Réservée aux élèves
   * Supabase réels (isSupabaseStudent) : un élève mock n'a rien à supprimer
   * côté serveur. window.confirm reprend le même garde-fou que le bouton
   * "Archiver l'élève" juste au-dessus, en insistant sur l'irréversibilité
   * (contrairement à l'archivage, qui reste réversible).
   */
  async function handleDeleteStudent() {
    if (
      !window.confirm(
        `Supprimer définitivement ${student.firstName} ${student.lastName} ? Cette action est IRRÉVERSIBLE : le profil, l'historique, les photos et l'accès de connexion seront tous supprimés.`,
      )
    ) {
      return;
    }
    setDeleteError(false);
    setDeleting(true);
    const response = await fetch(`/api/admin/students/${student.id}`, { method: "DELETE" });
    if (!response.ok) {
      setDeleting(false);
      setDeleteError(true);
      return;
    }
    router.push("/admin/eleves");
  }

  const studentFeedback = (isSupabaseStudent ? supabaseDetail.feedback : feedback.filter((f) => f.studentId === student.id))
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const daysSinceStart = daysBetween(student.startDate);
  const currentWeekNumber = assignedProgram
    ? Math.min(
        assignedProgram.durationWeeks,
        Number.isFinite(daysSinceStart) ? Math.max(1, Math.floor(daysSinceStart / 7) + 1) : 1,
      )
    : 1;
  const currentWeekMetrics = assignedProgram
    ? calculateWeekMetrics(assignedProgram.sessions, currentWeekNumber, selectedMuscleGroup)
    : null;

  const trainingFeedback = studentFeedback.filter((f) => f.type === "entrainement" && f.exerciseEntries.length > 0);
  const lastCompletedSession = trainingFeedback[0];
  const matchingPlannedSession =
    assignedProgram && lastCompletedSession
      ? assignedProgram.sessions.find(
          (s) => !s.isRestDay && s.name.toLowerCase() === lastCompletedSession.refLabel.toLowerCase(),
        )
      : undefined;
  const plannedVsActual =
    matchingPlannedSession && lastCompletedSession
      ? calculatePlannedVsActualMetrics(matchingPlannedSession, lastCompletedSession.exerciseEntries)
      : null;

  return (
    <div>
      <Link href="/admin/eleves" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Élèves
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              {fullName(student)}
            </h1>
            <StatusBadge label={studentStatusLabels[student.status]} tone={studentStatusTone(student.status)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {student.email} · Élève depuis le {formatDate(student.startDate)}
          </p>
          {isLinked && (
            <p className="mt-1 text-xs text-primary">
              Compte relié à l&apos;espace élève connecté — le poids, les mensurations et les photos ajoutés ici
              apparaissent directement dans /profil.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isSupabaseStudent && (
            <Link
              href={`/admin/eleves/${student.id}/progression`}
              className="flex items-center gap-1.5 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <TrendingUp size={14} />
              Progression
            </Link>
          )}
          <EditStudentModal student={student} onSave={applyStudentUpdate} />
          <AssignContentToStudentModal
            student={student}
            programs={programs}
            nutritionPlans={nutritionPlans}
            documents={documents}
            onSetAssignment={handleSetAssignment}
            isSupabaseStudent={isSupabaseStudent}
            canAssignRealPrograms={canAssignRealPrograms}
            canAssignRealNutrition={canAssignRealNutrition}
            canAssignRealDocuments={canAssignRealDocuments}
          />
          <AddCoachNoteModal onAdd={handleAddCoachNote} />
          {isSupabaseStudent && (
            <AdminOnboardingDetailModal studentId={student.id} student={student} onSaved={supabaseDetail.refetch} />
          )}
          <button
            type="button"
            onClick={async () => {
              setStatusActionError(false);
              const result = await applyStudentUpdate({ status: student.status === "pause" ? "actif" : "pause" });
              if (result === false) setStatusActionError(true);
            }}
            className="flex items-center gap-1.5 border border-amber-500/50 px-4 py-2 text-xs uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/10"
          >
            {student.status === "pause" ? <Play size={13} /> : <Pause size={13} />}
            {student.status === "pause" ? "Réactiver" : "Mettre en pause"}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`Archiver ${student.firstName} ${student.lastName} ? L'élève restera consultable mais ne sera plus actif.`)) {
                return;
              }
              setStatusActionError(false);
              const result = await applyStudentUpdate({ status: "terminé" });
              if (result === false) {
                setStatusActionError(true);
                return;
              }
              router.push("/admin/eleves");
            }}
            className="flex items-center gap-1.5 border border-red-500/50 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
          >
            <Archive size={13} />
            Archiver l&apos;élève
          </button>
          {isSupabaseStudent && (
            <button
              type="button"
              onClick={handleDeleteStudent}
              disabled={deleting}
              className="flex items-center gap-1.5 border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={13} />
              {deleting ? "Suppression…" : "Supprimer définitivement"}
            </button>
          )}
        </div>
        {statusActionError && (
          <p className="mt-2 flex w-full items-center gap-2 text-xs text-red-400">
            <AlertTriangle size={14} className="flex-shrink-0" />
            Échec de la mise à jour du statut. Réessaie.
          </p>
        )}
        {deleteError && (
          <p className="mt-2 flex w-full items-center gap-2 text-xs text-red-400">
            <AlertTriangle size={14} className="flex-shrink-0" />
            Échec de la suppression. Réessaie.
          </p>
        )}
      </div>

      <div className="mb-6">
        <WeightEvolutionCard
          profile={weightProfile}
          history={weightHistory}
          onUpdateWeight={handleUpdateWeight}
          onUpdateTarget={handleUpdateTarget}
        />
      </div>

      <div className="mb-6">
        <ProgressPhotoGallerySection
          studentId={student.id}
          photos={photos}
          defaultWeightKg={student.currentWeightKg}
          onAdd={handleAddPhoto}
          onDelete={handleDeletePhoto}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminSection title="Informations personnelles">
          <InfoRow label="Téléphone" value={formatTextOrEmpty(student.phone)} />
          <InfoRow label="Âge" value={formatNumberOrEmpty(student.age, " ans")} />
          <InfoRow label="Taille" value={formatNumberOrEmpty(student.heightCm, " cm")} />
          <InfoRow label="Poids actuel" value={formatNumberOrEmpty(student.currentWeightKg, " kg")} />
          <InfoRow label="Poids de départ" value={formatNumberOrEmpty(student.startWeightKg, " kg")} />
          <InfoRow label="Objectif de poids" value={formatNumberOrEmpty(student.targetWeightKg, " kg")} />
          <InfoRow label="Objectif principal" value={formatTextOrEmpty(student.goal)} />
          <InfoRow label="Niveau sportif" value={formatTextOrEmpty(student.level)} />
          <InfoRow
            label="Fréquence d'entraînement"
            value={formatNumberOrEmpty(student.trainingFrequencyPerWeek, "x / semaine")}
          />
          <InfoRow label="Lieu" value={formatTextOrEmpty(student.trainingLocation)} />
          <InfoRow label="Dernière connexion" value={student.lastLoginAt ? formatDateTime(student.lastLoginAt) : "Jamais"} />
        </AdminSection>

        <MeasurementsSection
          measurements={measurements}
          customMeasurements={customMeasurements}
          measurementHistory={measurementHistory}
          onSave={handleUpdateMeasurements}
        />
      </div>

      <div className="mb-6">
        {isSupabaseStudent ? (
          <StudentSubscriptionSection studentId={student.id} profile={student.paymentProfile} onUpdatePayment={handleUpdatePayment} />
        ) : (
          <PaymentSection studentId={student.id} profile={student.paymentProfile} onUpdate={handleUpdatePayment} />
        )}
      </div>

      {onboardingProfile ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <AdminSection title="Préférences alimentaires">
              <div className="flex flex-col gap-4">
                <InfoRow label="Régime particulier" value={formatTextOrEmpty(onboardingProfile.dietType)} />
                <InfoRow
                  label="Repas par jour"
                  value={formatNumberOrEmpty(onboardingProfile.preferredMealCount ?? 0, "")}
                />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Aliments aimés</span>
                  <TagList items={onboardingProfile.foodPreferences.liked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Aliments à éviter</span>
                  <TagList items={onboardingProfile.dislikedFoods} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Allergies</span>
                  <TagList items={onboardingProfile.allergies} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Intolérances</span>
                  <TagList items={onboardingProfile.intolerances} />
                </div>
                <InfoRow label="Horaires de repas" value={formatTextOrEmpty(onboardingProfile.mealTimingNotes)} />
                <InfoRow label="Contraintes travail / sociales" value={formatTextOrEmpty(onboardingProfile.workScheduleNotes)} />
                <InfoRow label="Notes nutrition" value={formatTextOrEmpty(onboardingProfile.nutritionNotes)} />
              </div>
            </AdminSection>

            <AdminSection title="Préférences sportives">
              <div className="flex flex-col gap-4">
                <InfoRow label="Objectif principal" value={formatTextOrEmpty(onboardingProfile.mainGoal)} />
                <InfoRow label="Niveau sportif" value={formatTextOrEmpty(student.level)} />
                <InfoRow
                  label="Fréquence d'entraînement"
                  value={formatNumberOrEmpty(student.trainingFrequencyPerWeek, "x / semaine")}
                />
                <InfoRow label="Lieu" value={formatTextOrEmpty(student.trainingLocation)} />
                <InfoRow label="Niveau d'activité / NEAT" value={formatTextOrEmpty(onboardingProfile.neatLevel)} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Sports pratiqués</span>
                  <TagList items={onboardingProfile.sportsPracticed} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Autres activités</span>
                  <TagList items={onboardingProfile.otherActivities} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Matériel disponible</span>
                  <TagList items={onboardingProfile.availableEquipment} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices préférés</span>
                  <TagList items={onboardingProfile.favoriteExercises} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices préférés à la salle</span>
                  <TagList items={onboardingProfile.favoriteGymExercises} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices à éviter</span>
                  <TagList items={onboardingProfile.avoidedExercises} />
                </div>
              </div>
            </AdminSection>
          </div>

          <div className="mb-6">
            <AdminSection title="Objectifs">
              <div className="flex flex-col gap-4">
                <InfoRow label="Objectif principal" value={formatTextOrEmpty(onboardingProfile.mainGoal)} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Objectifs secondaires</span>
                  <TagList items={onboardingProfile.secondaryGoals} />
                </div>
                <InfoRow label="Date cible" value={formatTextOrEmpty(onboardingProfile.targetDate ?? "")} />
                <InfoRow label="Délai souhaité" value={formatTextOrEmpty(onboardingProfile.targetTimeframe)} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Indicateurs suivis</span>
                  <TagList items={onboardingProfile.trackedIndicators} />
                </div>
              </div>
            </AdminSection>
          </div>

          <div className="mb-6 border border-amber-500/40 bg-amber-500/10 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-400" />
              <div className="flex-1">
                <h2 className="mb-3 font-heading text-sm font-bold uppercase text-amber-400">
                  Blessures et contraintes
                </h2>
                <div className="flex flex-col gap-3 text-sm text-amber-200/90">
                  <p>
                    <span className="mr-2 text-xs uppercase tracking-wide text-amber-400/80">Blessures :</span>
                    {formatTextOrEmpty(onboardingProfile.onboardingInjuries)}
                  </p>
                  <div>
                    <span className="mb-2 block text-xs uppercase tracking-wide text-amber-400/80">Exercices à éviter</span>
                    <TagList items={onboardingProfile.avoidedExercises} />
                  </div>
                  <p>
                    <span className="mr-2 text-xs uppercase tracking-wide text-amber-400/80">Notes santé :</span>
                    {formatTextOrEmpty(onboardingProfile.healthNotes)}
                  </p>
                  <p>
                    <span className="mr-2 text-xs uppercase tracking-wide text-amber-400/80">Traitements :</span>
                    {formatTextOrEmpty(onboardingProfile.medicalTreatments)}
                  </p>
                  <p>
                    <span className="mr-2 text-xs uppercase tracking-wide text-amber-400/80">Médicaments :</span>
                    {formatTextOrEmpty(onboardingProfile.medications)}
                  </p>
                  <p>
                    <span className="mr-2 text-xs uppercase tracking-wide text-amber-400/80">Notes coach :</span>
                    {formatTextOrEmpty(onboardingProfile.trainingNotes)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <AdminSection title="Préférences alimentaires">
              <div className="flex flex-col gap-4">
                <InfoRow label="Régime" value={formatTextOrEmpty(student.foodPreferences.diet)} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Aimés</span>
                  <TagList items={student.foodPreferences.liked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Non aimés</span>
                  <TagList items={student.foodPreferences.disliked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Intolérances</span>
                  <TagList items={student.foodPreferences.intolerances} />
                </div>
              </div>
            </AdminSection>

            <AdminSection title="Préférences sportives">
              <div className="flex flex-col gap-4">
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Sports</span>
                  <TagList items={student.sportPreferences.sports} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Matériel</span>
                  <TagList items={student.sportPreferences.equipment} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices préférés</span>
                  <TagList items={student.sportPreferences.preferredExercises} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices à éviter</span>
                  <TagList items={student.sportPreferences.exercisesToAvoid} />
                </div>
              </div>
            </AdminSection>
          </div>

          <div className="mb-6 border border-amber-500/40 bg-amber-500/10 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-400" />
              <div>
                <h2 className="mb-1 font-heading text-sm font-bold uppercase text-amber-400">
                  Blessures et contraintes
                </h2>
                <p className="text-sm text-amber-200/90">
                  {student.injuries.trim() ? student.injuries : "Aucune information renseignée."}
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AdminSection title="Programme actif">
          {assignedProgram ? (
            <div>
              <Link href={`/admin/programmes/${assignedProgram.id}`} className="text-sm text-primary hover:underline">
                {assignedProgram.name}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{assignedProgram.goal}</p>
              <button
                type="button"
                onClick={() => handleSetAssignment(student.id, "programme", assignedProgram.id, false)}
                className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
              >
                Retirer
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun programme attribué.</p>
          )}
        </AdminSection>
        <AdminSection title="Plan nutrition actif">
          {assignedPlan ? (
            <div>
              <Link href={`/admin/nutrition/${assignedPlan.id}`} className="text-sm text-primary hover:underline">
                {assignedPlan.name}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{assignedPlan.caloriesPerDay} kcal/jour</p>
              <button
                type="button"
                onClick={() => handleSetAssignment(student.id, "nutrition", assignedPlan.id, false)}
                className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
              >
                Retirer
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun plan attribué.</p>
          )}
        </AdminSection>
        <AdminSection
          title="Documents"
          action={
            lockedDocuments.length > 0 ? (
              <button
                type="button"
                onClick={() => void handleUnlockAllDocuments()}
                className="flex items-center gap-1.5 border border-primary px-3 py-1.5 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Unlock size={12} />
                Tout débloquer
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-3">
            <div>
              <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Disponibles ({availableDocuments.length})
              </span>
              {availableDocuments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun document disponible.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {availableDocuments.map(({ document }) => (
                    <li key={document.id} className="flex items-center justify-between gap-2 text-sm text-foreground">
                      {document.title}
                      {isSupabaseStudent && (
                        <button
                          type="button"
                          onClick={() => handleSetAssignment(student.id, "document", document.id, false)}
                          className="flex-shrink-0 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
                        >
                          Retirer
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lockedDocuments.length > 0 && (
              <div>
                <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Verrouillés ({lockedDocuments.length})
                </span>
                <ul className="flex flex-col gap-2">
                  {lockedDocuments.map(({ document, availability }) => (
                    <li key={document.id} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Lock size={12} />
                        {document.title}
                        {availability.unlockDate && ` · dès le ${formatDate(availability.unlockDate)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleUnlockDocument(document.id)}
                        className="flex-shrink-0 text-[11px] uppercase tracking-widest text-primary hover:underline"
                      >
                        Débloquer
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </AdminSection>
      </div>

      {isSupabaseStudent && assignedPlan && (
        <div className="mb-6 border border-border bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Suivi nutrition
          </h2>
          <NutritionWeekSummaryCard
            studentId={student.id}
            planId={assignedPlan.id}
            target={{
              calories: assignedPlan.caloriesPerDay,
              protein: assignedPlan.protein,
              carbs: assignedPlan.carbs,
              fat: assignedPlan.fat,
              weeklyTargetCalories: assignedPlan.weeklyTargetCalories,
            }}
          />
        </div>
      )}

      <div className="mb-6 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Retours récents
        </h2>
        {studentFeedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun retour pour le moment.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {studentFeedback.slice(0, 5).map((f) => (
              <div key={f.id} className="border border-border p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-foreground">
                    {feedbackTypeLabels[f.type]} · {f.refLabel}
                  </span>
                  <StatusBadge label={feedbackStatusLabels[f.status]} tone={feedbackStatusTone(f.status)} />
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(f.date)}</p>
                {f.comment && <p className="mt-2 text-sm text-foreground">{f.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {isSupabaseStudent && (
        <div className="mb-6 border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold uppercase text-foreground">
            <History size={18} className="text-primary" />
            Historique récent
          </h2>
          <ActivityFeed events={supabaseDetail.activityEvents} emptyLabel="Aucune activité récente pour cet élève." />
        </div>
      )}

      <div className="mb-6 border border-border bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold uppercase text-foreground">
          <Activity size={18} className="text-primary" />
          Charge d&apos;entraînement de l&apos;élève
        </h2>
        {!assignedProgram || !currentWeekMetrics ? (
          <p className="text-sm text-muted-foreground">Aucun programme attribué — pas de données de charge à afficher.</p>
        ) : (
          <div className="flex flex-col gap-6">
            <MuscleGroupFilterSelect value={selectedMuscleGroup} onChange={setSelectedMuscleGroup} />
            <UntaggedExercisesAlert show={currentWeekMetrics.hasUntaggedExercises} />
            <AnalysisFilterLabel selected={selectedMuscleGroup} />

            <div>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Semaine {currentWeekNumber} (actuelle)
              </h3>
              <TrainingStatCards
                totalSets={currentWeekMetrics.totalSets}
                totalVolume={currentWeekMetrics.totalVolume}
                totalTonnageKg={currentWeekMetrics.totalTonnageKg}
              />
            </div>

            {selectedMuscleGroup === "tous" ? (
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Séries par groupe musculaire (semaine actuelle)
                </h3>
                <MuscleGroupBars breakdown={currentWeekMetrics.muscleGroupBreakdown} />
              </div>
            ) : (
              <FilteredExerciseList exercises={currentWeekMetrics.exercises} />
            )}

            <div>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Dernière séance réalisée
              </h3>
              {lastCompletedSession ? (
                <p className="text-sm text-foreground">
                  {lastCompletedSession.refLabel} · {formatDate(lastCompletedSession.date)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun retour d&apos;entraînement enregistré pour le moment.</p>
              )}
            </div>

            {plannedVsActual?.actual && (
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Prévu vs réalisé — {lastCompletedSession?.refLabel}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="border border-border p-4">
                    <span className="mb-2 block text-[11px] uppercase tracking-widest text-muted-foreground">Prévu</span>
                    <TrainingStatCards
                      totalSets={plannedVsActual.planned.totalSets}
                      totalVolume={plannedVsActual.planned.totalVolume}
                      totalTonnageKg={plannedVsActual.planned.totalTonnageKg}
                    />
                  </div>
                  <div className="border border-primary/40 p-4">
                    <span className="mb-2 block text-[11px] uppercase tracking-widest text-primary">Réalisé</span>
                    <TrainingStatCards
                      totalSets={plannedVsActual.actual.totalSets}
                      totalVolume={plannedVsActual.actual.totalVolume}
                      totalTonnageKg={plannedVsActual.actual.totalTonnageKg}
                    />
                  </div>
                </div>
                {plannedVsActual.tonnageDeltaKg !== null && (
                  <p className="mt-3 text-sm text-foreground">
                    Tonnage réalisé : {formatTonnage(plannedVsActual.actual.totalTonnageKg)} / prévu :{" "}
                    {formatTonnage(plannedVsActual.planned.totalTonnageKg)}{" "}
                    <span className={plannedVsActual.tonnageDeltaKg >= 0 ? "text-green-400" : "text-red-400"}>
                      ({plannedVsActual.tonnageDeltaKg >= 0 ? "+" : ""}
                      {Math.round(plannedVsActual.tonnageDeltaKg).toLocaleString("fr-FR")} kg)
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Notes privées du coach
        </h2>
        {student.coachNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune note pour le moment.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {student.coachNotes
              .slice()
              .reverse()
              .map((note) => (
                <div key={note.id} className="border-l-2 border-primary bg-background/40 p-4">
                  <p className="text-sm text-foreground">{note.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(note.createdAt)}</p>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
