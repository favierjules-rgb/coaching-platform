"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { PaymentResultCard } from "@/components/shared/PaymentResultCard";

/**
 * Contenu de /acces-indisponible — l'écran d'une PANNE, pas d'un refus
 * commercial.
 *
 * ⚠️ POURQUOI UN ÉCRAN DE PLUS, ET POURQUOI IL NE DIT PAS LA MÊME CHOSE.
 * `/acces-limite` affirme quelque chose sur le compte de l'élève : « votre
 * accès sera activé après validation de votre abonnement », et, sans formule
 * attribuée, « aucune formule attribuée pour le moment ». Ces phrases sont
 * vraies quand elles découlent d'une lecture réussie. Le 18/10, 34 élèves en
 * ACCÈS MANUEL AUTORISÉ les ont lues parce qu'un privilège de colonne
 * empêchait de lire leur mode de facturation : le produit leur a affirmé une
 * chose fausse sur leur propre abonnement, pendant une journée.
 *
 * Ici, le contenu protégé reste fermé — on n'accorde rien sur une panne —
 * mais le message dit ce qui se passe réellement et propose de réessayer.
 * Aucune mention de formule, aucune mention d'abonnement : on ne sait pas,
 * donc on n'affirme rien.
 */
export function AccessUnavailableContent() {
  const router = useRouter();
  const [reessai, setReessai] = useState(false);

  function handleReessayer() {
    setReessai(true);
    // `refresh()` rejoue le rendu serveur, donc la garde et la lecture du
    // mode de facturation : si la panne est passée, l'élève repart sur son
    // contenu sans avoir à se reconnecter.
    router.refresh();
    window.setTimeout(() => setReessai(false), 4000);
  }

  return (
    <PaymentResultCard
      icon={AlertTriangle}
      iconTone="amber"
      title="Accès momentanément indisponible"
      message="Vos droits d'accès n'ont pas pu être vérifiés à l'instant. Ce n'est pas lié à votre abonnement : il s'agit d'un incident technique de notre côté. Réessayez dans un instant."
    >
      <button
        type="button"
        onClick={handleReessayer}
        disabled={reessai}
        className="border border-primary bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {reessai ? "Nouvelle tentative…" : "Réessayer"}
      </button>

      <Link
        href="/profil"
        className="border border-border px-4 py-3 text-center text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Retour à mon profil
      </Link>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Si le problème persiste, prévenez votre coach : l&apos;incident est journalisé de notre côté.
      </p>
    </PaymentResultCard>
  );
}
