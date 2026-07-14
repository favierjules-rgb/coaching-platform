"use client";

import { useEffect, useId, useState } from "react";
import { ProfileSection } from "@/components/student/ProfileSection";

type LoadState = "loading" | "ready" | "error";

export function NewsletterPreferenceToggle() {
  const toggleId = useId();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [subscribed, setSubscribed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/newsletter/preference");
        if (!response.ok) throw new Error("load_failed");
        const data = (await response.json()) as { subscribed: boolean };
        if (!cancelled) {
          setSubscribed(Boolean(data.subscribed));
          setLoadState("ready");
        }
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setError(null);
    const previous = subscribed;
    setSubscribed(next); // optimistic

    try {
      const response = await fetch("/api/newsletter/preference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscribed: next }),
      });
      if (!response.ok) throw new Error("save_failed");
      const data = (await response.json()) as { subscribed: boolean };
      setSubscribed(Boolean(data.subscribed));
    } catch {
      setSubscribed(previous);
      setError("Impossible d'enregistrer votre préférence. Réessayez plus tard.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileSection title="Préférences email">
      {loadState === "loading" ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger vos préférences email.
        </p>
      ) : (
        <div className="flex items-start gap-3">
          <input
            id={toggleId}
            type="checkbox"
            checked={subscribed}
            disabled={saving}
            onChange={(event) => handleToggle(event.target.checked)}
            className="mt-1"
          />
          <label htmlFor={toggleId} className="text-sm text-foreground">
            Recevoir les conseils et offres par email
            <span className="mt-1 block text-xs text-muted-foreground">
              Vous pouvez activer ou désactiver cette option à tout moment.
              Elle n&apos;est jamais activée automatiquement.
            </span>
          </label>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </ProfileSection>
  );
}
