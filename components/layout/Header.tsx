"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { navLinks } from "@/data/mock";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-border bg-background/95 backdrop-blur"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Logo variant="header" />

        <nav className="hidden items-center gap-8 lg:flex">
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

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/#methode"
            className="border border-primary px-4 py-2 text-sm tracking-wide text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            En savoir plus sur la méthode
          </Link>
          <Link
            href="/connexion"
            className="bg-foreground px-4 py-2 text-sm tracking-wide text-background transition-colors hover:bg-foreground/90"
          >
            Connexion
          </Link>
        </div>

        <button
          type="button"
          className="p-2 text-foreground lg:hidden"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {menuOpen && (
        <div className="flex flex-col gap-4 border-t border-border bg-card px-6 py-6 lg:hidden">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="border-b border-border py-2 text-sm tracking-wide text-foreground"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/#methode"
            onClick={() => setMenuOpen(false)}
            className="mt-2 border border-primary px-4 py-3 text-center text-sm tracking-wide text-primary"
          >
            En savoir plus sur la méthode
          </Link>
          <Link
            href="/connexion"
            onClick={() => setMenuOpen(false)}
            className="bg-foreground px-4 py-3 text-center text-sm tracking-wide text-background"
          >
            Connexion
          </Link>
        </div>
      )}
    </header>
  );
}
