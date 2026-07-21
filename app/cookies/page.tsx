import type { Metadata } from "next";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Cookies — Seth Préparation Physique",
  description: "Ce que ce site dépose réellement comme cookies et stockages, et ce qu'il n'utilise pas.",
};

/**
 * Page Cookies (chantier conformité juridique/RGPD, Lot C — juillet 2026).
 * Reflète le résultat de l'audit technique réel effectué en phase de
 * lecture seule (grep du repo pour tout script tiers/analytics/pixel,
 * inspection des usages de cookies/localStorage/sessionStorage) : aucun
 * traceur non essentiel identifié.
 *
 * Choix volontaire : pas de bandeau de consentement (rien à consentir tant
 * qu'aucun traceur non nécessaire n'est déposé — cf. audit), et le lien
 * footer est intitulé "Cookies" plutôt que "Gérer mes cookies" : il n'y a
 * aujourd'hui aucune préférence à gérer, un lien "Gérer" serait trompeur.
 * Si un traceur non essentiel est ajouté un jour, cette page ET le lien
 * footer devront être revus ensemble (bandeau, préférences par catégorie).
 */
export default function CookiesPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Vie privée</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">Cookies</h1>
      <p className="mb-16 text-sm text-muted-foreground">Dernière mise à jour : 21 juillet 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Ce que ce site utilise
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>Ce site dépose uniquement des éléments strictement nécessaires à son fonctionnement :</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                un cookie de session, pour te garder connecté à ton espace élève ou administrateur (obligatoire au
                fonctionnement du site, exempté de consentement) ;
              </li>
              <li>
                une préférence d&apos;affichage clair/sombre, enregistrée sur ton appareil (localStorage), pour
                mémoriser ton choix d&apos;un visite à l&apos;autre.
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Ce que ce site n&apos;utilise pas
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Aucun outil de mesure d&apos;audience, aucun cookie publicitaire, aucun pixel de réseau social et aucun
            script de suivi tiers n&apos;est présent sur ce site. C&apos;est pour cette raison qu&apos;aucun bandeau
            de consentement ne t&apos;est présenté : il n&apos;y a rien de facultatif à accepter ou refuser
            aujourd&apos;hui.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">Paiement</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Lors d&apos;un paiement ou de la gestion de ton abonnement, tu es redirigé vers les pages sécurisées de
            notre prestataire de paiement, Stripe. Stripe peut alors déposer ses propres cookies sur son propre
            domaine, en dehors du contrôle de ce site. Pour en savoir plus, consulte{" "}
            <a
              href="https://stripe.com/fr/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              la politique de confidentialité de Stripe
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Si cela change
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Si un traceur non essentiel (mesure d&apos;audience, publicité, réseau social) venait à être ajouté,
            cette page serait mise à jour et un mécanisme de consentement — bandeau, choix par catégorie, refus aussi
            simple que l&apos;acceptation — serait mis en place avant tout dépôt.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Aller plus loin
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Pour le détail des autres données traitées et de tes droits, consulte notre{" "}
            <a href="/confidentialite" className="text-foreground underline underline-offset-4">
              politique de confidentialité
            </a>
            .
          </p>
        </section>
      </div>
    </section>
  );
}
