"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Plus } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { fullName } from "@/lib/admin";
import { appointmentTypes } from "@/types";
import type { AdminStudent, AppointmentType } from "@/types";

export interface AppointmentModalSaveData {
  studentId: string;
  title: string;
  description: string;
  appointmentType: AppointmentType;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
}

function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AppointmentModal({
  students,
  defaultDurationMinutes,
  onSave,
}: {
  students: AdminStudent[];
  defaultDurationMinutes: number;
  onSave: (data: AppointmentModalSaveData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [appointmentType, setAppointmentType] = useState<AppointmentType>("Coaching en salle");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [startTime, setStartTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes);
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");

  useEffect(() => {
    if (studentId || students.length === 0) return;
    setStudentId(students[0].id);
  }, [students, studentId]);

  function close() {
    setOpen(false);
    setSaved(false);
  }

  function handleSave() {
    if (!studentId || !date || !startTime) return;
    const startAt = new Date(`${date}T${startTime}:00`);
    if (Number.isNaN(startAt.getTime())) return;
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
    onSave({
      studentId,
      title: title.trim() || appointmentType,
      description: description.trim(),
      appointmentType,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      location: location.trim(),
      meetingUrl: meetingUrl.trim(),
    });
    setSaved(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
      >
        <Plus size={14} />
        Créer un rendez-vous
      </button>

      {open && (
        <Modal title="Créer un rendez-vous" onClose={close} maxWidth="max-w-lg">
          {saved ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Rendez-vous créé.
            </div>
          ) : students.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun élève disponible pour le moment.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <SelectField
                label="Élève"
                value={studentId}
                onChange={setStudentId}
                options={students.map((s) => ({ value: s.id, label: fullName(s) }))}
              />
              <SelectField
                label="Type de rendez-vous"
                value={appointmentType}
                onChange={(v) => setAppointmentType(v as AppointmentType)}
                options={appointmentTypes.map((t) => ({ value: t, label: t }))}
              />
              <Field label="Titre (optionnel)" value={title} onChange={setTitle} placeholder={appointmentType} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Date" type="date" value={date} onChange={setDate} />
                <Field label="Heure de début" type="time" value={startTime} onChange={setStartTime} />
                <Field
                  label="Durée (min)"
                  type="number"
                  value={String(durationMinutes)}
                  onChange={(v) => setDurationMinutes(Number(v) || defaultDurationMinutes)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Lieu" value={location} onChange={setLocation} placeholder="Salle, adresse..." />
                <Field label="Lien visio" value={meetingUrl} onChange={setMeetingUrl} placeholder="https://..." />
              </div>
              <TextareaField label="Description" value={description} onChange={setDescription} rows={2} />
              <PrimaryButton onClick={handleSave}>Créer le rendez-vous</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
