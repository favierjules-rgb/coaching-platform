/**
 * HARNAIS REACT — LE VRAI COMPOSANT, DANS UN VRAI NAVIGATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL ICI, ET CE QUI NE L'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * RÉEL : React et `createRoot`, `SessionFeedbackSection` tel quel, ses
 * hooks (`useBrouillonSeance`), ses effets, son différé, sa validation, son
 * `handleSubmit`, `DepotOffline`, `MoteurIndexedDB` et IndexedDB lui-même.
 *
 * INJECTÉ : les deux FRONTIÈRES EXTERNES, et elles seulement —
 *   • le dépôt, qui vise une base jetable au lieu de celle de l'élève
 *     (exactement ce que fait `MoteurIndexedDB.pourTests`) ;
 *   • le réseau, remplacé par un mouchard qui refuse tout et enregistre.
 *
 * Aucune copie simplifiée du composant, aucun double de ses hooks. Ce qui
 * échoue ici échouerait sur le téléphone.
 */
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";

import { SessionFeedbackSection } from "@/components/student/SessionFeedbackSection";
import { DepotOffline, type MoteurStockage } from "@/lib/offline/depot";
import type { ReponseServeur, Transport } from "@/lib/offline/synchronisateur";
import type { AdminStudentFeedback, WorkoutFeedbackPayload } from "@/types";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import type { NomMagasin } from "@/lib/offline/schema";
import type { Exercise } from "@/types";

const USER = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SEANCE = "33333333-3333-4333-8333-111111111111";
const DIMANCHE = "2026-08-09";

const EXERCICES: Exercise[] = [
  {
    id: "66666666-6666-4666-8666-333333333333",
    name: "Développé couché",
    sets: 2,
    reps: "8-10",
    restSeconds: 120,
    tempo: "3-1-1",
    recommendedLoad: "80 kg",
    videoUrl: "",
    muscleGroup: "Pectoraux",
    libraryExerciseId: "88888888-8888-4888-8888-666666666666",
    recommendedRpe: "8",
  },
];

/** Un état de formulaire minimal mais VALIDE — la forme que le draft accepte. */
const FORMULAIRE_VIDE = {
  exerciseFeedback: {},
  substitutions: {},
  videosExercice: {},
  blockDrafts: {},
  completed: true,
  globalRpe: "8",
  globalComment: "",
  pain: "",
  painLevel: "aucune",
  painDetail: "",
  durationMinutes: "65",
};

/* ════════════════════════════════════════════════════════════════════════
 * LES DEUX FRONTIÈRES INJECTÉES
 * ════════════════════════════════════════════════════════════════════════ */

/** Un moteur qui délègue au vrai, en RETARDANT la lecture. Sert à la course d'hydratation. */
function moteurRetarde(reel: MoteurStockage, delaiMs: number): MoteurStockage {
  const attendre = () => new Promise((ok) => setTimeout(ok, delaiMs));
  return {
    async lire(magasin: NomMagasin, cle: string) {
      await attendre();
      return reel.lire(magasin, cle);
    },
    ecrire: (m, c, v) => reel.ecrire(m, c, v),
    supprimer: (m, c) => reel.supprimer(m, c),
    cles: (m) => reel.cles(m),
    transaction: (m, l, d) => reel.transaction(m, l, d),
  };
}

