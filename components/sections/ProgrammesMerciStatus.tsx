"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 14; // ~20s, au-delà on bascule sur le message email.

type Phase = "checking" | "redirecting" | "fallback";

/**
 * Corps interactif de /programmes/merci (voir page.tsx) — Client Component
 * car il doit lire ?session_id= et interroger
 * /api/public/programs/checkout-status pour offrir un accès direct dès que
 * le webhook Stripe (source de vérité pour le provisionnement, jamais
 * remise en cause ici) a fini de créer le compte, plutôt que de renvoyer
 * systématiquement vers l'email. Sans session_id (retour du parcours
 * gratuit /claim, qui ne passe jamais par Stripe), affiche directement le
 * message "vérifie ton email" — rien à poller.
 */
export function ProgrammesMerciStatus() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [phase, setPhase] = useState<Phase>(sessionId ? "checking" : "fallback");
  const attempts = useRef(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      attempts.current += 1;
      try {
        const res = await fetch(`/api/public/programs/checkout-status?session_id=${encodeURIComponent(sessionId as string)}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (body?.ready && body?.loginUrl) {
          setPhase("redirecting");
          window.location.href = body.loginUrl;
          return;
        }
      } catch {
        // Réseau instable : on retente simplement au prochain intervalle.
      }
      if (cancelled) return;
      if (attempts.current >= MAX_ATTEMPTS) {
        setPhase("fallback");
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  if (phase === "checking" || phase === "redirecting") {
    return (
      <div className="w-full max-w-md border border-border bg-zinc-950 p-8">
        <Loader2 size={28} className="mx-auto mb-4 animate-spin text-primary" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">Un instant...</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          On prépare ton accès. Tu vas être redirigé automatiquement vers ton programme.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md border border-border bg-zinc-950 p-8">
      <MailCheck size={28} className="mx-auto mb-4 text-primary" />
      <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">C&apos;est fait !</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Ton accès est en cours de préparation. Tu vas recevoir un email dans les prochaines minutes avec un lien pour
        définir ton mot de passe et accéder directement à ton programme.
      </p>
    </div>
  );
}
