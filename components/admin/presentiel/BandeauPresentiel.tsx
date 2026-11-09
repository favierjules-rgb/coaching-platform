"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, UserCog } from "lucide-react";

/**
 * LE BANDEAU PERMANENT DU MODE PRÉSENTIEL.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI IL EST COLLANT, ET POURQUOI IL NOMME L'ÉLÈVE
 * ════════════════════════════════════════════════════════════════════════
 * Un coach qui enchaîne deux élèves sur la même séance a, à l'écran, deux
 * pages rigoureusement identiques. Le seul garde-fou contre « j'ai noté le
 * squat de Marc dans la séance de Léa » est que le nom reste SOUS LES YEUX —
 * pas en haut d'une page qu'on a fait défiler il y a dix minutes. D'où
 * `sticky`, et d'où le nom dans le bandeau plutôt que dans le titre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ÉTAT DU BROUILLON SE DIT, IL NE SE DEVINE PAS
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ « ENREGISTRÉ SUR CET APPAREIL » N'EST PAS « ENVOYÉ ». La distinction est
 * tout l'enjeu : le brouillon protège la saisie d'un rechargement ou d'une
 * fermeture, mais rien ne part au serveur avant la validation finale. Un
 * libellé qui dirait seulement « enregistré » laisserait croire la séance
 * transmise, et un coach quitterait la page en pensant avoir fini.
 */
export function BandeauPresentiel({
  nomEleve,
  brouillonEnregistre,
  brouillonIndisponible,
  onViderBrouillon,
}: {
  readonly nomEleve: string;
  /** Vrai dès qu'une révision a été écrite sur cet appareil. */
  readonly brouillonEnregistre: boolean;
  /** Le stockage local est refusé (navigation privée, quota) : on le dit. */
  readonly brouillonIndisponible: boolean;
  readonly onViderBrouillon: () => void;
}) {
  const [confirme, setConfirme] = useState(false);

  return (
    <div
      role="status"
      data-presentiel="bandeau"
      className="sticky top-0 z-30 -mx-4 mb-6 border-b border-primary/40 bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control border border-primary/40 bg-primary/10 text-primary"
          >
            <UserCog size={16} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-heading text-[11px] font-bold uppercase tracking-widest text-primary">
              Mode présentiel — saisie par le coach
            </span>
            {/* Le nom tronque plutôt que d'élargir le bandeau : sur un
                téléphone en salle, c'est la largeur qui manque. */}
            <span className="truncate text-sm font-semibold text-foreground">{nomEleve}</span>
          </span>
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-3">
          {brouillonIndisponible ? (
            <span className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle size={13} aria-hidden />
              Brouillon indisponible sur cet appareil
            </span>
          ) : brouillonEnregistre ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle2 size={13} aria-hidden className="text-success" />
              Brouillon enregistré sur cet appareil
            </span>
          ) : null}

          {/* ⚠️ DEUX TEMPS, TOUJOURS. Vider le brouillon efface une séance
              entière de saisie en salle, et il n'y a pas d'annulation : un
              seul appui, même volontaire, est trop peu. */}
          {brouillonEnregistre ? (
            confirme ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirme(false);
                    onViderBrouillon();
                  }}
                  className="pressable inline-flex min-h-9 items-center rounded-control border border-destructive/50 px-3 text-[11px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                >
                  Confirmer l&apos;effacement
                </button>
                <button
                  type="button"
                  onClick={() => setConfirme(false)}
                  className="pressable inline-flex min-h-9 items-center rounded-control px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Annuler
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirme(true)}
                className="pressable inline-flex min-h-9 items-center rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Vider le brouillon
              </button>
            )
          ) : null}
        </span>
      </div>

      {/* ⚠️ LA PHRASE QUI ÉVITE LE MALENTENDU LE PLUS COÛTEUX. */}
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Rien n&apos;est transmis tant que le retour n&apos;a pas été enregistré en bas de page.
        Fermer la page ou changer d&apos;écran ne termine pas la séance.
      </p>
    </div>
  );
}
