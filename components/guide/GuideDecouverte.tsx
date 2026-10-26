"use client";

import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FOCUSABLE_SELECTOR, wrapFocusTarget } from "@/lib/admin-shell-nav";
import {
  doitFaireDefiler,
  estDerniereEtape,
  indexBorne,
  marquerGuideVu,
  positionnerCarte,
  prochaineEtapeAtteignable,
  type EtapeGuide,
  type PositionCarte,
} from "@/lib/guide-decouverte";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * VISITE GUIDÉE — LA MISE EN LUMIÈRE
 * ════════════════════════════════════════════════════════════════════════════
 * Un voile sombre, une découpe nette autour du menu présenté, une carte à côté.
 * Toute la décision est dans `lib/guide-decouverte.ts` ; ce composant ne fait
 * que mesurer le DOM et poser le résultat.
 *
 * ⚠️ LA DÉCOUPE EST UN MASQUE SVG, PAS QUATRE DIV. Encadrer la cible avec
 * quatre rectangles laisse des coutures d'un pixel aux angles, visibles sur un
 * fond sombre, et oblige à quatre recalculs au lieu d'un. Le masque donne un
 * bord franc et des coins arrondis cohérents avec `rounded-control`.
 *
 * ⚠️ AUCUN `pointer-events` SUR LA DÉCOUPE. Le voile capte les clics pour que
 * le parcours reste maître de la navigation ; la cible n'est PAS cliquable à
 * travers. C'est délibéré : laisser cliquer le menu mis en lumière
 * déclencherait un changement de route au milieu du parcours, ce que le guide
 * ne saurait pas suivre. L'utilisateur quitte, puis navigue — et la navigation
 * redevient entièrement normale.
 *
 * ACCESSIBILITÉ (règles Apple) : rôle `dialog` modal, focus déplacé sur le
 * titre à chaque étape et piégé dans la carte, `Échap` quitte, flèches gauche
 * et droite naviguent, cibles tactiles ≥ 44 px, progression annoncée une seule
 * fois par une région live polie, et aucune information portée par la seule
 * couleur. Sous `prefers-reduced-motion`, les transitions disparaissent — le
 * guide reste pleinement utilisable.
 */

export interface GuideDecouverteProps {
  readonly etapes: readonly EtapeGuide[];
  readonly onFermer: () => void;
  /** Libellé de l'espace visité, annoncé aux lecteurs d'écran. */
  readonly libelleParcours?: string;
}

const TAILLE_CARTE = { width: 340, height: 232 };

