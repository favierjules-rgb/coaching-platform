import { Star } from "lucide-react";

import { LogoGoogle } from "@/components/ui/LogoGoogle";
import type { GoogleReview } from "@/lib/reviews/types";

/**
 * LE MUR D'AVIS — deux colonnes qui défilent en boucle.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE COMPOSANT REMPLACE `GoogleReviewsStack`, ET C'EST UN CHANGEMENT DE FOND
 * ════════════════════════════════════════════════════════════════════════
 * La version précédente était une mise en scène « orbite » : un amas de
 * cartes qui se recouvraient autour d'une photo centrale, avec survol, tap,
 * secousse et mise en avant — 530 lignes de composant client.
 *
 * Conséquence directe, et c'est le gain : IL N'Y A PLUS DE JAVASCRIPT. Plus
 * d'état, plus d'écouteur, plus de `"use client"`. Les avis sont dans le HTML
 * initial, lisibles avant que le moindre script ne s'exécute, et le
 * défilement est une animation CSS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI DES COLONNES EXPLICITES ET PLUS `columns`
 * ════════════════════════════════════════════════════════════════════════
 * La première version utilisait le multi-colonnes CSS. Il est parfait pour
 * une mosaïque figée — et incompatible avec une boucle. Dans un `columns`,
 * le navigateur RÉPARTIT le contenu entre les colonnes : dupliquer la liste
 * pour boucler ne place pas la copie sous l'original, elle la redistribue.
 * Le raccord serait visible et le cycle faux.
 *
 * Chaque colonne est donc une PISTE indépendante, avec son propre contenu
 * dupliqué et sa propre durée. C'est aussi ce qui permet aux deux colonnes
 * d'avancer à la même vitesse apparente alors qu'elles n'ont pas la même
 * hauteur.
 *
 * ⚠️ AUCUN TEXTE N'EST TRONQUÉ. Pas de « Lire la suite », pas d'écrêtage :
 * une carte fait la hauteur de son avis.
 */

/**
 * Deux colonnes, et pas trois.
 *
 * ⚠️ LE NOMBRE EST FIGÉ CÔTÉ SERVEUR, parce qu'une colonne est un élément du
 * DOM et non une propriété CSS. En rendre trois pour les masquer sur petit
 * écran cacherait un tiers des avis ; en rendre une seule gâcherait la
 * largeur disponible sur grand écran. Deux tient dans les deux cas.
 */
const NOMBRE_DE_COLONNES = 2;

/**
 * Vitesse de défilement visée, en pixels par seconde.
 *
 * ⚠️ TRENTE, ET C'EST LENT EXPRÈS. Un mur de témoignages n'est pas un
 * bandeau publicitaire : le lecteur doit pouvoir finir une phrase sans
 * courir après elle. Au-delà de ~50 px/s le texte devient illisible en
 * mouvement.
 */
const VITESSE_PX_PAR_SECONDE = 30;

/**
 * Hauteur estimée d'une carte, en pixels, à partir de son nombre de
 * caractères.
 *
 * ⚠️ ESTIMÉE, ET ASSUMÉE COMME TELLE. Mesurer la vraie hauteur exigerait du
 * JavaScript et un rendu client — exactement ce que cette refonte a
 * supprimé. L'estimation ne sert qu'à donner à chaque colonne une durée
 * PROPORTIONNELLE à sa hauteur, pour que les deux avancent à la même vitesse
 * apparente. Une erreur de 10 % se traduit par une différence de vitesse de
 * 10 % entre colonnes : invisible. Une erreur de signe, elle, se verrait —
 * d'où le plancher et le plafond sur la durée.
 *
 * `120` : l'en-tête (avatar, nom, étoiles) plus les marges de la carte.
 * `0.49` : environ un demi-pixel de hauteur par caractère, à ~45 caractères
 * par ligne et 22 px d'interligne.
 */
function hauteurEstimee(item: GoogleReview): number {
  return 120 + item.text.length * 0.49;
}

/** Bornes de sécurité : ni un défilement figé, ni une course. */
const DUREE_MIN_S = 40;
const DUREE_MAX_S = 140;

function dureeDeColonne(colonne: readonly GoogleReview[]): number {
  const hauteur = colonne.reduce((total, item) => total + hauteurEstimee(item), 0);
  const secondes = Math.round(hauteur / VITESSE_PX_PAR_SECONDE);
  return Math.min(DUREE_MAX_S, Math.max(DUREE_MIN_S, secondes));
}

/**
 * Répartition en colonnes, en alternance.
 *
 * ⚠️ EN ALTERNANCE ET PAS EN BLOCS. Couper la liste en deux moitiés mettrait
 * les six premiers avis à gauche et les six derniers à droite : les colonnes
 * auraient des hauteurs très inégales, et l'ordre de lecture ne
 * correspondrait plus à rien. L'alternance équilibre les hauteurs sans
 * trier, donc sans privilégier un avis sur un autre.
 */
