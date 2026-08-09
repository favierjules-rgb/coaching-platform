"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { DepotOffline } from "@/lib/offline/depot";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import { identiteDepuisSession } from "@/lib/offline/identite";
import { classerErreur } from "@/lib/offline/source-donnees";
import {
  synchroniser,
  type BilanSynchronisation,
  type ReponseServeur,
  type Transport,
} from "@/lib/offline/synchronisateur";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getWorkoutFeedbackBySession } from "@/lib/supabase/workout-feedback";
import { corpsPourServeur } from "@/lib/workout-feedback-payload";
import type { AdminStudentFeedback } from "@/types";

/**
 * LA SYNCHRONISATION AUTOMATIQUE — QUATRE DÉCLENCHEURS, UN SEUL FLUSH.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE HOOK N'ORCHESTRE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * L'ordonnancement — capturer, envoyer, relire, acquitter sous condition —
 * vit dans `lib/offline/synchronisateur.ts`, testé dans Node. Ici il n'y a
 * que trois choses : ÉCOUTER les bons événements, retrouver l'identité
 * locale, et appeler.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI QUATRE DÉCLENCHEURS, ET PAS BACKGROUND SYNC
 * ════════════════════════════════════════════════════════════════════════
 * `online` seul ne suffit pas : iOS ne l'émet pas toujours au retour d'un
 * tunnel, et une application relancée après un kill n'a jamais quitté
 * l'état « hors ligne » de son point de vue. `visibilitychange` rattrape le
 * retour d'arrière-plan ; le montage de l'espace élève rattrape le
 * redémarrage ; le montage de la séance rattrape l'ouverture directe d'une
 * URL. Ensemble, ils couvrent les chemins par lesquels un élève revient
 * réellement dans l'application.
 *
 * Background Sync aurait été plus élégant — et absent de Safari iOS, c'est-
 * à-dire précisément de l'appareil visé.
 *
 * ════════════════════════════════════════════════════════════════════════
 * QUATRE ÉVÉNEMENTS, UN SEUL ENVOI
 * ════════════════════════════════════════════════════════════════════════
 * Sortir du métro déclenche facilement `online`, `visibilitychange` et un
 * remontage dans la même seconde. Le verrou PAR COMPTE de `synchroniser()`
 * absorbe la rafale : les appels surnuméraires rendent `deja_en_cours` sans
 * rien envoyer. Rien n'est réimplémenté ici.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ET AUCUNE BOUCLE
 * ════════════════════════════════════════════════════════════════════════
 * Un flush met à jour la copie locale, donc l'état React, donc provoque un
 * rendu. Si ce rendu réenclenchait un flush, l'application enverrait des
 * requêtes indéfiniment. Deux garde-fous : `flusher` est stable (aucune
 * dépendance changeante), et les écouteurs sont posés UNE fois. Un dépôt
 * vide rend `rien_a_faire` sans toucher au réseau.
 */

export interface OptionsSynchronisation {
  /** Injectable pour les tests ; en production, le vrai moteur IndexedDB. */
  depot?: DepotOffline;
  /** Injectable pour les tests ; en production, le chemin serveur existant. */
  transport?: Transport;
  /** Injectable pour les tests ; en production, la session locale Supabase. */
  identite?: () => Promise<string | null>;
  /** `false` désactive tout — utilisé quand l'écran n'a pas de compte. */
  actif?: boolean;
  /** Appelé après CHAQUE flush, quelle qu'en soit l'issue. */
  surFlush?: (bilan: BilanSynchronisation) => void;
  /** SERVER WINS — l'état relu du serveur, pour reconstruire la copie locale. */
  surEtatServeur?: (sessionId: string, feedback: AdminStudentFeedback | null) => void;
}

/* ════════════════════════════════════════════════════════════════════════
 * LE TRANSPORT DE PRODUCTION
 * ════════════════════════════════════════════════════════════════════════
 * Le chemin serveur EXISTANT, et rien d'autre : même route, même corps que
 * l'envoi immédiat (`corpsPourServeur`), donc mêmes validations, mêmes
 * déclencheurs, mêmes colonnes protégées. Aucun `service_role`, aucune
 * route « offline ».
 */
