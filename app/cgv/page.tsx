import type { Metadata } from "next";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Conditions générales de vente — Seth Préparation Physique",
  description: "Conditions applicables à l'achat d'un programme numérique ou d'un abonnement de coaching.",
};

/**
 * CGV (chantier conformité juridique/RGPD, Lot D — juillet 2026). Rédigées
 * à partir des règles commerciales confirmées par Jules (audit lecture
 * seule) : deux produits bien distincts (programme numérique à paiement
 * unique / abonnement de coaching), chacun avec son propre régime de
 * rétractation.
 *
 * Points volontairement non finalisés ici, en attente d'éléments encore
 * ouverts (voir points nécessitant une validation par un juriste dans
 * l'audit) :
 * - médiation de la consommation : pas de coordonnées publiées tant que
 *   l'adhésion CM2C n'est pas confirmée active (Lot G) ;
 * - fonctionnalité de résiliation dédiée : n'existe pas encore, seul le
 *   portail client Stripe est disponible aujourd'hui (Lot F) ;
 * - case à cocher d'acceptation des CGV au moment de la commande : partie
 *   technique du chantier volontairement reportée (implique une évolution
 *   du schéma Zod et de la route API de checkout), en attente de
 *   validation explicite de Jules avant implémentation.
 */
export default function CgvPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Conditions de vente</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
        Conditions générales de vente
      </h1>
      <p className="mb-16 text-sm text-muted-foreground">Dernière mise à jour : 21 juillet 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Préambule
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les présentes conditions générales de vente régissent les ventes réalisées sur ce site par Jules Favier
            (SETH), dont l&apos;identité complète figure dans nos{" "}
            <a href="/mentions-legales" className="text-foreground underline underline-offset-4">
              mentions légales
            </a>
            , à destination de consommateurs situés en France. Deux types de produits sont proposés, avec des règles
            distinctes détaillées ci-dessous : les programmes numériques vendus à l&apos;unité et les abonnements de
            coaching.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Produits proposés
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong className="font-semibold text-foreground">Programmes numériques à paiement unique.</strong>{" "}
              Chaque programme couvre, selon l&apos;offre, une durée comprise entre un et trois mois, précisée sur sa
              page. Il est accessible immédiatement après validation du paiement et reste accessible pendant six
              mois à compter de l&apos;achat. Passé ce délai, l&apos;accès au contenu prend fin ; cela ne signifie ni
              la suppression immédiate de ton compte, ni celle de tes données de facturation (voir notre{" "}
              <a href="/confidentialite" className="text-foreground underline underline-offset-4">
                politique de confidentialité
              </a>
              ).
            </p>
            <p>
              <strong className="font-semibold text-foreground">Abonnements de coaching.</strong> Plusieurs formules
              sont proposées ; le tarif et les caractéristiques de chacune sont affichés avant la commande. L&apos;
              engagement initial est de trois mois. À l&apos;issue de cette période, l&apos;abonnement est reconduit
              automatiquement par périodes successives d&apos;un mois, sauf résiliation dans les conditions décrites
              ci-dessous.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Prix et paiement
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les prix sont indiqués en euros, TVA non applicable, article 293 B du Code général des impôts. Le
            paiement s&apos;effectue par carte bancaire via notre prestataire Stripe, de façon sécurisée. Pour un
            programme à paiement unique, le débit est immédiat. Pour un abonnement, les prélèvements se renouvellent
            selon la périodicité de la formule choisie.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Commande
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            La validation de la commande implique une obligation de paiement. Une confirmation te sera adressée par
            email, avec le détail de ta commande, à conserver comme preuve d&apos;achat.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Droit de rétractation
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong className="font-semibold text-foreground">Programme numérique.</strong> Un programme numérique
              accessible immédiatement constitue un contenu numérique fourni sans support matériel. Si tu demandes
              expressément à y accéder avant l&apos;expiration du délai légal de rétractation de quatorze jours, et
              que tu reconnais explicitement perdre ton droit de rétractation en conséquence, tu ne pourras plus
              exercer ce droit une fois l&apos;accès accordé. En l&apos;absence d&apos;une telle demande expresse et
              de cette reconnaissance, le droit de rétractation de quatorze jours s&apos;applique dans les conditions
              prévues par le Code de la consommation.
            </p>
            <p>
              <strong className="font-semibold text-foreground">Abonnement de coaching.</strong> L&apos;abonnement de
              coaching est une prestation de service. Le délai de rétractation de quatorze jours s&apos;applique,
              sauf si tu demandes expressément que la prestation commence avant l&apos;expiration de ce délai ; dans
              ce cas, en cas de rétractation, le service déjà exécuté peut donner lieu à une facturation au prorata.
            </p>
            <p>
              Le détail de la procédure et le formulaire de rétractation seront publiés séparément.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Résiliation de l&apos;abonnement
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tu peux demander la résiliation de ton abonnement, avec un préavis d&apos;un mois à l&apos;issue de la
            période d&apos;engagement initiale de trois mois. Les sommes déjà versées ne sont pas remboursées, sauf
            disposition légale impérative contraire. Aujourd&apos;hui, cette demande se fait via le portail client
            accessible depuis ton espace élève ; une fonctionnalité de résiliation dédiée, avec récapitulatif et
            confirmation explicite, est en cours de mise en place.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Médiation de la consommation
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Conformément à l&apos;article L. 616-1 du Code de la consommation, tu as le droit de recourir
            gratuitement à un médiateur de la consommation en cas de litige. Les coordonnées du médiateur compétent
            seront publiées dès confirmation de notre adhésion à un dispositif de médiation.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Responsabilité
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nos prestations de coaching sportif sont soumises à une obligation de moyens. Elles ne remplacent pas un
            avis médical : consulte un professionnel de santé avant de débuter un programme sportif, en particulier
            en cas de doute sur ton état de santé. Notre activité réglementée (carte professionnelle, assurance) est
            détaillée dans nos{" "}
            <a href="/mentions-legales" className="text-foreground underline underline-offset-4">
              mentions légales
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Propriété intellectuelle
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les programmes et contenus vendus restent la propriété de SETH. Leur achat t&apos;accorde un droit
            d&apos;usage personnel, non transférable et non cessible ; toute reproduction ou diffusion à des tiers
            est interdite.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Droit applicable
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les présentes conditions sont soumises au droit français. Si tu es consommateur, cela ne te prive pas de
            la protection que t&apos;assurent les dispositions impératives de la loi de ton pays de résidence,
            lorsque celle-ci est plus favorable.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">Contact</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Pour toute question relative à une commande, contacte{" "}
            <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
              favierjules.contact@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </section>
  );
}
