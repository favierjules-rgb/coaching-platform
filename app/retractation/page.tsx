import type { Metadata } from "next";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Droit de rétractation — Seth Préparation Physique",
  description: "Procédure de rétractation pour un programme numérique ou un abonnement de coaching.",
};

/**
 * Page rétractation (chantier conformité juridique/RGPD, Lot E — juillet
 * 2026 ; case fusionnée au Lot E-bis). Complète /cgv, qui renvoie ici pour
 * le détail de la procédure et le modèle de formulaire.
 *
 * Le mécanisme technique décrit ici existe réellement : une case unique
 * "accès immédiat + perte du droit de rétractation" (article L. 221-28 du
 * Code de la consommation) est branchée sur le formulaire d'achat payant
 * (voir PublicProgramPurchaseForm.tsx, lib/legal-consents.ts, texte validé
 * explicitement par Jules), tracée dans legal_consents (avec référence de
 * commande), et son texte + version exacts sont reproduits dans l'email de
 * confirmation de commande envoyé après achat, avant activation de l'accès
 * (voir composePublicProgramOrderConfirmationEmail et
 * lib/stripe/webhook-handlers.ts).
 */
export default function RetractationPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Après ton achat</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
        Droit de rétractation
      </h1>
      <p className="mb-16 text-sm text-muted-foreground">Dernière mise à jour : 21 juillet 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Deux régimes différents
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Le droit de rétractation ne s&apos;applique pas de la même façon selon ce que tu as acheté. Reporte-toi
            au cas correspondant à ta commande, détaillé dans nos{" "}
            <a href="/cgv" className="text-foreground underline underline-offset-4">
              conditions générales de vente
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Programme numérique à paiement unique
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Tu disposes en principe de quatorze jours à compter de ton achat pour te rétracter, sans avoir à te
              justifier. Ce délai ne s&apos;applique pas si, au moment de l&apos;achat, tu as expressément demandé à
              accéder immédiatement au programme et reconnu perdre ton droit de rétractation en conséquence : dans ce
              cas, tu perds ce droit à compter du début de la fourniture du contenu numérique, conformément à
              l&apos;article L. 221-28 du Code de la consommation.
            </p>
            <p>
              Si tu n&apos;as pas fait cette demande expresse, tu peux te rétracter dans les quatorze jours en nous le
              notifiant (voir ci-dessous). Nous te rembourserons alors l&apos;intégralité des sommes versées.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Abonnement de coaching
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tu disposes de quatorze jours à compter de la souscription pour te rétracter. Si tu as demandé
            expressément que l&apos;accompagnement commence avant la fin de ce délai, et que tu te rétractes malgré
            tout, la part de service déjà exécutée peut donner lieu à une facturation au prorata ; le reste te sera
            remboursé.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Comment exercer ton droit
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Envoie-nous une déclaration dénuée d&apos;ambiguïté exprimant ta volonté de te rétracter, par exemple par
            email à{" "}
            <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
              favierjules.contact@gmail.com
            </a>
            . Tu peux utiliser le modèle ci-dessous. Nous t&apos;enverrons un accusé de réception de ta demande.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Modèle de formulaire de rétractation
          </h2>
          <div className="border border-border bg-card p-6 text-sm leading-relaxed text-muted-foreground">
            <p>À l&apos;attention de Jules Favier (SETH), favierjules.contact@gmail.com :</p>
            <p className="mt-3">
              Je notifie par la présente ma rétractation du contrat portant sur la commande ci-dessous :
            </p>
            <p className="mt-3">
              Commandé le : [date]
              <br />
              Nom du client : [nom, prénom]
              <br />
              Produit ou abonnement concerné : [nom du programme ou de la formule]
              <br />
              Adresse email utilisée pour la commande : [email]
            </p>
            <p className="mt-3">Signature (si envoyé par courrier) : Date :</p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Effets de la rétractation
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            En cas de rétractation valable, nous te remboursons les sommes concernées dans les meilleurs délais,
            sans retard injustifié, en utilisant le même moyen de paiement que celui utilisé pour la commande.
          </p>
        </section>
      </div>
    </section>
  );
}
