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
 * AUCUNE INFORMATION N'EST RÉSERVÉE AU SURVOL
 * ════════════════════════════════════════════════════════════════════════
 * C'est la contrainte qui a dicté la géométrie. Chaque carte porte son texte
 * COMPLET dans le DOM en permanence — le survol ne révèle rien, il met en
 * avant. Un lecteur d'écran lit les avis dans l'ordre, sans jamais rencontrer
 * de contenu conditionné à un pointeur ; l'utilisateur clavier tabule d'une
 * carte à l'autre et chaque `:focus-visible` produit exactement la même mise
 * en avant que le survol.
 *
 * ⚠️ Ne jamais remplacer la superposition par un `opacity: 0` ou un
 * `visibility: hidden` sur les cartes en retrait : ce serait précisément
 * cacher de l'information derrière le survol.
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
 * Le décalage et l'inclinaison de chaque carte sont DÉTERMINISTES, dérivés de
 * l'index : deux rendus successifs donnent la même composition, et le serveur
 * et le client produisent le même HTML.
 *
 * ⚠️ CE COMPOSANT NE SAIT PAS D'OÙ VIENNENT LES AVIS. Il reçoit une liste et
 * la rend. La Phase B changera la source, pas ce fichier.
 */

interface Props {
  readonly avis: readonly GoogleReview[];
}

/**
 * L'inclinaison d'une carte au repos, en degrés.
 *
 * Alternée autour de zéro et bornée à ±2,2° : au-delà, une carte de texte
 * cesse d'être confortable à lire, et l'ensemble vire au collage. La carte
 * mise en avant revient TOUJOURS à 0° — on ne lit pas un avis de travers.
 */
function inclinaison(index: number): number {
  const amplitudes = [-2.2, 1.6, -1.1, 2.2, -1.7, 1.2];
  return amplitudes[index % amplitudes.length];
}

/** Le décalage vertical au repos, en pixels. Même logique : discret, borné. */
function decalage(index: number): number {
  const ecarts = [0, 18, -12, 24, -6, 12];
  return ecarts[index % ecarts.length];
}

function Etoiles({ note }: { readonly note: number }) {
  return (
    // ⚠️ LES ÉTOILES SONT DÉCORATIVES, LE LIBELLÉ PORTE L'INFORMATION. Cinq
    // icônes sans texte ne sont rien pour un lecteur d'écran ; `aria-label`
    // dit la note en toutes lettres, et les icônes sont masquées.
    <p className="flex items-center gap-0.5" aria-label={`${note} étoiles sur 5`}>
      {Array.from({ length: note }, (_, i) => (
        <Star key={i} size={14} className="avis-etoile flex-shrink-0" aria-hidden="true" />
      ))}
    </p>
  );
}

/** « mars 2026 » — la précision d'un avis client n'est pas au jour près. */
function moisEtAnnee(iso: string): string | null {
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
      <div className="mb-3 flex items-center gap-3">
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
          <span className="block break-words font-heading text-sm font-semibold uppercase tracking-wide text-foreground">
            {item.authorName}
          </span>
          {date ? (
            <span className="block text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
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

export function GoogleReviewsStack({ avis }: Props) {
  const [actif, setActif] = useState<number | null>(null);
  const [tapArme, setTapArme] = useState<number | null>(null);
  const piste = useRef<HTMLUListElement | null>(null);

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

  const surTap = useCallback(
    (index: number, event: React.MouseEvent<HTMLAnchorElement>) => {
      // Souris : le survol a déjà mis la carte en avant, le clic suit le lien.
      const natif = event.nativeEvent;
      if (natif instanceof PointerEvent && natif.pointerType === "mouse") return;
      // Tactile : le PREMIER tap met en avant sans naviguer, le second suit.
      if (tapArme !== index) {
        event.preventDefault();
        setActif(index);
        setTapArme(index);
      }
    },
    [tapArme],
  );

  const mettreEnAvant = useCallback((index: number) => () => setActif(index), []);
  const retirer = useCallback(
    (index: number) => () => setActif((courant) => (courant === index ? null : courant)),
    [],
  );

  if (avis.length === 0) return null;

  return (
    <ul ref={piste} className="avis-pile" data-avis-pile>
      {avis.map((item, index) => {
        const enAvant = actif === index;
        const lien = item.googleUrl;
        const gestes = {
          className: "avis-carte",
          onMouseEnter: mettreEnAvant(index),
          onMouseLeave: retirer(index),
          onFocus: mettreEnAvant(index),
          onBlur: retirer(index),
        } as const;

        return (
          <li
            key={item.id}
            className="avis-carte-hote"
            style={
              {
                "--avis-rotation": `${inclinaison(index)}deg`,
                "--avis-decalage": `${decalage(index)}px`,
                // Les cartes se recouvrent dans l'ordre du DOM ; la carte mise
                // en avant passe au-dessus de toutes les autres.
                "--avis-plan": enAvant ? 50 : avis.length - index,
              } as React.CSSProperties
            }
            data-en-avant={enAvant ? "true" : undefined}
          >
            {lien ? (
              <a
                {...gestes}
                href={lien}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(event) => surTap(index, event)}
              >
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
