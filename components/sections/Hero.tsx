import Image from "next/image";
import { ArrowRight } from "lucide-react";

/**
 * Hero de la page d'accueil (chantier pages publiques, juillet 2026) —
 * ajout de la photo (running-01, seule ressource de brand/ sans marque
 * tierce ni tiers identifiable, voir audit brand/) en visuel de premier
 * plan cadré à droite, et du logo SVG réel au-dessus du kicker. Le dégradé
 * rouge décoratif (rgba(214,40,40,...) = ancien #d62828) et le
 * hover:bg-red-700 du CTA, hérités d'avant le redesign monochrome et hors
 * périmètre du Lot 6 (pages publiques exclues), sont retirés ici : dégradé
 * radial neutre (blanc à faible opacité) à la place, hover:bg-primary-hover
 * sur le CTA (même token que Lot 6, Groupe E). Photo en grayscale : aucune
 * couleur décorative, conformément à l'identité noir/blanc/gris.
 */
export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden bg-black">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_30%,rgba(10,10,10,0.75)_70%,#0a0a0a_100%)]" />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-12 px-6 pb-16 pt-32 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pb-24 lg:pt-40">
        <div>
          <div className="hero-fade-slide-in mb-6 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG vectoriel, l'optimiseur next/image n'apporte rien ici */}
            <img src="/brand/logo/seth-logo-primary.svg" alt="" className="h-5 w-auto" />
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

        <div className="hero-fade-slide-in hero-fade-slide-in-delay-1 relative hidden aspect-[3/4] w-full overflow-hidden border border-white/10 lg:block">
          <Image
            src="/brand/hero-running.webp"
            alt="Seth, préparateur physique, sur une piste d'athlétisme"
            fill
            sizes="(min-width: 1024px) 35vw, 0px"
            priority
            className="object-cover grayscale"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,10,0.55),transparent_45%)]" />
        </div>
      </div>
    </section>
  );
}
