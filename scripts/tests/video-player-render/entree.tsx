/**
 * HARNAIS REACT — LA VRAIE PAGE DE SÉANCE, ET LE LECTEUR PAR-DESSUS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL
 * ════════════════════════════════════════════════════════════════════════
 * `app/(student)/entrainement/seance/[sessionId]/page.tsx` telle quelle,
 * `SessionFeedbackSection`, `ExerciseFeedbackCard`, le brouillon IndexedDB,
 * `MediaModal`, `VideoPlayerModal`, React et les clics.
 *
 * INJECTÉ : le réseau (le même double que `parcours-offline-render`), pour
 * que la séance se lise depuis le snapshot local. `navigator.onLine` reste
 * VRAI : c'est le transport Supabase qui est en panne, pas la connexion —
 * le lecteur doit donc se monter normalement.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI LA VRAIE PAGE, ET PAS LE COMPOSANT DE CARTE
 * ════════════════════════════════════════════════════════════════════════
 * La question de VIDEO9 n'est pas « le bouton ouvre-t-il une modale » mais
 * « ouvrir une modale démonte-t-il le formulaire de séance ». Elle ne peut
 * se poser que sur l'arbre complet : le `<form>`, le `<fieldset disabled>`
 * de l'hydratation, le brouillon, et le lecteur rendu dans un portail.
 */
import { createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathParamsContext,
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import SeancePage from "@/app/(student)/entrainement/seance/[sessionId]/page";
import { FileViewerModal } from "@/components/shared/FileViewerModal";
import { VideoPlayerModal } from "@/components/shared/VideoPlayerModal";
import { DepotOffline } from "@/lib/offline/depot";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import { dateMetier } from "@/lib/offline/seance-du-jour";
import type { ContenuSnapshot } from "@/lib/offline/snapshot-seance";
import type { Exercise, WorkoutSession } from "@/types";

const USER = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SEANCE = "33333333-3333-4333-8333-777777777777";
const VIDEO_YOUTUBE = "https://youtu.be/dQw4w9WgXcQ?si=M2bRc4ufxQyliFDM";
const SIGNEE = "https://exemple-projet.supabase.co/storage/v1/object/sign/documents/x.pdf?token=abc";

const EXERCICE: Exercise = {
  id: "66666666-6666-4666-8666-333333333333",
  name: "Développé couché",
  sets: 2,
  reps: "8-13",
  restSeconds: 180,
  tempo: "2-0-X-0",
  recommendedLoad: "RIR 1",
  // C'est la forme RÉELLEMENT présente en base : `youtu.be` + `?si=`.
  videoUrl: VIDEO_YOUTUBE,
  muscleGroup: "Pectoraux",
  libraryExerciseId: "88888888-8888-4888-8888-666666666666",
  recommendedRpe: "8",
};

const SESSION = {
  id: SEANCE,
  programId: "99999999-9999-4999-8999-999999999999",
  name: "Push — Pecs / Épaules",
  day: "Lundi",
  durationMinutes: 60,
  muscleGroups: ["Pectoraux"],
  warmup: "",
  coachNotes: "",
  exercises: [EXERCICE],
  cardioBlocks: [],
  blocks: [
    {
      id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
      category: "strength",
      position: 1,
      title: "Bloc principal",
      colorKey: "neutral",
      exercises: [EXERCICE],
    },
  ],
} as unknown as WorkoutSession;

let racine: Root | null = null;

const routeurFactice = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {},
  prefetch: async () => {},
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]["value"];

/** Compte les navigations tentées — VIDEO8 exige qu'il n'y en ait aucune. */
const navigations: string[] = [];
for (const methode of ["push", "replace", "refresh", "back", "forward"] as const) {
  (routeurFactice as unknown as Record<string, () => void>)[methode] = () => {
    navigations.push(methode);
  };
}

function avecContexteNext(chemin: string, params: Record<string, string>, enfant: ReactNode) {
  return createElement(
    AppRouterContext.Provider,
    { value: routeurFactice },
    createElement(
      PathnameContext.Provider,
      { value: chemin },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(PathParamsContext.Provider, { value: params }, enfant),
      ),
    ),
  );
}

function monterDans(element: ReactNode) {
  racine?.unmount();
  document.getElementById("racine")!.innerHTML = "";
  racine = createRoot(document.getElementById("racine")!);
  racine.render(element);
}

function attendre(ms: number) {
  return new Promise((ok) => setTimeout(ok, ms));
}

