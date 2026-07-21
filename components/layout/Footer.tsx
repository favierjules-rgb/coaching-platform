import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

/**
 * Liens légaux (chantier conformité juridique/RGPD — juillet 2026) :
 * /mentions-legales (Lot A), /confidentialite (Lot B), /cookies (Lot C),
 * /cgv + /cgu (Lot D), /retractation (Lot E). Intitulé "Cookies" et non
 * "Gérer mes cookies" : aucun traceur non essentiel n'existe à ce stade,
 * donc rien à gérer (voir app/cookies). Ne pas ajouter de lien vers
 * résiliation tant que cette page n'existe pas (lot F, à venir).
 *
 * `flex-wrap` sur la nav (Lot D) : les liens ne tiennent plus
 * systématiquement sur une seule ligne selon la largeur — évite un
 * débordement horizontal plutôt que d'attendre que ça casse visuellement.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-black py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center">
        <Logo />
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            href="/mentions-legales"
            className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            Mentions légales
          </Link>
          <Link
            href="/confidentialite"
            className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            Confidentialité
          </Link>
          <Link
            href="/cookies"
            className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            Cookies
          </Link>
          <Link
            href="/cgv"
            className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            CGV
          </Link>
          <Link
            href="/cgu"
            className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            CGU
          </Link>
          <Link
            href="/retractation"
            className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            Rétractation
          </Link>
        </nav>
        <p className="text-xs text-muted-foreground">
          © 2026 Seth Préparation Physique — Tous droits réservés
        </p>
      </div>
    </footer>
  );
}
