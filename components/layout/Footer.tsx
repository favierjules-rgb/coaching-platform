import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

/**
 * Footer juridique simplifié (chantier simplification footer — juillet
 * 2026). 4 liens seulement en façade, aucune page/route supprimée : les
 * 5 pages légales existantes (+ crédits) restent accessibles via la page
 * d'index /informations-legales.
 *
 * - "Informations légales" → /informations-legales, page d'index qui
 *   renvoie vers mentions légales, CGV, CGU, rétractation et crédits.
 * - "Confidentialité" → /confidentialite (inchangé).
 * - "Politique de cookies" → /cookies. Intitulé volontairement descriptif
 *   et non "Gérer mes cookies" : aucune interface interactive permettant
 *   de modifier ou retirer un consentement n'existe à ce stade, donc rien
 *   à "gérer". Ne reprendre l'intitulé "Gérer mes cookies" que le jour où
 *   un véritable gestionnaire de consentement sera en place.
 * - "Résilier votre contrat" → /profil, où vit le vrai point d'entrée
 *   ("Gérer mon abonnement" → portail de facturation Stripe). Intitulé
 *   explicite et provisoire : il n'existe pas encore de route /resiliation
 *   dédiée, ce lien renvoie donc vers la fonctionnalité existante la plus
 *   proche, pas une page fictive.
 *
 * Grille 2 colonnes sur mobile / nav centrée entre logo et copyright sur
 * desktop, largeur de conteneur (max-w-7xl) identique au reste du site.
 */
const footerLinks = [
  { href: "/informations-legales", label: "Informations légales" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/cookies", label: "Politique de cookies" },
  { href: "/profil", label: "Résilier votre contrat" },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-black py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-6 md:flex-row md:justify-between">
        <div className="w-full md:w-auto md:shrink-0">
          <Logo />
        </div>

        <nav
          aria-label="Liens légaux"
          className="grid w-full grid-cols-2 gap-x-6 gap-y-3 text-center md:flex md:w-auto md:flex-row md:flex-wrap md:items-center md:justify-center md:gap-x-8 md:gap-y-2 md:text-left"
        >
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-block py-1 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="w-full text-center text-xs text-muted-foreground md:w-auto md:shrink-0 md:text-right">
          © 2026 Seth Préparation Physique — Tous droits réservés
        </p>
      </div>
    </footer>
  );
}
