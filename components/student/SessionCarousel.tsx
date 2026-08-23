"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ChevronLeft, ChevronRight, Dumbbell } from "lucide-react";

import { BLOCK_COLOR_STYLES } from "@/components/admin/blocks/block-view-model";
import {
  aplatirEnCartes,
  categorieCarte,
  libelleCarte,
  type CarteSeance,
} from "@/lib/student-session-carousel";
import type { StudentCardioBlockView, StudentSessionBlockView } from "@/lib/student-session-blocks";
import { normalizeColorKey } from "@/lib/training-block-editing";
import type { Exercise } from "@/types";

/**
 * LE PARCOURS D'UNE SÉANCE, CARTE PAR CARTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN CONTENEUR, PAS UNE SECONDE IMPLÉMENTATION
 * ════════════════════════════════════════════════════════════════════════
 * Ce composant ne rend AUCUN champ, aucune saisie, aucune validation. Il
 * reçoit les mêmes fonctions de rendu que l'ancienne liste verticale et se
 * contente de les disposer sur un rail horizontal. La carte d'exercice
 * reste `ExerciseFeedbackCard`, la prescription cardio reste
 * `StudentCardioBlockCard`, la validation d'un bloc cardio reste
 * `CardioBlockFeedbackForm` — tous montés tels quels, avec les mêmes props.
 * L'état de la séance continue de vivre dans `SessionFeedbackSection`, et
 * la soumission reste celle du `<form>` qui englobe ce rail.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI DU CSS NATIF ET AUCUNE LIBRAIRIE
 * ════════════════════════════════════════════════════════════════════════
 * `overflow-x:auto` + `scroll-snap-type:x mandatory` + `scroll-snap-align:
 * start`, c'est le carrousel du navigateur lui-même : inertie native,
 * rattrapage natif, accessibilité native, zéro octet de JavaScript pour
 * faire glisser. Le JavaScript ci-dessous ne sert QU'À DEUX CHOSES — dire
 * où l'on se trouve, et déplacer le rail quand on clique sur ‹ ou › . Si ce
 * script ne s'exécutait jamais, le doigt continuerait de fonctionner.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI RESTE HORS DU RAIL
 * ════════════════════════════════════════════════════════════════════════
 * La validation GLOBALE de la séance (« Résumé de la séance » et son bouton
 * d'envoi) n'entre jamais ici : elle reste en flux normal sous le rail, donc
 * toujours atteignable sans avoir à parcourir toutes les cartes. Un test
 * vérifie explicitement que le bouton d'envoi n'est pas un descendant du
 * rail.
 */
