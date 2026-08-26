"use client";

import { Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { GoogleReview } from "@/lib/reviews/types";

/**
 * LA PILE D'AVIS — DÉCOUVERTE PAR SURVOL, PAR TAP, ET AU CLAVIER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE PILE ET PAS UN CARROUSEL
 * ════════════════════════════════════════════════════════════════════════
 * Un carrousel à flèches montre UN avis et cache les autres derrière un
 * geste. Une pile les montre TOUS d'un coup, légèrement décalés : on voit
 * qu'il y en a plusieurs avant même d'interagir, et l'envie d'en lire un
 * vient de ce qu'on en devine déjà un bout. C'est ce qui distingue une preuve
 * sociale d'une liste de témoignages.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉSORDRE VIENT DE LA POSITION, JAMAIS DE LA ROTATION
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE CARTE N'EST INCLINÉE. C'est une exigence, pas une préférence :
 * une version précédente donnait à chaque carte une inclinaison de ±2,2°, et
 * elle a été RETIRÉE. Toutes les cartes sont parfaitement horizontales.
 *
 * L'aspect organique tient entièrement à la POSITION : chaque carte est
 * translatée horizontalement et verticalement d'une quantité qui lui est
 * propre. Les deux tables de décalage ont des longueurs PREMIÈRES ENTRE ELLES
 * (7 et 5) : sur neuf cartes, aucune paire ne retombe sur le même couple
 * (dx, dy), donc aucune rangée ni colonne ne s'aligne parfaitement.
 *
 * ⚠️ NE PAS RÉINTRODUIRE DE `rotate()` SUR UNE CARTE, sous aucune forme —
 * ni au repos, ni au survol, ni au focus. La seule rotation tolérée dans ce
 * composant est celle du GROUPE ENTIER (voir plus bas), bornée à 0,5°.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE TEXTE EST TOUJOURS DANS LE DOM — IL EST SEULEMENT ÉCOURTÉ À L'ŒIL
 * ════════════════════════════════════════════════════════════════════════
 * Au repos, la carte ne montre que les premières lignes de l'avis ; le texte
 * COMPLET apparaît au survol, au focus clavier et au tap.
 *
 * ⚠️ LA DISTINCTION QUI COMPTE : le texte n'est jamais RETIRÉ, il est
 * seulement ÉCRÊTÉ VISUELLEMENT (`line-clamp` en CSS). Il reste intégralement
 * dans le DOM, donc un lecteur d'écran le lit en entier sans avoir à
 * survoler quoi que ce soit, et un moteur d'indexation le voit.
 *
 * ⚠️ NE JAMAIS remplacer cet écrêtage par un rendu conditionnel du type
 * `{enAvant && <p>{item.text}</p>}` : ce serait, cette fois pour de bon,
 * réserver de l'information au survol.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS ENTRÉES, UN SEUL ÉTAT
 * ════════════════════════════════════════════════════════════════════════
 * `actif` — l'index mis en avant — est piloté par :
 *   • le survol (desktop uniquement, voir la garde `(hover: hover)` en CSS) ;
 *   • le focus clavier, qui pose le même état ;
 *   • le tap (tactile), où le premier tap met en avant sans naviguer et le
 *     second suit le lien quand il y en a un.
 *
 * Les décalages sont DÉTERMINISTES, dérivés de l'index : deux rendus
 * successifs donnent la même composition, et le serveur et le client
 * produisent le même HTML.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA SECOUSSE TACTILE — ELLE APPARTIENT AU GROUPE, PAS AUX CARTES
 * ════════════════════════════════════════════════════════════════════════
 * Sur tactile, un tap fait bouger TOUT L'ENSEMBLE d'un très léger mouvement,
 * comme une pile d'objets qu'on effleure. La direction est tirée au hasard à
 * chaque interaction.
 *
 * ⚠️ LA TRANSFORMATION EST POSÉE SUR LE CONTENEUR, autour d'un
 * `transform-origin` central — jamais sur les cartes une à une. C'est la
 * différence entre « la pile bouge » et « neuf cartes bougent chacune dans
 * leur coin », et c'est visible à l'œil.
 *
 * ⚠️ CE CENTRE EST PUREMENT CONCEPTUEL. `transform-origin` est une propriété
 * de calcul : elle ne dessine RIEN. Il ne doit exister nulle part de cercle,
 * de point, d'axe ou de pseudo-élément qui le représenterait — ni ici, ni en
 * CSS. Le lecteur doit sentir que l'amas s'organise autour de quelque chose,
 * sans jamais voir ce quelque chose.
 *
 * ⚠️ LE TIRAGE AU SORT N'A LIEU QUE DANS UN GESTIONNAIRE D'ÉVÉNEMENT, jamais
 * au rendu : un `Math.random()` appelé pendant le rendu donnerait au serveur
 * et au client deux valeurs différentes, et l'hydratation échouerait.
 *
 * ⚠️ CE COMPOSANT NE SAIT PAS D'OÙ VIENNENT LES AVIS. Il reçoit une liste et
 * la rend. La Phase B changera la source, pas ce fichier.
 */

interface Props {
  readonly avis: readonly GoogleReview[];
}

/**
 * LE DÉCALAGE HORIZONTAL d'une carte au repos, en pixels.
 *
 * C'est lui qui remplace l'ancienne inclinaison : une carte plus à gauche,
 * la suivante plus à droite, sans qu'aucune ne penche. Les valeurs sont
 * irrégulières À DESSEIN — une progression régulière redessinerait une
 * grille, en diagonale au lieu d'être droite, mais une grille quand même.
 */
function decalageX(index: number): number {
  const ecarts = [0, 11, -8, 13, -5, 8, -11];
  return ecarts[index % ecarts.length];
}

/**
 * LE DÉCALAGE VERTICAL au repos, en pixels.
 *
 * ⚠️ SEPT VALEURS EN HORIZONTAL, CINQ EN VERTICAL. Les deux longueurs sont
 * premières entre elles : le couple (dx, dy) ne se répète qu'au bout de
 * 35 cartes. Avec neuf avis, aucune carte n'a la position d'une autre, et
 * c'est ce qui garantit qu'aucune rangée ne s'aligne au pixel près.
 */
function decalageY(index: number): number {
  const ecarts = [0, 9, -6, 11, -4];
  return ecarts[index % ecarts.length];
}

function Etoiles({ note }: { readonly note: number }) {
  return (
    // ⚠️ LES ÉTOILES SONT DÉCORATIVES, LE LIBELLÉ PORTE L'INFORMATION. Cinq
    // icônes sans texte ne sont rien pour un lecteur d'écran ; `aria-label`
    // dit la note en toutes lettres, et les icônes sont masquées.
    <p className="avis-notes flex items-center gap-0.5" aria-label={`${note} étoiles sur 5`}>
      {Array.from({ length: note }, (_, i) => (
        <Star key={i} size={14} className="avis-etoile flex-shrink-0" aria-hidden="true" />
      ))}
    </p>
  );
}

/**
 * « mars 2026 » — la précision d'un avis client n'est pas au jour près.
 *
 * ⚠️ REND `null` QUAND LA DATE EST INCONNUE, et la carte n'affiche alors
 * aucune ligne de date. C'est le cas des avis recopiés depuis une capture :
 * Google n'y montre qu'une ancienneté relative (« il y a 4 jours »), qu'on
 * refuse de convertir en date absolue. Rien ne remplace la ligne manquante —
 * ni « date inconnue », ni un mois deviné.
 */
function moisEtAnnee(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
}

/**
 * LE CONTENU D'UNE CARTE, indépendant de sa balise.
 *
 * Extrait parce que la carte est un `<a>` quand une URL existe et un `<div>`
 * sinon — et qu'une balise dynamique unique rendrait le typage des
 * gestionnaires d'événements faux dans un cas sur deux.
 */
function ContenuCarte({ item, lien }: { readonly item: GoogleReview; readonly lien: string | null }) {
  const date = moisEtAnnee(item.date);
  return (
    <>
      <div className="avis-entete mb-3 flex items-center gap-3">
        {/*
          L'avatar. Balise <img> native et non next/image : en Phase B l'URL
          viendra de googleusercontent.com, qui n'est pas déclaré dans
          next.config.ts — l'optimiseur la refuserait. Aucune donnée n'est
          fabriquée : sans photo, on affiche l'initiale, ce qui est aussi le
          rendu réel d'un compte Google sans photo de profil.
        */}
        {item.authorPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.authorPhoto}
            alt=""
            aria-hidden="true"
            width={36}
            height={36}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="avis-avatar"
          />
        ) : (
          <span className="avis-avatar avis-avatar-initiale" aria-hidden="true">
            {item.authorName.slice(0, 1).toUpperCase()}
          </span>
        )}

        <span className="min-w-0">
          {/*
            ⚠️ PAS DE `truncate`. Un nom coupé en « Camille… » n'attribue plus
            l'avis à personne. Il passe à la ligne, et la carte grandit
            d'autant.
          */}
          <span className="avis-auteur block break-words font-heading text-sm font-semibold uppercase tracking-wide text-foreground">
            {item.authorName}
          </span>
          {date ? (
            <span className="avis-date block text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
              {date}
            </span>
          ) : null}
        </span>
      </div>

      <Etoiles note={item.rating} />

      {/* LE TEXTE, TEL QUEL. Jamais tronqué : la carte grandit, le texte non. */}
      <p className="avis-texte mt-3 text-[0.9rem] leading-relaxed text-muted-foreground">{item.text}</p>

      <span className="avis-source mt-4 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground/70">
        Avis Google
        {lien ? <span aria-hidden="true">↗</span> : null}
      </span>
    </>
  );
}