function elementCible(cible: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-guide="${CSS.escape(cible)}"]`);
}

export function GuideDecouverte({ etapes, onFermer, libelleParcours = "l'application" }: GuideDecouverteProps) {
  const [index, setIndex] = useState(0);
  const [termine, setTermine] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<PositionCarte | null>(null);
  const carteRef = useRef<HTMLDivElement | null>(null);
  const titreRef = useRef<HTMLHeadingElement | null>(null);

  const total = etapes.length;
  const etape = etapes[indexBorne(index, total)];

  const cibleExiste = useCallback((cible: string) => elementCible(cible) !== null, []);

  /**
   * Mesure la cible, place la carte, et saute l'étape si la cible n'existe pas.
   *
   * ⚠️ CE RAPPEL N'EST JAMAIS APPELÉ DANS LE CORPS D'UN EFFET. Il l'est depuis
   * une image d'animation, un écouteur ou l'observateur de taille — jamais
   * synchroniquement au montage. C'est ce que demande `set-state-in-effect`, et
   * c'est aussi plus juste : mesurer avant que le navigateur ait peint donnerait
   * des dimensions fausses pour la carte, dont la hauteur dépend du texte.
   */
  const mesurer = useCallback(() => {
    if (!etape) return;
    const element = elementCible(etape.cible);

    if (!element) {
      // Cible absente — repliée dans un tiroir, hors écran, pas encore montée.
      // On saute à la suivante atteignable plutôt que de pointer le vide.
      const suivante = prochaineEtapeAtteignable(etapes, index + 1, 1, cibleExiste);
      if (suivante !== null && suivante !== index) {
        setIndex(suivante);
      } else {
        setTermine(true);
      }
      setRect(null);
      return;
    }

    const mesure = element.getBoundingClientRect();
    setRect(mesure);
    setPosition(
      positionnerCarte(
        { top: mesure.top, left: mesure.left, width: mesure.width, height: mesure.height },
        { width: window.innerWidth, height: window.innerHeight },
        {
          width: Math.min(TAILLE_CARTE.width, window.innerWidth - 32),
          height: carteRef.current?.offsetHeight ?? TAILLE_CARTE.height,
        },
      ),
    );
  }, [etape, etapes, index, cibleExiste]);

  /*
   * Un seul effet pour toute la mesure : première image, redimensionnement,
   * défilement. Tous les écouteurs sont retirés au démontage, et l'image
   * demandée est annulée — sans quoi un changement d'étape rapide laisserait
   * une mesure obsolète s'appliquer après coup.
   */
  useEffect(() => {
    const image = requestAnimationFrame(() => mesurer());
    const onChangement = () => mesurer();
    window.addEventListener("resize", onChangement);
    window.addEventListener("scroll", onChangement, true);
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("resize", onChangement);
      window.removeEventListener("scroll", onChangement, true);
    };
  }, [mesurer]);

  /* Défilement jusqu'à la cible si elle est hors de la zone visible. */
  useEffect(() => {
    if (!etape) return;
    const element = elementCible(etape.cible);
    if (!element) return;
    const mesure = element.getBoundingClientRect();
    if (!doitFaireDefiler({ top: mesure.top, left: mesure.left, width: mesure.width, height: mesure.height }, { height: window.innerHeight })) {
      return;
    }
    const reduit = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    element.scrollIntoView({ behavior: reduit ? "auto" : "smooth", block: "center" });
  }, [etape]);

  const quitter = useCallback(() => {
    marquerGuideVu(typeof window === "undefined" ? null : window.localStorage);
    onFermer();
  }, [onFermer]);

  const aller = useCallback(
    (direction: 1 | -1) => {
      const depuis = index + direction;
      if (depuis < 0) return;
      if (depuis >= total) {
        setTermine(true);
        return;
      }
      const cible = prochaineEtapeAtteignable(etapes, depuis, direction, cibleExiste);
      if (cible === null) {
        if (direction === 1) setTermine(true);
        return;
      }
      setIndex(cible);
    },
    [index, total, etapes, cibleExiste],
  );

  /* Clavier : Échap quitte, flèches naviguent, Tab reste dans la carte. */
  useEffect(() => {
    function onKeyDown(evenement: KeyboardEvent) {
      if (evenement.key === "Escape") {
        evenement.preventDefault();
        quitter();
        return;
      }
      if (evenement.key === "ArrowRight") {
        evenement.preventDefault();
        aller(1);
        return;
      }
      if (evenement.key === "ArrowLeft") {
        evenement.preventDefault();
        aller(-1);
        return;
      }
      if (evenement.key !== "Tab" || !carteRef.current) return;
      const focusables = Array.from(carteRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const suivant = wrapFocusTarget(focusables, document.activeElement as HTMLElement | null, evenement.shiftKey);
      if (suivant) {
        evenement.preventDefault();
        suivant.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quitter, aller]);

  /* Le focus suit l'étape : annoncé, et le parcours au clavier reste linéaire. */
  useEffect(() => {
    titreRef.current?.focus();
  }, [index, termine]);

  const decoupe = useMemo(() => {
    if (!rect) return null;
    const marge = 6;
    return { x: rect.left - marge, y: rect.top - marge, width: rect.width + marge * 2, height: rect.height + marge * 2 };
  }, [rect]);

  if (total === 0) return null;

  const numero = indexBorne(index, total) + 1;
  const largeurCarte = `min(${TAILLE_CARTE.width}px, calc(100vw - 2rem))`;

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-titre"
      aria-describedby="guide-texte"
    >
      {/* Voile + découpe. `aria-hidden` : purement décoratif, le contenu est dans la carte. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        <defs>
          <mask id="guide-masque">
            <rect width="100%" height="100%" fill="white" />
            {decoupe ? (
              <rect
                x={decoupe.x}
                y={decoupe.y}
                width={decoupe.width}
                height={decoupe.height}
                rx="12"
                fill="black"
                className="transition-all duration-300 ease-out motion-reduce:transition-none"
              />
            ) : null}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.66)" mask="url(#guide-masque)" />
      </svg>

      {/* Contour net autour de la cible — non cliquable, purement visuel. */}
      {decoupe ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[12px] ring-2 ring-primary/70 transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ top: decoupe.y, left: decoupe.x, width: decoupe.width, height: decoupe.height }}
        />
      ) : null}

      {/* Capte les clics hors carte : fermer au clic sur le voile. */}
      <button
        type="button"
        aria-label="Quitter la visite guidée"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={quitter}
        tabIndex={-1}
      />

      <div
        ref={carteRef}
        className="absolute flex flex-col gap-4 rounded-card border border-border bg-card p-5 shadow-xl transition-[top,left] duration-300 ease-out motion-reduce:transition-none"
        style={
          position
            ? { top: position.top, left: position.placement === "bas-ecran" ? 16 : position.left, width: largeurCarte }
            : { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: largeurCarte }
        }
      >
        {termine ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2
                id="guide-titre"
                ref={titreRef}
                tabIndex={-1}
                className="font-heading text-lg font-bold text-foreground outline-none"
              >
                Visite terminée
              </h2>
              <span aria-hidden className="rounded-full bg-success/15 p-1.5 text-success">
                <Check size={16} />
              </span>
            </div>
            <p id="guide-texte" className="text-sm text-muted-foreground">
              Vous avez fait le tour de {libelleParcours}. Vous pouvez relancer cette visite à tout moment depuis le
              bouton « Visite guidée ».
            </p>
            <button
              type="button"
              onClick={quitter}
              className="pressable inline-flex min-h-[44px] items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Terminer
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2
                id="guide-titre"
                ref={titreRef}
                tabIndex={-1}
                className="font-heading text-lg font-bold text-foreground outline-none"
              >
                {etape?.titre}
              </h2>
              <button
                type="button"
                onClick={quitter}
                aria-label="Quitter la visite guidée"
                className="pressable -mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <p id="guide-texte" className="text-sm leading-relaxed text-foreground">
                {etape?.texte}
              </p>
              {etape?.exemple ? (
                <p className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">{etape.exemple}</p>
              ) : null}
            </div>

            {/* Progression : texte ET barre — jamais la couleur seule. */}
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground" aria-live="polite">
                Étape {numero} sur {total}
              </p>
              <div className="h-1 w-full rounded-full bg-border" aria-hidden>
                <div
                  className="h-1 rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${Math.round((numero / total) * 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => aller(-1)}
                disabled={numero === 1}
                className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control px-3 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <ArrowLeft size={16} aria-hidden />
                Précédent
              </button>
              <button
                type="button"
                onClick={() => aller(1)}
                className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {estDerniereEtape(numero - 1, total) ? "Terminer" : "Suivant"}
                <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
