"use client";

import { useState } from "react";
import { CheckCircle, RotateCcw } from "lucide-react";

import { CheckboxField, Field, SelectField } from "@/components/admin/AdminFormFields";
import { AdminSection } from "@/components/admin/AdminSection";
import { PrimaryButton } from "@/components/admin/Modal";
import { useAdminData } from "@/hooks/useAdminData";

const statusOptions = [
  { value: "en ligne", label: "En ligne" },
  { value: "maintenance", label: "Maintenance" },
];

export default function AdminSettingsPage() {
  const { state, updateCoachSettings, resetAdminData } = useAdminData();
  const { coachSettings } = state;

  const [form, setForm] = useState(coachSettings);
  const [saved, setSaved] = useState(false);
  // Resynchronise le brouillon local dès que la source de vérité change
  // (hydratation post-SSR, ou reset) : ajustement pendant le rendu plutôt
  // que dans un effet, comme recommandé par React pour ce cas précis
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [syncedSettings, setSyncedSettings] = useState(coachSettings);
  if (coachSettings !== syncedSettings) {
    setSyncedSettings(coachSettings);
    setForm(coachSettings);
    // Ne touche pas à `saved` ici : ce bloc se déclenche aussi juste après
    // un enregistrement réussi (updateCoachSettings change coachSettings),
    // et effacerait sinon la confirmation qu'on vient d'afficher.
  }

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    updateCoachSettings(form);
    setSaved(true);
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
            <Field label="Nom de marque" value={form.brandName} onChange={(v) => setField("brandName", v)} />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setField("email", v)} />
          </div>
        </AdminSection>

        <AdminSection title="Apparence">
          <div className="flex flex-col gap-4">
            <Field label="Couleur d'accent (mockée)" value={form.accentColor} onChange={(v) => setField("accentColor", v)} />
            <CheckboxField
              label="Affichage compact"
              checked={form.compactDisplay}
              onChange={(v) => setField("compactDisplay", v)}
            />
          </div>
        </AdminSection>

        <AdminSection title="Statut du site">
          <SelectField
            label="Statut"
            value={form.siteStatus}
            onChange={(v) => setField("siteStatus", v as typeof form.siteStatus)}
            options={statusOptions}
          />
        </AdminSection>

        {saved && (
          <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            <CheckCircle size={18} className="flex-shrink-0" />
            Paramètres enregistrés.
          </div>
        )}

        <PrimaryButton onClick={handleSave}>Enregistrer les paramètres</PrimaryButton>

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
