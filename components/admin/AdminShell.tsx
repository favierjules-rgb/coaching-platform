"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { FOCUSABLE_SELECTOR, bodyOverflowFor, nextDrawerOpen, wrapFocusTarget } from "@/lib/admin-shell-nav";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Drawer mobile — accessibilité complète (polish Apple admin, Lot A) :
  //  - à l'ouverture : mémorise le déclencheur, bloque le scroll du document,
  //    place le focus sur le premier élément focusable (bouton Fermer) ;
  //  - pendant : Échap ferme ; Tab/Shift+Tab bouclent DANS le drawer
  //    (wrapFocusTarget, testé dans scripts/tests/admin-shell-nav.mts) ; un
  //    focus égaré derrière l'overlay est ramené au premier élément ;
  //  - à la fermeture (Échap, overlay, navigation, ou démontage du composant
  //    pendant l'ouverture) : le cleanup restaure le scroll et RETOURNE le
  //    focus au déclencheur. Ouvertures/fermetures répétées : l'effet se
  //    réexécute proprement à chaque cycle. Aucune dépendance ajoutée.
  useEffect(() => {
    if (!sideOpen) return;

    // Safari/iOS ne donne PAS le focus à un <button> cliqué :
    // document.activeElement reste <body>, qui EST un HTMLElement — l'ancien
    // test `instanceof HTMLElement` ne repliait donc jamais sur le
    // déclencheur et le focus était « rendu » à <body>. On n'accepte
    // l'élément actif que s'il est réellement focalisé (≠ body/html), sinon
    // référence stable vers le bouton menu.
    const triggerAtOpen = triggerRef.current;
    const activeAtOpen = document.activeElement;
    const previouslyFocused =
      activeAtOpen instanceof HTMLElement && activeAtOpen !== document.body && activeAtOpen !== document.documentElement
        ? activeAtOpen
        : triggerAtOpen;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = bodyOverflowFor(true, previousOverflow);

    const focusables = () =>
      Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSideOpen((open) => nextDrawerOpen(open, "escape"));
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = wrapFocusTarget(elements, current, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = bodyOverflowFor(false, previousOverflow);
      // Restitution APRÈS la fermeture réelle (rAF) : à l'instant du cleanup
      // le drawer est encore dans le DOM et Safari peut refuser un focus()
      // synchrone vers l'extérieur. Cible = élément mémorisé s'il est
      // toujours monté et focusable, sinon repli explicite sur le bouton
      // menu — jamais <body>.
      const restoreFocus = () => {
        const candidate =
          previouslyFocused && previouslyFocused.isConnected && !previouslyFocused.hasAttribute("disabled")
            ? previouslyFocused
            : triggerAtOpen;
        if (candidate && candidate.isConnected && !candidate.hasAttribute("disabled")) {
          candidate.focus();
        }
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(restoreFocus);
      } else {
        restoreFocus();
      }
    };
  }, [sideOpen]);

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
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu admin"
          className="modal-overlay-fade-in fixed inset-0 z-50 flex bg-black/60 lg:hidden"
        >
          <div ref={drawerRef} className="animate-fade-in h-full w-64 shadow-soft">
            <AdminSidebar mobile onNavigate={() => setSideOpen((open) => nextDrawerOpen(open, "navigate"))} />
          </div>
          <div
            className="flex-1"
            onClick={() => setSideOpen((open) => nextDrawerOpen(open, "overlay"))}
          />
        </div>
      )}

      {/* ⚠️ `min-w-0` N'EST PAS DÉCORATIF — SANS LUI, TOUTE LA PAGE DÉBORDE.
          Cette colonne est un ENFANT FLEX de la rangée ci-dessus. Un enfant
          flex a `min-width: auto` par défaut, ce qui l'empêche de devenir plus
          étroit que la largeur MINIMALE de son contenu. Il suffit donc qu'un
          seul descendant, n'importe où dans l'admin, ait une largeur minimale
          large — un carrousel, un tableau, une chaîne insécable — pour que
          cette colonne s'élargisse, pousse la rangée, et fasse défiler la page
          entière. Mesuré : 1 204 px de colonne dans un viewport de 390 px.
          Avec `min-w-0`, la colonne peut rétrécir et c'est au descendant de
          gérer son propre débordement. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setSideOpen((open) => nextDrawerOpen(open, "toggle"))}
            aria-label="Ouvrir le menu"
            aria-expanded={sideOpen}
            className="pressable flex h-11 w-11 items-center justify-center rounded-control text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