/** Le dialogue, s'il est ouvert. Il vit dans un PORTAIL, donc hors de #racine. */
function dialogue(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function champs(): HTMLInputElement[] {
  return Array.from(document.getElementById("racine")!.querySelectorAll("input, textarea"));
}

function poser(element: HTMLInputElement | HTMLTextAreaElement, valeur: string) {
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, valeur);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * LE MÉCANISME DE SIGNATURE, VU DU TEST.
 *
 * Il compte ses appels et rend une URL DIFFÉRENTE à chaque fois : c'est la
 * seule façon de distinguer « le composant a redemandé une signature » de
 * « le composant a rechargé la même adresse ».
 */
const signatures: string[] = [];
function signerAnouveau(): string | null {
  const bloque = (globalThis as unknown as { __SIGNATURE_ECHOUE?: boolean }).__SIGNATURE_ECHOUE;
  if (bloque) {
    signatures.push("(refus)");
    return null;
  }
  const url = `https://exemple-projet.supabase.co/storage/v1/object/sign/documents/x.pdf?token=frais-${signatures.length + 1}`;
  signatures.push(url);
  return url;
}

/** Petit hôte pour monter un lecteur isolé (PDF, hors ligne…). */
function HoteLecteur({ genre, url }: { genre: "video" | "fichier"; url: string | null }) {
  const [ouvert, setOuvert] = useState(false);
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", "aria-label": "Ouvrir le média", onClick: () => setOuvert(true) },
      "Ouvrir",
    ),
    genre === "video"
      ? createElement(VideoPlayerModal, {
          ouvert, onFermer: () => setOuvert(false), titre: "Média", url,
          onRafraichir: signerAnouveau,
        })
      : createElement(FileViewerModal, {
          ouvert, onFermer: () => setOuvert(false), titre: "Document", url,
          onRafraichir: signerAnouveau,
        }),
  );
}

