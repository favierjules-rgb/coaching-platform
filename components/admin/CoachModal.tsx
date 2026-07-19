"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, Pencil, Plus } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
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
    role: coach.role ?? "assistant",
    status: coach.status ?? "actif",
    speciality: coach.speciality ?? "",
  };
}

export interface CoachSaveResult {
  ok: boolean;
  error?: string;
}

interface CoachModalProps {
  coach?: AdminCoach;
  /** Création (compte réel + email d'invitation, voir POST /api/admin/coaches) ou mise à jour d'une fiche existante. */
  onSave: (data: Omit<AdminCoach, "id" | "userId" | "createdAt" | "updatedAt">) => Promise<CoachSaveResult>;
}

export function CoachModal({ coach, onSave }: CoachModalProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => formFromCoach(coach ?? {}));

  function setField<K extends keyof ReturnType<typeof formFromCoach>>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setSaved(false);
    setError("");
  }

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) return;
    setSaving(true);
    setError("");
    const result = await onSave({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      role: form.role as CoachRole,
      status: form.status as CoachAccountStatus,
      speciality: form.speciality.trim(),
    });
    setSaving(false);
    if (result.ok) {
      setSaved(true);
    } else {
      setError(result.error || "Échec de l'enregistrement.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(formFromCoach(coach ?? {}));
          setError("");
          setOpen(true);
        }}
        className={
          coach
            ? "flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            : "flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
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
              {coach ? "Coach mis à jour." : "Compte créé — un email d'invitation vient d'être envoyé."}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom" value={form.firstName} onChange={(v) => setField("firstName", v)} />
                <Field label="Nom" value={form.lastName} onChange={(v) => setField("lastName", v)} />
              </div>
              <div>
                <Field
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(v) => setField("email", v)}
                  disabled={Boolean(coach)}
                />
                {coach && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    L&apos;email de connexion ne peut pas être modifié ici.
                  </p>
                )}
              </div>
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
              {!coach && (
                <p className="text-xs text-muted-foreground">
                  Un compte réel est créé immédiatement : la personne reçoit un email pour définir son mot de passe
                  et a alors accès à l&apos;espace admin (mêmes droits que le compte principal).
                </p>
              )}
              {error && (
                <div className="flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  <AlertTriangle size={18} className="flex-shrink-0" />
                  {error}
                </div>
              )}
              <PrimaryButton onClick={handleSave} disabled={saving}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
