import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Informations légales — Seth Préparation Physique",
  description: "Retrouve l'ensemble des pages légales : mentions légales, CGV, CGU, rétractation et crédits.",
};

/**
 * Page d'index (chantier simplification footer, juillet 2026).
 *
 * Purement une page de navigation : aucun contenu juridique n'est fusionné
 * ou dupliqué ici. Chaque lien renvoie vers la page existante qui reste la
 * source de vérité pour son propre contenu. "Crédits photographiques et
 * audiovisuels" pointe vers l'ancre #credits sur /mentions-legales, où ce
 * contenu vit réellement (section ajoutée en juillet 2026) — il n'existe
 * pas de page dédiée séparée pour ce contenu.
 */
const legalLinks = [
  {
    href: "/mentions-legales",
    label: "Mentions légales",
    description: "Éditeur du site, activité réglementée, hébergement et propriété intellectuelle.",
  },
  {
    href: "/cgv",
    label: "Conditions générales de vente",
    description: "Modalités applicables à l'achat des programmes et prestations.",
  },
  {
    href: "/cgu",
    label: "Conditions générales d'utilisation",
    description: "Règles d'utilisation de la plateforme et de l'espace élève.",
  },
  {
    href: "/retractation",
    label: "Rétractation",
    description: "Droit de rétractation et modalités d'exercice.",
  },
  {
    href: "/mentions-legales#credits",
    label: "Crédits photographiques et audiovisuels",
    description: "Crédits des photographies et vidéos réalisées pour SETH.",
  },
];

export default function InformationsLegalesPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Informations légales</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
        Informations légales
      </h1>
      <p className="mb-16 text-sm leading-relaxed text-muted-foreground">
        Retrouve ici l&apos;ensemble des pages légales du site.
      </p>

      <nav aria-label="Pages légales" className="divide-y divide-border border-y border-border">
        <ul>
          {legalLinks.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-6 py-6 transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                <span>
                  <span className="block font-heading text-base font-bold uppercase tracking-wide text-foreground group-hover:text-primary">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary"
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
