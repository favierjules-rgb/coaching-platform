"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { StudentSidebar } from "@/components/student/StudentSidebar";

/**
 * Coquille de l'espace élève — refonte visuelle feat/student-training-apple-ui
 * (aucun changement de navigation ni de permissions) :
 * - contenu principal RECENTRÉ dans une colonne à largeur maximale cohérente
 *   sur grand écran, padding réduit sur téléphone (pas d'espace perdu) ;
 * - barre mobile collante avec léger flou (une seule surface translucide,
 *   lisible et peu coûteuse), zone tactile du menu ≥ 44 px ;
 * - safe-areas iOS respectées (encoche et bas d'écran) pour ne jamais masquer
 *   un bouton de validation derrière la barre système.
 */
export function StudentShell({ children }: { children: ReactNode }) {
  const [sideOpen, setSideOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:flex">
        <StudentSidebar />
      </div>

      {sideOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="h-full w-64">
            <StudentSidebar mobile onNavigate={() => setSideOpen(false)} />
          </div>
          <div
            className="flex-1 bg-black/60"
            onClick={() => setSideOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/80 bg-card/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-card/75 lg:hidden">
          <button
            type="button"
            onClick={() => setSideOpen(true)}
            aria-label="Ouvrir le menu"
            className="pressable inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Menu size={20} />
          </button>
          <Logo />
        </div>

        <main className="flex-1 overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
