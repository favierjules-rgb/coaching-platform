"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Dumbbell,
  FileText,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Settings,
  Users,
  Utensils,
  X,
} from "lucide-react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { isAdminRouteActive, isAnyAdminRouteActive, isSubmenuOpen } from "@/lib/admin-shell-nav";

// "Programmation" (V3 chantier module Programmation, étape 2) regroupe les 3
// sous-domaines du contenu d'entraînement admin derrière un seul item
// dépliable, plutôt que 3 entrées à plat dans la sidebar — voir
// docs/chantier-programmation.md.
const programmationChildren = [
  { href: "/admin/programmes", label: "Programmes" },
  { href: "/admin/exercices", label: "Exercices" },
  { href: "/admin/seances", label: "Séances" },
];

const adminLinks = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/eleves", label: "Élèves", icon: Users },
  { href: "/admin/calendrier", label: "Calendrier", icon: CalendarDays },
  { href: "/admin/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/admin/documents", label: "Documents", icon: FileText },
  { href: "/admin/paiements", label: "Paiements", icon: CreditCard },
  { href: "/admin/emails", label: "Emails", icon: Mail },
  { href: "/admin/retours", label: "Retours élèves", icon: MessageSquare },
  { href: "/admin/parametres", label: "Paramètres", icon: Settings },
];

/**
 * Item de navigation (chantier polish Apple admin, Lot A ; état actif adouci
 * au polish final) : pastille `rounded-control`, hover discret, press
 * feedback, cible >= 44px. L'item ACTIF n'est plus une pastille pleine à fort
 * contraste : fond légèrement contrasté (`bg-primary/10`) + fin indicateur
 * latéral arrondi — même langage que les sous-items Programmation. Le focus
 * clavier (`focus-visible:ring`) reste distinct de l'état actif. Couleurs =
 * tokens sémantiques uniquement.
 */
function navItemClass(active: boolean): string {
  return `pressable flex min-h-[44px] items-center gap-3 rounded-control px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
    active
      ? "relative bg-primary/10 font-medium text-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary before:content-['']"
      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
  }`;
}

interface AdminSidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function AdminSidebar({ mobile = false, onNavigate }: AdminSidebarProps) {
  const pathname = usePathname();
  const programmationActive = isAnyAdminRouteActive(
    pathname,
    programmationChildren.map((child) => child.href),
  );
  // État manuel du sous-menu (bascule au clic), indépendant de la route
  // active — pas de synchronisation via effet. L'état affiché est dérivé au
  // rendu : ouvert dès qu'on est sur une page du groupe, sinon piloté par le
  // clic (mêmes deux comportements qu'avant, sans setState dans un effet).
  // Détection de route déléguée aux helpers purs lib/admin-shell-nav.ts
  // (mêmes fonctions testées dans scripts/tests/admin-shell-nav.mts) — une
  // seule source pour le style actif ET aria-current.
  const [programmationManualOpen, setProgrammationManualOpen] = useState(false);
  const programmationOpen = isSubmenuOpen(programmationActive, programmationManualOpen);

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center justify-between border-b border-border px-6">
        <Logo />
        {mobile && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Fermer le menu"
            className="flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="border-b border-border px-6 py-3">
        <span className="text-[11px] uppercase tracking-widest text-primary">Espace admin</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {adminLinks.slice(0, 2).map(({ href, label, icon: Icon }) => {
          const active = isAdminRouteActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={navItemClass(Boolean(active))}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}

        <div>
          <button
            type="button"
            onClick={() => setProgrammationManualOpen((v) => !v)}
            aria-expanded={programmationOpen}
            className={`w-full ${navItemClass(programmationActive)}`}
          >
            <Dumbbell size={18} />
            <span className="flex-1 text-left">Programmation</span>
            <ChevronDown
              size={16}
              className={`transition-transform motion-reduce:transition-none ${programmationOpen ? "rotate-180" : ""}`}
            />
          </button>
          {programmationOpen && (
            <div className="sidebar-submenu-fade-in mt-1 flex flex-col gap-1 pl-[38px]">
              {programmationChildren.map((child) => {
                const childActive = isAdminRouteActive(pathname, child.href);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    aria-current={childActive ? "page" : undefined}
                    className={`pressable flex min-h-[44px] items-center rounded-control px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      childActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {adminLinks.slice(2).map(({ href, label, icon: Icon }) => {
          const active = isAdminRouteActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={navItemClass(Boolean(active))}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-4">
        <ThemeToggle />
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={navItemClass(false)}
        >
          <ArrowLeft size={18} />
          Espace élève
        </Link>
        <SignOutButton
          onBeforeNavigate={onNavigate}
          className={`w-full ${navItemClass(false)}`}
        />
      </div>
    </div>
  );
}