const harnais = {
  constantes: () => ({ SEANCE, VIDEO_YOUTUBE, SIGNEE }),

  /** Écrit le snapshot EXACTEMENT comme le fait le chemin en ligne. */
  async semer() {
    (globalThis as unknown as Record<string, unknown>).__MODE_RESEAU = "offline";
    const depot = new DepotOffline(new MoteurIndexedDB());
    const contenu: ContenuSnapshot = {
      studentId: ELEVE,
      session: SESSION,
      programId: "99999999-9999-4999-8999-999999999999",
      programName: "Hypertrophie — bloc 2",
      feedbackExistant: null,
      historique: [],
      remplacants: {},
      accessType: "coaching",
    };
    await depot.ecrireSnapshot({
      userId: USER, businessDate: dateMetier(), sessionId: SEANCE,
      payload: contenu, maintenant: Date.now(),
    });
  },

  async monterSeance() {
    navigations.length = 0;
    monterDans(
      avecContexteNext(`/entrainement/seance/${SEANCE}`, { sessionId: SEANCE }, createElement(SeancePage)),
    );
    // Le formulaire s'ouvre dans un `<fieldset disabled>` tant que le
    // brouillon n'est pas restauré : un clic plus tôt n'atteindrait rien.
    const limite = Date.now() + 10000;
    while (
      (document.querySelector("fieldset[disabled]") ||
        !(document.getElementById("racine")?.textContent ?? "").includes("Développé couché")) &&
      Date.now() < limite
    ) {
      await attendre(40);
    }
    await attendre(150);
    if (document.querySelector("fieldset[disabled]")) return "FIELDSET TOUJOURS DÉSACTIVÉ";
    if (!(document.getElementById("racine")?.textContent ?? "").includes("Développé couché")) {
      return "EXERCICE JAMAIS RENDU";
    }
    return "ok";
  },

  monterLecteur(genre: "video" | "fichier", url: string | null) {
    monterDans(createElement(HoteLecteur, { genre, url }));
  },

  async ouvrirMedia() {
    document.querySelector<HTMLButtonElement>('[aria-label="Ouvrir le média"]')?.click();
    await attendre(120);
  },

  /** Remplit charge, reps, RPE et commentaire — de vraies saisies. */
  async remplirSeance() {
    const entrees = champs();
    const numeriques = entrees.filter((c) => c.type === "number" || c.type === "text");
    const zones = Array.from(
      document.getElementById("racine")!.querySelectorAll("textarea"),
    ) as HTMLTextAreaElement[];
    const saisies: Record<string, string> = {};
    const valeurs = ["62.5", "11", "8"];
    numeriques.slice(0, 3).forEach((champ, index) => {
      poser(champ, valeurs[index] ?? "1");
      saisies[`champ${index}`] = valeurs[index] ?? "1";
    });
    if (zones[0]) {
      poser(zones[0], "Barre lourde, dernière série difficile.");
      saisies.commentaire = "Barre lourde, dernière série difficile.";
    }
    await attendre(150);
    return saisies;
  },

  /** Ce que portent les champs, à l'instant présent. */
  valeursSaisies() {
    const entrees = champs();
    return {
      numeriques: entrees.filter((c) => c.type === "number" || c.type === "text").slice(0, 3).map((c) => c.value),
      commentaires: Array.from(
        document.getElementById("racine")!.querySelectorAll("textarea"),
      ).map((z) => (z as HTMLTextAreaElement).value),
    };
  },

  async cliquerDemo() {
    const bouton = Array.from(document.getElementById("racine")!.querySelectorAll("button")).find((b) =>
      /Voir la démo/i.test(b.textContent ?? ""),
    );
    if (!bouton) return "BOUTON ABSENT";
    if (bouton.tagName !== "BUTTON") return "CE N'EST PAS UN BOUTON";
    bouton.click();
    await attendre(150);
    return "ok";
  },

  /** L'état du dialogue — ce qu'un utilisateur y voit, et ce qu'il contient. */
  etatModale() {
    const boite = dialogue();
    if (!boite) return { ouvert: false } as Record<string, unknown>;
    const iframe = boite.querySelector("iframe");
    return {
      ouvert: true,
      role: boite.getAttribute("role"),
      ariaModal: boite.getAttribute("aria-modal"),
      titre: boite.querySelector("h2")?.textContent ?? "",
      etiquetteTitre: Boolean(boite.getAttribute("aria-labelledby")),
      texte: boite.textContent ?? "",
      iframes: boite.querySelectorAll("iframe").length,
      videos: boite.querySelectorAll("video").length,
      srcIframe: iframe?.getAttribute("src") ?? null,
      titreIframe: iframe?.getAttribute("title") ?? null,
      pleinEcran: iframe?.hasAttribute("allowfullscreen") ?? false,
      permissions: iframe?.getAttribute("allow") ?? "",
      etat: boite.querySelector("[data-etat]")?.getAttribute("data-etat") ?? null,
      focusSurFermeture: document.activeElement?.getAttribute("aria-label") === "Fermer",
      scrollBloque: document.body.style.overflow === "hidden",
    };
  },

  async fermerParX() {
    dialogue()?.querySelector<HTMLButtonElement>('[aria-label="Fermer"]')?.click();
    await attendre(150);
  },

  async fermerParEchap() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await attendre(150);
  },

  async fermerParVoile() {
    document.querySelector<HTMLElement>("[data-media-modal-voile]")?.click();
    await attendre(150);
  },

  /** Ce que la page de séance montre encore — titre, champs, boutons. */
  pageSeance() {
    const dom = document.getElementById("racine")!;
    const texteComplet = dom.textContent ?? "";
    return {
      // Un extrait pour le diagnostic, et le VERDICT calculé sur le texte
      // COMPLET : le nom de l'exercice n'est pas dans les 400 premiers
      // caractères, et tronquer avant de chercher ferait échouer un test qui
      // a raison.
      texte: texteComplet.slice(0, 400),
      contientExercice: texteComplet.includes("Développé couché"),
      nombreChamps: champs().length,
      cheminCourant: window.location.pathname,
      navigations: [...navigations],
      formulaires: dom.querySelectorAll("form").length,
    };
  },

  /** Bascule la connexion telle que le lecteur la lit. */
  poserReseau(enLigne: boolean) {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => enLigne });
  },

  /** Les URLs réellement produites par le mécanisme de signature. */
  signatures: () => [...signatures],
  reinitialiserSignatures() {
    signatures.length = 0;
    (globalThis as unknown as Record<string, unknown>).__SIGNATURE_ECHOUE = false;
  },
  poserEchecSignature(valeur: boolean) {
    (globalThis as unknown as Record<string, unknown>).__SIGNATURE_ECHOUE = valeur;
  },

  /** Clique « Réessayer » dans le dialogue. */
  async reessayer() {
    const bouton = Array.from(dialogue()?.querySelectorAll("button") ?? []).find((b) =>
      /Réessayer/.test(b.textContent ?? ""),
    );
    if (!bouton) return "BOUTON RÉESSAYER ABSENT";
    bouton.click();
    await attendre(200);
    return "ok";
  },

  /** Force l'erreur de lecture d'une vidéo fichier, comme un lien expiré. */
  async casserLaVideo() {
    const video = dialogue()?.querySelector("video");
    if (!video) return "AUCUNE VIDÉO";
    video.dispatchEvent(new Event("error", { bubbles: false }));
    await attendre(150);
    return "ok";
  },

  /** Toutes les requêtes réseau parties depuis le montage. */
  requetes: () => [...requetes],
};

/* Un greffier sur `fetch` : VIDEO13 exige qu'aucune requête vidéo ne parte
   hors ligne. On note, on ne bloque pas. */
const requetes: string[] = [];
const vraiFetch = window.fetch.bind(window);
window.fetch = ((entree: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  requetes.push(url);
  return vraiFetch(entree as RequestInfo, init);
}) as typeof window.fetch;

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
