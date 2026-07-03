"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Eye, Power, RotateCcw, ShieldAlert } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { AdminSection } from "@/components/admin/AdminSection";
import { CoachModal } from "@/components/admin/CoachModal";
import { PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { coachRoleLabels, coachStatusLabels, fullName } from "@/lib/admin";
import type { AdminAppearanceSettings } from "@/types";

const statusOptions = [
  { value: "en ligne", label: "En ligne" },
  { value: "maintenance", label: "Maintenance" },
];

const darkModeOptions = [
  { value: "sombre", label: "Sombre" },
  { value: "très sombre", label: "Très sombre" },
];

const cardStyleOptions = [
  { value: "angulaire", label: "Angulaire" },
  { value: "arrondi", label: "Légèrement arrondi" },
];

const densityOptions = [
  { value: "compacte", label: "Compacte" },
  { value: "normale", label: "Normale" },
  { value: "large", label: "Large" },
];

export default function AdminSettingsPage() {
  const {
    state,
    updateCoachSettings,
    updateAppearanceSettings,
    setMockAdminPassword,
    createCoach,
    updateCoach,
    resetAdminData,
  } = useAdminData();
  const { coachSettings, coaches, appearanceSettings, securitySettings } = state;

  const [form, setForm] = useState(coachSettings);
  const [saved, setSaved] = useState(false);
  const [syncedSettings, setSyncedSettings] = useState(coachSettings);
  if (coachSettings !== syncedSettings) {
    setSyncedSettings(coachSettings);
    setForm(coachSettings);
  }

  const [appearanceForm, setAppearanceForm] = useState(appearanceSettings);
  const [appearanceSaved, setAppearanceSaved] = useState(false);
  const [syncedAppearance, setSyncedAppearance] = useState(appearanceSettings);
  if (appearanceSettings !== syncedAppearance) {
    setSyncedAppearance(appearanceSettings);
    setAppearanceForm(appearanceSettings);
  }

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function setAppearanceField<K extends keyof AdminAppearanceSettings>(key: K, value: AdminAppearanceSettings[K]) {
    setAppearanceForm((prev) => ({ ...prev, [key]: value }));
    setAppearanceSaved(false);
  }

  function handleSave() {
    updateCoachSettings(form);
    setSaved(true);
  }

  function handleSaveAppearance() {
    updateAppearanceSettings(appearanceForm);
    setAppearanceSaved(true);
  }

  function handleSavePassword() {
    setPasswordError("");
    if (password.length < 4) {
      setPasswordError("Le mot de passe doit contenir au moins 4 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setMockAdminPassword(password);
    setPassword("");
    setConfirmPassword("");
    setPasswordSaved(true);
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

        <AdminSection title="Coachs" action={<CoachModal onSave={createCoach} />}>
          {coaches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun coach enregistré.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {coaches.map((coach) => (
                <div
                  key={coach.id}
                  className="flex flex-col gap-3 border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{fullName(coach)}</span>
                      <StatusBadge
                        label={coachStatusLabels[coach.status]}
                        tone={coach.status === "actif" ? "green" : "muted"}
                      />
                    </div>
                    <span className="block text-xs text-muted-foreground">
                      {coach.email} · {coachRoleLabels[coach.role]}
                      {coach.speciality && ` · ${coach.speciality}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CoachModal coach={coach} onSave={(data) => updateCoach(coach.id, data)} />
                    <button
                      type="button"
                      onClick={() => updateCoach(coach.id, { status: coach.status === "actif" ? "inactif" : "actif" })}
                      className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <Power size={12} />
                      {coach.status === "actif" ? "Désactiver" : "Réactiver"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminSection>

        <AdminSection title="Apparence du site">
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex flex-1 flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Couleur d&apos;accent
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={appearanceForm.accentColor}
                      onChange={(e) => setAppearanceField("accentColor", e.target.value)}
                      className="h-11 w-11 flex-shrink-0 cursor-pointer border border-border bg-background"
                    />
                    <Field label="" value={appearanceForm.accentColor} onChange={(v) => setAppearanceField("accentColor", v)} />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Couleur secondaire
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={appearanceForm.secondaryColor}
                      onChange={(e) => setAppearanceField("secondaryColor", e.target.value)}
                      className="h-11 w-11 flex-shrink-0 cursor-pointer border border-border bg-background"
                    />
                    <Field
                      label=""
                      value={appearanceForm.secondaryColor}
                      onChange={(v) => setAppearanceField("secondaryColor", v)}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <SelectField
                  label="Mode sombre"
                  value={appearanceForm.darkMode}
                  onChange={(v) => setAppearanceField("darkMode", v as AdminAppearanceSettings["darkMode"])}
                  options={darkModeOptions}
                />
                <SelectField
                  label="Style des cartes"
                  value={appearanceForm.cardStyle}
                  onChange={(v) => setAppearanceField("cardStyle", v as AdminAppearanceSettings["cardStyle"])}
                  options={cardStyleOptions}
                />
                <SelectField
                  label="Densité"
                  value={appearanceForm.density}
                  onChange={(v) => setAppearanceField("density", v as AdminAppearanceSettings["density"])}
                  options={densityOptions}
                />
              </div>
              <Field
                label="Style de titre / typographie"
                value={appearanceForm.titleStyle}
                onChange={(v) => setAppearanceField("titleStyle", v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Nom de marque (logo)"
                  value={appearanceForm.brandLogoText}
                  onChange={(v) => setAppearanceField("brandLogoText", v)}
                />
                <Field
                  label="Texte de marque / tagline"
                  value={appearanceForm.brandTagline}
                  onChange={(v) => setAppearanceField("brandTagline", v)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ces réglages sont mockés (stockés en localStorage). La couleur d&apos;accent est appliquée en direct
                sur l&apos;interface admin. Une table Supabase <code>settings</code> remplacera ce stockage plus
                tard.
              </p>
              {appearanceSaved && (
                <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                  <CheckCircle size={18} className="flex-shrink-0" />
                  Apparence enregistrée et appliquée.
                </div>
              )}
              <PrimaryButton onClick={handleSaveAppearance}>Enregistrer l&apos;apparence</PrimaryButton>
            </div>

            <div className="flex w-full flex-shrink-0 flex-col gap-3 lg:w-72">
              <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Eye size={13} />
                Prévisualisation rapide
              </span>
              <div
                className={`border p-5 ${appearanceForm.cardStyle === "arrondi" ? "rounded-xl" : ""}`}
                style={{ borderColor: appearanceForm.accentColor, backgroundColor: "var(--color-card)" }}
              >
                <div
                  className="mb-3 text-sm font-extrabold uppercase tracking-wide"
                  style={{ color: appearanceForm.accentColor }}
                >
                  {appearanceForm.brandLogoText || "SETH"}
                </div>
                <p className="mb-4 text-xs text-muted-foreground">{appearanceForm.brandTagline || "Préparation physique"}</p>
                <button
                  type="button"
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-widest text-white ${
                    appearanceForm.cardStyle === "arrondi" ? "rounded-lg" : ""
                  }`}
                  style={{ backgroundColor: appearanceForm.accentColor }}
                >
                  Bouton principal
                </button>
                <button
                  type="button"
                  className={`ml-2 border px-4 py-2 text-xs font-bold uppercase tracking-widest ${
                    appearanceForm.cardStyle === "arrondi" ? "rounded-lg" : ""
                  }`}
                  style={{ borderColor: appearanceForm.secondaryColor, color: appearanceForm.secondaryColor }}
                >
                  Secondaire
                </button>
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Sécurité admin">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />
              <span>
                Ceci n&apos;est <strong>pas</strong> un mécanisme de sécurité réel. Le mot de passe est stocké en
                clair dans le localStorage du navigateur, uniquement pour la démo. Il sera remplacé par une vraie
                authentification (Supabase Auth) avant toute mise en production.
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {securitySettings.mockPasswordSet
                ? `Mot de passe mock défini (${securitySettings.mockPasswordHint}).`
                : "Aucun mot de passe mock défini pour le moment."}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Nouveau mot de passe (mock)"
                type="password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setPasswordSaved(false);
                }}
              />
              <Field
                label="Confirmer le mot de passe"
                type="password"
                value={confirmPassword}
                onChange={(v) => {
                  setConfirmPassword(v);
                  setPasswordSaved(false);
                }}
              />
            </div>
            {passwordError && (
              <div className="flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <AlertTriangle size={18} className="flex-shrink-0" />
                {passwordError}
              </div>
            )}
            {passwordSaved && !passwordError && (
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                <CheckCircle size={18} className="flex-shrink-0" />
                Mot de passe mock enregistré.
              </div>
            )}
            <PrimaryButton onClick={handleSavePassword}>Enregistrer le mot de passe mock</PrimaryButton>
          </div>
        </AdminSection>

        <AdminSection title="Accès rapide">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Ces raccourcis mockés simulent une connexion sans authentification réelle — utiles pour naviguer
              rapidement entre les deux espaces pendant les tests.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                Se connecter en admin mock
              </Link>
              <Link
                href="/dashboard"
                className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Se connecter en élève mock
              </Link>
            </div>
          </div>
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
