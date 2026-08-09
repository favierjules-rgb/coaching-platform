"use client";

import { useCallback, useState } from "react";

import { DepotOffline } from "@/lib/offline/depot";
import {
  deconnecterEnConservantLesEnvois,
  preparerDeconnexion,
  type DecisionDeconnexion,
} from "@/lib/offline/deconnexion";
import { identiteDepuisSession } from "@/lib/offline/identite";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * LA DÉCONNEXION — ET CE QU'ELLE N'A PAS LE DROIT D'EMPORTER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS ISSUES, ET UNE SEULE EST AUTOMATIQUE
 * ════════════════════════════════════════════════════════════════════════
 *   • RIEN EN ATTENTE → purge complète du compte, sans question. Un
 *     téléphone peut servir à deux élèves ; ce qui reste après un départ
 *     doit être nul.
 *
 *   • QUELQUE CHOSE EN ATTENTE → on s'arrête et on DEMANDE. Une opération
 *     en attente n'est pas un cache : c'est une séance réellement faite que
 *     le serveur n'a jamais reçue. La purger reviendrait à effacer le
 *     travail de quelqu'un pour tenir une promesse d'hygiène — sans que
 *     l'élève voie rien.
 *
 *   • LE STOCKAGE NE RÉPOND PAS → on se déconnecte quand même, et on ne
 *     prétend PAS avoir purgé. Rester connecté de force parce qu'IndexedDB
 *     est en panne serait pire : l'élève ne pourrait plus quitter son
 *     compte sur un téléphone partagé.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI SURVIT À UNE DÉCONNEXION CONFIRMÉE
 * ════════════════════════════════════════════════════════════════════════
 * Uniquement ce qui sert à la reprise : l'outbox en attente, et les
 * brouillons des séances concernées. Le snapshot et la préférence
 * d'affichage partent — ils se reconstruisent en une requête à la
 * reconnexion, et `display_prefs` n'a jamais rien à voir avec la
 * synchronisation.
 */

export interface OptionsDeconnexion {
  /** Injectable pour les tests ; en production, le vrai moteur IndexedDB. */
  depot?: DepotOffline;
  /** Injectable pour les tests ; en production, la session locale Supabase. */
  identite?: () => Promise<string | null>;
  /** Injectable pour les tests ; en production, `supabase.auth.signOut()`. */
  signOut?: () => Promise<void>;
}

export type EtatDeconnexion =
  | { phase: "repos" }
  /** Une confirmation est nécessaire — RIEN n'a encore été supprimé, RIEN n'a été déconnecté. */
  | { phase: "confirmation"; sessions: { sessionId: string; businessDate: string | null }[] }
  | { phase: "en_cours" };

async function identiteParDefaut(): Promise<string | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return identiteDepuisSession(data?.session ?? null)?.userId ?? null;
}

async function signOutParDefaut(): Promise<void> {
  const client = createSupabaseBrowserClient();
  if (client) await client.auth.signOut();
}

export function useDeconnexionOffline(options: OptionsDeconnexion = {}) {
  const [etat, setEtat] = useState<EtatDeconnexion>({ phase: "repos" });
  const depot = options.depot ?? null;
  const identite = options.identite ?? identiteParDefaut;
  const signOut = options.signOut ?? signOutParDefaut;

  const obtenirDepot = useCallback(
    () => depot ?? new DepotOffline(new MoteurIndexedDB()),
    [depot],
  );

  /**
   * Premier temps : décider. Rend `true` si la déconnexion peut se faire
   * TOUT DE SUITE, `false` si une confirmation est nécessaire.
   */
  const demanderDeconnexion = useCallback(async (): Promise<boolean> => {
    const userId = await identite();
    if (!userId) {
      // Aucune identité locale : il n'y a rien à purger, et surtout rien à
      // deviner. On ne va pas chercher « le dernier compte connu ».
      return true;
    }
    let decision: DecisionDeconnexion;
    try {
      decision = await preparerDeconnexion(obtenirDepot(), userId);
    } catch {
      // Stockage illisible : on ne SAIT pas s'il reste quelque chose. On
      // laisse partir — sans annoncer une purge qui n'a pas eu lieu.
      return true;
    }
    if (decision.etat === "purge") return true;
    setEtat({ phase: "confirmation", sessions: decision.operations });
    return false;
  }, [identite, obtenirDepot]);

  /** L'élève a été prévenu et part quand même. */
  const confirmerDeconnexion = useCallback(async (): Promise<void> => {
    setEtat({ phase: "en_cours" });
    const userId = await identite();
    if (userId) {
      try {
        // Conserve l'outbox et les brouillons qui s'y rattachent ; efface
        // le snapshot et `display_prefs`.
        await deconnecterEnConservantLesEnvois(obtenirDepot(), userId);
      } catch {
        // Voir plus haut : une purge impossible ne retient personne.
      }
    }
    await signOut();
  }, [identite, obtenirDepot, signOut]);

  const annuler = useCallback(() => setEtat({ phase: "repos" }), []);

  /** Déconnexion immédiate, quand `demanderDeconnexion` a rendu `true`. */
  const deconnecter = useCallback(async (): Promise<void> => {
    setEtat({ phase: "en_cours" });
    await signOut();
  }, [signOut]);

  return { etat, demanderDeconnexion, confirmerDeconnexion, deconnecter, annuler };
}
