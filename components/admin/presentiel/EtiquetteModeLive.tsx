"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Radio, X } from "lucide-react";

import { libelleEleve, listeElevesLive, type EleveLive } from "@/lib/presentiel-live";

/**
 * « MODE LIVE » — L'ENTRÉE DU MODE PRÉSENTIEL, SOUS LA PROGRAMMATION.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE COMPOSANT NE DÉCIDE PAS
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ IL NE COMPOSE JAMAIS LA LISTE DES ÉLÈVES. Il la DEMANDE à
 * `/api/admin/presentiel/programmes/[programId]/eleves`, qui la résout depuis
 * les affectations réelles et la confronte à `requireStaffForStudent`
 * (entraînement / écriture) élève par élève. L'écran a pourtant les
 * identifiants sous la main — il s'en sert uniquement pour savoir s'il faut
 * afficher cette étiquette, jamais pour ouvrir une porte.
 *
 * ⚠️ ET IL NE DEVINE PAS L'ÉLÈVE QUAND IL N'Y EN A QU'UN. C'est le serveur qui
 * dit « il n'y en a qu'un, et c'est celui-là ». Une programmation que l'écran
 * croit mono-élève peut avoir été réaffectée entre-temps ; une qu'il croit
 * multi-élèves peut n'en laisser qu'un au compte connecté.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * UN SEUL APPEL, TROIS ISSUES
 * ════════════════════════════════════════════════════════════════════════════
 *   · aucun élève autorisé  → on le DIT, et on n'ouvre rien ;
 *   · un seul              → on va droit à son planning, sans fenêtre ;
 *   · plusieurs            → la fenêtre « Choisir un élève ».
 *
 * L'appel n'a lieu qu'au clic : la liste des programmations en charge des
 * dizaines, et interroger le serveur pour chacune à l'affichage coûterait
 * autant de requêtes que de cartes, pour un bouton qu'on ne presse qu'une fois.
 */
export function EtiquetteModeLive({
  programId,
  nomProgramme,
}: {
  readonly programId: string;
  readonly nomProgramme: string;
}) {
  const router = useRouter();
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [choix, setChoix] = useState<readonly EleveLive[] | null>(null);
  const premierBouton = useRef<HTMLButtonElement | null>(null);

  // Le focus entre dans la fenêtre à l'ouverture : en salle, on navigue parfois
  // au clavier d'une tablette, et une fenêtre modale qu'on ne peut pas
  // atteindre au clavier n'est pas une fenêtre, c'est un mur.
  useEffect(() => {
    if (choix && choix.length > 0) premierBouton.current?.focus();
  }, [choix]);

  async function ouvrir() {
    setErreur(null);
    setChargement(true);
    try {
      const reponse = await fetch(`/api/admin/presentiel/programmes/${programId}/eleves`);
      if (!reponse.ok) {
        setErreur(
          reponse.status === 404
            ? "Cette programmation n'est plus accessible."
            : "Impossible de lire les élèves de cette programmation.",
        );
        return;
      }
      const { eleves } = (await reponse.json()) as { eleves: EleveLive[] };

      if (eleves.length === 0) {
        // ⚠️ MESSAGE EXPLICITE, JAMAIS UN PLANNING AU HASARD. Affectation
        // retirée entre-temps, élève devenu inaccessible, permission d'écriture
        // retirée : trois causes, une seule conséquence honnête.
        setErreur("Aucun élève de cette programmation ne vous est accessible en écriture.");
        return;
      }
      if (eleves.length === 1) {
        router.push(`/admin/programmes/${programId}/live/${eleves[0].studentId}`);
        return;
      }
      setChoix(eleves);
    } catch {
      setErreur("Réseau indisponible. Réessaie.");
    } finally {
      setChargement(false);
    }
  }

  const liste = choix ? listeElevesLive(choix) : null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => void ouvrir()}
        disabled={chargement}
        data-live="etiquette"
        aria-label={`Démarrer le mode Live sur ${nomProgramme}`}
        className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border border-primary/60 bg-primary/10 px-4 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
      >
        {chargement ? (
          <Loader2 size={14} aria-hidden className="animate-spin" />
        ) : (
          <Radio size={14} aria-hidden />
        )}
        Mode Live
      </button>

      {erreur ? (
        <p role="status" className="mt-2 text-[11px] leading-relaxed text-warning">
          {erreur}
        </p>
      ) : null}

      {liste && liste.eleves.length > 0 ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choisir un élève"
          data-live="choix-eleve"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
        >
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-heading text-base font-bold uppercase text-foreground">
                  Choisir un élève
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{nomProgramme}</p>
              </div>
              <button
                type="button"
                onClick={() => setChoix(null)}
                aria-label="Fermer"
                className="pressable -mr-1 -mt-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={16} />
              </button>
            </div>

            {/* La liste défile : une programmation de groupe peut porter
                vingt élèves, et la fenêtre doit rester dans l'écran d'un
                téléphone tenu d'une main. */}
            <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2">
              {liste.eleves.map((eleve, rang) => (
                <li key={eleve.studentId}>
                  <button
                    type="button"
                    ref={rang === 0 ? premierBouton : undefined}
                    onClick={() =>
                      router.push(`/admin/programmes/${programId}/live/${eleve.studentId}`)
                    }
                    className="pressable flex min-h-[48px] w-full min-w-0 items-center justify-between gap-3 rounded-control px-3 text-left text-sm text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {/* `libelleEleve` complète le nom quand DEUX élèves
                        s'appellent pareil : le nom ne distingue pas, et
                        l'identifiant technique ne dirait rien au coach. */}
                    <span className="min-w-0 truncate">{libelleEleve(eleve, liste.homonymes)}</span>
                    {eleve.debutProgramme ? (
                      <span className="flex-shrink-0 text-[11px] uppercase tracking-widest text-muted-foreground">
                        depuis le {eleve.debutProgramme}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
