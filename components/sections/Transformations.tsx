import { SectionLabel } from "@/components/ui/SectionLabel";
import { transformations } from "@/data/mock";

export function Transformations() {
  return (
    <section id="transformations" className="bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Résultats réels</SectionLabel>
        <h2 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          Transformations
        </h2>
        <p className="mb-16 max-w-xl text-muted-foreground">
          Avant / Après. Des vrais résultats, des vrais élèves. Aucune
          retouche.
        </p>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {transformations.map((transformation) => (
            <div
              key={transformation.id}
              className="flex flex-col border border-border bg-zinc-950"
            >
              <div className="grid grid-cols-2">
                <div className="flex aspect-[3/4] items-center justify-center bg-zinc-900">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    Avant
                  </span>
                </div>
                <div className="flex aspect-[3/4] items-center justify-center bg-gradient-to-br from-primary/30 to-zinc-900">
                  <span className="text-xs uppercase tracking-widest text-foreground">
                    Après
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {transformation.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {transformation.duration}
                  </span>
                </div>
                <span className="font-heading text-xs font-semibold uppercase tracking-wide text-primary">
                  {transformation.goal}
                </span>
                <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
                  &ldquo;{transformation.quote}&rdquo;
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