const transportParDefaut: Transport = {
  async envoyer(payload): Promise<ReponseServeur> {
    let reponse: Response;
    try {
      reponse = await fetch("/api/student/workout-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpsPourServeur(payload)),
      });
    } catch (erreur) {
      // Seul un échec de TRANSPORT arrive ici : le serveur n'a pas répondu.
      return classerErreur(erreur) === "reseau"
        ? { etat: "reseau", message: "réseau indisponible" }
        : { etat: "metier", message: "envoi impossible" };
    }
    if (reponse.ok) return { etat: "succes" };
    // 401 : la session a expiré — on conserve l'outbox et on s'arrête.
    if (reponse.status === 401) return { etat: "auth" };
    // Tout le reste est un REFUS compris du serveur (403, 400, 500…) : il
    // sera consigné dans `attempts`/`lastError`, jamais effacé.
    return { etat: "metier", message: `refus du serveur (${reponse.status})` };
  },

  async relire(sessionId): Promise<AdminStudentFeedback | null> {
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error("client Supabase indisponible");
    const studentId = await getCurrentStudentId(client);
    // LEVER, et non rendre `null` : `null` signifie « le serveur n'a pas de
    // retour », ce qui autoriserait l'acquittement. Ici on ne SAIT pas.
    if (!studentId) throw new Error("fiche élève introuvable");
    return getWorkoutFeedbackBySession(client, studentId, sessionId);
  },
};

/** L'identité locale, lue sans aucun appel réseau. */
async function identiteParDefaut(): Promise<string | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return identiteDepuisSession(data?.session ?? null)?.userId ?? null;
}

export function useSynchronisation(options: OptionsSynchronisation = {}) {
  const actif = options.actif !== false;

  const depot = useMemo(
    () => options.depot ?? new DepotOffline(new MoteurIndexedDB()),
    [options.depot],
  );
  const transport = options.transport ?? transportParDefaut;

  /* Les rappels du parent changent d'identité à chaque rendu. Les garder
   * dans des refs est ce qui rend `flusher` stable — et donc ce qui empêche
   * la boucle « flush → rendu → flush ». */
  const transportRef = useRef(transport);
  const surFlushRef = useRef(options.surFlush);
  const surEtatServeurRef = useRef(options.surEtatServeur);
  const identiteRef = useRef(options.identite ?? identiteParDefaut);

  /* Mise à jour APRÈS le rendu, jamais pendant : écrire dans une ref en
   * cours de rendu est ce que `react-hooks/refs` interdit à juste titre.
   * Cet effet est déclaré en PREMIER — les effets s'exécutent dans l'ordre
   * de déclaration, donc les rappels sont à jour avant que le déclencheur
   * de montage, plus bas, ne parte. */
  useEffect(() => {
    transportRef.current = transport;
    surFlushRef.current = options.surFlush;
    surEtatServeurRef.current = options.surEtatServeur;
    identiteRef.current = options.identite ?? identiteParDefaut;
  });

  const flusher = useCallback(async () => {
    // ── L'IDENTITÉ D'ABORD, TOUJOURS ────────────────────────────────
    // Sans compte identifié, il n'y a rien à envoyer — et surtout, on ne
    // devine pas à qui appartient ce qui traîne dans le dépôt. Le compte B
    // ne peut donc pas expédier l'outbox de A : `synchroniser()` ne sait
    // lire que les opérations du `userId` qu'on lui donne.
    const userId = await identiteRef.current();
    if (!userId) return;

    const bilan = await synchroniser({
      depot,
      userId,
      transport: transportRef.current,
      surEtatServeur: (sessionId, feedback) => {
        surEtatServeurRef.current?.(sessionId, feedback);
      },
    });
    surFlushRef.current?.(bilan);
  }, [depot]);

  /* ── LES QUATRE DÉCLENCHEURS ─────────────────────────────────────────
   * Posés UNE fois. `flusher` ne dépend que du dépôt, lui-même mémorisé :
   * un rendu provoqué par la synchronisation ne repose pas les écouteurs et
   * ne relance donc aucun envoi. */
  useEffect(() => {
    if (!actif || typeof window === "undefined") return;

    // 1 & 4 — montage : espace élève au démarrage, ou ouverture de la séance.
    void flusher();

    // 2 — le réseau revient.
    const auRetourDuReseau = () => void flusher();
    window.addEventListener("online", auRetourDuReseau);

    // 3 — l'application repasse au premier plan (retour d'arrière-plan iOS).
    const auRetourAuPremierPlan = () => {
      if (document.visibilityState === "visible") void flusher();
    };
    document.addEventListener("visibilitychange", auRetourAuPremierPlan);

    return () => {
      window.removeEventListener("online", auRetourDuReseau);
      document.removeEventListener("visibilitychange", auRetourAuPremierPlan);
    };
  }, [actif, flusher]);

  return { flusher };
}
