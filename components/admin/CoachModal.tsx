"use client";

import { useState } from "react";
import { CheckCircle, Pencil, Plus } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { coachRoleLabels, coachStatusLabels } from "@/lib/admin";
import type { AdminCoach, CoachAccountStatus, CoachRole } from "@/types";

const roleOptions = Object.entries(coachRoleLabels).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(coachStatusLabels).map(([value, label]) => ({ value, label }));

function formFromCoach(coach: Partial<AdminCoach>) {
  return {
    firstName: coach.firstName ?? "",
    lastName: coach.lastName ?? "",
    email: coach.email ?? "",
    role: coach.role ?? "coach",
    status: coach.status ?? "actif",
    speciality: coach.speciality ?? "",
    internalNote: coach.internalNote ?? "",
  };
}

interface CoachModalProps {
  coach?: AdminCoach;
  onSave: (data: Omit<AdminCoach, "id" | "createdAt" | "updatedAt">) => void;
}

export function CoachModal({ coach, onSave }: CoachModalProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(() => formFromCoach(coach ?? {}));

  function setField<K extends keyof ReturnType<typeof formFromCoach>>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setSaved(false);
  }

  function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) return;
    onSave({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      role: form.role as CoachRole,
      status: form.status as CoachAccountStatus,
      speciality: form.speciality.trim(),
      internalNote: form.internalNote.trim(),
    });
    setSaved(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(formFromCoach(coach ?? {}));
          setOpen(true);
        }}
        className={
          coach
            ? "flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            : "flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
        }
      >
        {coach ? <Pencil size={12} /> : <Plus size={14} />}
        {coach ? "Modifier" : "Ajouter un coach"}
      </button>

      {open && (
        <Modal title={coach ? "Modifier le coach" : "Ajouter un coach"} onClose={close} maxWidth="max-w-lg">
          {saved ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Coach enregistré.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom" value={form.firstName} onChange={(v) => setField("firstName", v)} />
                <Field label="Nom" value={form.lastName} onChange={(v) => setField("lastName", v)} />
              </div>
              <Field label="Email" type="email" value={form.email} onChange={(v) => setField("email", v)} />
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Rôle" value={form.role} onChange={(v) => setField("role", v as CoachRole)} options={roleOptions} />
                <SelectField
                  label="Statut"
                  value={form.status}
                  onChange={(v) => setField("status", v as CoachAccountStatus)}
                  options={statusOptions}
                />
              </div>
              <Field label="Spécialité" value={form.speciality} onChange={(v) => setField("speciality", v)} />
              <TextareaField label="Note interne" value={form.internalNote} onChange={(v) => setField("internalNote", v)} rows={2} />
              <PrimaryButton onClick={handleSave}>Enregistrer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
