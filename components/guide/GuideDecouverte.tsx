"use client";

import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { FOCUSABLE_SELECTOR, wrapFocusTarget } from "@/lib/admin-shell-nav";
import {
  ATTENTE_CIBLE_MS,
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
 * ⚠️ LA DÉCOUPE NE SE TRAVERSE PAS, SAUF DEMANDE EXPLICITE DE L'ÉTAPE. Par
 * défaut le voile capte les clics pour que le parcours reste maître de la
 * navigation : laisser cliquer un menu mis en lumière déclencherait un
 * changement de route au milieu du parcours, que le guide ne saurait pas
 * suivre. L'utilisateur quitte, puis navigue.
 *
 * L'exception est l'étape qui déclare `gesteAttendu` : là, et seulement là, la
 * découpe laisse passer les clics et le clavier, parce que le geste réel de
 * l'utilisateur fait PARTIE de ce qui est enseigné — ouvrir la feuille d'ajout
 * d'un aliment, par exemple, qui crée au passage un conteneur de repas que le
 * guide n'a pas à créer à la place de l'élève.
 *
 * ACCESSIBILITÉ (règles Apple) : rôle `dialog` modal, focus déplacé sur le
 * titre à chaque étape et piégé dans la carte, `Échap` quitte, flèches gauche
 * et droite naviguent, cibles tactiles ≥ 44 px, progression annoncée une seule
 * fois par une région live polie, et aucune information portée par la seule
 * couleur. Sous `prefers-reduced-motion`, les transitions disparaissent — le
 * guide reste pleinement utilisable.
 *
 * Sur une étape `gesteAttendu`, la cible rejoint l'anneau de tabulation, en
 * tête. Ouvrir la découpe aux seuls clics aurait réservé le geste à la souris
 * et au doigt, et laissé l'étape sans issue au clavier.
 */

export interface GuideDecouverteProps {
  readonly etapes: readonly EtapeGuide[];
  readonly onFermer: () => void;
  /** Libellé de l'espace visité, annoncé aux lecteurs d'écran. */
  readonly libelleParcours?: string;
}

const TAILLE_CARTE = { width: 340, height: 232 };

/** Un rectangle d'écran, dans les coordonnées du voile. */
interface Decoupe {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Les quatre zones de sortie qui entourent la découpe, sans la recouvrir.
 *
 * ⚠️ CECI N'EST PAS LA DÉCOUPE VISUELLE, qui reste un masque SVG — ces bandes
 * sont invisibles et ne servent qu'à la détection du clic. Les coutures d'un
 * pixel qui interdisent quatre div pour le VISUEL sont sans effet ici : une
 * ligne d'un pixel qui ne déclenche pas la sortie ne se voit pas.
 */
function bandesAutour(d: Decoupe): readonly { cle: string; style: CSSProperties }[] {
  const hautPx = Math.max(0, d.y);
  const gauchePx = Math.max(0, d.x);
  return [
    { cle: "haut", style: { top: 0, left: 0, right: 0, height: hautPx } },
    { cle: "bas", style: { top: d.y + d.height, left: 0, right: 0, bottom: 0 } },
    { cle: "gauche", style: { top: d.y, left: 0, width: gauchePx, height: d.height } },
    { cle: "droite", style: { top: d.y, left: d.x + d.width, right: 0, height: d.height } },
  ];
}

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
  /* Identifiant de l'étape dont le déclencheur a DÉJÀ été pressé : une
     ouverture par étape, jamais deux — sans quoi chaque image d'animation
     rouvrirait la feuille. */
  const ouvertePour = useRef<string | null>(null);
  /** Échéance de l'attente en cours, ou `null` si aucune attente. */
  const echeance = useRef<number | null>(null);
  /** Vrai tant que la boucle de mesure doit se relancer. */
  const attenteEnCours = useRef(false);
  /*
   * `data-guide` de la commande qui refermera ce que le guide a ouvert.
   *
   * ⚠️ PORTÉE PAR LE PARCOURS, PAS PAR L'ÉTAPE COURANTE. Une interface ouverte
   * à l'étape 2 reste ouverte aux étapes 3, 4 et 5, qui montrent ce qu'elle
   * contient. Ne retenir que « l'étape qui a ouvert » laissait donc le panneau
   * en place dès que l'utilisateur quittait une étape plus loin — et c'est
   * précisément là qu'il quitte, puisqu'il a lu ce qu'il voulait. On garde donc
   * la commande de fermeture tant qu'elle n'a pas servi.
   */
  const aFermer = useRef<string | null>(null);

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
      /*
       * ════════════════════════════════════════════════════════════════════
       * CIBLE ABSENTE : OUVRIR, PUIS ATTENDRE, PUIS SEULEMENT ABANDONNER.
       * ════════════════════════════════════════════════════════════════════
       * L'ancien comportement sautait l'étape immédiatement. C'est juste pour
       * un menu replié, mais faux pour une feuille d'ajout ou un scanner : la
       * cible n'existe pas ENCORE, elle apparaîtra au clic puis au rendu.
       * Trois temps, dans cet ordre.
       */

      // 1. Un déclencheur est déclaré et n'a pas encore servi POUR CETTE
      //    étape : on le presse une fois. Il n'ouvre qu'une interface —
      //    jamais une validation (voir le contrat sur `ouvrirVia`).
      if (etape.ouvrirVia && ouvertePour.current !== etape.id) {
        ouvertePour.current = etape.id;
        const declencheur = elementCible(etape.ouvrirVia);
        if (declencheur) {
          declencheur.click();
          // Mémorisé AU MOMENT DE L'OUVERTURE : c'est le seul instant où l'on
          // sait avec certitude que l'interface a été ouverte par le guide.
          if (etape.fermerVia) aFermer.current = etape.fermerVia;
          echeance.current = Date.now() + (etape.attenteMs ?? ATTENTE_CIBLE_MS);
          attenteEnCours.current = true;
          return;
        }
      }

      // 2. Une attente est déclarée (ou vient d'être armée) et court encore :
      //    on laisse la boucle de mesure repasser.
      if (etape.attenteMs !== undefined && echeance.current === null) {
        echeance.current = Date.now() + etape.attenteMs;
        attenteEnCours.current = true;
        return;
      }
      if (echeance.current !== null && Date.now() < echeance.current) {
        attenteEnCours.current = true;
        return;
      }

      // 3. Délai écoulé, ou aucune attente demandée : on saute à l'étape
      //    suivante atteignable. Le guide ne reste JAMAIS bloqué.
      attenteEnCours.current = false;
      echeance.current = null;
      const suivante = prochaineEtapeAtteignable(etapes, index + 1, 1, cibleExiste);
      if (suivante !== null && suivante !== index) {
        setIndex(suivante);
      } else {
        setTermine(true);
      }
      setRect(null);
      return;
    }

    // Cible trouvée : l'attente, s'il y en avait une, est terminée.
    attenteEnCours.current = false;
    echeance.current = null;

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
    let actif = true;
    let image = 0;
    /* La boucle ne tourne QUE pendant une attente : hors de ce cas elle
       s'arrête à la première image, comme avant. Pas d'animation permanente. */
    const boucle = () => {
      if (!actif) return;
      mesurer();
      if (actif && attenteEnCours.current) image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    const onChangement = () => mesurer();
    window.addEventListener("resize", onChangement);
    window.addEventListener("scroll", onChangement, true);
    return () => {
      actif = false;
      attenteEnCours.current = false;
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
    /*
     * ⚠️ ON REFERME CE QU'ON A OUVERT, DEPUIS N'IMPORTE QUELLE ÉTAPE. Si le
     * guide a ouvert un panneau pour montrer un champ, le laisser ouvert à la
     * sortie abandonnerait l'utilisateur dans un écran qu'il n'a pas demandé.
     * La commande de fermeture est retenue au moment de l'OUVERTURE et survit
     * aux étapes suivantes, qui montrent justement le contenu du panneau : une
     * condition portant sur l'étape courante aurait laissé le panneau ouvert
     * dès qu'on quitte deux étapes plus loin.
     *
     * Et seulement ce qu'on a ouvert : un panneau que l'utilisateur avait
     * ouvert lui-même avant la visite n'est jamais refermé — `aFermer` ne vaut
     * quelque chose que si le guide a réellement pressé le déclencheur.
     */
    if (aFermer.current) {
      elementCible(aFermer.current)?.click();
      aFermer.current = null;
    }
    ouvertePour.current = null;
    echeance.current = null;
    attenteEnCours.current = false;
    marquerGuideVu(typeof window === "undefined" ? null : window.localStorage);
    onFermer();
    /* `etape` n'est plus une dépendance : la commande de fermeture est lue dans
       `aFermer`, un ref, et non plus sur l'étape courante. La sortie est donc
       stable d'une étape à l'autre — ce qui évite au passage de réabonner les
       écouteurs clavier à chaque pas. */
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
      /* GESTE ATTENDU : la cible entre dans l'anneau de tabulation. Sans cela,
         ouvrir la découpe aux clics ne servirait qu'à la souris et au doigt, et
         l'étape serait un cul-de-sac au clavier. Elle est placée en TÊTE : le
         geste à faire vient avant « Suivant ». */
      if (etape?.gesteAttendu) {
        const cible = elementCible(etape.cible);
        if (cible) focusables.unshift(cible);
      }
      const suivant = wrapFocusTarget(focusables, document.activeElement as HTMLElement | null, evenement.shiftKey);
      if (suivant) {
        evenement.preventDefault();
        suivant.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quitter, aller, etape]);

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
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden focusable="false">
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

      {/* ════════════════════════════════════════════════════════════════════
          LA SORTIE AU CLIC HORS CARTE — ET, SUR DEMANDE, UN TROU DANS LE VOILE
          ════════════════════════════════════════════════════════════════════
          Par défaut, un seul rectangle couvre tout l'écran : cliquer n'importe
          où en dehors de la carte quitte la visite, y compris sur l'élément mis
          en lumière. C'est le comportement de TOUS les parcours déjà livrés, et
          il ne change pas.

          Quand l'étape déclare `gesteAttendu`, le même rectangle est découpé en
          quatre bandes autour de la cible. La zone éclairée devient alors
          réellement cliquable : l'utilisateur presse le bouton LUI-MÊME. On ne
          fait pas de la cible une zone de sortie, sinon le geste attendu
          fermerait la visite au lieu de l'avancer.

          Pourquoi quatre bandes plutôt qu'un `pointer-events: none` sur le
          trou : un trou sans surface n'existe pas en CSS, et poser
          `pointer-events-none` sur le rectangle entier supprimerait la sortie
          au clic partout. Quatre bandes gardent les deux propriétés. */}
      {etape?.gesteAttendu && decoupe ? (
        bandesAutour(decoupe).map((bande) => (
          <button
            key={bande.cle}
            type="button"
            aria-label="Quitter la visite guidée"
            className="absolute cursor-default"
            style={bande.style}
            onClick={quitter}
            tabIndex={-1}
          />
        ))
      ) : (
        <button
          type="button"
          aria-label="Quitter la visite guidée"
          className="absolute inset-0 h-full w-full cursor-default"
          onClick={quitter}
          tabIndex={-1}
        />
      )}

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
