import { SectionLabel } from "@/components/ui/SectionLabel";
import { methodPillars } from "@/data/mock";

export function Method() {
  return (
    <section id="methode" className="scroll-mt-24 bg-background py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Ma méthode</SectionLabel>
        <h2 className="mb-16 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          4 piliers.
          <br />1 transformation.
        </h2>

        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {methodPillars.map(({ icon: Icon, title, description }, index) => (
            <div
              key={title}
              className="bg-card p-8 transition-colors hover:bg-white/[0.03]"
            >
              <div className="mb-6 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                0{index + 1}
              </div>
              <Icon size={28} className="mb-4 text-primary" />
              <h3 className="mb-3 font-heading text-xl font-bold uppercase text-foreground">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