function repartir(avis: readonly GoogleReview[]): GoogleReview[][] {
  const colonnes: GoogleReview[][] = Array.from({ length: NOMBRE_DE_COLONNES }, () => []);
  avis.forEach((item, index) => colonnes[index % NOMBRE_DE_COLONNES].push(item));
  return colonnes;
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
 * aucune ligne de date. C'est le cas de tous les avis recopiés depuis une
 * capture : Google n'y montre qu'une ancienneté relative (« il y a 2
 * semaines »), qu'on refuse de convertir en date absolue.
 */
function moisEtAnnee(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
}

/**
 * ⚠️ `copie` MASQUE LA CARTE AUX LECTEURS D'ÉCRAN, il ne la dessine pas
 * autrement. La seconde moitié de la piste est un doublon visuel destiné à
 * rendre le raccord de la boucle invisible ; à l'oreille, ce serait les
 * mêmes témoignages lus deux fois.
 */
function Carte({ item, copie = false }: { readonly item: GoogleReview; readonly copie?: boolean }) {
  const date = moisEtAnnee(item.date);
  return (
    <article className="avis-carte" aria-hidden={copie ? "true" : undefined}>
      {/*
        ⚠️ LE LOGO EST DANS L'EN-TÊTE, À DROITE, et l'en-tête est un
        `justify-between` : c'est la place que lui donne Google lui-même, et
        celle qu'attend l'œil sur une carte d'avis. `min-w-0` sur le groupe de
        gauche pour qu'un nom à rallonge pousse sur plusieurs lignes au lieu
        de chasser le logo hors de la carte.
      */}
      <div className="avis-entete mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
        {/*
          L'avatar. Balise <img> native et non next/image : au raccordement de
          l'API, l'URL viendra de googleusercontent.com, qui n'est pas déclaré
          dans next.config.ts — l'optimiseur la refuserait. Aucune donnée n'est
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
            ⚠️ PAS DE `truncate`. Un nom coupé en « Vincent Métamorph… »
            n'attribue plus l'avis à personne. Il passe à la ligne, et la
            carte grandit d'autant.
          */}
          <span className="avis-auteur block break-words font-heading text-sm font-semibold uppercase tracking-wide">
            {item.authorName}
          </span>
          {date ? (
            <span className="avis-date block text-[0.7rem] uppercase tracking-[0.16em]">{date}</span>
          ) : null}
        </span>
        </div>

        <LogoGoogle />
      </div>

      <Etoiles note={item.rating} />

      {/* LE TEXTE, TEL QUEL — sauts de ligne compris (voir .avis-texte). */}
      <p className="avis-texte mt-3 text-[0.9rem] leading-relaxed">{item.text}</p>

      {/*
        ⚠️ L'ATTRIBUTION RESTE, ELLE CHANGE DE PORTEUR. Le « G » la donne à
        l'écran ; ce texte la donne aux lecteurs d'écran, pour qui une image
        décorative n'existe pas. La retirer laisserait un avis non attribué à
        quiconque ne voit pas la page.
      */}
      <span className="sr-only">Avis Google</span>
    </article>
  );
}

export function GoogleReviewsGrid({ avis }: { readonly avis: readonly GoogleReview[] }) {
  /*
   * ⚠️ UNE LISTE VIDE NE REND RIEN — pas même le conteneur. Une fenêtre vide
   * laisserait dans la page une boîte invisible mais bien réelle, avec sa
   * hauteur : la section « disparaît » à moitié, ce qui est pire que pas du
   * tout.
   */
  if (avis.length === 0) return null;

  const colonnes = repartir(avis);

  return (
    /*
      ⚠️ LA FENÊTRE EST CE QUI BORNE LE MUR. Sans elle, les douze avis
      s'étalent sur près de trois mille pixels et la section écrase tout le
      reste de la page. Elle porte aussi le fondu haut et bas — voir
      `.avis-fenetre` dans globals.css.

      `.marquee-pausable` est la classe générique du dépôt : elle met en
      pause au survol, souris uniquement. Sur tactile le survol reste collé
      après un tap et figerait le mur sans qu'on l'ait demandé.
    */
    <div className="avis-fenetre marquee-pausable">
      <div className="avis-colonnes">
        {colonnes.map((colonne, index) => (
          <div className="avis-colonne" key={`colonne-${index}`}>
            <div
              className="avis-piste"
              style={{ animationDuration: `${dureeDeColonne(colonne)}s` }}
            >
              {/*
                ⚠️ LA COPIE EST CE QUI REND LA BOUCLE INVISIBLE — et elle est
                posée en FRÈRE DIRECT, pas dans un bloc à part.

                La piste se translate de 0 à −50 % : au moment où l'original a
                fini de défiler, la copie occupe exactement sa place de départ
                et le raccord ne se voit pas. Pour que ce « exactement » soit
                vrai, la piste doit mesurer le double de sa première moitié —
                ce qui suppose que chaque carte porte sa propre marge basse
                (voir `.avis-carte`) et que la piste n'utilise NI `gap`, NI
                conteneur intermédiaire. Avec un bloc imbriqué, il resterait
                une marge de raccord non dupliquée : la boucle sauterait d'une
                demi-marge à chaque cycle.
              */}
              {[...colonne, ...colonne].map((item, rang) => (
                <Carte
                  key={`${item.id}-${rang}`}
                  item={item}
                  copie={rang >= colonne.length}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
