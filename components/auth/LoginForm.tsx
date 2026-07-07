"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, FlaskConical } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateLastLoginTimestamp } from "@/lib/supabase/students";
import type { UserRole } from "@/types";

/**
 * Traduit les messages d'erreur Supabase Auth les plus courants en
 * français. Message générique par défaut plutôt que d'afficher le texte
 * anglais brut de l'API.
 */
function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Email ou mot de passe incorrect.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Ton email n'a pas encore été confirmé. Vérifie ta boîte mail.";
  }
  return "Une erreur est survenue lors de la connexion. Réessaie dans un instant.";
}

function redirectPathForRole(role: UserRole): string {
  return role === "student" ? "/dashboard" : "/admin";
}

export function LoginForm({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unknownRole, setUnknownRole] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUnknownRole(false);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase n'est pas configuré sur cet environnement.");
      return;
    }

    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.user) {
      setLoading(false);
      setError(translateAuthError(signInError?.message ?? ""));
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    setLoading(false);

    if (!profile) {
      setUnknownRole(true);
      return;
    }

    if (profile.role === "student") {
      await updateLastLoginTimestamp(supabase, data.user.id);
    }

    router.refresh();
    router.push(redirectPathForRole(profile.role));
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>

      <div className="w-full max-w-md border border-border bg-card p-8">
        <h1 className="mb-1 font-heading text-2xl font-extrabold uppercase text-foreground">
          Connexion
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Accède à ton espace coaching.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor={emailId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor={passwordId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Mot de passe
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {unknownRole && (
            <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              Ton compte est connecté, mais aucun profil ne lui est encore associé. Contacte ton
              coach pour finaliser ton accès.
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !supabaseConfigured}
            className="mt-2 bg-primary py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
          >
            {loading ? "Connexion..." : "Connexion"}
          </button>

          {!supabaseConfigured && (
            <p className="text-center text-xs text-muted-foreground">
              Supabase n&apos;est pas encore configuré — utilise les boutons de test ci-dessous.
            </p>
          )}
        </form>

        {!supabaseConfigured && (
          <div className="mt-6 border-t border-dashed border-border pt-6">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-amber-400">
              <FlaskConical size={14} />
              Mode test — temporaire tant que Supabase n&apos;est pas branché
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="border border-border px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Connexion mock élève
              </button>
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="border border-border px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Connexion mock coach/admin
              </button>
            </div>
          </div>
        )}
      </div>

      <Link
        href="/"
        className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft size={14} />
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
