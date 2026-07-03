import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, MailPlus } from "lucide-react";

import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = {
  title: "Demander un accès — Seth Préparation Physique",
};

/**
 * Volontairement pas un vrai formulaire d'inscription : un élève ne doit
 * jamais pouvoir se créer un compte actif seul, sans validation du coach
 * (voir README.md, section "Créer les premiers utilisateurs"). Cette page
 * se contente d'orienter vers un contact direct.
 */
export default function InscriptionPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-center">
      <div className="mb-8">
        <Logo />
      </div>

      <div className="w-full max-w-md border border-border bg-card p-8">
        <MailPlus size={28} className="mx-auto mb-4 text-primary" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">
          Demander un accès
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Les comptes élèves sont créés par ton coach après validation, il n&apos;y a pas
          d&apos;inscription libre pour le moment. Contacte directement ton coach pour démarrer
          ton accompagnement — il te communiquera tes identifiants de connexion.
        </p>
      </div>

      <Link
        href="/connexion"
        className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft size={14} />
        Retour à la connexion
      </Link>
    </div>
  );
}
