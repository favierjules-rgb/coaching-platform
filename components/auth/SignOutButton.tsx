"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { useDeconnexionOffline, type OptionsDeconnexion } from "@/hooks/useDeconnexionOffline";

interface SignOutButtonProps {
  className: string;
  onBeforeNavigate?: () => void;
  label?: string;
  /** SEAM DE TEST — dépôt, identité et signOut injectés par le harnais. */
  offline?: OptionsDeconnexion;
}

/**
 * Bouton de déconnexion réutilisable (sidebar élève, sidebar admin, page
 * accès refusé). En mode mock (Supabase non configuré), il n'y a pas de
 * session réelle à couper — redirige simplement vers /connexion.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UNE SÉANCE NON SYNCHRONISÉE NE PART JAMAIS EN SILENCE
 * ════════════════════════════════════════════════════════════════════════
 * Avant de couper la session, on regarde s'il reste une opération en
 * attente pour ce compte. S'il y en a une, la déconnexion s'interrompt et
 * l'élève est prévenu — avec la seule information qui compte pour lui : sa
 * séance sera conservée sur cet appareil et repartira à la reconnexion.
 *
 * On ne lui propose PAS d'effacer. La seule alternative offerte est de
 * rester connecté le temps de retrouver du réseau.
 */
export function SignOutButton({
  className,
  onBeforeNavigate,
  label = "Déconnexion",
  offline,
}: SignOutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const deconnexion = useDeconnexionOffline(offline ?? {});

  function partir() {
    onBeforeNavigate?.();
    router.refresh();
    router.push("/connexion");
  }

  async function handleSignOut() {
    setLoading(true);
    const immediat = await deconnexion.demanderDeconnexion();
    if (!immediat) {
      // Une séance attend : on s'arrête ici. Rien n'a été supprimé, la
      // session est intacte.
      setLoading(false);
      return;
    }
    await deconnexion.deconnecter();
    partir();
  }

  async function handleConfirmer() {
    setLoading(true);
    await deconnexion.confirmerDeconnexion();
    partir();
  }

  return (
    <>
      <button type="button" onClick={handleSignOut} disabled={loading} className={className}>
        <LogOut size={18} />
        {label}
      </button>

      {deconnexion.etat.phase === "confirmation" && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="deconnexion-titre"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6"
        >
          <div className="w-full max-w-md rounded-card border border-border bg-card p-6 shadow-soft">
            <h2 id="deconnexion-titre" className="mb-3 font-heading text-sm font-bold uppercase text-foreground">
              Une séance attend d&apos;être synchronisée
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Si tu te déconnectes maintenant, elle sera conservée sur cet appareil et pourra être
              envoyée lorsque tu te reconnecteras avec ce compte.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => void handleConfirmer()}
                className="pressable min-h-[44px] flex-1 rounded-control border border-border px-4 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Se déconnecter quand même
              </button>
              <button
                type="button"
                onClick={deconnexion.annuler}
                className="pressable min-h-[44px] flex-1 rounded-control bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Rester connecté
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
