import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, MailPlus } from "lucide-react";

import { AuthCardLayout } from "@/components/shared/AuthCardLayout";

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
    <AuthCardLayout
      outerClassName="text-center"
      footer={
        <Link
          href="/connexion"
          className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft size={14} />
          Retour à la connexion
        </Link>
      }
    >
      <MailPlus size={28} className="mx-auto mb-4 text-primary" />
      <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">
        Demander un accès
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Les comptes élèves sont créés par ton coach après validation, il n&apos;y a pas
        d&apos;inscription libre pour le moment. Contacte directement ton coach pour démarrer
        ton accompagnement — il te communiquera tes identifiants de connexion.
      </p>
    </AuthCardLayout>
  );
}
