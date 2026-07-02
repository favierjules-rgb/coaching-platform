"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Archive, Pause, Play } from "lucide-react";

import { AddCoachNoteModal } from "@/components/admin/AddCoachNoteModal";
import { AdminSection, InfoRow, TagList } from "@/components/admin/AdminSection";
import { AssignContentToStudentModal } from "@/components/admin/AssignContentToStudentModal";
import { EditStudentModal } from "@/components/admin/EditStudentModal";
import { StatusBadge, feedbackStatusTone, studentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import {
  feedbackStatusLabels,
  feedbackTypeLabels,
  formatDate,
  formatDateTime,
  fullName,
  studentStatusLabels,
} from "@/lib/admin";

export default function AdminStudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const router = useRouter();
  const { state, updateStudent, addCoachNote, setAssignment } = useAdminData();
  const { students, programs, nutritionPlans, documents, feedback } = state;

  const student = students.find((s) => s.id === params.studentId);

  if (!student) {
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

  const assignedProgram = programs.find((p) => student.assignedProgramIds.includes(p.id));
  const assignedPlan = nutritionPlans.find((p) => student.assignedNutritionPlanIds.includes(p.id));
  const assignedDocuments = documents.filter((d) => student.assignedDocumentIds.includes(d.id));
  const studentFeedback = feedback
    .filter((f) => f.studentId === student.id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
        </div>
        <div className="flex flex-wrap gap-2">
          <EditStudentModal student={student} onSave={(partial) => updateStudent(student.id, partial)} />
          <AssignContentToStudentModal
            student={student}
            programs={programs}
            nutritionPlans={nutritionPlans}
            documents={documents}
            onSetAssignment={setAssignment}
          />
          <AddCoachNoteModal onAdd={(text) => addCoachNote(student.id, text)} />
          <button
            type="button"
            onClick={() => updateStudent(student.id, { status: student.status === "pause" ? "actif" : "pause" })}
            className="flex items-center gap-1.5 border border-amber-500/50 px-4 py-2 text-xs uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/10"
          >
            {student.status === "pause" ? <Play size={13} /> : <Pause size={13} />}
            {student.status === "pause" ? "Réactiver" : "Mettre en pause"}
          </button>
          <button
            type="button"
            onClick={() => {
              updateStudent(student.id, { status: "terminé" });
              router.push("/admin/eleves");
            }}
            className="flex items-center gap-1.5 border border-red-500/50 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
          >
            <Archive size={13} />
            Archiver l&apos;élève
          </button>
        </div>
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

        <AdminSection title="Mensurations">
          {student.measurements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune mensuration enregistrée.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {student.measurements.map((m) => (
                <div key={m.label} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <span className="text-sm text-foreground">{m.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {m.startValueCm} → {m.currentValueCm} cm
                  </span>
                </div>
              ))}
            </div>
          )}
        </AdminSection>
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
            <p className="text-sm text-amber-200/90">{student.injuries}</p>
          </div>
        </div>
      </div>

      <div className="mb-6 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Photos de progression
        </h2>
        {student.progressPhotos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune photo enregistrée.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {student.progressPhotos.map((photo) => (
              <div key={photo.id} className="border border-border">
                <div className="flex aspect-[3/4] items-center justify-center bg-gradient-to-br from-zinc-900 to-black text-xs uppercase tracking-widest text-muted-foreground">
                  Photo
                </div>
                <div className="p-3 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>{formatDate(photo.date)}</span>
                    {photo.weightKg !== null && <span className="text-foreground">{photo.weightKg} kg</span>}
                  </div>
                  <p className="mt-1">{photo.note}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
        <AdminSection title="Documents attribués">
          {assignedDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun document attribué.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assignedDocuments.map((d) => (
                <li key={d.id}>
                  <Link href="/admin/documents" className="text-sm text-primary hover:underline">
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
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
