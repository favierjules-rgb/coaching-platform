"use client";

import { Compass } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { GuideDecouverte } from "@/components/guide/GuideDecouverte";
import {
  espaceDejaVu,
  espaceGuidePour,
  invitationDejaProposee,
  marquerEspaceVu,
  marquerInvitationProposee,
} from "@/lib/guide-categories";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * L'INVITATION DE PREMIÈRE ARRIVÉE DANS UN ESPACE
 * ════════════════════════════════════════════════════════════════════════════
 * Monté UNE SEULE FOIS par shell. Il regarde la route courante et, la première
 * fois qu'on arrive dans un espace qui a une visite, propose de la suivre.
 *
 * ⚠️ UNE FENÊTRE CENTRÉE, PLUS UNE LIGNE DANS LE FLUX. L'ancienne version
 * posait une bannière en haut de la page : discrète au point d'être invisible,
 * elle se confondait avec le contenu et personne ne la lisait. Le pop-up prend
 * le même vocabulaire visuel que les autres fenêtres de l'application — voile
 * sombre, carte `rounded-card`, bordure `border-border` — et reste refusable
 * d'un bouton.
 *
 * ⚠️ UNE MÉMOIRE PAR ESPACE, ET DISTINCTE DE « VISITE FAITE ». `guide-invitation-<id>`
 * dit qu'on a déjà PROPOSÉ ; `guide-espace-<id>` dit qu'on a FAIT. Partager la
 * clé ferait qu'un simple « Plus tard » marquerait la visite comme accomplie,
 * et que terminer une visite empêcherait les invitations des autres espaces.
 *
 * ⚠️ ON ATTEND QUE LA PAGE SOIT VRAIMENT LÀ. Proposer de découvrir un écran
 * encore en chargement montrerait une visite dont aucune cible n'existe. La
 * condition d'ouverture est donc qu'au moins une ancre de la visite soit
 * présente dans le document — un signal réel, pas une temporisation choisie au
 * jugé.
 *
 * ⚠️ JAMAIS PAR-DESSUS AUTRE CHOSE. Si une modale ou une visite guidée est
 * déjà ouverte, l'invitation attend. Deux fenêtres empilées, c'est une fenêtre
 * qu'on ferme sans la lire.
 */
export function GuideEspace() {
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false);
  const [invite, setInvite] = useState(false);
  const dejaPropose = useRef<string | null>(null);

  const espace = espaceGuidePour(pathname);

  /*
   * `localStorage` est une source extérieure à React : `useSyncExternalStore`
   * est l'outil prévu. Le lire pendant le rendu divergerait à l'hydratation,
   * et le lire dans un effet pour poser un état est ce que la règle
   * `set-state-in-effect` interdit. L'instantané serveur dit « déjà vu » pour
   * qu'aucune invitation ne clignote avant l'hydratation.
   */
  const lire = useCallback(
    () =>
      espace &&
      !espaceDejaVu(window.localStorage, espace.id) &&
      !invitationDejaProposee(window.localStorage, espace.id)
        ? "0"
        : "1",
    [espace],
  );
  const abonner = useCallback((auChangement: () => void) => {
    window.addEventListener("storage", auChangement);
    return () => window.removeEventListener("storage", auChangement);
  }, []);
  const dejaVu = useSyncExternalStore(abonner, lire, () => "1") === "1";

  /*
   * L'OUVERTURE DIFFÉRÉE, CONDITIONNÉE À L'ÉTAT RÉEL DE LA PAGE.
   *
   * ⚠️ `setState` EST APPELÉ DEPUIS UNE IMAGE D'ANIMATION, jamais dans le corps
   * de l'effet : c'est ce que demande `set-state-in-effect`, et c'est aussi la
   * seule façon de laisser le rendu se faire avant de décider.
   */
  const espaceId = espace?.id ?? null;
  const ancres = espace?.etapes.map((e) => e.cible).join("|") ?? "";
  useEffect(() => {
    if (!espaceId || dejaVu || ouvert) return;
    if (dejaPropose.current === espaceId) return;
    let actif = true;
    let image = 0;
    const cibles = ancres.split("|").filter(Boolean);
    const boucle = () => {
      if (!actif) return;
      const pageChargee = cibles.some(
        (cible) => document.querySelector(`[data-guide="${CSS.escape(cible)}"]`) !== null,
      );
      // Une modale, une feuille, ou la visite elle-même : on ne se superpose pas.
      const autreFenetre = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
      if (pageChargee && !autreFenetre) {
        dejaPropose.current = espaceId;
        marquerInvitationProposee(typeof window === "undefined" ? null : window.localStorage, espaceId);
        setInvite(true);
        return;
      }
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => {
      actif = false;
      cancelAnimationFrame(image);
    };
  }, [espaceId, ancres, dejaVu, ouvert]);

  if (!espace) return null;

  const fermerVisite = () => {
    marquerEspaceVu(typeof window === "undefined" ? null : window.localStorage, espace.id);
    setOuvert(false);
  };

  if (ouvert) {
    return <GuideDecouverte etapes={espace.etapes} libelleParcours={espace.titre} onFermer={fermerVisite} />;
  }

  if (!invite) return null;

  return (
    <div
      className="modal-overlay-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invitation-guide-titre"
      aria-describedby="invitation-guide-texte"
    >
      <div className="modal-content-scale-in flex w-full max-w-md flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 rounded-full bg-primary/15 p-2 text-primary">
            <Compass size={18} />
          </span>
          <h2 id="invitation-guide-titre" className="font-heading text-lg font-bold text-foreground">
            Découvrez votre espace
          </h2>
        </div>

        <p id="invitation-guide-texte" className="text-sm leading-relaxed text-muted-foreground">
          Vous découvrez cet espace pour la première fois. Souhaitez-vous suivre une visite guidée
          pour découvrir ses fonctionnalités ?
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Vous pourrez également lancer cette visite à tout moment depuis le bouton «&nbsp;Visite
          guidée&nbsp;» de la page.
        </p>

        {/* Les deux actions ont la MÊME hauteur de cible et le même rang de
            lecture : « Plus tard » n'est pas relégué à un lien minuscule. */}
        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setInvite(false)}
            className="pressable inline-flex min-h-[44px] items-center justify-center rounded-control border border-border px-5 text-sm font-semibold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Plus tard
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              setInvite(false);
              setOuvert(true);
            }}
            className="pressable inline-flex min-h-[44px] items-center justify-center rounded-control bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Faire la visite guidée
          </button>
        </div>
      </div>
    </div>
  );
}
