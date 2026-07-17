"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";

import { Logo } from "@/components/ui/Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Status = "checking" | "ready" | "invalid";

const VALID_OTP_TYPES: readonly EmailOtpType[] = ["recovery", "invite", "magiclink", "signup", "email_change", "email"];

function redirectPathForRole(role: string): string {
  return role === "student" ? "/dashboard" : "/admin";
}

/**
 * Formulaire "définir un nouveau mot de passe" (/reinitialiser-mot-de-passe)
 * — destination commune de trois liens Supabase distincts : le recovery de
 * /mot-de-passe-oublie, l'invite envoyé aux nouveaux élèves (coach ou achat
 * de programme public, voir lib/supabase/coach-student-provisioning.ts et
 * lib/supabase/public-program-provisioning.ts) et le magiclink d'auto-
 * connexion post-paiement (voir app/api/public/programs/checkout-status/route.ts).
 *
 * Chemin principal — ?token_hash=...&type=... : on échange nous-mêmes le
 * jeton contre une session via verifyOtp(). Avant, ces liens pointaient vers
 * l'URL "action_link" hébergée par Supabase (/auth/v1/verify?...&redirect_to=...),
 * qui redirige ENSUITE vers cette page avec la session dans le hash — mais
 * GoTrue tronque silencieusement redirect_to (y compris le chemin
 * /reinitialiser-mot-de-passe) dès qu'il ne correspond pas EXACTEMENT à une
 * entrée de la liste "Redirect URLs" du dashboard Supabase (les wildcards
 * `**` n'ont pas suffi en pratique pour les liens générés côté admin), ce
 * qui a cassé ce flux en prod (17/07/2026 — mot de passe admin écrasé sans
 * le vouloir, puis liens de récupération systématiquement "invalides"). En
 * passant nous-mêmes le hashed_token en paramètre de requête vers CETTE
 * page et en appelant verifyOtp() ici, on n'a plus jamais besoin de la
 * redirection hébergée par Supabase ni de sa liste d'URLs autorisées.
 *
 * Repli — #access_token=... (detectSessionInUrl, activé par défaut côté
 * @supabase/ssr) : conservé pour tout ancien lien déjà envoyé/en cache avant
 * ce correctif.
 *
 * Garde anti-collision multi-onglets : le client Supabase stocke la session
 * dans localStorage, PARTAGÉ par tous les onglets du même navigateur/profil.
 * Si un autre onglet (ex. une session admin déjà ouverte) réécrit cette
 * clé entre le moment où le lien est traité et le clic sur "Valider", le
 * mot de passe pourrait être appliqué au mauvais compte. On mémorise donc
 * l'utilisateur ciblé dès que la session est prête, et on revérifie juste
 * avant l'appel updateUser que la session courante correspond toujours à ce
 * même utilisateur — sinon on refuse plutôt que d'écraser un autre compte.
 */
export function ResetPasswordForm({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordId = useId();
  const confirmId = useId();

  const [supabase] = useState(() => (supabaseConfigured ? createSupabaseBrowserClient() : null));
  const [status, setStatus] = useState<Status>(supabase ? "checking" : "invalid");
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;

    let settled = false;
    function markReady(userId: string) {
      if (settled) return;
      settled = true;
      setTargetUserId(userId);
      setStatus("ready");
    }

    const tokenHash = searchParams.get("token_hash");
    const typeParam = searchParams.get("type");
    if (tokenHash && typeParam && (VALID_OTP_TYPES as string[]).includes(typeParam)) {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: typeParam as EmailOtpType }).then(({ data, error: verifyError }) => {
        if (verifyError || !data.session) {
          if (!settled) setStatus("invalid");
          return;
        }
        markReady(data.session.user.id);
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        markReady(session.user.id);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady(data.session.user.id);
    });

    // L'échange token_hash / le hash d'auth peuvent mettre un instant à être
    // traités au premier chargement — on laisse une marge avant de conclure
    // à un lien invalide/expiré plutôt que d'afficher l'erreur trop tôt.
    const timeout = setTimeout(() => {
      if (!settled) setStatus("invalid");
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase, searchParams]);

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
    if (!supabase) {
      setError("Supabase n'est pas configuré sur cet environnement.");
      return;
    }

    setLoading(true);

    // Revérification anti-collision : si un autre onglet a réécrit la
    // session partagée entre-temps, la session courante ne correspond plus
    // à l'utilisateur détecté à l'ouverture du lien — on refuse plutôt que
    // de modifier le mot de passe d'un autre compte.
    const { data: currentSession } = await supabase.auth.getSession();
    if (!currentSession.session || currentSession.session.user.id !== targetUserId) {
      setLoading(false);
      setError(
        "La session a changé pendant que tu remplissais ce formulaire (un autre onglet connecté dans le même navigateur ?). Réouvre le lien reçu par email dans une fenêtre privée/navigation privée, seule, puis réessaie.",
      );
      return;
    }

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
