"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Choix clair/sombre de la PAGE D'ACCUEIL uniquement (chantier
 * `feat/home-apple-refresh-light-dark`).
 *
 * Volontairement indépendant de `ThemeProvider` (admin/élève) : autre clé
 * localStorage, autre porteur (l'attribut `data-home-theme` du conteneur
 * `#accueil`, jamais `<html>`), pour qu'un choix fait sur la home ne change
 * jamais l'apparence de l'admin — et réciproquement. La palette, elle, est
 * partagée : en clair, le conteneur reçoit les mêmes tokens que la classe
 * `.light` (voir app/globals.css).
 *
 * Même architecture éprouvée que ThemeProvider : localStorage est la source
 * de vérité, lue via `useSyncExternalStore` (instantané serveur : sombre) —
 * aucun setState dans un effet, aucune divergence d'hydratation, le premier
 * rendu client est identique au rendu serveur puis se synchronise seul.
 *
 * Anti-flash : le choix mémorisé est appliqué par un script bloquant inséré
 * comme premier enfant du conteneur (voir `homeThemeAntiFlashScript`),
 * exécuté pendant le parsing, avant la première peinture.
 *
 * Le sombre reste le thème par défaut : sans choix mémorisé, rien ne change.
 */

export const HOME_THEME_STORAGE_KEY = "seth-home-theme";

/**
 * Script bloquant anti-flash. `document.currentScript.parentElement` est le
 * conteneur `#accueil` : au moment où il s'exécute, le conteneur est parsé
 * mais son contenu pas encore peint. Tout est sous try/catch — stockage
 * indisponible (navigation privée stricte) = sombre par défaut.
 */
export const homeThemeAntiFlashScript = `try{var t=localStorage.getItem("${HOME_THEME_STORAGE_KEY}");if(t==="light"){var e=document.currentScript.parentElement;e.setAttribute("data-home-theme","light");}}catch(_){}`;

type HomeTheme = "dark" | "light";

const auditeurs = new Set<() => void>();

function sAbonner(auditeur: () => void): () => void {
  auditeurs.add(auditeur);
  return () => auditeurs.delete(auditeur);
}

function lireThème(): HomeTheme {
  try {
    return window.localStorage.getItem(HOME_THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Instantané serveur : sombre, l'apparence historique de la home. */
function instantanéServeur(): HomeTheme {
  return "dark";
}

function écrireThème(suivant: HomeTheme): void {
  document.getElementById("accueil")?.setAttribute("data-home-theme", suivant);
  try {
    window.localStorage.setItem(HOME_THEME_STORAGE_KEY, suivant);
  } catch {
    // Stockage indisponible : le choix vaut pour la session en cours.
  }
  for (const notifier of auditeurs) notifier();
}

export function HomeThemeSwitch() {
  const theme = useSyncExternalStore(sAbonner, lireThème, instantanéServeur);
  const versClair = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => écrireThème(versClair ? "light" : "dark")}
      className="home-theme-switch"
      aria-label={versClair ? "Activer le thème clair" : "Activer le thème sombre"}
      aria-pressed={theme === "light"}
      title={versClair ? "Thème clair" : "Thème sombre"}
    >
      {versClair ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
