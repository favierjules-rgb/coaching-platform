"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

// Le builder plein écran (V3, /admin/programmes/[id]/builder) est un
// "sandbox" volontairement sans sidebar ni menu admin (voir spec V3 —
// fullscreen builder) : ni scroll de page, ni double barre de défilement.
// On le détecte par pattern d'URL plutôt que de le sortir de l'arborescence
// app/admin/** (qui forcerait à déplacer toutes les autres routes admin),
// donc AdminShell reste le seul point de bascule et le reste de l'admin
// n'est absolument pas affecté.
const BUILDER_ROUTE_PATTERN = /^\/admin\/programmes\/[^/]+\/builder(\/.*)?$/;

// Ancienne "couleur d'accent" personnalisable par coach (chantier identité
// SETH, Lot 6 Bis, 2026-07-19) : appliquait state.appearanceSettings.
// accentColor en style inline sur --primary, donc identique quel que soit
// le thème clair/sombre — problématique avec la nouvelle identité
// monochrome où --primary s'inverse volontairement entre les deux thèmes
// (voir app/globals.css). Retirée : aucune page /admin/parametres ne
// permet aujourd'hui de modifier ce réglage (scaffolding jamais relié à
// une UI), son seul effet vivant était donc de casser --primary en clair.
// state.appearanceSettings.accentColor reste défini dans data/admin.ts et
// les types (fonctionnalité en sursis, décision produit à venir) — plus
// consommé ici. --primary suit désormais normalement la cascade
// :root/.light comme partout ailleurs dans l'app.
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sideOpen, setSideOpen] = useState(false);

  if (pathname && BUILDER_ROUTE_PATTERN.test(pathname)) {
    // Racine en `<main>` (Lot 6, Groupe C — landmarks) : ce sandbox
    // fullscreen n'a ni sidebar ni le <main> de la branche normale
    // ci-dessous, donc aucun repère "contenu principal" n'existait pour les
    // lecteurs d'écran. Changement de balise uniquement, layout inchangé.
    return (
      <main className="h-dvh w-full overflow-hidden bg-background">
        {children}
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:flex">
        <AdminSidebar />
      </div>

      {sideOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="h-full w-64">
            <AdminSidebar mobile onNavigate={() => setSideOpen(false)} />
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setSideOpen(false)} />
        </div>
      )}

      <div className="flex flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setSideOpen(true)}
            aria-label="Ouvrir le menu"
            className="text-foreground"
          >
            <Menu size={20} />
          </button>
          <Logo />
          <span className="text-[11px] uppercase tracking-widest text-primary">Admin</span>
        </div>

        <main className="flex-1 overflow-y-auto p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
