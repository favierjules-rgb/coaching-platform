import type { Metadata } from "next";

import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation — Seth Préparation Physique",
  description: "Règles d'accès et d'utilisation du site et de l'espace élève.",
};

/**
 * CGU (chantier conformité juridique/RGPD, Lot D — juillet 2026). Distinctes
 * des CGV : les CGU régissent l'usage du site et de l'espace élève, pas
 * l'achat en lui-même. Reflètent le fonctionnement réel constaté en audit
 * (comptes provisionnés par le coach ou après achat d'un programme, pas
 * d'inscription libre — voir app/inscription/page.tsx).
 */
export default function CguPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <SectionLabel>Conditions d&apos;utilisation</SectionLabel>
      <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
        Conditions générales d&apos;utilisation
      </h1>
      <p className="mb-16 text-sm text-muted-foreground">Dernière mise à jour : 21 juillet 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">Objet</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les présentes conditions générales d&apos;utilisation régissent l&apos;accès et l&apos;utilisation de ce
            site et de l&apos;espace élève, indépendamment des conditions applicables à l&apos;achat d&apos;un
            programme ou d&apos;un abonnement, détaillées dans nos{" "}
            <a href="/cgv" className="text-foreground underline underline-offset-4">
              conditions générales de vente
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Accès au site
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les pages publiques du site sont accessibles librement. L&apos;espace élève est réservé aux personnes
            dont le compte a été créé par leur coach, ou aux personnes ayant acheté un programme numérique (compte
            créé automatiquement après paiement). Il n&apos;existe pas d&apos;inscription libre sur ce site.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Ton compte
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tes identifiants de connexion sont personnels et confidentiels. Tu es responsable de leur confidentialité
            et de toute activité réalisée depuis ton compte. Préviens-nous sans délai à{" "}
            <a href="mailto:favierjules.contact@gmail.com" className="text-foreground underline underline-offset-4">
              favierjules.contact@gmail.com
            </a>{" "}
            en cas d&apos;usage suspect ou non autorisé.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Usage autorisé
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            L&apos;accès à l&apos;espace élève et aux programmes est strictement personnel. Toute revente, partage de
            compte, extraction ou diffusion des contenus à des tiers sans autorisation est interdite.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Disponibilité du service
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nous mettons en œuvre des moyens raisonnables pour assurer l&apos;accès continu au site, sans garantir
            une disponibilité ininterrompue. Des interruptions temporaires, notamment pour maintenance, peuvent
            survenir.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Données personnelles et cookies
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            L&apos;utilisation de tes données personnelles et des cookies/stockages de ce site est décrite dans notre{" "}
            <a href="/confidentialite" className="text-foreground underline underline-offset-4">
              politique de confidentialité
            </a>{" "}
            et notre page{" "}
            <a href="/cookies" className="text-foreground underline underline-offset-4">
              cookies
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Responsabilité
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les contenus et conseils fournis via le site ne remplacent pas un avis médical. Tu es seul responsable de
            l&apos;adaptation des exercices à ta condition physique et de la véracité des informations que tu nous
            transmets.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Modifications
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ces conditions peuvent être mises à jour pour refléter des évolutions du site ou de la réglementation. La
            date de dernière mise à jour figure en haut de cette page.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-heading text-xl font-bold uppercase tracking-wide text-foreground">
            Droit applicable
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les présentes conditions sont soumises au droit français.
          </p>
        </section>
      </div>
    </section>
  );
}
