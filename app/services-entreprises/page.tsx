import type { Metadata } from "next";
import Image from "next/image";

import { EntrepriseConfigurateur } from "@/components/sections/EntrepriseConfigurateur";
import { PageThemeSwitch } from "@/components/ui/PageThemeSwitch";
import { SectionLabel } from "@/components/ui/SectionLabel";
/*
 * ⚠️ LE SCRIPT ANTI-FLASH VIENT D'UN MODULE NEUTRE, PAS DU COMPOSANT.
 * `PageThemeSwitch.tsx` porte `"use client"` : tous ses exports sont des
 * références client, et en APPELER une pendant le rendu serveur casse le
 * prerender. Seul le composant en vient ; la fonction, elle, est importée
 * de `lib/theme/page-theme.ts`, qui n'a pas de directive.
 */
import { pageThemeAntiFlashScript, type PageThemeConfig } from "@/lib/theme/page-theme";
import {
  CE_QUE_VOUS_OBTENEZ,
  ETAPES_DEPLOIEMENT,
  PARCOURS_COLLABORATEUR,
  PRINCIPE_FORMULE,
  REPERES_HERO,
} from "@/data/entreprise";

/**
 * Page publique « GRIT Entreprise » (/services-entreprises).
 *
 * Refonte du 13/09/2026 : d'une page de présentation à une landing B2B
 * orientée demande de devis. Le cœur de la page est le CONFIGURATEUR — sept
 * étapes qui qualifient le projet — et non plus un formulaire de contact
 * placé en fin de parcours.
 *
 * ⚠️ AUCUN TARIF N'EST PUBLIÉ, et ce n'est pas un oubli. Décision
 * commerciale : le prix se présente et se discute pendant l'appel. La page
 * promet une proposition adaptée, jamais un montant. Aucun paiement, aucun
 * panier, aucun encaissement ici.
 *
 * Rendu SERVEUR pour tout le contenu éditorial — seul le configurateur est
 * un composant client. C'est ce qui préserve le référencement malgré la
 * réduction du texte.
 *
 * Accessible depuis le menu burger ET depuis le footer (lien commercial
 * distinct de la navigation « Liens légaux », voir components/layout/Footer.tsx).
 *
 * ⚠️ VERSION CLAIRE DISPONIBLE. La page est sombre par défaut, comme le reste
 * du site public, et un switch flottant permet de basculer en clair. Le choix
 * est porté par `data-page-theme` sur le conteneur de la page — jamais sur
 * `<html>` — avec sa propre clé de stockage : un visiteur qui éclaircit cette
 * page ne change ni la home, ni l'admin. Voir components/ui/PageThemeSwitch.tsx.
 */

export const metadata: Metadata = {
  title: "Coaching sportif en entreprise | GRIT Entreprise",
  description:
    "Un accompagnement sportif individuel pour vos collaborateurs, sans infrastructure à gérer : séances de 45 minutes, programme personnalisé et suivi. Demandez votre devis.",
  alternates: { canonical: "/services-entreprises" },
};

/** Conteneur et clé de stockage propres à cette page. */
const THEME_ENTREPRISE: PageThemeConfig = {
  containerId: "entreprise",
  storageKey: "seth-entreprise-theme",
};