export function SessionCarousel({
  blocks,
  renderStrengthExercise,
  renderCardioPrescription,
  renderCardioValidation,
}: {
  blocks: StudentSessionBlockView[];
  /** Identique à l'ancienne prop de `StudentSessionBlockList` — même signature, même appelant. */
  renderStrengthExercise: (exercise: Exercise, globalIndex: number) => ReactNode;
  renderCardioPrescription: (view: StudentCardioBlockView) => ReactNode;
  renderCardioValidation: (view: StudentCardioBlockView) => ReactNode;
}) {
  const cartes = aplatirEnCartes(blocks);
  const rail = useRef<HTMLDivElement | null>(null);
  const [actif, setActif] = useState(0);

  /**
   * QUELLE CARTE EST DEVANT LES YEUX ?
   *
   * Celle dont le bord gauche est le plus proche du bord gauche du rail.
   * C'est la définition exacte de `scroll-snap-align:start`, donc la mesure
   * suit le rattrapage du navigateur au lieu de le deviner. On ne divise
   * pas `scrollLeft` par une largeur supposée : l'espace entre les cartes
   * et les marges latérales fausseraient le calcul.
   */
  const recalculer = useCallback(() => {
    const piste = rail.current;
    if (!piste) return;
    const cartesDom = Array.from(piste.children) as HTMLElement[];
    if (cartesDom.length === 0) return;
    let meilleur = 0;
    let ecartMin = Number.POSITIVE_INFINITY;
    cartesDom.forEach((element, index) => {
      const ecart = Math.abs(element.offsetLeft - piste.offsetLeft - piste.scrollLeft);
      if (ecart < ecartMin) {
        ecartMin = ecart;
        meilleur = index;
      }
    });
    setActif(meilleur);
  }, []);

  useEffect(() => {
    const piste = rail.current;
    if (!piste) return;
    // `requestAnimationFrame` suffit : on n'a pas besoin d'une valeur par
    // pixel parcouru, seulement de la carte finale, et le navigateur nous
    // rappelle à chaque image.
    let planifie = false;
    const onScroll = () => {
      if (planifie) return;
      planifie = true;
      requestAnimationFrame(() => {
        planifie = false;
        recalculer();
      });
    };
    piste.addEventListener("scroll", onScroll, { passive: true });
    recalculer();
    return () => piste.removeEventListener("scroll", onScroll);
  }, [recalculer, cartes.length]);

  const allerVers = useCallback((index: number) => {
    const piste = rail.current;
    if (!piste) return;
    const cible = piste.children[index] as HTMLElement | undefined;
    if (!cible) return;
    // On déplace le rail, JAMAIS la page : `scrollIntoView` aurait pu faire
    // défiler le document verticalement pour « bien montrer » la carte.
    piste.scrollTo({ left: cible.offsetLeft - piste.offsetLeft, behavior: "smooth" });
  }, []);

  /**
   * LES FLÈCHES DU CLAVIER, MAIS PAS DANS UN CHAMP.
   *
   * Un élève qui corrige « 34 » en « 36 » dans le champ Charge utilise ← et
   * → pour déplacer son curseur. Les intercepter le ferait changer
   * d'exercice en pleine saisie. On ne les prend donc que lorsque le focus
   * n'est sur aucun contrôle de saisie.
   */
  const onKeyDown = (evenement: React.KeyboardEvent<HTMLDivElement>) => {
    if (evenement.key !== "ArrowLeft" && evenement.key !== "ArrowRight") return;
    const cible = evenement.target as HTMLElement | null;
    if (cible?.closest("input, textarea, select, [contenteditable='true']")) return;
    evenement.preventDefault();
    allerVers(evenement.key === "ArrowLeft" ? Math.max(0, actif - 1) : Math.min(cartes.length - 1, actif + 1));
  };

  if (cartes.length === 0) return null;

  const carteActive = cartes[Math.min(actif, cartes.length - 1)];
  const libelle = libelleCarte(carteActive);

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div
        ref={rail}
        // `region` + libellé : un lecteur d'écran annonce le parcours, et
        // `aria-live` sur l'indicateur dit où l'on vient d'arriver.
        role="region"
        aria-label="Parcours de la séance"
        data-rail-seance="true"
        className="rail-seance flex snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1"
      >
        {cartes.map((carte) => (
          <div
            key={carte.cleCarte}
            data-carte-seance={carte.kind}
            className="flex w-full flex-shrink-0 snap-start flex-col overflow-hidden sm:w-[85%] lg:w-[72%] lg:max-w-2xl"
          >
            <BandeauBloc carte={carte} />
            {/*
              LE SEUL DÉFILEMENT VERTICAL AUTORISÉ, ET IL EST BORNÉ.
              Une carte plus haute que l'écran défile DANS elle-même, sans
              jamais rallonger la page : `overscroll-contain` empêche le
              défilement de se propager au document une fois arrivé en bout
              de course. `min-h-0` est indispensable — sans lui, la règle
              flex `min-height:auto` annulerait `overflow-y-auto`.
            */}
            <div className="min-h-0 max-h-[76dvh] flex-1 overflow-y-auto overscroll-y-contain">
              {carte.kind === "exercice"
                ? renderStrengthExercise(carte.exercise, carte.indexGlobal)
                : carte.kind === "cardio"
                  ? renderCardioPrescription(carte.view)
                  : renderCardioValidation(carte.view)}
            </div>
          </div>
        ))}
      </div>

      {/* ── OÙ SUIS-JE, ET COMMENT J'AVANCE ─────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div aria-live="polite" className="min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground">
          <span className="font-semibold text-foreground">{libelle.bloc}</span>
          <span className="mx-2 opacity-40">·</span>
          <span>{libelle.position}</span>
          <span className="mx-2 opacity-40">·</span>
          <span>
            Carte {actif + 1} / {cartes.length}
          </span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <BoutonRail
            direction="precedent"
            disabled={actif === 0}
            onClick={() => allerVers(Math.max(0, actif - 1))}
          />
          <BoutonRail
            direction="suivant"
            disabled={actif >= cartes.length - 1}
            onClick={() => allerVers(Math.min(cartes.length - 1, actif + 1))}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * LE BANDEAU DE BLOC, SUR CHAQUE CARTE.
 *
 * L'ancienne carte de bloc englobait ses exercices : la couleur et le titre
 * du bloc étaient lus une fois, en haut. Au doigt, on arrive au milieu d'un
 * bloc sans avoir vu son en-tête — chaque carte porte donc désormais son
 * appartenance. C'est la même pastille, la même icône et les mêmes styles
 * que `StudentStrengthBlockCard` / `StudentCardioBlockCard` : aucune
 * nouvelle esthétique n'est introduite ici.
 */
function BandeauBloc({ carte }: { carte: CarteSeance }) {
  const estCardio = carte.kind !== "exercice";
  const couleur = BLOCK_COLOR_STYLES[normalizeColorKey(carte.colorKey, estCardio ? "blue" : "gray")];
  const Icone = estCardio ? Activity : Dumbbell;
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-t-card border border-b-0 border-l-4 border-border ${couleur.borderLeft} ${couleur.softBg} px-4 py-2.5`}
    >
      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${couleur.dot}`} aria-hidden="true" />
      <Icone size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
        Bloc {carte.blocNumero} · {categorieCarte(carte)}
      </span>
      {carte.blockTitle ? (
        <span className="truncate font-heading text-[11px] font-bold uppercase text-foreground">· {carte.blockTitle}</span>
      ) : null}
    </div>
  );
}

function BoutonRail({
  direction,
  disabled,
  onClick,
}: {
  direction: "precedent" | "suivant";
  disabled: boolean;
  onClick: () => void;
}) {
  const precedent = direction === "precedent";
  const Icone = precedent ? ChevronLeft : ChevronRight;
  return (
    <button
      // `type="button"` est VITAL : ce rail vit à l'intérieur du <form> de la
      // séance, et un bouton sans type y vaut `submit`. Naviguer d'une carte
      // à l'autre enverrait le retour.
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={precedent ? "Carte précédente" : "Carte suivante"}
      className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Icone size={18} aria-hidden="true" />
    </button>
  );
}
