"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { PAGE_THEME_ATTRIBUTE, type PageThemeConfig } from "@/lib/theme/page-theme";

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
 *
 * ⚠️ CE MODULE N'EXPORTE QU'UN COMPOSANT, ET C'EST UNE RÈGLE, PAS UN HASARD.
 * `"use client"` qualifie le MODULE entier : chacun de ses exports devient
 * une référence client, donc un proxy que le serveur ne peut pas exécuter.
 * Un composant JSX s'en accommode ; une fonction appelée pendant le rendu
 * serveur échoue au build — c'est ce qui a cassé le prerender de
 * /services-entreprises le 1efdde2. La configuration, l'attribut et le
 * script anti-flash vivent donc dans `lib/theme/page-theme.ts`, module
 * neutre, et rien d'appelable côté serveur ne doit revenir ici.
 */

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
  document.getElementById(config.containerId)?.setAttribute(PAGE_THEME_ATTRIBUTE, suivant);
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
