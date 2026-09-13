/**
 * Thème clair/sombre d'UNE page publique — partie NEUTRE, partagée par le
 * serveur et le client.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE : UNE FRONTIÈRE, PAS UN SUJET
 * ════════════════════════════════════════════════════════════════════════
 * Ces déclarations vivaient dans `components/ui/PageThemeSwitch.tsx`, par
 * proximité thématique. Or ce module porte `"use client"`, et cette
 * directive ne qualifie pas un composant : elle qualifie LE MODULE ENTIER.
 * Chacun de ses exports devient une référence client, c'est-à-dire un proxy
 * sérialisable et non le vrai code. Pour un composant JSX c'est exactement
 * l'effet voulu ; pour une FONCTION appelée pendant le rendu serveur, c'est
 * une erreur de build :
 *
 *     Attempted to call pageThemeAntiFlashScript() from the server
 *     but pageThemeAntiFlashScript is on the client.
 *
 * Constaté au prerender de /services-entreprises (Vercel, commit 1efdde2).
 *
 * ⚠️ CETTE FONCTION N'A RIEN DE CLIENT, ET C'EST TOUT LE PROBLÈME. Elle ne
 * touche ni au DOM, ni à React, ni à `localStorage` : elle assemble une
 * chaîne. Sa seule vraie contrainte est inverse — elle DOIT s'exécuter côté
 * serveur, puisque le script qu'elle produit doit figurer dans le HTML
 * envoyé, avant la première peinture. Elle appartient donc à un module
 * neutre, et l'interactivité seule reste derrière `"use client"`.
 *
 * Règle générale, valable au-delà de ce cas : ranger un module par sa
 * FRONTIÈRE d'exécution, pas par son sujet.
 */

/** Attribut porteur du thème — posé sur le conteneur de page, jamais sur `<html>`. */
export const PAGE_THEME_ATTRIBUTE = "data-page-theme";

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
 *
 * Rendue ici, dans un module neutre, précisément pour qu'un Server Component
 * puisse l'APPELER (voir l'en-tête de fichier).
 */
export function pageThemeAntiFlashScript({ storageKey }: PageThemeConfig): string {
  return `try{var t=localStorage.getItem("${storageKey}");if(t==="light"){var e=document.currentScript.parentElement;e.setAttribute("${PAGE_THEME_ATTRIBUTE}","light");}}catch(_){}`;
}