/** Un moteur entièrement en panne — navigation privée, quota, stockage coupé. */
function moteurEnPanne(): MoteurStockage {
  const refus = (): never => {
    throw new Error("IndexedDB indisponible");
  };
  return {
    async lire(): Promise<unknown> {
      return refus();
    },
    async ecrire(): Promise<void> {
      return refus();
    },
    async supprimer(): Promise<void> {
      return refus();
    },
    async cles(): Promise<string[]> {
      return refus();
    },
    async transaction(): Promise<void> {
      return refus();
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * LE MOUCHARD RÉSEAU
 * ════════════════════════════════════════════════════════════════════════
 * Il ne se contente pas d'enregistrer : il REFUSE. Un test qui laisserait
 * passer une requête prouverait seulement qu'elle n'a pas planté.
 */
const requetes: { url: string; methode: string }[] = [];
const fetchOrigine = window.fetch.bind(window);
window.fetch = (async (entree: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const methode = (init?.method ?? (entree instanceof Request ? entree.method : "GET")).toUpperCase();
  requetes.push({ url, methode });
  throw new Error(`réseau interdit dans ce harnais : ${methode} ${url}`);
}) as typeof window.fetch;
void fetchOrigine;

/* ════════════════════════════════════════════════════════════════════════
 * PILOTAGE
 * ════════════════════════════════════════════════════════════════════════ */

export interface ConfigMontage {
  nomBase: string;
  /** `retard` : lecture du brouillon différée. `panne` : stockage HS. */
  moteur?: "normal" | "retard" | "panne";
  delaiMs?: number;
  /** Brouillon à écrire AVANT le montage. */
  brouillon?: Record<string, unknown> | null;
  cheminsVideoConnus?: string[];
  /**
   * Comportement du TRANSPORT de synchronisation.
   *
   * `aucun` : pas de transport injecté — le hook prendrait celui de
   * production, qui ne peut rien faire ici (pas de Supabase configuré).
   */
  transport?: "aucun" | "succes" | "reseau" | "auth" | "metier" | "relecture_ko" | "course";
  /** Opération à déposer dans l'outbox AVANT le montage. */
  outbox?: { charge: string; operationId: string } | null;
  /** `false` : aucune identité locale — le flush ne doit rien envoyer. */
  avecIdentite?: boolean;
}

let racine: Root | null = null;
let depotCourant: DepotOffline | null = null;

/* ── LE TRANSPORT, PILOTÉ PAR LE TEST ──────────────────────────────────── */
const envois: WorkoutFeedbackPayload[] = [];
const relectures: string[] = [];

const FEEDBACK_SERVEUR = {
  id: "fb-serveur",
  studentId: ELEVE,
  type: "entrainement",
  sessionId: SEANCE,
  refLabel: "Haut du corps",
  date: DIMANCHE,
  performedAt: DIMANCHE,
  durationMinutes: 65,
  completed: true,
  rpe: 8,
  comment: "confirmé par le serveur",
  pain: "",
  exerciseEntries: [],
  videos: [],
  status: "a-traiter",
  coachReply: "",
} as unknown as AdminStudentFeedback;

function transportPour(config: ConfigMontage): Transport | undefined {
  const genre = config.transport ?? "aucun";
  if (genre === "aucun") return undefined;

  const reponse = (): ReponseServeur => {
    if (genre === "reseau") return { etat: "reseau", message: "hors ligne" };
    if (genre === "auth") return { etat: "auth" };
    if (genre === "metier") return { etat: "metier", message: "remplacement devenu invalide" };
    return { etat: "succes" };
  };

  return {
    async envoyer(payload) {
      envois.push(payload);
      if (genre === "course") {
        // La correction arrive PENDANT le POST — la course A → B, fabriquée.
        await depotCourant!.validerRetourHorsLigne({
          userId: USER,
          sessionId: SEANCE,
          businessDate: DIMANCHE,
          etatFormulaire: { ...FORMULAIRE_VIDE, globalComment: "correction B" },
          payloadServeur: { ...payload, globalComment: "correction B" },
          operationId: "op-ignore",
          maintenant: Date.now(),
        });
      }
      return reponse();
    },
    async relire(sessionId) {
      relectures.push(sessionId);
      if (genre === "relecture_ko") throw new Error("relecture impossible");
      return FEEDBACK_SERVEUR;
    },
  };
}

function depotPour(config: ConfigMontage): DepotOffline {
  const reel = MoteurIndexedDB.pourTests({ nomBase: config.nomBase, version: 1 });
  if (config.moteur === "panne") return new DepotOffline(moteurEnPanne());
  if (config.moteur === "retard") {
    return new DepotOffline(moteurRetarde(reel, config.delaiMs ?? 400));
  }
  return new DepotOffline(reel);
}

const harnais = {
  requetes: () => requetes,
  envois: () => envois.map((p) => ({ globalComment: p.globalComment, durationMinutes: p.durationMinutes })),
  relectures: () => relectures,

  /** Dépose une opération en attente AVANT le montage. */
  async semerOutbox(nomBase: string, charge: string, operationId: string) {
    const depot = new DepotOffline(MoteurIndexedDB.pourTests({ nomBase, version: 1 }));
    await depot.validerRetourHorsLigne({
      userId: USER,
      sessionId: SEANCE,
      businessDate: DIMANCHE,
      etatFormulaire: { ...FORMULAIRE_VIDE, globalComment: charge },
      payloadServeur: {
        studentId: ELEVE, sessionKey: SEANCE, sessionRefLabel: "Haut du corps",
        completed: true, globalRpe: 8, globalComment: charge, pain: "",
        exercises: [], sessionId: SEANCE, durationMinutes: 65, performedAt: DIMANCHE,
      } as unknown as WorkoutFeedbackPayload,
      operationId,
      maintenant: Date.now(),
    });
  },

  /** Écrit un brouillon AVANT montage, par le vrai dépôt. */
  async semerBrouillon(nomBase: string, payload: unknown, revision = 1) {
    const depot = new DepotOffline(MoteurIndexedDB.pourTests({ nomBase, version: 1 }));
    await depot.ecrireBrouillon({
      userId: USER,
      sessionId: SEANCE,
      businessDate: DIMANCHE,
      payload,
      maintenant: Date.now(),
      revision,
    });
  },

  async monter(config: ConfigMontage) {
    requetes.length = 0;
    envois.length = 0;
    relectures.length = 0;
    if (config.brouillon) {
      await harnais.semerBrouillon(config.nomBase, config.brouillon);
    }
    if (config.outbox) {
      await harnais.semerOutbox(config.nomBase, config.outbox.charge, config.outbox.operationId);
    }
    depotCourant = depotPour(config);
    const transport = transportPour(config);

    const hote = document.getElementById("racine")!;
    racine = createRoot(hote);
    racine.render(
      createElement(SessionFeedbackSection, {
        studentId: ELEVE,
        sessionId: SEANCE,
        programId: null,
        sessionRefLabel: "Haut du corps",
        exercises: EXERCICES,
        sessionMuscleGroup: "Pectoraux",
        source: "offline",
        businessDate: DIMANCHE,
        cheminsVideoConnus: config.cheminsVideoConnus ?? [],
        depot: depotCourant,
        authUserId: config.avecIdentite === false ? null : USER,
        ...(transport ? { transport } : {}),
      }),
    );
  },

  /** Ce que le dépôt contient RÉELLEMENT, relu à mains nues. */
  async etatDepot(nomBase: string) {
    const depot = new DepotOffline(MoteurIndexedDB.pourTests({ nomBase, version: 1 }));
    const brouillon = await depot.lireBrouillon(USER, SEANCE);
    const operation = await depot.lireOperation(USER, SEANCE);
    return {
      brouillon: brouillon ? { revision: brouillon.revision, payload: brouillon.payload } : null,
      operation: operation
        ? { revision: operation.revision, operationId: operation.operationId, payload: operation.payload }
        : null,
    };
  },

  demonter() {
    racine?.unmount();
    racine = null;
  },

  /**
   * REMONTAGE — la PWA tuée puis rouverte.
   *
   * Démonte l'arbre React et le reconstruit sur un dépôt NEUF visant la même
   * base : aucun état JavaScript ne survit, seul IndexedDB subsiste. C'est
   * exactement ce que fait un kill suivi d'une réouverture.
   */
  async remonter(config: ConfigMontage) {
    racine?.unmount();
    racine = null;
    document.getElementById("racine")!.innerHTML = "";
    await new Promise((ok) => setTimeout(ok, 50));
    envois.length = 0;
    relectures.length = 0;
    depotCourant = depotPour(config);
    const transport = transportPour(config);
    racine = createRoot(document.getElementById("racine")!);
    racine.render(
      createElement(SessionFeedbackSection, {
        studentId: ELEVE,
        sessionId: SEANCE,
        programId: null,
        sessionRefLabel: "Haut du corps",
        exercises: EXERCICES,
        sessionMuscleGroup: "Pectoraux",
        source: "offline",
        businessDate: DIMANCHE,
        cheminsVideoConnus: config.cheminsVideoConnus ?? [],
        depot: depotCourant,
        authUserId: config.avecIdentite === false ? null : USER,
        ...(transport ? { transport } : {}),
      }),
    );
  },

  /** Écrit une forme ARBITRAIRE dans `training_draft` — pour DRAFT10. */
  async semerDraftBrut(nomBase: string, payload: unknown) {
    const depot = new DepotOffline(MoteurIndexedDB.pourTests({ nomBase, version: 1 }));
    await depot.ecrireBrouillon({
      userId: USER, sessionId: SEANCE, businessDate: DIMANCHE,
      payload, maintenant: Date.now(), revision: 1,
    });
  },
};

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
