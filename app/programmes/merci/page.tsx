import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";

import { ProgrammesMerciStatus } from "@/components/sections/ProgrammesMerciStatus";

export const metadata: Metadata = {
  title: "Merci — Seth Préparation Physique",
};

/**
 * Page de confirmation post-achat/réclamation (chantier module
 * Programmation, étape 6) — commune au retour Stripe (success_url du
 * Checkout anonyme) et à la réclamation gratuite (redirection client après
 * /api/public/programs/[id]/claim). Le compte est créé côté serveur avant
 * l'affichage de cette page (webhook Stripe ou route claim, voir
 * lib/supabase/public-program-provisioning.ts) — l'email de bienvenue avec
 * le lien de connexion arrive séparément, quelques secondes après.
 *
 * Correctif "accès direct post-paiement" : pour le retour Stripe
 * (?session_id=...), ProgrammesMerciStatus interroge en polling
 * /api/public/programs/checkout-status et redirige automatiquement vers
 * /entrainement dès que le compte est prêt, plutôt que de systématiquement
 * faire attendre l'email — celui-ci part toujours en parallèle et reste le
 * filet de sécurité si le polling n'aboutit pas. Le Suspense fallback
 * rejoue le message "vérifie ton email" pour que le rendu serveur initial
 * (avant hydratation) ne soit jamais vide.
 */
export default function ProgrammesMerciPage() {
  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center bg-black px-4 py-24 text-center">
      <Suspense
        fallback={
          <div className="w-full max-w-md border border-border bg-zinc-950 p-8">
            <MailCheck size={28} className="mx-auto mb-4 text-primary" />
            <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">C&apos;est fait !</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ton accès est en cours de préparation. Tu vas recevoir un email dans les prochaines minutes avec un
              lien pour définir ton mot de passe et accéder directement à ton programme.
            </p>
          </div>
        }
      >
        <ProgrammesMerciStatus />
      </Suspense>

      <Link
        href="/programmes"
        className="mt-6 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        Voir d&apos;autres programmes
      </Link>
    </section>
  );
}
