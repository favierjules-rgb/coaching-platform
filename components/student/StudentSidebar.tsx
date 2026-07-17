"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Apple,
  CalendarDays,
  Dumbbell,
  FileText,
  LayoutDashboard,
  Lock,
  TrendingUp,
  User,
  X,
} from "lucide-react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { Logo } from "@/components/ui/Logo";
import { useSupabaseAccessType } from "@/hooks/useSupabaseAccessType";
import { useSupabaseMyAccess } from "@/hooks/useSupabaseMyAccess";

const studentLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, requiresAccess: false },
  { href: "/entrainement", label: "Entraînement", icon: Dumbbell, requiresAccess: true },
  { href: "/nutrition", label: "Nutrition", icon: Apple, requiresAccess: true },
  { href: "/rendez-vous", label: "Rendez-vous", icon: CalendarDays, requiresAccess: false },
  { href: "/progression", label: "Progression", icon: TrendingUp, requiresAccess: true },
  { href: "/documents", label: "Documents", icon: FileText, requiresAccess: true },
  { href: "/profil", label: "Profil", icon: User, requiresAccess: false },
];

// Comptes "programme_seul" (chantier module Programmation, étape 6, achat
// unique depuis la home page) : accès restreint à Entraînement + Profil,
// jamais Dashboard/Nutrition/Rendez-vous/Progression/Documents — voir
// lib/supabase/guards.ts (requireCoachingFeature/requireActiveStudentAccess)
// pour les redirections serveur correspondantes, ce filtrage n'est qu'un
// masquage de menu côté affichage.
const programOnlyHrefs = new Set(["/entrainement", "/profil"]);

interface StudentSidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function StudentSidebar({
  mobile = false,
  onNavigate,
}: StudentSidebarProps) {
  const pathname = usePathname();
  // Cadenas plutôt que masquage (chantier "supabase-stripe-access-control")
  // : l'onglet reste visible et cliquable — le clic mène bien à la page
  // (le guard requireActiveStudentAccess redirige vers /acces-limite le cas
  // échéant), c'est juste un indice visuel pour comprendre pourquoi.
  const access = useSupabaseMyAccess();
  const accessType = useSupabaseAccessType();
  // Correctif crawl pré-merge (chantier suppression auto. 6 mois) : un
  // compte "programme_seul" n'est jamais soumis au contrôle d'abonnement
  // Stripe (voir lib/supabase/guards.ts::requireEntrainementAccess, qui lui
  // laisse toujours l'accès) — sans ce garde-fou, useSupabaseMyAccess le
  // trouvait "non abonné" et affichait un cadenas trompeur sur Entraînement
  // alors que le clic fonctionnait réellement.
  const isBlocked =
    accessType !== "programme_seul" && access.ready && access.status !== null && !access.status.allowed;
  const visibleLinks =
    accessType === "programme_seul" ? studentLinks.filter((link) => programOnlyHrefs.has(link.href)) : studentLinks;

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

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {visibleLinks.map(({ href, label, icon: Icon, requiresAccess }) => {
          const active = pathname === href;
          const locked = requiresAccess && isBlocked;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-label={locked ? `${label} (accès verrouillé — abonnement requis)` : label}
              className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {locked && <Lock size={13} className="text-amber-400" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <SignOutButton
          onBeforeNavigate={onNavigate}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-primary"
        />
      </div>
    </div>
  );
}
