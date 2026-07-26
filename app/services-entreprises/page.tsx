import type { Metadata } from "next";

import { BusinessInquiryForm } from "@/components/sections/BusinessInquiryForm";
import { SectionLabel } from "@/components/ui/SectionLabel";
import {
  BUSINESS_FORMATS,
  BUSINESS_NEEDS,
  BUSINESS_PROCESS_STEPS,
} from "@/data/business-services";

/**
 * Page publique « Services aux entreprises » (chantier
 * feat/business-services-contact, juillet 2026).
 *
 * Accessible uniquement depuis le menu burger — aucun lien dans la
 * navigation principale ni dans le footer — mais volontairement indexable :
 * un prospect non connecté doit pouvoir y arriver par son URL ou par un
 * moteur de recherche. Aucune donnée n'est stockée : le formulaire envoie
 * la demande par email (voir app/api/business-inquiry/route.ts).
 */

export const metadata: Metadata = {
  title: "Services aux entreprises | Coaching sportif et QVT",
  description:
    "Coaching sportif en entreprise, prévention des TMS, qualité de vie au travail, cohésion d'équipe et accompagnement personnalisé.",
  alternates: { canonical: "/services-entreprises" },
};

export default function ServicesEntreprisesPage() {
  return (
    <>
      {/* A — HERO */}
      <section className="bg-background pb-16 pt-32 md:pb-24 md:pt-40">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Entreprises</SectionLabel>
          <h1 className="mb-6 max-w-4xl font-heading text-3xl font-extrabold uppercase leading-[1.05] text-foreground sm:text-4xl md:text-6xl">
            Sport et performance en entreprise
          </h1>
          <p className="mb-10 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Des interventions adaptées à vos équipes pour améliorer la santé, l&apos;énergie, la cohésion et la
            performance au travail. Le coaching se déroule <strong className="font-semibold text-foreground">en
            présentiel, directement dans vos locaux</strong>, à distance en visio, ou en combinant les deux.
          </p>
          <a
            href="#demande"
            className="pressable inline-flex min-h-[52px] items-center bg-foreground px-6 py-3 text-sm font-bold uppercase tracking-widest text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Parler de votre projet
          </a>
        </div>
      </section>

      {/* B — BESOINS TRAITÉS */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Besoins traités</SectionLabel>
          <h2 className="mb-12 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Ce que je peux améliorer dans votre entreprise
          </h2>

          <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {BUSINESS_NEEDS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="bg-card p-6 lg:p-8">
                <Icon size={24} className="mb-4 h-5 w-5 text-primary lg:h-6 lg:w-6" aria-hidden />
                <h3 className="mb-2 font-heading text-base font-bold uppercase leading-tight text-foreground lg:text-lg">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* C — FORMATS POSSIBLES */}
      <section className="bg-black py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Formats possibles</SectionLabel>
          <h2 className="mb-4 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Des interventions qui s&apos;adaptent à votre organisation
          </h2>
          <p className="mb-12 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            Le présentiel reste le format le plus efficace : je me déplace dans vos locaux pour encadrer les
            séances sur place. Les formats à distance et hybrides restent possibles pour les équipes réparties
            sur plusieurs sites.
          </p>

          <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {BUSINESS_FORMATS.map(({ title, description }) => (
              <li key={title} className="bg-card p-6 lg:p-8">
                <h3 className="mb-2 font-heading text-base font-bold uppercase leading-tight text-foreground lg:text-lg">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>

          <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
            Chaque intervention est construite sur mesure : le contenu, la fréquence et le tarif dépendent de vos
            objectifs et de vos contraintes. Décrivez votre projet et je vous prépare une proposition adaptée.
          </p>
        </div>
      </section>

      {/* D — FONCTIONNEMENT */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Fonctionnement</SectionLabel>
          <h2 className="mb-12 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Trois étapes, sans engagement
          </h2>

          <ol className="grid grid-cols-1 gap-px bg-border md:grid-cols-3">
            {BUSINESS_PROCESS_STEPS.map(({ title, description }, index) => (
              <li key={title} className="bg-card p-6 lg:p-8">
                <p className="mb-3 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                  Étape {index + 1}
                </p>
                <h3 className="mb-2 font-heading text-base font-bold uppercase leading-tight text-foreground lg:text-lg">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* E — FORMULAIRE */}
      <section id="demande" className="scroll-mt-24 bg-black py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-6">
          <SectionLabel>Demande de contact</SectionLabel>
          <h2 className="mb-4 font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Parlez-moi de votre projet
          </h2>
          <p className="mb-12 text-sm leading-relaxed text-muted-foreground md:text-base">
            Répondez à ces quelques questions. Je vous recontacte pour préciser vos besoins et établir une
            proposition adaptée.
          </p>

          <BusinessInquiryForm />
        </div>
      </section>
    </>
  );
}
