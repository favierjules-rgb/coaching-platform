import { SectionLabel } from "@/components/ui/SectionLabel";
import { NewsletterSignupForm } from "@/components/marketing/NewsletterSignupForm";

export function Newsletter() {
  return (
    <section id="newsletter" className="scroll-mt-24 border-t border-border bg-card py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
          <div className="max-w-xl">
            <SectionLabel>La méthode Seth</SectionLabel>
            <h2 className="mb-6 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
              Reçois la
              <br />
              méthode
              <br />
              <span className="italic text-primary">complète</span>
            </h2>
            <p className="text-muted-foreground">
              Programme type, conseils nutrition et stratégie de progression
              — directement dans ta boîte mail.
            </p>
          </div>

          <div className="w-full max-w-lg">
            <NewsletterSignupForm />
          </div>
        </div>
      </div>
    </section>
  );
}
