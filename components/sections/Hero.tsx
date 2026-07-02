import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="relative flex min-h-screen items-end overflow-hidden bg-black">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(214,40,40,0.28),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_30%,rgba(10,10,10,0.75)_70%,#0a0a0a_100%)]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-24 pt-40">
        <div className="max-w-3xl">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-0.5 w-8 bg-primary" />
            <span className="font-heading text-xs font-semibold uppercase tracking-[0.4em] text-primary">
              Seth · Préparation Physique
            </span>
          </div>

          <h1 className="font-heading text-6xl font-extrabold uppercase leading-[0.95] text-foreground sm:text-7xl md:text-8xl">
            Transforme
            <br />
            <span className="italic text-primary">ton physique.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-300">
            Coaching sportif, nutrition, suivi et progression encadrée pour
            passer d&apos;un mode de vie sédentaire à un niveau sportif
            confirmé.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="#methode"
              className="inline-flex items-center gap-2 bg-primary px-8 py-4 font-heading text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
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
