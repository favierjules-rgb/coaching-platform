"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, Archive, Lock, Pause, Play, Unlock } from "lucide-react";

import { AddCoachNoteModal } from "@/components/admin/AddCoachNoteModal";
import { AdminSection, InfoRow, TagList } from "@/components/admin/AdminSection";
import { AssignContentToStudentModal } from "@/components/admin/AssignContentToStudentModal";
import { EditStudentModal } from "@/components/admin/EditStudentModal";
import { StatusBadge, feedbackStatusTone, studentStatusTone } from "@/components/admin/StatusBadge";
import { PaymentSection } from "@/components/admin/PaymentSection";
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
import { useStudentProfile } from "@/hooks/useStudentProfile";
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

export default function AdminStudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const router = useRouter();
  const { state, updateStudent, addCoachNote, setAssignment, unlockDocumentForStudent, unlockAllDocumentsForStudent } =
    useAdminData();
  const { students, programs, nutritionPlans, documents, feedback, manualDocumentUnlocks } = state;
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");

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

  function handleUpdateWeight(weightKg: number) {
    if (isSupabaseStudent) {
      supabaseDetail.updateWeight(weightKg);
      return;
    }
    if (isLinked) {
      linkedProfile.updateWeight(weightKg);
      return;
    }
    const currentHistory = Array.isArray(student!.weightHistory) ? student!.weightHistory : [];
    const newHistory = [...currentHistory, { month: nextWeightHistoryMonth(currentHistory), kg: weightKg }];
    updateStudent(student!.id, { currentWeightKg: weightKg, weightHistory: newHistory });
  }

  function handleUpdateTarget(targetKg: number) {
    if (isSupabaseStudent) {
      supabaseDetail.updateTarget(targetKg);
      return;
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

  function applyStudentUpdate(partial: Partial<AdminStudent>) {
    if (isSupabaseStudent) {
      supabaseDetail.updateStudentFields(partial);
      return;
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
  const assignedDocuments = documents.filter((d) => student.assignedDocumentIds.includes(d.id));
  const documentsWithAvailability = assignedDocuments.map((d) => ({
    document: d,
    availability: computeDocumentAvailability(
      student,
      d,
      manualDocumentUnlocks.filter((u) => u.studentId === student.id),
    ),
  }));
  const availableDocuments = documentsWithAvailability.filter((d) => d.availability.available);
  const lockedDocuments = documentsWithAvailability.filter((d) => !d.availability.available);

  const studentFeedback = feedback
    .filter((f) => f.studentId === student.id)
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
          <EditStudentModal student={student} onSave={applyStudentUpdate} />
          <AssignContentToStudentModal
            student={student}
            programs={programs}
            nutritionPlans={nutritionPlans}
            documents={documents}
            onSetAssignment={setAssignment}
          />
          <AddCoachNoteModal onAdd={handleAddCoachNote} />
          <button
            type="button"
            onClick={() => applyStudentUpdate({ status: student.status === "pause" ? "actif" : "pause" })}
            className="flex items-center gap-1.5 border border-amber-500/50 px-4 py-2 text-xs uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/10"
          >
            {student.status === "pause" ? <Play size={13} /> : <Pause size={13} />}
            {student.status === "pause" ? "Réactiver" : "Mettre en pause"}
          </button>
          <button
            type="button"
            onClick={() => {
              applyStudentUpdate({ status: "terminé" });
              router.push("/admin/eleves");
            }}
            className="flex items-center gap-1.5 border border-red-500/50 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
          >
            <Archive size={13} />
            Archiver l&apos;élève
          </button>
        </div>
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
          <InfoRow label="Téléphone" value={student.phone} />
          <InfoRow label="Âge" value={`${student.age} ans`} />
          <InfoRow label="Taille" value={`${student.heightCm} cm`} />
          <InfoRow label="Poids actuel" value={`${student.currentWeightKg} kg`} />
          <InfoRow label="Poids de départ" value={`${student.startWeightKg} kg`} />
          <InfoRow label="Objectif de poids" value={`${student.targetWeightKg} kg`} />
          <InfoRow label="Objectif principal" value={student.goal} />
          <InfoRow label="Niveau sportif" value={student.level} />
          <InfoRow label="Fréquence d'entraînement" value={`${student.trainingFrequencyPerWeek}x / semaine`} />
          <InfoRow label="Lieu" value={student.trainingLocation} />
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
        <PaymentSection
          studentId={student.id}
          profile={student.paymentProfile}
          onUpdate={handleUpdatePayment}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminSection title="Préférences alimentaires">
          <div className="flex flex-col gap-4">
            <InfoRow label="Régime" value={student.foodPreferences.diet} />
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

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AdminSection title="Programme actif">
          {assignedProgram ? (
            <div>
              <Link href={`/admin/programmes/${assignedProgram.id}`} className="text-sm text-primary hover:underline">
                {assignedProgram.name}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{assignedProgram.goal}</p>
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
                onClick={() => unlockAllDocumentsForStudent(student.id)}
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
                    <li key={document.id} className="text-sm text-foreground">
                      {document.title}
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
                        onClick={() => unlockDocumentForStudent(student.id, document.id)}
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
