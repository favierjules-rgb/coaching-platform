"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Timer, X } from "lucide-react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  ajuster,
  cadran,
  creerChronometre,
  demarrer,
  DUREE_MAX_MS,
  PAS_AJUSTEMENT_MS,
  pauser,
  reglerDuree,
  reinitialiser,
  reprendre,
  restantSecondes,
  tic,
  type Chronometre,
} from "@/lib/chronometre";
import { formaterDuree } from "@/lib/duree";

/**
 * LE CHRONOMÈTRE FLOTTANT DE LA SÉANCE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne mesure PAS la séance. `SessionFeedbackSection` documente depuis sa
 * création que la durée de séance est DÉCLARÉE par l'élève, sans `startedAt`
 * et sans chronomètre ; ce composant ne change rien à cela et n'écrit dans
 * aucun champ de retour. C'est un minuteur de repos, posé à côté de la
 * séance, qui ne touche ni au programme, ni aux données de séance, ni à
 * Supabase — rien n'est persisté, pas même dans le navigateur.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI IL EST MONTÉ PAR UN LAYOUT ET PAS PAR LA PAGE
 * ════════════════════════════════════════════════════════════════════════
 * `app/(student)/entrainement/seance/[sessionId]/layout.tsx` le rend une
 * fois. La page de séance, elle, a six branches de `return` (chargement,
 * erreur, séance introuvable, hors ligne, réel, démonstration) : monté dans
 * la page, il faudrait le répéter six fois, et la septième branche écrite un
 * jour l'oublierait. Monté dans le layout, sa présence est une propriété de
 * l'ARBORESCENCE — et son absence du Builder (`app/admin/**`) aussi.
 *
 * Effet de bord recherché : le layout ne se remonte pas quand la page change
 * d'état. Un compte à rebours lancé survit donc au passage « chargement →
 * contenu » et à une reconnexion.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE PANNEAU ET LE TEMPS SONT DEUX CHOSES SÉPARÉES
 * ════════════════════════════════════════════════════════════════════════
 * `ouvert` ne pilote QUE la visibilité du panneau. L'état du chronomètre vit
 * dans ce composant, qui reste monté en permanence : fermer le panneau
 * n'arrête rien, ne remet rien à zéro, et le battement continue. Le bouton
 * flottant affiche alors le temps restant, pour qu'on n'ait pas à rouvrir.
 *
 * Le battement ne COMPTE rien — il redessine. Tout le calcul du temps vit
 * dans `lib/chronometre.ts` et se fait par soustraction de dates, ce qui
 * rend le compte à rebours insensible aux `setInterval` en retard, à un
 * onglet mis en veille et à un téléphone verrouillé.
 */

/** Battement d'affichage. Plus court qu'une seconde pour que le passage d'un
 *  chiffre au suivant ne se voie jamais en retard ; sans effet sur le compte,
 *  qui est calculé et non décrémenté. */
const BATTEMENT_MS = 250;

const MINUTES_MAX = Math.floor(DUREE_MAX_MS / 60000);

function libelleRestant(secondes: number): string {
  if (secondes <= 0) return "Temps écoulé";
  return `${formaterDuree(secondes)} restantes`;
}

