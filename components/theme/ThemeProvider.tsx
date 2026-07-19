"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

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
 * choix "clair" est mémorisé, pour éviter un flash sombre->clair au
 * chargement. Volontairement une simple chaîne (pas d'import), pour rester
 * exécutable comme script inline sans dépendre du bundle client.
 */
export const themeAntiFlashScript = `(function(){try{var t=window.localStorage.getItem('${STORAGE_KEY}');if(t==='light'){document.documentElement.classList.add('light');}}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

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
