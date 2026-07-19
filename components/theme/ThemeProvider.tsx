"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

/**
 * Bascule clair/sombre (chantier "redesign clair/sombre", juillet 2026) —
 * espace admin + espace élève. Purement présentationnel : pose/retire la
 * classe `.light` sur `<html>` (voir app/globals.css pour les tokens de
 * couleur associés) et mémorise le choix en localStorage. Ne touche à
 * aucune donnée ni logique métier.
 *
 * Par défaut (aucun choix mémorisé) : mode sombre, identique au
 * comportement historique du site — jamais de surprise pour un utilisateur
 * existant qui n'a jamais touché au bouton.
 *
 * Lecture de l'état via `useSyncExternalStore` plutôt que
 * `useState` + `useEffect` : le thème mémorisé n'est disponible que côté
 * client (localStorage), et `useSyncExternalStore` est l'API React conçue
 * précisément pour ce cas (valeur qui diffère entre le rendu serveur et le
 * client sans provoquer d'avertissement d'hydratation), contrairement à un
 * `setState` synchrone dans un effet qui déclenche un rendu en cascade
 * évitable.
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "seth-theme";

/**
 * Source de vérité UNIQUE des routes où le choix clair/sombre s'applique
 * (chantier Lot 6, correctif "isolation des thèmes") — espace admin et
 * espace élève. Toute route hors de cette liste (landing, catalogue public
 * /programmes, pages d'authentification, paiement, désinscription
 * newsletter...) reste verrouillée en sombre, quel que soit le thème
 * mémorisé. Utilisée à deux endroits qui doivent impérativement rester en
 * accord :
 * 1. `themeAntiFlashScript` (pré-hydratation, voir plus bas) ;
 * 2. l'effet de synchronisation au changement de route dans
 *    `ThemeProvider` (post-hydratation, navigation client-side).
 * Ne jamais dupliquer cette liste ailleurs — l'importer.
 */
export const THEME_ENABLED_PREFIXES = [
  "/admin",
  "/dashboard",
  "/entrainement",
  "/nutrition",
  "/documents",
  "/profil",
  "/progression",
  "/rendez-vous",
  "/onboarding",
] as const;

function isThemeableRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return THEME_ENABLED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// useLayoutEffect n'a aucun effet côté serveur (juste un avertissement React
// dans la console) : sur le rendu serveur on retombe silencieusement sur
// useEffect (no-op pour cet usage, la classe .light n'a de toute façon pas
// de sens sans DOM). Côté client, useLayoutEffect s'exécute de façon
// synchrone AVANT que le navigateur peigne le nouveau contenu de route — le
// seul moyen d'éviter un flash visible (clair puis sombre, ou l'inverse) au
// moment précis d'une navigation client-side (App Router ne recharge pas
// <html>/<body>, seul le sous-arbre routé change).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle("light", theme === "light");
}

// Store externe minimal pour useSyncExternalStore : pas d'état React, la
// source de vérité reste localStorage (via readStoredTheme), on notifie
// juste les abonnés après une écriture pour déclencher un nouveau rendu.
const themeListeners = new Set<() => void>();

function subscribeToTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function getThemeSnapshot(): Theme {
  return readStoredTheme();
}

function getServerThemeSnapshot(): Theme {
  return "dark";
}

/**
 * Script anti-flash injecté dans <head> par app/layout.tsx, exécuté avant
 * l'hydratation React : applique la classe `.light` immédiatement si un
 * choix "clair" est mémorisé ET que la route courante fait partie des
 * espaces thémables (THEME_ENABLED_PREFIXES ci-dessus), pour éviter un
 * flash sombre->clair au chargement — SANS jamais l'appliquer sur une page
 * publique verrouillée en sombre. Volontairement une simple chaîne (pas
 * d'import), pour rester exécutable comme script inline sans dépendre du
 * bundle client ; la liste de préfixes est sérialisée depuis
 * THEME_ENABLED_PREFIXES pour ne jamais diverger de la version utilisée
 * côté React.
 */
export const themeAntiFlashScript = `(function(){try{var t=window.localStorage.getItem('${STORAGE_KEY}');if(t!=='light')return;var prefixes=${JSON.stringify(THEME_ENABLED_PREFIXES)};var path=window.location.pathname;for(var i=0;i<prefixes.length;i++){if(path.indexOf(prefixes[i])===0){document.documentElement.classList.add('light');break;}}}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);
  const pathname = usePathname();

  // Synchronise la classe .light à chaque changement de route (navigation
  // client-side, sans rechargement complet) — le script anti-flash ci-dessus
  // ne s'exécute qu'au chargement initial d'une page ; sans cet effet, une
  // navigation en SPA depuis une route privée en clair vers une route
  // publique (ou l'inverse) laisserait .light collé sur <html>. Ne lit
  // jamais localStorage pendant le rendu serveur : cet effet ne s'exécute
  // que côté client, après montage/mise à jour.
  useIsomorphicLayoutEffect(() => {
    const shouldBeLight = isThemeableRoute(pathname) && readStoredTheme() === "light";
    document.documentElement.classList.toggle("light", shouldBeLight);
  }, [pathname]);

  const setTheme = useCallback((next: Theme) => {
    applyThemeClass(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage indisponible (navigation privée...) : le choix reste
      // actif pour la session courante (classe appliquée), simplement pas
      // mémorisé — et les abonnés ne seront pas notifiés d'un changement
      // "durable", ce qui est correct puisqu'il n'y en a pas eu.
    }
    themeListeners.forEach((listener) => listener());
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme doit être utilisé à l'intérieur de <ThemeProvider>.");
  }
  return ctx;
}
