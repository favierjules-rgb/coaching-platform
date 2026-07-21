import type { Metadata } from "next";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Mentions légales — Seth Préparation Physique",
  description: "Éditeur du site, hébergement, activité réglementée et propriété intellectuelle.",
};

/**
 * Mentions légales (chantier conformité juridique/RGPD, Lot A — juillet
 * 2026). Contenu strictement limité aux informations confirmées par Jules
 * (voir audit lecture seule préalable) : aucune donnée inventée.
 *
 * Volontairement absent de cette page à ce stade :
 * - le médiateur de la consommation (CM2C) : coordonnées fournies mais
 *   publication explicitement mise en attente d'une confirmation d'adhésion
 *   active (chantier séparé, Lot G) ;
 * - une politique de confidentialité complète : renvoi à une page dédiée à
 *   venir (Lot B), la présente page ne fait qu'identifier le responsable de
 *   traitement et un contact.
 */
export default function MentionsLegalesPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Informations légales</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
        Mentions légales
      </h1>
      <p className="mb-16 text-sm text-muted-foreground">Dernière mise à jour : 21 juillet 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Éditeur du site
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Ce site est édité par Jules Favier, exerçant sous le nom commercial{" "}
              <strong className="font-semibold text-foreground">SETH</strong>, entrepreneur individuel relevant du
              régime de la micro-entreprise.
            </p>
            <p>
              SIREN : 932 731 193
              <br />
              SIRET : 932 731 193 00011
              <br />
              Immatriculation : Registre national des entreprises (RNE)
            </p>
            <p>
              Adresse : 2 impasse du Chasselas, 31780 Castelginest, France
              <br />
              Téléphone : 06 70 85 65 13
              <br />
              Email :{" "}
              <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
                favierjules.contact@gmail.com
              </a>
            </p>
            <p>TVA non applicable, article 293 B du Code général des impôts.</p>
            <p>Directeur de la publication : Jules Favier.</p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Activité réglementée
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>SETH propose des prestations de coaching sportif et de préparation physique.</p>
            <p>
              Carte professionnelle d&apos;éducateur sportif n° 08324ED0421, délivrée par la préfecture du Var
              (ministère chargé des Sports).
            </p>
            <p>
              Assurance responsabilité civile professionnelle souscrite auprès d&apos;Inter Mutuelles Entreprises
              (IME), contrat n° 971 0002 76014 P 30.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Hébergement
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            L&apos;application est hébergée par Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Propriété intellectuelle
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            L&apos;ensemble des contenus présents sur ce site (textes, visuels, logos, structure) est protégé par le
            droit de la propriété intellectuelle. Toute reproduction ou représentation, totale ou partielle, sans
            autorisation préalable est interdite.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Données personnelles
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Le responsable du traitement des données personnelles collectées sur ce site est Jules Favier (SETH), à
            l&apos;adresse indiquée ci-dessus. Pour toute question ou pour exercer tes droits, contacte{" "}
            <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
              favierjules.contact@gmail.com
            </a>
            . Une politique de confidentialité détaillée, décrivant l&apos;ensemble des traitements réalisés, sera
            publiée séparément.
          </p>
        </section>
      </div>
    </section>
  );
}