export function ChronometreSeance() {
  const [chrono, setChrono] = useState<Chronometre>(() => creerChronometre());
  const [ouvert, setOuvert] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const mouvementReduit = usePrefersReducedMotion();

  const declencheur = useRef<HTMLButtonElement | null>(null);
  const panneau = useRef<HTMLDivElement | null>(null);
  const premierControle = useRef<HTMLButtonElement | null>(null);
  const idPanneau = useId();

  /* ── LE BATTEMENT ──────────────────────────────────────────────────────
   * Un seul intervalle, armé UNIQUEMENT pendant la marche, et démonté par la
   * fonction de nettoyage à chaque changement d'état comme à la destruction
   * du composant : aucun intervalle ne survit à la sortie de la page. */
  useEffect(() => {
    if (chrono.etat !== "encours") return;
    const battement = window.setInterval(() => {
      const t = Date.now();
      setMaintenant(t);
      setChrono((precedent) => tic(precedent, t));
    }, BATTEMENT_MS);
    return () => window.clearInterval(battement);
  }, [chrono.etat]);

  const secondes = restantSecondes(chrono, maintenant);
  const enMarche = chrono.etat === "encours";
  const termine = chrono.etat === "termine";

  const agir = useCallback((transformation: (c: Chronometre, t: number) => Chronometre) => {
    const t = Date.now();
    setMaintenant(t);
    setChrono((precedent) => transformation(precedent, t));
  }, []);

  /* ── FERMETURE ET FOCUS ────────────────────────────────────────────────
   * Échap ferme, et le focus revient TOUJOURS au bouton qui a ouvert : sans
   * cela, une fermeture au clavier laisse le focus sur un élément retiré du
   * document et la navigation repart du haut de la page. */
  const fermer = useCallback(() => {
    setOuvert(false);
    declencheur.current?.focus();
  }, []);

  useEffect(() => {
    if (!ouvert) return;
    premierControle.current?.focus();
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") {
        evenement.stopPropagation();
        fermer();
      }
    };
    const surClicExterieur = (evenement: MouseEvent) => {
      const cible = evenement.target as Node;
      if (panneau.current?.contains(cible)) return;
      if (declencheur.current?.contains(cible)) return;
      setOuvert(false);
    };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("mousedown", surClicExterieur);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("mousedown", surClicExterieur);
    };
  }, [ouvert, fermer]);

  const minutesReglees = Math.floor(chrono.dureeInitialeMs / 60000);
  const secondesReglees = Math.floor((chrono.dureeInitialeMs % 60000) / 1000);

  const reglerDepuisChamps = (min: number, sec: number) => {
    const m = Number.isFinite(min) ? Math.max(0, Math.min(MINUTES_MAX, Math.floor(min))) : 0;
    const s = Number.isFinite(sec) ? Math.max(0, Math.min(59, Math.floor(sec))) : 0;
    setChrono((precedent) => reglerDuree(precedent, m * 60000 + s * 1000));
  };

  return (
    /*
      z-30 : AU-DESSUS du contenu et de la barre mobile collante (z-40 n'est
      qu'un en-tête, jamais recouvert puisque le chrono est en bas), et
      EN DESSOUS des modales (z-50, et z-[100] pour MediaModal). Un minuteur
      de repos ne doit jamais passer devant une vidéo ouverte en plein écran.
    */
    <div className="pointer-events-none fixed inset-0 z-30">
      <div className="pointer-events-auto absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        {ouvert && (
          <div
            ref={panneau}
            id={idPanneau}
            role="dialog"
            aria-label="Chronomètre de repos"
            className="w-[17rem] rounded-card border border-border bg-card p-4 shadow-soft"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Chronomètre
              </h2>
              <button
                type="button"
                onClick={fermer}
                aria-label="Fermer le chronomètre"
                className="pressable inline-flex min-h-9 min-w-9 items-center justify-center rounded-control text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/*
              `role="timer"` sans `aria-live` : un compte à rebours annoncé à
              chaque seconde rendrait un lecteur d'écran inutilisable pendant
              toute la durée du repos. Les changements qui MÉRITENT une
              annonce (démarrage, pause, reprise, remise à zéro, fin) passent
              par la région `role="status"` plus bas, qui ne parle qu'aux
              transitions.
            */}
            <p
              role="timer"
              aria-label={libelleRestant(secondes)}
              className={`mb-4 text-center font-heading text-4xl font-extrabold tabular-nums ${
                termine ? "text-primary" : "text-foreground"
              } ${termine && !mouvementReduit ? "animate-pulse" : ""}`}
            >
              <span aria-hidden="true">{cadran(secondes)}</span>
            </p>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                ref={premierControle}
                type="button"
                onClick={() => agir((c, t) => ajuster(c, -PAS_AJUSTEMENT_MS, t))}
                className="pressable inline-flex min-h-11 items-center justify-center rounded-control border border-border text-sm font-semibold text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                −30 s
              </button>
              <button
                type="button"
                onClick={() => agir((c, t) => ajuster(c, PAS_AJUSTEMENT_MS, t))}
                className="pressable inline-flex min-h-11 items-center justify-center rounded-control border border-border text-sm font-semibold text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                +30 s
              </button>
            </div>

            <div className="mb-3 flex gap-2">
              {enMarche ? (
                <button
                  type="button"
                  onClick={() => agir(pauser)}
                  className="pressable inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Pause size={16} aria-hidden="true" />
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => agir(chrono.etat === "pause" ? reprendre : demarrer)}
                  disabled={chrono.etat !== "pause" && chrono.restantMs <= 0 && chrono.dureeInitialeMs <= 0}
                  className="pressable inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={16} aria-hidden="true" />
                  {chrono.etat === "pause" ? "Reprendre" : "Démarrer"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setChrono(reinitialiser)}
                aria-label="Réinitialiser le chronomètre"
                className="pressable inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>

            <fieldset className="flex items-end gap-2" disabled={enMarche}>
              <legend className="sr-only">Durée initiale</legend>
              <label className="flex-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                Minutes
                <input
                  type="number"
                  min={0}
                  max={MINUTES_MAX}
                  inputMode="numeric"
                  value={minutesReglees}
                  onChange={(e) => reglerDepuisChamps(Number(e.target.value), secondesReglees)}
                  className="mt-1 w-full rounded-control border border-border bg-surface px-2 py-2 text-sm font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
                />
              </label>
              <label className="flex-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                Secondes
                <input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={secondesReglees}
                  onChange={(e) => reglerDepuisChamps(minutesReglees, Number(e.target.value))}
                  className="mt-1 w-full rounded-control border border-border bg-surface px-2 py-2 text-sm font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
                />
              </label>
            </fieldset>

            {/* Annonce les TRANSITIONS, jamais le décompte. */}
            <p role="status" aria-live="polite" className="sr-only">
              {termine
                ? "Temps écoulé"
                : enMarche
                  ? `Chronomètre en marche, ${libelleRestant(secondes)}`
                  : chrono.etat === "pause"
                    ? `Chronomètre en pause, ${libelleRestant(secondes)}`
                    : `Chronomètre à l'arrêt, ${formaterDuree(Math.round(chrono.dureeInitialeMs / 1000))}`}
            </p>
          </div>
        )}

        <button
          ref={declencheur}
          type="button"
          onClick={() => (ouvert ? fermer() : setOuvert(true))}
          aria-expanded={ouvert}
          aria-controls={ouvert ? idPanneau : undefined}
          aria-label={
            enMarche || chrono.etat === "pause" || termine
              ? `Chronomètre — ${libelleRestant(secondes)}`
              : "Ouvrir le chronomètre"
          }
          className={`pressable inline-flex min-h-14 min-w-14 items-center justify-center rounded-full border border-border bg-card shadow-soft transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            termine ? "text-primary" : "text-foreground"
          } ${termine && !mouvementReduit ? "animate-pulse" : ""} ${enMarche || chrono.etat === "pause" || termine ? "px-4" : ""}`}
        >
          {enMarche || chrono.etat === "pause" || termine ? (
            <span aria-hidden="true" className="font-heading text-sm font-extrabold tabular-nums">
              {cadran(secondes)}
            </span>
          ) : (
            <Timer size={20} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
