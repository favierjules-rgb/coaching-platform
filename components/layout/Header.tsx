"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { navLinks } from "@/data/mock";

/**
 * Liens exposés UNIQUEMENT par le menu burger — jamais dans la navigation
 * horizontale ni dans le footer (chantier feat/business-services-contact,
 * juillet 2026). Les pages restent publiques et indexables : seul le
 * chemin de découverte dans l'interface est volontairement discret.
 */
const burgerOnlyLinks = [{ label: "Services aux entreprises", href: "/services-entreprises" }];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Échap ferme le menu, quel que soit l'élément focalisé.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-border bg-background/95 backdrop-blur"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Logo variant="header" />

        <nav className="mt-5 hidden items-center gap-8 lg:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* Action unique. Le second bouton qui renvoyait vers /#methode a
              été retiré (juillet 2026) : il occupait une place importante
              pour un doublon — la navigation et le menu burger mènent déjà
              à cette ancre — et diluait le seul appel à l'action utile. */}
          <div className="hidden items-center gap-3 lg:flex">
            <Link
              href="/connexion"
              className="bg-foreground px-4 py-2 text-sm tracking-wide text-background transition-colors hover:bg-foreground/90"
            >
              Connexion
            </Link>
          </div>

          {/* Bouton burger : présent à TOUS les breakpoints depuis le
              chantier « services aux entreprises » — c'est le seul point
              d'entrée vers les liens `burgerOnlyLinks`, y compris sur
              desktop où la navigation horizontale reste inchangée. */}
          <button
            type="button"
            className="pressable p-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
            aria-controls="menu-burger"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="menu-burger" className="flex flex-col gap-4 border-t border-border bg-card px-6 py-6">
          {/* Liens de la navigation principale : repris ici pour le mobile,
              masqués sur desktop où ils sont déjà dans la barre. */}
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="border-b border-border py-2 text-sm tracking-wide text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
            >
              {link.label}
            </a>
          ))}

          {burgerOnlyLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="border-b border-border py-2 text-sm tracking-wide text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {link.label}
            </Link>
          ))}

          <Link
            href="/connexion"
            onClick={() => setMenuOpen(false)}
            className="mt-2 bg-foreground px-4 py-3 text-center text-sm tracking-wide text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
          >
            Connexion
          </Link>
        </div>
      )}
    </header>
  );
}
