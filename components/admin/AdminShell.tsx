"use client";

import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Menu } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useAdminData } from "@/hooks/useAdminData";

// Le builder plein écran (V3, /admin/programmes/[id]/builder) est un
// "sandbox" volontairement sans sidebar ni menu admin (voir spec V3 —
// fullscreen builder) : ni scroll de page, ni double barre de défilement.
// On le détecte par pattern d'URL plutôt que de le sortir de l'arborescence
// app/admin/** (qui forcerait à déplacer toutes les autres routes admin),
// donc AdminShell reste le seul point de bascule et le reste de l'admin
// n'est absolument pas affecté.
const BUILDER_ROUTE_PATTERN = /^\/admin\/programmes\/[^/]+\/builder(\/.*)?$/;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sideOpen, setSideOpen] = useState(false);
  const { state } = useAdminData();
  const accentColor = state.appearanceSettings?.accentColor ?? "#d62828";

  if (pathname && BUILDER_ROUTE_PATTERN.test(pathname)) {
    return (
      <div className="h-dvh w-full overflow-hidden bg-background" style={{ "--primary": accentColor } as CSSProperties}>
        {children}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen bg-background"
      style={{ "--primary": accentColor } as CSSProperties}
    >
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
