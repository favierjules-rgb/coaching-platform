"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";

import { AuthCardLayout } from "@/components/shared/AuthCardLayout";

/**
 * Formulaire "mot de passe oublié" (/mot-de-passe-oublie) — passe par
 * /api/public/password-reset (jamais `supabase.auth.resetPasswordForEmail`
 * côté client directement, qui déclenche l'email par défaut de Supabase
 * Auth, non brandé) pour recevoir le même template Resend/SETH que les
 * autres emails transactionnels. Message de confirmation identique que
 * l'email existe ou non côté auth.users, pour ne jamais laisser deviner si
 * une adresse a un compte.
 */
export function ForgotPasswordForm({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const emailId = useId();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    setLoading(true);
    try {
      await fetch("/api/public/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Toujours "envoyé" côté UI même en cas d'erreur réseau ponctuelle —
      // évite de révéler quoi que ce soit sur l'existence d'un compte.
    }
    setLoading(false);
    setSent(true);
  }

  const backToLoginFooter = (
    <Link
      href="/connexion"
      className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
    >
      <ArrowLeft size={14} />
      Retour à la connexion
    </Link>
  );

  if (sent) {
    return (
      <AuthCardLayout cardClassName="text-center" footer={backToLoginFooter}>
        <MailCheck size={28} className="mx-auto mb-4 text-primary" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">Email envoyé</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Si un compte existe pour {email.trim()}, un lien pour réinitialiser ton mot de passe vient de t&apos;être
          envoyé.
        </p>
      </AuthCardLayout>
    );
  }

  return (
    <AuthCardLayout footer={backToLoginFooter}>
      <h1 className="mb-1 font-heading text-2xl font-extrabold uppercase text-foreground">Mot de passe oublié</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Indique ton email, on t&apos;envoie un lien pour en choisir un nouveau.
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

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !supabaseConfigured}
          className="mt-2 bg-primary py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
        >
          {loading ? "Envoi..." : "Envoyer le lien"}
        </button>
      </form>
    </AuthCardLayout>
  );
}
