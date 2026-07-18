"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, RotateCcw, Trash2 } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { AdminSection } from "@/components/admin/AdminSection";
import { CoachModal, type CoachSaveResult } from "@/components/admin/CoachModal";
import { PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseCoaches } from "@/hooks/useSupabaseCoaches";
import { coachRoleLabels, coachStatusLabels, fullName } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateCoach as updateCoachRow } from "@/lib/supabase/coaches";
import type { AdminCoach } from "@/types";

const statusOptions = [
  { value: "en ligne", label: "En ligne" },
  { value: "maintenance", label: "Maintenance" },
];

export default function AdminSettingsPage() {
  const { state, updateCoachSettings, resetAdminData } = useAdminData();
  const { coachSettings } = state;
  const { coaches, currentUserId, refetch: refetchCoaches } = useSupabaseCoaches();

  const [form, setForm] = useState(coachSettings);
  const [saved, setSaved] = useState(false);
  const [syncedSettings, setSyncedSettings] = useState(coachSettings);
  if (coachSettings !== syncedSettings) {
    setSyncedSettings(coachSettings);
    setForm(coachSettings);
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    updateCoachSettings(form);
    setSaved(true);
  }

  async function handleCreateCoach(data: Omit<AdminCoach, "id" | "userId" | "createdAt" | "updatedAt">): Promise<CoachSaveResult> {
    // createCoachBodySchema (lib/api/schemas/coaches.ts) est en .strict() et
    // n'accepte pas "status" : un nouveau compte est toujours créé "actif"
    // (voir createCoachAccount) — le champ existe dans le formulaire pour
    // l'édition d'une fiche existante, jamais pour la création.
    const { firstName, lastName, email, role, speciality } = data;
    const response = await fetch("/api/admin/coaches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, role, speciality }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: json.error || "Échec de la création du compte." };
    }
    await refetchCoaches();
    return { ok: true };
  }

  async function handleUpdateCoach(
    coachId: string,
    data: Omit<AdminCoach, "id" | "userId" | "createdAt" | "updatedAt">,
  ): Promise<CoachSaveResult> {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return { ok: false, error: "Supabase non configuré." };
    const ok = await updateCoachRow(supabase, coachId, data);
    if (!ok) return { ok: false, error: "Échec de la mise à jour." };
    await refetchCoaches();
    return { ok: true };
  }

  async function handleDeleteCoach(coach: AdminCoach) {
    if (!window.confirm(`Supprimer définitivement le compte de ${fullName(coach)} ? Cette action est irréversible : son accès admin sera immédiatement révoqué.`)) {
      return;
    }
    setDeleteErrorId(null);
    setDeletingId(coach.id);
    const response = await fetch(`/api/admin/coaches/${coach.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!response.ok) {
      setDeleteErrorId(coach.id);
      return;
    }
    await refetchCoaches();
  }

  function handleReset() {
    if (window.confirm("Réinitialiser toutes les données de test admin (élèves, programmes, plans, documents, retours) ? Cette action efface le localStorage.")) {
      resetAdminData();
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Paramètres
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Version mockée — {coachSettings.mockVersion}</p>
      </div>

      <div className="flex flex-col gap-6">
        <AdminSection title="Informations coach">
          <div className="flex flex-col gap-4">
            <Field label="Nom du coach" value={form.coachName} onChange={(v) => setField("coachName", v)} />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setField("email", v)} />
            <SelectField
              label="Statut du site"
              value={form.siteStatus}
              onChange={(v) => setField("siteStatus", v as typeof form.siteStatus)}
              options={statusOptions}
            />
            {saved && (
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                <CheckCircle size={18} className="flex-shrink-0" />
                Informations enregistrées.
              </div>
            )}
            <PrimaryButton onClick={handleSave}>Enregistrer les informations</PrimaryButton>
          </div>
        </AdminSection>

        <AdminSection title="Coachs" action={<CoachModal onSave={handleCreateCoach} />}>
          {coaches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun coach enregistré.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {coaches.map((coach) => {
                const isSelf = Boolean(coach.userId) && coach.userId === currentUserId;
                return (
                  <div key={coach.id} className="flex flex-col gap-3 border border-border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">{fullName(coach)}</span>
                          <StatusBadge
                            label={coachStatusLabels[coach.status]}
                            tone={coach.status === "actif" ? "green" : "muted"}
                          />
                          {isSelf && <span className="text-[11px] uppercase tracking-widest text-muted-foreground">(Toi)</span>}
                        </div>
                        <span className="block text-xs text-muted-foreground">
                          {coach.email} · {coachRoleLabels[coach.role]}
                          {coach.speciality && ` · ${coach.speciality}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <CoachModal coach={coach} onSave={(data) => handleUpdateCoach(coach.id, data)} />
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCoach(coach)}
                            disabled={deletingId === coach.id}
                            className="flex items-center gap-1.5 border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                            {deletingId === coach.id ? "Suppression..." : "Supprimer"}
                          </button>
                        )}
                      </div>
                    </div>
                    {deleteErrorId === coach.id && (
                      <p className="flex items-center gap-2 text-xs text-red-400">
                        <AlertTriangle size={14} className="flex-shrink-0" />
                        Échec de la suppression. Réessaie.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </AdminSection>

        <div className="border border-red-500/40 bg-red-500/5 p-6">
          <h2 className="mb-2 font-heading text-sm font-bold uppercase text-red-400">Zone de test</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Réinitialise toutes les données admin mockées (élèves, programmes, plans, documents, retours) et
            revient aux données de départ. N&apos;affecte pas l&apos;espace élève.
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 border border-red-500/50 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
          >
            <RotateCcw size={13} />
            Réinitialiser les données de test
          </button>
        </div>
      </div>
    </div>
  );
}
