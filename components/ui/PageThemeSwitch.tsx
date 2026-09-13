"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Choix clair/sombre d'UNE page publique, porté par un attribut
 * `data-page-theme` sur son conteneur — jamais sur `<html>`.
 *
 * ⚠️ POURQUOI CE COMPOSANT EXISTE À CÔTÉ DE `HomeThemeSwitch`, ET CE QUE
 * ÇA COÛTE. La home dispose du même mécanisme depuis juillet 2026, mais
 * câblé en dur sur `#accueil` et sur sa propre clé de stockage. Le
 * généraliser aurait imposé de modifier `HomeThemeSwitch`, `app/page.tsx`
 * et `scripts/tests/home-theme.mts` — qui épingle nommément
 * `getElementById("accueil")` dans le source du switch — c'est-à-dire de
 * sortir du périmètre de la page entreprise pour un gain d'une quarantaine
 * de lignes. La mécanique est donc reprise ici sous forme PARAMÉTRÉE, et la
 * home reste intacte. Dette assumée et signalée : le jour où un troisième
 * usage apparaît, c'est `HomeThemeSwitch` qui doit devenir une enveloppe de
 * ce composant, pas l'inverse.
 *
 * Architecture identique à celle qui a fait ses preuves : localStorage est
 * la source de vérité, lue par `useSyncExternalStore` (instantané serveur :
 * sombre). Aucun `setState` dans un effet, aucune divergence d'hydratation —
 * le premier rendu client est identique au rendu serveur, puis se
 * synchronise seul.
 *
 * Le sombre reste le défaut : sans choix mémorisé, rien ne change.
 */

export interface PageThemeConfig {
  /** `id` du conteneur qui porte l'attribut de thème. */
  containerId: string;
  /** Clé localStorage — DISTINCTE de celles des autres pages et de l'admin. */
  storageKey: string;
}

/**
 * Script bloquant anti-flash, à insérer comme PREMIER ENFANT du conteneur.
 *
 * `document.currentScript.parentElement` est ce conteneur : au moment où le
 * script s'exécute, l'élément est parsé mais son contenu pas encore peint,
 * donc le thème mémorisé s'applique avant la première image. Tout est sous
 * try/catch — stockage indisponible (navigation privée stricte) = sombre.
 */
export function pageThemeAntiFlashScript({ storageKey }: PageThemeConfig): string {
  return `try{var t=localStorage.getItem("${storageKey}");if(t==="light"){var e=document.currentScript.parentElement;e.setAttribute("data-page-theme","light");}}catch(_){}`;
}

type PageTheme = "dark" | "light";

const auditeurs = new Set<() => void>();

function sAbonner(auditeur: () => void): () => void {
  auditeurs.add(auditeur);
  return () => auditeurs.delete(auditeur);
}

function lireThème(storageKey: string): PageTheme {
  try {
    return window.localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Instantané serveur : sombre, l'apparence par défaut du site public. */
function instantanéServeur(): PageTheme {
  return "dark";
}

function écrireThème(config: PageThemeConfig, suivant: PageTheme): void {
  document.getElementById(config.containerId)?.setAttribute("data-page-theme", suivant);
  try {
    window.localStorage.setItem(config.storageKey, suivant);
  } catch {
    // Stockage indisponible : le choix vaut pour la session en cours.
  }
  for (const notifier of auditeurs) notifier();
}

export function PageThemeSwitch({ config }: { config: PageThemeConfig }) {
  const theme = useSyncExternalStore(sAbonner, () => lireThème(config.storageKey), instantanéServeur);
  const versClair = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => écrireThème(config, versClair ? "light" : "dark")}
      className="page-theme-switch"
      aria-label={versClair ? "Activer le thème clair" : "Activer le thème sombre"}
      aria-pressed={theme === "light"}
      title={versClair ? "Thème clair" : "Thème sombre"}
    >
      {versClair ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
