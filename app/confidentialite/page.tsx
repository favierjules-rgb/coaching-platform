import type { Metadata } from "next";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Seth Préparation Physique",
  description: "Quelles données sont collectées, pourquoi, combien de temps, et comment exercer tes droits.",
};

/**
 * Politique de confidentialité (chantier conformité juridique/RGPD, Lot B —
 * juillet 2026). Contenu construit à partir de l'inventaire RGPD réalisé en
 * phase d'audit (lecture seule) : catégories de données, sous-traitants et
 * résultat de l'audit cookies/stockages réels du code. Aucune donnée
 * inventée.
 *
 * Deux points restent volontairement formulés de façon générique plutôt que
 * précise, en attendant que le code corresponde réellement à l'engagement :
 * - conservation des documents comptables/factures : la suppression
 *   automatique des comptes "programme seul" à 6 mois entraîne aujourd'hui,
 *   via des contraintes SQL "on delete cascade", la suppression des
 *   paiements en même temps (défaut critique identifié en audit, correction
 *   prévue au Lot F) — cette page ne doit pas annoncer une durée de
 *   conservation comptable tant que ce n'est pas techniquement vrai ;
 * - consentement explicite pour les données de santé de l'onboarding :
 *   aucune case de consentement séparée n'existe encore dans le code
 *   (nécessite une évolution du schéma/API, hors périmètre "lecture +
 *   contenu" de ce lot — voir échange avec Jules).
 *
 * `id="donnees-de-sante"` sur la section correspondante : sert de cible
 * pour le lien ajouté à l'étape 5 de OnboardingWizard.tsx.
 */
export default function ConfidentialitePage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Vie privée</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
        Politique de confidentialité
      </h1>
      <p className="mb-16 text-sm text-muted-foreground">Dernière mise à jour : 21 juillet 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Responsable du traitement
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Jules Favier, exerçant sous le nom commercial SETH, entrepreneur individuel — 2 impasse du Chasselas,
            31780 Castelginest, France. Pour toute question ou pour exercer tes droits, contacte{" "}
            <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
              favierjules.contact@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Quelles données sont collectées
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>Selon ton usage du site et de l&apos;espace élève, nous pouvons collecter :</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>identité et contact : nom, prénom, email, téléphone, date de naissance éventuelle ;</li>
              <li>profil de coaching : objectifs, niveau, fréquence et lieu d&apos;entraînement, matériel disponible ;</li>
              <li>mensurations et photographies de progression ;</li>
              <li>préférences et suivi nutritionnels ;</li>
              <li>rendez-vous et messages échangés avec ton coach ;</li>
              <li>documents partagés dans l&apos;espace élève ;</li>
              <li>informations de paiement et statut d&apos;abonnement (traitées par Stripe, voir plus bas) ;</li>
              <li>données techniques et journaux de connexion nécessaires au fonctionnement du site.</li>
            </ul>
          </div>
        </section>

        <section id="donnees-de-sante">
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Données de santé
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Certaines informations que tu peux renseigner — poids, taille, douleurs ou blessures, traitements en
              cours, mensurations — peuvent constituer ou révéler des données de santé au sens de l&apos;article 9 du
              RGPD. Elles sont explicitement présentées comme optionnelles dans le formulaire d&apos;onboarding et
              servent uniquement à adapter ton accompagnement sportif.
            </p>
            <p>
              Nous travaillons à la mise en place d&apos;un consentement explicite dédié à ces données, distinct de
              l&apos;acceptation générale des conditions d&apos;utilisation. En attendant, évite de renseigner plus
              d&apos;informations médicales que ce qui est utile à ton coach, et privilégie l&apos;échange direct avec
              lui pour tout élément sensible.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Pourquoi ces données sont utilisées
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les données de coaching, de suivi et de paiement sont utilisées pour exécuter le contrat qui te lie à
            SETH (accompagnement, suivi de progression, facturation). Les données techniques sont utilisées sur la
            base de notre intérêt légitime à faire fonctionner et sécuriser le site. L&apos;inscription à la
            newsletter repose sur ton consentement explicite, recueilli séparément et retirable à tout moment (voir
            plus bas).
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Combien de temps ces données sont conservées
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les données de ton espace élève sont conservées pendant la durée de la relation contractuelle. Pour un
            programme acheté à l&apos;unité, l&apos;accès au contenu prend fin après la durée annoncée sur la page du
            programme. Les documents nécessaires au respect de nos obligations comptables et fiscales sont, pour
            leur part, conservés pendant la durée légale applicable, indépendamment de la fermeture de ton compte.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Qui a accès à tes données
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>Nous faisons appel à des prestataires techniques pour faire fonctionner le site :</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Supabase (hébergement de la base de données, authentification et stockage des fichiers, région Irlande, Union européenne) ;</li>
              <li>Stripe (traitement des paiements et des abonnements) ;</li>
              <li>Resend (envoi des emails transactionnels) ;</li>
              <li>Brevo (gestion de la newsletter, sur la base de ton consentement) ;</li>
              <li>Vercel (hébergement de l&apos;application).</li>
            </ul>
            <p>
              Certains de ces prestataires peuvent être situés hors de l&apos;Union européenne. Dans ce cas, ils
              s&apos;engagent à mettre en œuvre des garanties appropriées pour le transfert de données personnelles.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Cookies et traceurs
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ce site n&apos;utilise aucun cookie publicitaire ni outil d&apos;analyse tiers. Seuls des éléments
            strictement nécessaires au fonctionnement du site sont déposés (session de connexion, préférence
            d&apos;affichage clair/sombre). Une page dédiée à la gestion de tes préférences sera publiée séparément.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Tes droits
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Conformément au RGPD, tu disposes d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de
              limitation, d&apos;opposition et de portabilité sur tes données. Tu peux exercer ces droits à tout
              moment en écrivant à{" "}
              <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
                favierjules.contact@gmail.com
              </a>
              .
            </p>
            <p>
              Si tu estimes que tes droits ne sont pas respectés, tu peux introduire une réclamation auprès de la
              Commission nationale de l&apos;informatique et des libertés (CNIL).
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Sécurité
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nous mettons en œuvre des mesures techniques et organisationnelles raisonnables pour protéger tes
            données contre l&apos;accès non autorisé, la perte ou l&apos;altération.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Modifications
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Cette politique peut être mise à jour pour refléter des évolutions du site ou de la réglementation. La
            date de dernière mise à jour figure en haut de cette page.
          </p>
        </section>
      </div>
    </section>
  );
}
