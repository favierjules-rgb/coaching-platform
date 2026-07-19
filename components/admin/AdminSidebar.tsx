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

interface AdminSidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function AdminSidebar({ mobile = false, onNavigate }: AdminSidebarProps) {
  const pathname = usePathname();
  const programmationActive = programmationChildren.some((child) => pathname?.startsWith(child.href));
  // État manuel du sous-menu (bascule au clic), indépendant de la route
  // active — pas de synchronisation via effet. L'état affiché est dérivé au
  // rendu : ouvert dès qu'on est sur une page du groupe, sinon piloté par le
  // clic (mêmes deux comportements qu'avant, sans setState dans un effet).
  const [programmationManualOpen, setProgrammationManualOpen] = useState(false);
  const programmationOpen = programmationActive || programmationManualOpen;

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center justify-between border-b border-border px-6">
        <Logo />
        {mobile && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Fermer le menu"
            className="text-muted-foreground"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="border-b border-border px-6 py-3">
        <span className="text-[11px] uppercase tracking-widest text-primary">Espace admin</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {adminLinks.slice(0, 2).map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === href : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
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
            className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors ${
              programmationActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <Dumbbell size={18} />
            <span className="flex-1 text-left">Programmation</span>
            <ChevronDown size={16} className={`transition-transform ${programmationOpen ? "rotate-180" : ""}`} />
          </button>
          {programmationOpen && (
            <div className="mt-1 flex flex-col gap-1 pl-[38px]">
              {programmationChildren.map((child) => {
                const childActive = pathname?.startsWith(child.href);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    className={`px-4 py-2 text-sm transition-colors ${
                      childActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground"
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
          const active = href === "/admin" ? pathname === href : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
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
          className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeft size={18} />
          Espace élève
        </Link>
        <SignOutButton
          onBeforeNavigate={onNavigate}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        />
      </div>
    </div>
  );
}
