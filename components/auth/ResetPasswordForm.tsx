"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Status = "checking" | "ready" | "invalid";

function redirectPathForRole(role: string): string {
  return role === "student" ? "/dashboard" : "/admin";
}

/**
 * Formulaire "définir un nouveau mot de passe" (/reinitialiser-mot-de-passe)
 * — destination commune de trois liens Supabase distincts, tous du type
 * "l'utilisateur arrive avec un access_token dans l'URL" : le recovery de
 * /mot-de-passe-oublie, l'invite envoyé aux nouveaux acheteurs de programme
 * public (voir lib/supabase/public-program-provisioning.ts) et le magiclink
 * d'auto-connexion post-paiement (voir
 * app/api/public/programs/checkout-status/route.ts). Dans les trois cas,
 * @supabase/ssr détecte le token dans l'URL au chargement (detectSessionInUrl,
 * activé par défaut) et établit une session avant même que ce composant ne
 * s'affiche — on attend juste que ce soit fait avant de montrer le
 * formulaire. Après confirmation, /dashboard redirige lui-même vers
 * /entrainement pour un compte "programme_seul" (voir lib/supabase/guards.ts)
 * — inutile de le gérer ici.
 */
export function ResetPasswordForm({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const router = useRouter();
  const passwordId = useId();
  const confirmId = useId();

  const [supabase] = useState(() => (supabaseConfigured ? createSupabaseBrowserClient() : null));
  const [status, setStatus] = useState<Status>(supabase ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;

    let settled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session && !settled) {
        settled = true;
        setStatus("ready");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !settled) {
        settled = true;
        setStatus("ready");
      }
    });

    // Le hash d'auth peut mettre un instant à être traité au premier
    // chargement — on laisse une marge avant de conclure à un lien
    // invalide/expiré plutôt que d'afficher l'erreur trop tôt.
    const timeout = setTimeout(() => {
      if (!settled) setStatus("invalid");
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("8 caractères minimum.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase n'est pas configuré sur cet environnement.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError("Impossible de mettre à jour le mot de passe. Redemande un lien.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const profileRole = userData.user
      ? (await supabase.from("profiles").select("role").eq("user_id", userData.user.id).maybeSingle()).data?.role
      : null;

    router.push(profileRole ? redirectPathForRole(profileRole) : "/connexion");
    router.refresh();
  }

  if (status === "checking") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
        <div className="mb-8">
          <Logo />
        </div>
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
        <div className="mb-8">
          <Logo />
        </div>
        <div className="w-full max-w-md border border-border bg-card p-8 text-center">
          <AlertCircle size={28} className="mx-auto mb-4 text-red-400" />
          <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">Lien invalide</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ce lien est invalide ou a expiré. Redemande un lien pour définir ton mot de passe.
          </p>
        </div>
        <Link
          href="/mot-de-passe-oublie"
          className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft size={14} />
          Redemander un lien
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>

      <div className="w-full max-w-md border border-border bg-card p-8">
        <h1 className="mb-1 font-heading text-2xl font-extrabold uppercase text-foreground">
          Ton mot de passe
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">Choisis un mot de passe pour ton espace coaching.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor={passwordId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Nouveau mot de passe
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor={confirmId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Confirme-le
            </label>
            <input
              id={confirmId}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-primary py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
          >
            {loading ? "Enregistrement..." : "Valider et accéder à mon espace"}
          </button>
        </form>
      </div>
    </div>
  );
}
