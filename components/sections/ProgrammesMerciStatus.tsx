"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Loader } from "@/components/ui/Loader";

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 14; // ~20s, au-delà on bascule sur le message email.

type Phase = "checking" | "ready" | "fallback";

/** Ce que le backend a pu confirmer sur la remise du lien d'activation. */
type RemiseLien = "confirmee" | "inconnue";

/** Destinations acceptées : jamais une URL fournie librement par l'API. */
const DESTINATIONS_AUTORISEES = new Set(["/connexion"]);

/**
 * Corps interactif de /programmes/merci (voir page.tsx) — Client Component
 * car il doit lire ?session_id= et interroger
 * /api/public/programs/checkout-status pour savoir quand le webhook Stripe
 * (source de vérité du provisionnement) a fini de créer le compte. Sans
 * session_id (retour du parcours gratuit /claim, qui ne passe jamais par
 * Stripe), affiche directement le message "vérifie ton email" — rien à
 * poller.
 *
 * Correctif de sécurité H-1 (audit du 27/07/2026) : ce composant
 * redirigeait auparavant vers `body.loginUrl`, un magiclink Supabase que la
 * route renvoyait au navigateur. Un `session_id` — visible dans l'URL, donc
 * dans l'historique et les journaux — suffisait alors à prendre le contrôle
 * du compte. La route ne renvoie plus aucun lien d'authentification ; le
 * lien de définition de mot de passe part uniquement par email, côté
 * serveur. Ici, on se contente d'annoncer que l'accès est prêt et de
 * proposer /connexion.
 *
 * `redirectTo` est de surcroît confronté à une liste blanche : même si la
 * réponse changeait, aucune destination arbitraire ne pourrait être suivie.
 */
export function ProgrammesMerciStatus() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [phase, setPhase] = useState<Phase>(sessionId ? "checking" : "fallback");
  const [destination, setDestination] = useState("/connexion");
  const [remiseLien, setRemiseLien] = useState<RemiseLien>("inconnue");
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
        if (body?.ready) {
          const cible = typeof body.redirectTo === "string" ? body.redirectTo : "";
          if (DESTINATIONS_AUTORISEES.has(cible)) setDestination(cible);
          // On n'affirme un envoi que si le backend l'a confirmé.
          setRemiseLien(body.accessEmailSent === true ? "confirmee" : "inconnue");
          setPhase("ready");
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

  if (phase === "checking") {
    return (
      <div className="w-full max-w-md border border-border bg-zinc-950 p-8">
        {/* ⚠️ Même raison qu'ailleurs : le cercle générique de lucide cède la
            place à l'emblème, seule identité de chargement du site. */}
        <Loader libelle="Préparation de ton accès…" variante="ligne" className="mb-2" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">Un instant...</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">On prépare ton accès.</p>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="w-full max-w-md border border-border bg-zinc-950 p-8">
        <MailCheck size={28} className="mx-auto mb-4 text-primary" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">Ton accès est prêt !</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {remiseLien === "confirmee"
            ? "On vient de t'envoyer un email avec un lien pour définir ton mot de passe. Une fois c'est fait, tu retrouves ton programme dans ton espace."
            : "Ton programme est bien enregistré. L'email contenant ton lien de connexion arrive dans les prochaines minutes — pense à vérifier tes spams. S'il n'arrive pas, tu peux demander un lien depuis la page de connexion."}
        </p>
        <Link
          href={destination}
          className="mt-6 inline-block border border-border px-6 py-3 text-xs uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Aller à la connexion
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md border border-border bg-zinc-950 p-8">
      <MailCheck size={28} className="mx-auto mb-4 text-primary" />
      <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">C&apos;est fait !</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Ton accès est en cours de préparation. Un email contenant ton lien de connexion doit arriver dans les
        prochaines minutes — pense à vérifier tes spams. S&apos;il n&apos;arrive pas, tu peux demander un lien depuis la
        page de connexion.
      </p>
    </div>
  );
}
