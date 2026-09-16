import { Star } from "lucide-react";
import Link from "next/link";

import { GoogleReviewsGrid } from "@/components/sections/GoogleReviewsGrid";
import { FICHE_GOOGLE_URL } from "@/lib/reviews/fiche-google";
import { getReviews } from "@/lib/reviews/source";

/**
 * SECTION « LA CONFIANCE DE NOS CLIENTS » — les avis Google.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX COLONNES : CE QU'ON AFFIRME À GAUCHE, CE QUI LE PROUVE À DROITE
 * ════════════════════════════════════════════════════════════════════════
 * Le panneau de gauche porte le titre, la promesse, la note et les deux
 * appels à l'action. Il ne bouge pas : sur grand écran il reste collé pendant
 * qu'on parcourt les avis, de sorte que « Laisser un avis » est toujours à
 * portée de clic, y compris au douzième témoignage.
 *
 * La mosaïque de droite fait tout le reste — voir `GoogleReviewsGrid`.
 *
 * ⚠️ REFONTE DU 16/09/2026. Cette section montrait un amas de cartes en
 * orbite autour d'une photo, piloté par 530 lignes de composant client. Elle
 * est désormais entièrement SERVEUR : plus une ligne de JavaScript, les avis
 * sont dans le HTML initial.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ LES AVIS SONT RÉELS ; LEUR CIRCUIT NE L'EST PAS ENCORE
 * ════════════════════════════════════════════════════════════════════════
 * L'API Google Business Profile n'est pas ouverte. `getReviews()` rend DOUZE
 * VRAIS AVIS recopiés à la main depuis des captures (9 le 25/08/2026, 3 le
 * 16/09/2026) — voir `lib/reviews/google-reviews.mock.ts`. Le raccordement
 * ne touchera que le corps de `getReviews()` : ni cette section, ni la
 * mosaïque n'auront à bouger.
 *
 * ⚠️ IL N'Y A PAS DE BANDEAU DE PROVENANCE À L'ÉCRAN, et ce n'est pas un
 * oubli : il en existait un, retiré sur demande. Le drapeau `demonstration`
 * de la source, lui, n'a pas bougé. NE PAS EN REMETTRE sans le demander — un
 * test vérifie qu'aucun n'est rendu.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ELLE DISPARAÎT PLUTÔT QUE DE MENTIR
 * ════════════════════════════════════════════════════════════════════════
 * Aucun avis publiable et la section ne rend RIEN. Pas d'état vide, pas de
 * « bientôt des avis », pas de squelette : une page qui promet des
 * témoignages sans en avoir vaut moins qu'une page qui n'en parle pas.
 */
interface Props {
  /**
   * Destination du second bouton, « Mon bilan offert ».
   *
   * ⚠️ ELLE DIFFÈRE SELON LA PAGE, et c'est pour ça que c'est une prop.
   * Depuis l'accueil, l'ancre `#bilan-offert` est sur la même page et le
   * défilement est immédiat. Depuis `/services-entreprises`, la même ancre
   * n'existe pas : il faut le chemin absolu `/#bilan-offert`, qui ramène à
   * l'accueil. Coder l'un ou l'autre en dur casserait silencieusement une
   * des deux pages.
   */
  readonly ancreBilan?: string;
}

export async function GoogleReviews({ ancreBilan = "#bilan-offert" }: Props = {}) {
  const { reviews, average, count } = await getReviews();

  // ⚠️ AUCUN AVIS, AUCUNE SECTION. Voir l'en-tête : pas d'état vide.
  if (reviews.length === 0) return null;

  return (
    <section id="avis-clients" className="scroll-mt-24 overflow-x-clip py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="avis-disposition">
          {/* ── LE PANNEAU ─────────────────────────────────────────────── */}
          <div className="avis-panneau">
            <h2 className="avis-titre mb-4 font-heading text-4xl font-extrabold uppercase md:text-6xl">
              La confiance de nos clients
            </h2>

            <p className="avis-promesse mb-8 text-base leading-relaxed">
              Découvrez ce que nos clients disent de leur expérience avec nous
            </p>

            <div className="mb-8 flex flex-wrap gap-3">
              {/*
                ⚠️ `target="_blank"` APPELLE `rel="noopener noreferrer"`. Sans
                lui, la page ouverte garde une référence vers celle-ci via
                `window.opener` et peut la faire naviguer ailleurs.
              */}
              <a
                href={FICHE_GOOGLE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="avis-bouton avis-bouton-primaire pressable inline-flex min-h-[44px] items-center justify-center rounded-control px-6 text-[0.7rem] font-bold uppercase tracking-[0.18em]"
              >
                Laisser un avis
              </a>
              <Link
                href={ancreBilan}
                className="avis-bouton avis-bouton-secondaire pressable inline-flex min-h-[44px] items-center justify-center rounded-control px-6 text-[0.7rem] font-bold uppercase tracking-[0.18em]"
              >
                Mon bilan offert
              </Link>
            </div>

            {/*
              LA NOTE GLOBALE — celle des avis AFFICHÉS, et le libellé le dit.
              Ce n'est pas la note de la fiche Google, qui inclut les avis
              sous 5 étoiles. Écrire « 5/5 sur Google » serait faux. Le
              raccordement lira la vraie moyenne chez Google.
            */}
            {average !== null ? (
              <p className="avis-note-globale flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span
                  className="flex items-center gap-0.5"
                  aria-label={`${average} étoiles sur 5 en moyenne`}
                >
                  {Array.from({ length: Math.round(average) }, (_, i) => (
                    <Star key={i} size={16} className="avis-etoile" aria-hidden="true" />
                  ))}
                </span>
                <span className="avis-note-chiffre font-heading font-bold">{average}/5</span>
                <span>
                  sur {count} avis affiché{count > 1 ? "s" : ""}
                </span>
              </p>
            ) : null}
          </div>

          {/* ── LA MOSAÏQUE ────────────────────────────────────────────── */}
          <GoogleReviewsGrid avis={reviews} />
        </div>
      </div>
    </section>
  );
}
