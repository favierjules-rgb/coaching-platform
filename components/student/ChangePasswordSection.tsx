"use client";

import { useId, useState, type FormEvent } from "react";
import { Check } from "lucide-react";

import { ProfileSection } from "@/components/student/ProfileSection";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Changement de mot de passe pour un compte déjà connecté — distinct du flux
 * /reinitialiser-mot-de-passe (récupération par email, session pas encore
 * active) : ici la session est déjà active, `supabase.auth.updateUser`
 * suffit, aucun lien de récupération nécessaire. Affichée dans la version
 * "essentiel" de /profil (comptes programme_seul) via ProfilPageContent.
 */
export function ChangePasswordSection() {
  const passwordId = useId();
  const confirmId = useId();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(false);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Service indisponible pour le moment.");
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError("Échec de la mise à jour. Réessaie dans quelques instants.");
      return;
    }
    setSuccess(true);
    setPassword("");
    setConfirm("");
  }

  return (
    <ProfileSection title="Mot de passe">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor={passwordId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Nouveau mot de passe
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={confirmId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Confirmer le mot de passe
          </label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && (
          <p className="flex items-center gap-1.5 text-sm text-primary">
            <Check size={14} aria-hidden="true" /> Mot de passe mis à jour.
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="self-start bg-primary px-6 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Mise à jour..." : "Changer le mot de passe"}
        </button>
      </form>
    </ProfileSection>
  );
}
