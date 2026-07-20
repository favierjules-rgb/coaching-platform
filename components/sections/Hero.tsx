import Image from "next/image";
import { ArrowRight } from "lucide-react";

import { SethStarsMark } from "@/components/brand/SethStarsMark";

/**
 * Hero de la page d'accueil (chantier pages publiques, juillet 2026 ;
 * fond plein cadre le 20/07/2026 sur demande de Jules — Backhero.jpg,
 * brand/images/backgrounds/, remplace l'ancien visuel cadré à droite
 * running-01, retiré). Photo de fond en grayscale : aucune couleur
 * décorative, conformément à l'identité noir/blanc/gris. Dégradé sombre
 * renforcé (0.55→0.75→noir plein) par rapport à l'ancien fond neutre, la
 * photo étant plus chargée visuellement qu'un simple dégradé — nécessaire
 * pour garder le texte lisible par-dessus. Le dégradé rouge décoratif
 * (rgba(214,40,40,...) = ancien #d62828) et le hover:bg-red-700 du CTA,
 * hérités d'avant le redesign monochrome et hors périmètre du Lot 6 (pages
 * publiques exclues), restent retirés : hover:bg-primary-hover sur le CTA
 * (même token que Lot 6, Groupe E). Icône étoiles du kicker (20/07/2026) :
 * `SethStarsMark` (composant existant du chantier storytelling) au lieu du
 * `<img src="/brand/logo/seth-logo-secondary.svg">` — le fichier SVG source
 * contient un 3e tracé (contour complet) sans classe CSS, donc rempli en
 * noir par défaut, visible en cadre derrière les étoiles blanches.
 * SethStarsMark ne dessine que les 2 tracés blancs ; fichier SVG source
 * non modifié.
 */
export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden bg-black">
      <div className="absolute inset-0">
        <Image
          src="/brand/backgrounds/hero.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_22%] grayscale"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,10,10,0.1)_0%,rgba(10,10,10,0.35)_55%,rgba(10,10,10,0.75)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-16 pt-32 lg:pb-24 lg:pt-40">
        <div className="max-w-2xl">
          <div className="hero-fade-slide-in mb-6 flex items-center gap-3">
            <SethStarsMark className="h-5 w-auto" />
            <span className="h-0.5 w-8 bg-primary" />
            <span className="font-heading text-xs font-semibold uppercase tracking-[0.4em] text-primary">
              Seth · Préparation Physique
            </span>
          </div>

          <h1 className="hero-fade-slide-in font-heading text-6xl font-extrabold uppercase leading-[0.95] text-foreground sm:text-7xl md:text-8xl">
            Transforme
            <br />
            <span className="italic text-primary">ton physique.</span>
          </h1>

          <p className="hero-fade-slide-in hero-fade-slide-in-delay-1 mt-6 max-w-xl text-lg leading-relaxed text-gray-300">
            Coaching sportif, nutrition, suivi et progression encadrée pour
            passer d&apos;un mode de vie sédentaire à un niveau sportif
            confirmé.
          </p>

          <div className="hero-fade-slide-in hero-fade-slide-in-delay-2 mt-10 flex flex-wrap gap-4">
            <a
              href="#methode"
              className="inline-flex items-center gap-2 bg-primary px-8 py-4 font-heading text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Découvrir la méthode <ArrowRight size={16} />
            </a>
            <a
              href="#transformations"
              className="inline-flex items-center gap-2 border border-white/30 px-8 py-4 font-heading text-sm font-bold uppercase tracking-widest text-foreground transition-colors hover:border-white"
            >
              Voir les transformations
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