/**
 * L'amplitude maximale de la secousse du groupe, en pixels.
 *
 * ⚠️ HUIT PIXELS, PAS DAVANTAGE. C'est un frémissement, pas un déplacement :
 * l'amas doit sembler effleuré, jamais bousculé. Le tirage tire entre 60 % et
 * 100 % de cette valeur, soit un mouvement réel de 5 à 8 px.
 */
const AMPLITUDE_SECOUSSE = 8;
/** Le plafond de la micro-rotation GLOBALE, en degrés. Jamais au-delà : une
 *  rotation visible contredirait l'exigence « toutes les cartes horizontales ». */
const ROTATION_GROUPE_MAX = 0.4;
/** La durée de l'aller-retour, en millisecondes. Sous les 300 ms de la maison. */
const DUREE_SECOUSSE = 260;

interface Secousse {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export function GoogleReviewsStack({ avis }: Props) {
  const [actif, setActif] = useState<number | null>(null);
  const [tapArme, setTapArme] = useState<number | null>(null);
  const [secousse, setSecousse] = useState<Secousse | null>(null);
  const piste = useRef<HTMLUListElement | null>(null);
  const minuterie = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (minuterie.current !== null) window.clearTimeout(minuterie.current);
    },
    [],
  );

  /**
   * LA SECOUSSE DU GROUPE — direction tirée au sort, amplitude faible.
   *
   * ⚠️ ELLE N'EST APPELÉE QUE DEPUIS UN GESTIONNAIRE D'ÉVÉNEMENT. Un
   * `Math.random()` évalué pendant le rendu produirait un HTML serveur
   * différent du HTML client, et React refuserait l'hydratation.
   *
   * ⚠️ CE QUI SORT D'ICI EST POSÉ SUR LE CONTENEUR, pas sur les cartes : ce
   * sont trois variables lues par `.avis-pile`, dont le `transform-origin`
   * est le centre. La pile pivote et glisse d'un bloc ; aucune carte ne
   * tourne sur elle-même.
   */
  const secouerLeGroupe = useCallback(() => {
    const angle = Math.random() * Math.PI * 2;
    const amplitude = AMPLITUDE_SECOUSSE * (0.6 + Math.random() * 0.4);
    const rotation = (Math.random() * 2 - 1) * ROTATION_GROUPE_MAX;
    setSecousse({
      x: Math.round(Math.cos(angle) * amplitude),
      y: Math.round(Math.sin(angle) * amplitude),
      rotation: Math.round(rotation * 100) / 100,
    });
    if (minuterie.current !== null) window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => setSecousse(null), DUREE_SECOUSSE);
  }, []);

  // Un tap ailleurs referme la mise en avant : sans ça, sur tactile, une carte
  // resterait au premier plan indéfiniment.
  useEffect(() => {
    function ailleurs(event: PointerEvent) {
      if (event.pointerType === "mouse") return;
      const cible = event.target;
      if (cible instanceof Node && piste.current?.contains(cible)) return;
      setActif(null);
      setTapArme(null);
    }
    document.addEventListener("pointerdown", ailleurs);
    return () => document.removeEventListener("pointerdown", ailleurs);
  }, []);

  /**
   * ⚠️ TYPÉ SUR `HTMLElement`, PAS SUR `HTMLAnchorElement`.
   *
   * Une carte est un `<a>` quand l'avis porte une URL Google, un `<div>`
   * sinon — et AUCUN des neuf avis actuels n'en porte, faute de lien fourni
   * par l'API. Un gestionnaire posé sur le seul `<a>` n'aurait donc jamais
   * été appelé : le tap n'aurait mis aucune carte en avant par ce chemin, et
   * surtout la secousse du groupe n'aurait jamais eu lieu en production.
   */
  const surTap = useCallback(
    (index: number, event: React.MouseEvent<HTMLElement>) => {
      // Souris : le survol a déjà mis la carte en avant, le clic suit le lien.
      const natif = event.nativeEvent;
      if (natif instanceof PointerEvent && natif.pointerType === "mouse") return;
      // Tactile : le PREMIER tap met en avant sans naviguer, le second suit.
      if (tapArme !== index) {
        event.preventDefault();
        setActif(index);
        setTapArme(index);
      }
      // Et dans tous les cas le GROUPE réagit — c'est le geste tactile
      // demandé : on touche une carte, l'ensemble frémit.
      secouerLeGroupe();
    },
    [secouerLeGroupe, tapArme],
  );

  const mettreEnAvant = useCallback((index: number) => () => setActif(index), []);
  const retirer = useCallback(
    (index: number) => () => setActif((courant) => (courant === index ? null : courant)),
    [],
  );

  if (avis.length === 0) return null;

  return (
    <ul
      ref={piste}
      className="avis-pile"
      data-avis-pile
      data-avis-secousse={secousse ? "true" : undefined}
      style={
        {
          // ⚠️ TROIS VARIABLES SUR LE CONTENEUR, ZÉRO SUR LES CARTES. C'est
          // ce qui fait réagir la pile comme un objet unique.
          "--avis-groupe-x": `${secousse?.x ?? 0}px`,
          "--avis-groupe-y": `${secousse?.y ?? 0}px`,
          "--avis-groupe-rotation": `${secousse?.rotation ?? 0}deg`,
        } as React.CSSProperties
      }
    >
      {avis.map((item, index) => {
        const enAvant = actif === index;
        const lien = item.googleUrl;
        const gestes = {
          className: "avis-carte",
          onMouseEnter: mettreEnAvant(index),
          onMouseLeave: retirer(index),
          onFocus: mettreEnAvant(index),
          onBlur: retirer(index),
          // ⚠️ LE TAP EST DANS LES GESTES COMMUNS, donc il vaut aussi pour la
          // carte SANS lien — c'est-à-dire pour les neuf avis actuels.
          onClick: (event: React.MouseEvent<HTMLElement>) => surTap(index, event),
        } as const;

        return (
          <li
            key={item.id}
            className="avis-carte-hote"
            style={
              {
                // ⚠️ AUCUNE VARIABLE DE ROTATION ICI. Le désordre est
                // entièrement porté par ces deux translations.
                "--avis-dx": `${decalageX(index)}px`,
                "--avis-dy": `${decalageY(index)}px`,
                // Les cartes se recouvrent dans l'ordre du DOM ; la carte mise
                // en avant passe au-dessus de toutes les autres.
                "--avis-plan": enAvant ? 50 : avis.length - index,
              } as React.CSSProperties
            }
            data-en-avant={enAvant ? "true" : undefined}
          >
            {lien ? (
              <a {...gestes} href={lien} target="_blank" rel="noopener noreferrer nofollow">
                <ContenuCarte item={item} lien={lien} />
              </a>
            ) : (
              // Sans lien, la carte reste atteignable au clavier : c'est elle
              // qui porte la mise en avant, et l'exclure du parcours rendrait
              // la découverte impossible sans souris.
              <div {...gestes} tabIndex={0}>
                <ContenuCarte item={item} lien={null} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
