"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Navigation, X } from "lucide-react";

import {
  fournisseursOrdonnes,
  urlDuFournisseur,
  type Fournisseur,
} from "@/lib/cartographie/itineraire";
import type { Point } from "@/lib/cartographie/vue-magasins";

/**
 * COURSES — « ITINÉRAIRE » : LE CHOIX DE L'APPLICATION.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE COMPOSANT N'ENVOIE PAS
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN POINT DE DÉPART. Les trois applications savent déterminer la
 * position de l'appareil elles-mêmes, mieux que nous : ne rien envoyer veut
 * dire que ni Google, ni Waze, ni Apple n'apprennent d'où part cet élève. Ils
 * ne reçoivent que la DESTINATION — l'adresse d'un commerce, une information
 * publique.
 *
 * ⚠️ ET OUVRIR UN ITINÉRAIRE NE DEMANDE JAMAIS LA GÉOLOCALISATION. Un élève
 * qui a refusé la localisation et cherché par ville peut se faire guider comme
 * les autres.
 *
 * ⚠️ UN SEUL FOURNISSEUR REÇOIT LES COORDONNÉES : celui que l'élève a choisi.
 * Les deux autres liens ne sont jamais ouverts, et rien n'est préchargé.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI DES PASTILLES DE COULEUR ET NON LES LOGOS
 * ════════════════════════════════════════════════════════════════════════════
 * Retracer à la main le repère de Google Maps ou l'icône de Waze donnerait une
 * approximation — c'est-à-dire exactement le logo déformé qu'il faut éviter.
 * La couleur de la marque et son nom écrit en toutes lettres suffisent à
 * reconnaître l'application. Poser les vrais emblèmes demande de récupérer les
 * fichiers officiels de chaque marque et d'en respecter les conditions
 * d'usage : c'est une décision, pas un détail d'intégration.
 */
export function ChoixItineraire({
  vers,
  nomDuCommerce,
  compact = false,
}: {
  readonly vers: Point;
  readonly nomDuCommerce: string;
  /** Dans la fiche posée sur la carte, le bouton doit rester petit. */
  readonly compact?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const titreId = useId();
  const panneau = useRef<HTMLDivElement | null>(null);
  const declencheur = useRef<HTMLButtonElement | null>(null);

  /*
   * ⚠️ ÉCHAP FERME, ET LE FOCUS REVIENT D'OÙ IL VENAIT. Sans ce retour, la
   * tabulation repart du début du document : sur un écran de courses, cela
   * veut dire recommencer tout le parcours au clavier.
   */
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") {
        evenement.stopPropagation();
        setOuvert(false);
        declencheur.current?.focus();
      }
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [ouvert]);

  /** Le premier choix reçoit le focus : la feuille s'ouvre là où l'on agit. */
  useEffect(() => {
    if (!ouvert) return;
    const premier = panneau.current?.querySelector<HTMLElement>("a[href]");
    premier?.focus();
  }, [ouvert]);

  /*
   * ⚠️ L'ORDRE DÉPEND DE LA PLATEFORME, LE CHOIX NON. Sur iPhone, Plans est
   * proposé en premier ; ailleurs, Google Maps. Les trois restent offertes, et
   * aucune n'est présélectionnée — beaucoup de gens préfèrent Waze partout.
   *
   * Lu au rendu, jamais au module : `navigator` n'existe pas au rendu serveur.
   */
  const fournisseurs: readonly Fournisseur[] =
    typeof navigator === "undefined"
      ? fournisseursOrdonnes(undefined)
      : fournisseursOrdonnes(navigator.userAgent);

  return (
    <>
      <button
        ref={declencheur}
        type="button"
        onClick={() => setOuvert(true)}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        className={[
          "pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border border-border px-3 uppercase tracking-widest text-muted-foreground transition-colors",
          "hover:border-info hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none",
          compact ? "text-xs" : "text-xs",
        ].join(" ")}
      >
        <Navigation size={14} aria-hidden="true" />
        Itinéraire
      </button>

      {ouvert && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="presentation"
          onClick={(evenement) => {
            // Un clic HORS du panneau ferme ; un clic dedans ne doit pas
            // remonter jusqu'ici et refermer ce qu'on vient d'ouvrir.
            if (evenement.target === evenement.currentTarget) setOuvert(false);
          }}
        >
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
          <div
            ref={panneau}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titreId}
            /*
              ⚠️ UNE FEUILLE EN BAS SUR TÉLÉPHONE, UNE BOÎTE CENTRÉE AU-DESSUS.
              En bas, elle tombe sous le pouce ; centrée sur grand écran, elle
              ne traverse pas tout l'écran pour trois lignes.
              `pb-[env(safe-area-inset-bottom)]` : sur un iPhone, la barre
              d'accueil mangerait sinon le dernier choix.
            */
            className="relative w-full max-w-md rounded-t-card border border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-soft sm:rounded-card sm:pb-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={titreId} className="text-sm font-semibold uppercase tracking-widest text-foreground">
                  Ouvrir l&apos;itinéraire
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{nomDuCommerce}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOuvert(false);
                  declencheur.current?.focus();
                }}
                aria-label="Fermer"
                className="pressable shrink-0 rounded-control p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <ul className="mt-3 flex flex-col gap-2">
              {fournisseurs.map((fournisseur) => {
                const href = urlDuFournisseur(fournisseur.id, vers);
                /*
                 * ⚠️ PAS D'URL, PAS DE LIGNE. Une coordonnée aberrante ne doit
                 * pas produire un bouton qui envoie au milieu de l'Atlantique.
                 */
                if (href === null) return null;
                return (
                  <li key={fournisseur.id}>
                    <a
                      href={href}
                      target="_blank"
                      /*
                        ⚠️ `noreferrer` : sans lui, l'URL de la page de courses
                        partirait dans le `Referer` du service de navigation —
                        et cette URL dit que l'élève fait ses courses.
                      */
                      rel="noopener noreferrer"
                      onClick={() => setOuvert(false)}
                      className="pressable flex min-h-[52px] w-full items-center gap-3 rounded-control border border-border px-3 text-left transition-colors hover:border-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-sm font-semibold text-black"
                        style={{ background: fournisseur.couleur }}
                      >
                        {fournisseur.nom.charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {fournisseur.nom}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Ouvre l&apos;application, ou sa version web
                        </span>
                      </span>
                      <Navigation size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-xs text-muted-foreground">
              Ton point de départ reste sur ton téléphone&nbsp;: nous
              n&apos;envoyons que l&apos;adresse du commerce.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
