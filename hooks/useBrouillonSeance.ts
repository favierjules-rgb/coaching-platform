"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DepotOffline } from "@/lib/offline/depot";
import { creerPlanificateurBrouillon } from "@/lib/offline/brouillon-differe";
import { MoteurIndexedDB } from "@/lib/offline/idb";

/**
 * LE BROUILLON DE SÉANCE — UNE COQUILLE, ET RIEN DE PLUS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE HOOK NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne calcule aucune révision, n'arbitre aucun conflit, ne vérifie aucune
 * appartenance de compte et n'ouvre aucune transaction. Tout cela existe
 * déjà, testé, dans `DepotOffline` et `creerPlanificateurBrouillon`. Ce
 * fichier ne fait que les brancher sur le cycle de vie React.
 *
 * C'est une contrainte délibérée : ce qui vit ici ne peut être vérifié que
 * sur un vrai appareil. Ce qui vit dans les modules purs est vérifié dans
 * Node, à chaque exécution de la suite. Moins il y a de décisions ici, plus
 * la garantie est solide.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉMONTAGE N'EST PAS UN DÉTAIL
 * ════════════════════════════════════════════════════════════════════════
 * Quitter l'écran avec une frappe non enregistrée la perdrait. On vide donc
 * le différé au démontage — mais sans jamais rien écrire APRÈS une
 * validation finale : `abandonner()` est ce que le composant appelle avant
 * de soumettre, et la garde de révision du dépôt reste le dernier filet.
 */

export interface EtatBrouillon<T> {
  /** `true` tant que la restauration n'a pas abouti. */
  chargement: boolean;
  /** Le brouillon restauré pour CE compte et CETTE séance, ou `null`. */
  restaure: T | null;
  /** Révision du brouillon restauré — 0 s'il n'y en avait pas. */
  revision: number;
  /** Le stockage local est-il hors service ? (l'écran continue quand même) */
  indisponible: boolean;
}

export interface OptionsBrouillon {
  /** Id Auth — clé d'isolation. `null` ⇒ le hook ne lit ni n'écrit RIEN. */
  userId: string | null;
  sessionId: string;
  /** Date métier de la séance, figée à la première écriture. */
  businessDate: string;
  delaiMs?: number;
  /** Injectable pour les tests ; en production, le vrai moteur IndexedDB. */
  depot?: DepotOffline;
}

export function useBrouillonSeance<T>(options: OptionsBrouillon) {
  const { userId, sessionId, businessDate } = options;

  const depot = useMemo(
    () => options.depot ?? new DepotOffline(new MoteurIndexedDB()),
    [options.depot],
  );

  const [etat, setEtat] = useState<EtatBrouillon<T>>({
    chargement: true,
    restaure: null,
    revision: 0,
    indisponible: false,
  });

  // La révision de départ doit être connue AVANT la première écriture
  // différée, sinon le planificateur repartirait de 1 et ses écritures
  // seraient refusées par la garde du dépôt jusqu'à rattraper l'existant.
  const revisionInitiale = useRef(0);
  const planificateur = useRef<ReturnType<typeof creerPlanificateurBrouillon> | null>(null);

  /* ── RESTAURATION ────────────────────────────────────────────────────
   * `lireBrouillon` ne rend que ce qui appartient à CE compte et à CETTE
   * séance : la clé le garantit, et `estCompatible` le revérifie au
   * contenu. Le hook n'ajoute aucun filtre — il en ajouterait un de trop,
   * qui finirait par diverger du dépôt. */
  useEffect(() => {
    let annule = false;
    // Tout passe par l'IIFE asynchrone, y compris le cas « pas de compte » :
    // un `setState` synchrone dans le corps d'un effet déclenche un rendu en
    // cascade, et React le signale à juste titre.
    (async () => {
      if (!userId) {
        if (!annule) {
          setEtat({ chargement: false, restaure: null, revision: 0, indisponible: false });
        }
        return;
      }
      try {
        const brouillon = await depot.lireBrouillon(userId, sessionId);
        if (annule) return;
        revisionInitiale.current = brouillon?.revision ?? 0;
        setEtat({
          chargement: false,
          restaure: (brouillon?.payload as T | undefined) ?? null,
          revision: brouillon?.revision ?? 0,
          indisponible: false,
        });
      } catch {
        if (annule) return;
        // Stockage local hors service : l'écran continue, simplement sans
        // restauration. Ce n'est pas une panne de l'application.
        revisionInitiale.current = 0;
        setEtat({ chargement: false, restaure: null, revision: 0, indisponible: true });
      }
    })();
    return () => {
      annule = true;
    };
  }, [depot, userId, sessionId]);

  /* ── PLANIFICATEUR ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!userId || etat.chargement) {
      planificateur.current = null;
      return;
    }
    const instance = creerPlanificateurBrouillon({
      revisionInitiale: revisionInitiale.current,
      delaiMs: options.delaiMs,
      ecrire: async (payload, revision) => {
        try {
          return await depot.ecrireBrouillon({
            userId,
            sessionId,
            businessDate,
            payload,
            maintenant: Date.now(),
            revision,
          });
        } catch {
          // Une sauvegarde locale impossible ne doit pas casser la saisie.
          // Le retour final, lui, dira la vérité (voir `soumettreRetour`).
          setEtat((precedent) => ({ ...precedent, indisponible: true }));
          return false;
        }
      },
    });
    planificateur.current = instance;
    return () => {
      // Le démontage vide ce qui attend : quitter l'écran ne doit pas
      // coûter la dernière frappe.
      void instance.viderMaintenant();
      planificateur.current = null;
    };
  }, [depot, userId, sessionId, businessDate, etat.chargement, options.delaiMs]);

  const enregistrer = useCallback((payload: T) => {
    planificateur.current?.planifier(payload);
  }, []);

  /**
   * À appeler AVANT toute validation finale.
   *
   * La validation écrit elle-même le brouillon définitif, dans la même
   * transaction que l'opération à envoyer. Un différé antérieur est donc
   * périmé par construction : on l'abandonne, on ne le vide pas.
   */
  const abandonnerDiffere = useCallback(() => {
    planificateur.current?.abandonner();
  }, []);

  /**
   * Efface le brouillon local — APRÈS un envoi serveur réussi, et seulement
   * là.
   *
   * Le serveur fait alors foi : garder le brouillon ferait gagner la
   * priorité « cas C » à la prochaine ouverture avec une version périmée.
   *
   * BEST-EFFORT ASSUMÉ : la promesse ne rejette jamais. Un effacement local
   * impossible après un POST réussi n'est pas une erreur pour l'élève — son
   * retour EST enregistré.
   */
  const purger = useCallback(async () => {
    if (!userId) return;
    try {
      await depot.supprimerBrouillon(userId, sessionId);
    } catch {
      // Volontairement silencieux : voir ci-dessus.
    }
  }, [depot, userId, sessionId]);

  return { ...etat, depot, enregistrer, abandonnerDiffere, purger };
}
