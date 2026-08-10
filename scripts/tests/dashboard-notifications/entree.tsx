/**
 * HARNAIS REACT — LE COMPOSER, COMPACT ET COMPLET, DANS UN VRAI NAVIGATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL
 * ════════════════════════════════════════════════════════════════════════
 * `NotificationComposer` tel quel, React, `createRoot`, et les clics.
 *
 * INJECTÉ : le réseau seul. `fetch` est remplacé par un greffier qui note ce
 * que le composant DEMANDE au serveur — c'est précisément l'objet de cette
 * suite : prouver que le tableau de bord envoie le même ordre que la page.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotificationComposer } from "@/components/admin/NotificationComposer";
import type { AdminStudent } from "@/types";

const ELEVE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const ELEVES = [
  { id: ELEVE_A, firstName: "Jules", lastName: "Dupont", email: "jules@example.com", status: "actif" },
  { id: ELEVE_B, firstName: "Marie", lastName: "Leroy", email: "marie@example.com", status: "actif" },
] as unknown as AdminStudent[];

interface Appel {
  url: string;
  corps: unknown;
}

const appels: Appel[] = [];

const vraiFetch = window.fetch.bind(window);
window.fetch = (async (entree: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const corps = init?.body ? JSON.parse(String(init.body)) : null;
  appels.push({ url, corps });

  if (url.includes("/audience")) {
    return new Response(JSON.stringify({ ok: true, cibles: 2, joignables: 2, appareils: 3 }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/campaigns")) {
    const programmee = corps && (corps as { quand?: { mode?: string } }).quand?.mode !== "now";
    return new Response(
      JSON.stringify({
        ok: true,
        campagneId: "camp-1",
        prochaineEcheance: programmee ? "2026-08-17T06:00:00.000Z" : null,
        appareilsCibles: 3, envoyes: 3, echoues: 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return vraiFetch(entree as RequestInfo, init);
}) as typeof window.fetch;

let racine: Root | null = null;

function attendre(ms: number) {
  return new Promise((ok) => setTimeout(ok, ms));
}

function racineDom() {
  return document.getElementById("racine")!;
}

/** Le contrôle porteur de cette étiquette accessible. */
function parEtiquette<T extends HTMLElement>(etiquette: string): T | null {
  return racineDom().querySelector<T>(`[aria-label="${etiquette}"]`);
}

function poser(element: HTMLInputElement | HTMLSelectElement, valeur: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const poseur = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  poseur.call(element, valeur);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

const harnais = {
  constantes: () => ({ ELEVE_A, ELEVE_B }),

  async monter(compact: boolean) {
    appels.length = 0;
    racine?.unmount();
    racineDom().innerHTML = "";
    racine = createRoot(racineDom());
    racine.render(createElement(NotificationComposer, { students: ELEVES, compact }));
    await attendre(60);
  },

  /** Ce que l'écran propose réellement — étiquettes visibles et contrôles. */
  vu() {
    const dom = racineDom();
    return {
      texte: dom.textContent ?? "",
      boutons: Array.from(dom.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? ""),
      controles: Array.from(dom.querySelectorAll("[aria-label]")).map((n) => n.getAttribute("aria-label") ?? ""),
      typesEntrees: Array.from(dom.querySelectorAll("input")).map((i) => i.type),
      quandEstUnMenu: Boolean(dom.querySelector('select[aria-label="Quand"]')),
    };
  },

  async choisirQuand(mode: "now" | "once" | "recurring") {
    const menu = parEtiquette<HTMLSelectElement>("Quand");
    if (menu) {
      poser(menu, mode);
    } else {
      const libelle = mode === "now" ? "Maintenant" : mode === "once" ? "Programmer" : "Répéter";
      const bouton = Array.from(racineDom().querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === libelle,
      );
      if (!bouton) return "BOUTON ABSENT";
      bouton.click();
    }
    await attendre(40);
    return "ok";
  },

  async choisirDestinataire(genre: "all" | "un" | "plusieurs", ids: string[] = []) {
    const menu = parEtiquette<HTMLSelectElement>("Destinataires")!;
    poser(menu, genre);
    await attendre(40);
    if (genre === "un" && ids.length > 0) {
      poser(parEtiquette<HTMLSelectElement>("Élève destinataire")!, ids[0]);
    }
    if (genre === "plusieurs") {
      for (const case_ of Array.from(racineDom().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
        const libelle = case_.closest("label")?.textContent ?? "";
        const veut =
          (ids.includes(ELEVE_A) && libelle.includes("Jules")) ||
          (ids.includes(ELEVE_B) && libelle.includes("Marie"));
        if (veut !== case_.checked) case_.click();
      }
    }
    await attendre(60);
  },

  async remplir(champs: { date?: string; heure?: string; freq?: string; jours?: number[] }) {
    if (champs.freq) {
      poser(parEtiquette<HTMLSelectElement>("Fréquence")!, champs.freq);
      await attendre(40);
    }
    if (champs.jours) {
      for (const j of [1, 2, 3, 4, 5, 6, 7]) {
        const bouton = parEtiquette<HTMLButtonElement>(`Jour ${j}`);
        if (!bouton) continue;
        const actif = bouton.getAttribute("aria-pressed") === "true";
        if (actif !== champs.jours.includes(j)) bouton.click();
      }
      await attendre(40);
    }
    if (champs.date) poser(parEtiquette<HTMLInputElement>("Date")!, champs.date);
    if (champs.heure) poser(parEtiquette<HTMLInputElement>("Heure")!, champs.heure);
    await attendre(40);
  },

  /** Clique le bouton d'action, puis la confirmation si elle apparaît. */
  async agir() {
    const principal = parEtiquette<HTMLButtonElement>("Valider la notification");
    if (!principal) return "ACTION ABSENTE";
    principal.click();
    await attendre(60);
    const confirmer = Array.from(racineDom().querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Envoyer",
    );
    if (confirmer && racineDom().textContent?.includes("Envoyer cette notification à")) {
      confirmer.click();
      await attendre(80);
    }
    await attendre(80);
    return "ok";
  },

  /** Le dernier ordre envoyé à `/campaigns` — la preuve de ce qui a été demandé. */
  dernierPayload() {
    const campagnes = appels.filter((a) => a.url.includes("/campaigns"));
    return campagnes.length > 0 ? campagnes[campagnes.length - 1].corps : null;
  },

  appels: () => appels.map((a) => a.url),
};

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
