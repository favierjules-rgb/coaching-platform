/**
 * HARNAIS — LE VRAI CLIC, LE VRAI SERVICE WORKER, LA VRAIE NAVIGATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL ICI
 * ════════════════════════════════════════════════════════════════════════
 * `StudentSidebar` telle quelle, ses `<Link>` de Next, le clic de
 * l'utilisateur, `public/sw.js` RÉELLEMENT enregistré, le vrai Cache
 * Storage, les vraies navigations de document, et le mode hors ligne réel
 * du navigateur (`context.setOffline`).
 *
 * INJECTÉ : le réseau Supabase (les hooks de la barre latérale
 * interrogeraient un serveur qui n'existe pas ici) et le contexte de routeur
 * que Next fournit normalement.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE HARNAIS EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * A34 prouvait que les sept coquilles étaient dans Cache Storage. Sur
 * l'iPhone, un clic sur « Nutrition » affichait quand même « Une erreur est
 * survenue » : `<Link>` ne recharge pas le document, il va chercher la
 * charge RSC de la route — que le service worker laisse passer, et qui
 * échoue sans réseau.
 *
 * Un test qui appelait le service worker à la main ne pouvait pas voir ça.
 * Celui-ci clique.
 */
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathParamsContext,
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { StudentSidebar } from "@/components/student/StudentSidebar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const routeur = {
  push: (url: string) => {
    (window as unknown as { __PUSH: string[] }).__PUSH.push(url);
  },
  replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {},
  prefetch: async () => {},
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]["value"];

function avecContexteNext(chemin: string, enfant: ReactNode) {
  return createElement(
    AppRouterContext.Provider,
    { value: routeur },
    createElement(
      PathnameContext.Provider,
      { value: chemin },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(PathParamsContext.Provider, { value: {} }, enfant),
      ),
    ),
  );
}

(window as unknown as { __PUSH: string[] }).__PUSH = [];

const racine = document.getElementById("racine");
if (racine) {
  createRoot(racine).render(
    avecContexteNext(
      window.location.pathname,
      // `ThemeToggle`, dans la barre latérale, exige son fournisseur : c'est
      // le layout racine qui le pose dans l'application.
      createElement(ThemeProvider, null, createElement(StudentSidebar, {})),
    ),
  );
}

/**
 * Ce que fait `ServiceWorkerRegistrar` puis `PreparationCoquille`, dans le
 * même ordre : enregistrer, attendre l'activation, annoncer la page.
 */
async function preparer(): Promise<void> {
  const enregistrement = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  const actif = enregistrement.active ?? navigator.serviceWorker.controller;
  if (!actif) {
    throw new Error("aucun service worker actif");
  }
  actif.postMessage({ type: "coquille-eleve", url: window.location.href });
}

(window as unknown as { __harnais: unknown }).__harnais = {
  preparer,
  pushs: () => (window as unknown as { __PUSH: string[] }).__PUSH,
  /** Tout ce que Cache Storage contient, tous caches confondus. */
  async cache(): Promise<string[]> {
    const noms = await caches.keys();
    const urls: string[] = [];
    for (const nom of noms) {
      const cache = await caches.open(nom);
      for (const requete of await cache.keys()) {
        urls.push(new URL(requete.url).pathname);
      }
    }
    return urls.sort();
  },
  /** Le lien du menu, tel que l'élève le voit. */
  lien(href: string): boolean {
    const noeud = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    if (!noeud) return false;
    noeud.click();
    return true;
  },
};
