/**
 * HARNAIS REACT — DÉCONNEXION ET MENU, DANS UN VRAI NAVIGATEUR.
 *
 * RÉEL : `SignOutButton` tel quel avec sa confirmation, `useDeconnexionOffline`,
 * `useSupabaseAccessType`, `DepotOffline`, `MoteurIndexedDB`, IndexedDB.
 *
 * INJECTÉ : l'identité (quel compte est connecté), `signOut` (on n'a pas de
 * Supabase ici), la résolution en ligne de l'`access_type`, et le dépôt —
 * qui vise une base jetable. Rien d'autre.
 */
import { createRoot, type Root } from "react-dom/client";
import { createElement, type ReactNode } from "react";
// `SignOutButton` appelle `useRouter()`. Hors application Next, ce contexte
// n'existe pas — on le fournit ICI, dans le harnais, plutôt que d'ajouter
// une prop au composant produit pour les besoins d'un test.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { useSupabaseAccessType } from "@/hooks/useSupabaseAccessType";
import { DepotOffline } from "@/lib/offline/depot";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import type { TypeAcces } from "@/lib/offline/schema";
import type { WorkoutFeedbackPayload } from "@/types";

const A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const B = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const SEANCE = "33333333-3333-4333-8333-111111111111";
const DIMANCHE = "2026-08-09";

const FORMULAIRE = {
  exerciseFeedback: {}, substitutions: {}, videosExercice: {}, blockDrafts: {},
  completed: true, globalRpe: "8", globalComment: "saisie de A", pain: "",
  painLevel: "aucune", painDetail: "", durationMinutes: "65",
};

function depotPour(nomBase: string, enPanne = false): DepotOffline {
  if (enPanne) {
    const refus = (): never => {
      throw new Error("IndexedDB indisponible");
    };
    return new DepotOffline({
      async lire() { return refus(); },
      async ecrire() { return refus(); },
      async supprimer() { return refus(); },
      async cles() { return refus(); },
      async transaction() { return refus(); },
    });
  }
  return new DepotOffline(MoteurIndexedDB.pourTests({ nomBase, version: 1 }));
}

let racine: Root | null = null;
const signOuts: string[] = [];
const navigations: string[] = [];

const routeurFactice = {
  push: (url: string) => navigations.push(url),
  replace: (url: string) => navigations.push(url),
  refresh: () => navigations.push("refresh"),
  back: () => {},
  forward: () => {},
  prefetch: async () => {},
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]["value"];

function avecRouteur(enfant: ReactNode) {
  return createElement(AppRouterContext.Provider, { value: routeurFactice }, enfant);
}

/** Sonde d'affichage : rend la valeur du hook, rien d'autre. */
function SondeMenu({
  depot, userId, resoudreEnLigne,
}: {
  depot: DepotOffline;
  userId: string | null;
  resoudreEnLigne?: () => Promise<TypeAcces>;
}) {
  const accessType = useSupabaseAccessType({
    depot,
    identite: async () => userId,
    ...(resoudreEnLigne ? { resoudreEnLigne } : {}),
  });
  // Le MÊME test que la sidebar : `accessType === "programme_seul"` réduit
  // la liste. On rend le verdict, pas une seconde navigation.
  return createElement(
    "div",
    null,
    createElement("span", { id: "acces" }, accessType),
    createElement("span", { id: "menu" }, accessType === "programme_seul" ? "réduit" : "complet"),
  );
}

const harnais = {
  signOuts: () => signOuts,
  navigations: () => navigations,

  /** Sème un compte : snapshot + brouillon + préférence, et éventuellement une opération en attente. */
  async semer(nomBase: string, userId: string, options: { pending?: boolean; acces?: TypeAcces } = {}) {
    const depot = depotPour(nomBase);
    await depot.ecrireSnapshot({
      userId, businessDate: DIMANCHE, sessionId: SEANCE,
      payload: { studentId: "eleve", session: { id: SEANCE } }, maintenant: Date.now(),
    });
    await depot.ecrireTypeAcces(userId, options.acces ?? "coaching", Date.now());
    if (options.pending) {
      await depot.validerRetourHorsLigne({
        userId, sessionId: SEANCE, businessDate: DIMANCHE,
        etatFormulaire: FORMULAIRE,
        payloadServeur: {
          studentId: "eleve", sessionKey: SEANCE, sessionRefLabel: "Haut du corps",
          completed: true, globalRpe: 8, globalComment: "retour de A", pain: "",
          exercises: [], sessionId: SEANCE, durationMinutes: 65, performedAt: DIMANCHE,
        } as unknown as WorkoutFeedbackPayload,
        operationId: "op-A", maintenant: Date.now(),
      });
    } else {
      await depot.ecrireBrouillon({
        userId, sessionId: SEANCE, businessDate: DIMANCHE,
        payload: FORMULAIRE, maintenant: Date.now(), revision: 1,
      });
    }
  },

  /** Ce que le dépôt contient pour un compte donné. */
  async etat(nomBase: string, userId: string) {
    const depot = depotPour(nomBase);
    return {
      snapshot: (await depot.lireSnapshot(userId, DIMANCHE)) !== null,
      brouillon: (await depot.lireBrouillon(userId, SEANCE)) !== null,
      operation: (await depot.lireOperation(userId, SEANCE)) !== null,
      acces: await depot.lireTypeAcces(userId),
      enAttente: (await depot.operationsEnAttente(userId)).length,
    };
  },

  monterDeconnexion(nomBase: string, userId: string | null, options: { moteurEnPanne?: boolean } = {}) {
    signOuts.length = 0;
    racine?.unmount();
    document.getElementById("racine")!.innerHTML = "";
    racine = createRoot(document.getElementById("racine")!);
    racine.render(
      avecRouteur(createElement(SignOutButton, {
        className: "bouton-deconnexion",
        offline: {
          depot: depotPour(nomBase, options.moteurEnPanne === true),
          identite: async () => userId,
          signOut: async () => {
            signOuts.push(userId ?? "sans-identite");
          },
        },
      })),
    );
  },

  monterMenu(nomBase: string, userId: string | null, acces?: TypeAcces) {
    racine?.unmount();
    document.getElementById("racine")!.innerHTML = "";
    racine = createRoot(document.getElementById("racine")!);
    racine.render(
      createElement(SondeMenu, {
        depot: depotPour(nomBase),
        userId,
        // Sans `resoudreEnLigne`, la sonde n'a aucun moyen d'interroger le
        // serveur : c'est exactement le cas HORS LIGNE.
        ...(acces ? { resoudreEnLigne: async () => acces } : {}),
      }),
    );
  },

  /** Écrit une préférence ILLISIBLE, pour MENU6. */
  async semerAccesInvalide(nomBase: string, userId: string) {
    const moteur = MoteurIndexedDB.pourTests({ nomBase, version: 1 });
    await moteur.ecrire("display_prefs", userId, {
      schemaVersion: 1, userId, accessType: "administrateur_supreme", updatedAt: Date.now(),
    });
  },

  constantes: () => ({ A, B, SEANCE, DIMANCHE }),
};

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
