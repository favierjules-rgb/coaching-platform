"use client";

import { AlertTriangle, BellRing, Loader2 } from "lucide-react";

import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import { activationPossible, type EtatNotifications } from "@/lib/push/etat";

/**
 * LE RAPPEL « RÉACTIVE TES NOTIFICATIONS » — SUR LE PROFIL, UNE FOIS PAR VISITE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'IL EST, ET CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Ce n'est pas une fenêtre d'information : le bouton principal exécute le
 * VRAI parcours d'activation (`useNotificationsPush.activer`), celui du bloc
 * « Notifications » du profil. Il n'y a qu'un mécanisme d'activation dans
 * l'application, et c'est celui-là.
 *
 * ⚠️ IL N'A AUCUN ÉTAT À LUI. Ni le sien, ni une copie de celui du hook : il
 * reçoit l'état et les actions de son parent, qui tient l'UNIQUE instance de
 * `useNotificationsPush`. C'est ce qui garantit que le rappel et le bloc
 * « Notifications » ne peuvent pas se contredire — il n'y a pas deux vérités
 * à synchroniser, il n'y en a qu'une.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA CROIX, « PLUS TARD », ÉCHAP ET LE FOND NE TOUCHENT À RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Les quatre ferment la fenêtre pour la visite en cours, et c'est tout :
 * aucune préférence écrite, aucun abonnement retiré, aucun appel réseau.
 * « Plus tard » veut dire plus tard, pas « non ».
 *
 * La croix, le piège de focus, la fermeture au clavier et le verrou de
 * défilement viennent de `Modal` — le socle de modale de l'application. En
 * écrire un second ici reviendrait à rendre cette fenêtre moins accessible
 * que les autres.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS SITUATIONS, TROIS CONTENUS
 * ════════════════════════════════════════════════════════════════════════
 *   · activable (`inactif`, `a_reactiver`, `erreur`) → le bouton principal ;
 *   · `refuse` → PAS de bouton, mais le chemin des réglages : redemander la
 *     permission après un refus ne produit rien, et un bouton qui ne peut pas
 *     aboutir est pire que pas de bouton ;
 *   · le succès ne s'affiche pas ici : la fenêtre se ferme, et le bloc
 *     « Notifications » juste derrière porte le message de confirmation. Un
 *     échec, lui, reste affiché ICI, là où se trouve le bouton pour réessayer.
 */
export function RappelNotificationsPush({
  etat,
  message,
  enCours,
  onReactiver,
  onFermer,
}: {
  etat: EtatNotifications;
  /** Message de résultat remonté par le parcours d'activation. */
  message: string | null;
  enCours: boolean;
  onReactiver: () => void;
  onFermer: () => void;
}) {
  const peutActiver = activationPossible(etat);

  return (
    <Modal title="Notifications push" onClose={onFermer}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control border border-primary/40 bg-primary/10">
            <BellRing size={18} className="text-primary" aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            Suite à une mise à jour, pense à réactiver les notifications push pour continuer à
            recevoir tes rappels et notifications.
          </p>
        </div>

        {etat === "refuse" ? (
          /* ⚠️ AUCUNE TENTATIVE DE CONTOURNEMENT. Après un refus, aucun
             navigateur ne repose la question : seuls les réglages du site
             peuvent revenir dessus. On indique le chemin, par plateforme. */
          <div className="rounded-panel border border-warning/40 bg-warning/5 px-4 py-3 text-xs leading-relaxed text-warning">
            <p className="mb-2 font-bold uppercase tracking-wide">
              Les notifications sont bloquées pour ce site
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                <span className="font-semibold">iPhone / iPad</span> — Réglages → Notifications →
                SETH, puis autorise les notifications.
              </li>
              <li>
                <span className="font-semibold">Android / Chrome</span> — appuie sur le cadenas dans
                la barre d&apos;adresse → Autorisations → Notifications.
              </li>
              <li>
                <span className="font-semibold">Ordinateur</span> — clique sur le cadenas à gauche de
                l&apos;adresse → Notifications → Autoriser, puis recharge la page.
              </li>
            </ul>
          </div>
        ) : null}

        {/* ⚠️ LE MESSAGE D'ÉCHEC RESTE ICI, à côté du bouton qui permet de
            réessayer. Il ne prétend jamais que les notifications sont
            activées : voir `messageActivation`. */}
        {message ? (
          <p
            className="flex items-start gap-2 rounded-panel border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs leading-relaxed text-destructive"
            role="alert"
          >
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
            {message}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {peutActiver ? (
            <PrimaryButton onClick={onReactiver} disabled={enCours}>
              {enCours ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Activation…
                </span>
              ) : (
                "Réactiver les notifications"
              )}
            </PrimaryButton>
          ) : null}
          <div className="flex justify-center">
            <OutlineButton onClick={onFermer}>Plus tard</OutlineButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
