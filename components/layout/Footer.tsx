import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

/**
 * Liens légaux (chantier conformité juridique/RGPD — juillet 2026) :
 * /mentions-legales (Lot A) et /confidentialite (Lot B). Ne pas ajouter de
 * lien vers cookies/CGV/CGU/rétractation/résiliation tant que ces pages
 * n'existent pas (lots C à G, à venir).
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-black py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center">
        <Logo />
        <nav className="flex items-center gap-6">
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
        </nav>
        <p className="text-xs text-muted-foreground">
          © 2026 Seth Préparation Physique — Tous droits réservés
        </p>
      </div>
    </footer>
  );
}