export default function ServicesEntreprisesPage() {
  return (
    /*
     * `suppressHydrationWarning` : le script anti-flash ci-dessous peut avoir
     * changé l'attribut avant que React n'hydrate. Sombre par défaut — sans
     * choix mémorisé, la page est exactement ce qu'elle a toujours été.
     */
    <div id="entreprise" data-page-theme="dark" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: pageThemeAntiFlashScript(THEME_ENTREPRISE) }} />

      {/* A — HERO, avec photo d'illustration en arrière-plan */}
      <section className="relative overflow-hidden bg-background pb-16 pt-32 md:pb-24 md:pt-40">
        {/*
         * ⚠️ LA PHOTO EST DÉCORATIVE, PAS INFORMATIVE : `alt=""` et
         * `aria-hidden`. Elle n'apporte aucune information que le texte ne
         * porte déjà — la décrire ferait perdre du temps à un lecteur
         * d'écran sans rien lui apprendre.
         *
         * `priority` : c'est l'image de plus grande surface au-dessus de la
         * ligne de flottaison, donc le point de mesure du LCP. La laisser en
         * chargement paresseux retarderait l'affichage perçu.
         */}
        <div className="absolute inset-0" aria-hidden>
          <Image
            src="/brand/backgrounds/hero.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[center_30%] grayscale"
          />
          <div className="hero-voile absolute inset-0" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-6">
          <SectionLabel>GRIT Entreprise</SectionLabel>
          <h1 className="mb-6 max-w-4xl font-heading text-3xl font-extrabold uppercase leading-[1.05] text-foreground sm:text-4xl md:text-6xl">
            Le coaching sportif de vos collaborateurs. Pensé pour l&apos;entreprise.
          </h1>
          <p className="mb-10 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Des séances individuelles de 45 minutes, un accompagnement personnalisé, et aucune
            infrastructure à gérer.
          </p>

          <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-center">
            <a
              href="#devis"
              className="pressable inline-flex min-h-[52px] items-center justify-center bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Demander mon devis
            </a>
            <a
              href="#programme"
              className="pressable inline-flex min-h-[52px] items-center justify-center border border-border px-6 py-3 text-sm font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Découvrir le programme
            </a>
          </div>

          <dl className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-3">
            {REPERES_HERO.map((repere) => (
              <div key={repere.label} className="bg-card p-6">
                <dt className="sr-only">{repere.label}</dt>
                <dd>
                  <span className="block font-heading text-2xl font-extrabold uppercase text-foreground md:text-3xl">
                    {repere.value}
                  </span>
                  <span className="mt-1 block text-xs uppercase tracking-widest text-muted-foreground">
                    {repere.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* B — COMMENT ÇA MARCHE */}
      <section id="programme" className="scroll-mt-24 bg-black py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Comment ça marche</SectionLabel>
          <h2 className="mb-12 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Quatre étapes, de votre besoin au terrain
          </h2>

          <ol className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {ETAPES_DEPLOIEMENT.map((etape, index) => (
              <li key={etape.title} className="bg-card p-6 lg:p-8">
                <p className="mb-4 font-heading text-3xl font-extrabold leading-none text-primary/30 md:text-4xl">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mb-2 font-heading text-base font-bold uppercase leading-tight text-foreground lg:text-lg">
                  {etape.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{etape.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* C — CE QUE L'ENTREPRISE OBTIENT */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Ce que vous obtenez</SectionLabel>
          <h2 className="mb-12 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Un service de coaching, pas un abonnement
          </h2>

          <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {CE_QUE_VOUS_OBTENEZ.map(({ icon: Icon, title, description }) => (
              <li key={title} className="bg-card p-6 lg:p-8">
                <Icon size={24} className="mb-4 h-5 w-5 text-primary lg:h-6 lg:w-6" aria-hidden />
                <h3 className="mb-2 font-heading text-base font-bold uppercase leading-tight text-foreground lg:text-lg">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* D — POUR VOS COLLABORATEURS */}
      <section className="bg-black py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Pour vos collaborateurs</SectionLabel>
          <h2 className="mb-12 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Je suis accompagné individuellement
          </h2>

          <ol className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
            {PARCOURS_COLLABORATEUR.map((jalon, index) => (
              <li key={jalon.title} className="bg-card p-6">
                <p className="mb-3 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mb-2 font-heading text-sm font-bold uppercase leading-tight text-foreground lg:text-base">
                  {jalon.title}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{jalon.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* E — UNE FORMULE ADAPTÉE (aucun montant : voir en-tête de fichier) */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionLabel>Votre formule</SectionLabel>
          <h2 className="mb-4 max-w-3xl font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Une formule construite pour votre entreprise
          </h2>
          <p className="mb-12 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            Chaque dispositif dépend du nombre de collaborateurs, du rythme choisi et de vos
            contraintes d&apos;organisation. Décrivez votre projet en quelques clics : nous revenons
            vers vous avec une proposition adaptée.
          </p>

          <ul className="mb-12 grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
            {PRINCIPE_FORMULE.map(({ icon: Icon, title, description }) => (
              <li key={title} className="bg-card p-6 lg:p-8">
                <Icon size={24} className="mb-4 h-5 w-5 text-primary lg:h-6 lg:w-6" aria-hidden />
                <h3 className="mb-2 font-heading text-base font-bold uppercase leading-tight text-foreground lg:text-lg">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>

          <a
            href="#devis"
            className="pressable inline-flex min-h-[52px] items-center justify-center bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Construire mon projet
          </a>
        </div>
      </section>

      {/* F — CONFIGURATEUR */}
      <section id="devis" className="scroll-mt-24 bg-black py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-6">
          <SectionLabel>Demande de devis</SectionLabel>
          <h2 className="mb-4 font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl md:text-5xl">
            Construisons votre programme
          </h2>
          <p className="mb-12 text-sm leading-relaxed text-muted-foreground md:text-base">
            Sept étapes courtes pour cadrer votre projet. Nous étudions votre besoin et revenons vers
            vous avec une proposition adaptée à votre entreprise.
          </p>

          <EntrepriseConfigurateur />
        </div>
      </section>

      <PageThemeSwitch config={THEME_ENTREPRISE} />
    </div>
  );
}
