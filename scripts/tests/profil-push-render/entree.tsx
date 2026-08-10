/**
 * HARNAIS REACT — /profil MONTÉ POUR DE VRAI, AVEC UN ENVIRONNEMENT PUSH CHOISI.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL
 * ════════════════════════════════════════════════════════════════════════
 * `app/(student)/profil/page.tsx`, `ProfilPageContent`, ses gardes,
 * `useEtatOfflineEleve`, `NotificationsSection`, `useNotificationsPush`,
 * React et `createRoot`.
 *
 * INJECTÉ : le réseau (`supabase-mode.ts`, partagé avec parcours-offline),
 * le hook de profil Supabase (`profil-charge.ts`), et — c'est l'objet de
 * cette suite — L'ENVIRONNEMENT PUSH DU NAVIGATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI SUBSTITUER `navigator.serviceWorker`
 * ════════════════════════════════════════════════════════════════════════
 * Chromium sur `127.0.0.1` est un contexte sécurisé : il a toujours
 * `serviceWorker`, `PushManager` et `Notification`. Or les situations à
 * prouver sont précisément celles où il en MANQUE, ou bien où
 * `serviceWorker.ready` ne se résout jamais — ce que Safari hors PWA
 * installée fait tous les jours. Aucune de ces situations n'est
 * reproductible autrement que par substitution.
 *
 * Ce qui est substitué est donc la SURFACE DU NAVIGATEUR, jamais le code
 * qui la lit : `useNotificationsPush` s'exécute tel quel.
 */
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathParamsContext,
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import ProfilPage from "@/app/(student)/profil/page";
import { PRENOM_REEL } from "./profil-charge";

export type ModePush =
  /** Safari hors PWA installée : pas de `PushManager` du tout. */
  | "absent"
  /** Le cas qui pend : `serviceWorker.ready` ne se résout JAMAIS. */
  | "ready_jamais"
  /** `ready` arrive tard (enregistrement lent) : l'état doit se corriger. */
  | "ready_tardif"
  /** L'élève a refusé, iOS ne revient dessus que par les Réglages. */
  | "refuse"
  /** `getSubscription()` rejette : réseau, quota, stockage. */
  | "getSubscription_rejette"
  /** Nominal, cet appareil est déjà abonné. */
  | "abonne"
  /** Nominal, jamais demandé. */
  | "pas_abonne";

let racine: Root | null = null;

const routeurFactice = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {},
  prefetch: async () => {},
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]["value"];

function avecContexteNext(enfant: ReactNode) {
  return createElement(
    AppRouterContext.Provider,
    { value: routeurFactice },
    createElement(
      PathnameContext.Provider,
      { value: "/profil" },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(PathParamsContext.Provider, { value: {} }, enfant),
      ),
    ),
  );
}

function poserServiceWorker(valeur: unknown) {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: valeur });
}

function poserNotification(permission: NotificationPermission) {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission, requestPermission: async () => permission },
  });
}

function enregistrement(getSubscription: () => Promise<unknown>) {
  return { pushManager: { getSubscription, subscribe: async () => ({ endpoint: "x", toJSON: () => ({}) }) } };
}

const harnais = {
  constantes: () => ({ PRENOM_REEL }),

  /**
   * L'environnement Push, posé AVANT le montage. Chaque cas tourne dans un
   * contexte de navigateur neuf, donc dans une page neuve : ces
   * substitutions ne fuient jamais d'un cas à l'autre.
   */
  environnementPush(mode: ModePush) {
    if (mode === "absent") {
      // `"PushManager" in window` doit devenir faux : le getter est sur le
      // prototype, c'est donc là qu'il faut le retirer.
      delete (window as unknown as Record<string, unknown>).PushManager;
      delete (Navigator.prototype as unknown as Record<string, unknown>).serviceWorker;
      return;
    }
    poserNotification(mode === "refuse" ? "denied" : "default");
    if (mode === "ready_jamais") {
      poserServiceWorker({ ready: new Promise(() => {}) });
      return;
    }
    if (mode === "ready_tardif") {
      poserServiceWorker({
        ready: new Promise((resoudre) =>
          setTimeout(() => resoudre(enregistrement(async () => ({ endpoint: "x" }))), 4200),
        ),
      });
      return;
    }
    if (mode === "getSubscription_rejette") {
      poserServiceWorker({
        ready: Promise.resolve(
          enregistrement(async () => {
            throw new Error("stockage indisponible");
          }),
        ),
      });
      return;
    }
    poserServiceWorker({
      ready: Promise.resolve(
        enregistrement(async () => (mode === "abonne" ? { endpoint: "x" } : null)),
      ),
    });
  },

  /** Ce que `useNotificationsPush.supporte()` verra réellement. */
  supportPush() {
    return {
      serviceWorker: "serviceWorker" in navigator,
      pushManager: "PushManager" in window,
      notification: "Notification" in window,
    };
  },

  /** `false` rejoue l'instant où Supabase n'a pas encore répondu. */
  profilCharge(valeur: boolean) {
    (globalThis as unknown as Record<string, unknown>).__PROFIL_CHARGE = valeur;
    (globalThis as unknown as Record<string, unknown>).__MODE_RESEAU = "online";
  },

  monterProfil() {
    racine?.unmount();
    document.getElementById("racine")!.innerHTML = "";
    racine = createRoot(document.getElementById("racine")!);
    racine.render(avecContexteNext(createElement(ProfilPage)));
  },

  vu() {
    const racineDom = document.getElementById("racine")!;
    return {
      texte: racineDom.textContent ?? "",
      boutons: Array.from(racineDom.querySelectorAll("button")).map((b) => b.textContent ?? ""),
    };
  },
};

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
