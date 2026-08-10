"use client";

import { useEffect, useState } from "react";

import { DepotOffline } from "@/lib/offline/depot";
import { identiteDepuisSession } from "@/lib/offline/identite";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import type { TypeAcces } from "@/lib/offline/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentAccessType } from "@/lib/supabase/current-student";

/**
 * `access_type` du compte élève connecté — « coaching » (défaut) ou
 * « programme_seul ». Utilisé par `StudentSidebar` pour masquer les entrées
 * de menu hors périmètre d'un compte programme_seul.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE N'EST PAS, ET NE DEVIENDRA JAMAIS, UNE AUTORISATION
 * ════════════════════════════════════════════════════════════════════════
 * Cette valeur ne sert qu'à décider quelles entrées de menu DESSINER. Elle
 * ne garde aucune route, ne filtre aucune donnée, ne remplace aucune
 * politique RLS. `requireCoachingFeature`, `requireEntrainementAccess` et
 * les politiques Supabase restent l'autorité entière — un compte qui
 * modifierait la valeur sur son propre téléphone verrait simplement
 * apparaître des entrées de menu qui le redirigeraient toutes.
 *
 * Un garde-fou statique (`scripts/tests/garde-fous-affichage.mts`) échoue
 * si `display_prefs` ou `lireTypeAcces` apparaît dans un fichier de garde,
 * de route ou d'API.
 *
 * ════════════════════════════════════════════════════════════════════════
 * HORS LIGNE, LE MENU DOIT ÊTRE LE MÊME
 * ════════════════════════════════════════════════════════════════════════
 * Sans réseau, la requête ne répond pas. Sans mémoire, le hook retomberait
 * sur son défaut « coaching » et un compte programme_seul verrait
 * apparaître sept entrées au lieu de deux. Ce n'est pas une fuite — les
 * gardes serveur redirigent toujours — mais ce n'est pas le produit
 * demandé.
 *
 * D'où la mémorisation : la valeur RÉSOLUE EN LIGNE est écrite dans
 * `display_prefs`, scindée par compte, et relue quand le réseau manque.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ET SI RIEN N'A JAMAIS ÉTÉ MÉMORISÉ
 * ════════════════════════════════════════════════════════════════════════
 * On retombe sur « coaching », le défaut historique — JAMAIS sur la
 * préférence d'un autre compte : `lireTypeAcces` exige l'identifiant, et il
 * n'existe aucune lecture « la dernière préférence disponible ».
 *
 * Conséquence assumée : un compte programme_seul qui n'aurait jamais chargé
 * l'application en ligne verrait, hors ligne, le menu complet. Dans le
 * parcours réel, la préférence est écrite au premier chargement en ligne —
 * c'est-à-dire avant toute perte de réseau.
 */
export function useSupabaseAccessType(options?: {
  /** Injectable pour les tests ; en production, le vrai moteur IndexedDB. */
  depot?: DepotOffline;
  /** Injectable pour les tests ; en production, la session locale Supabase. */
  identite?: () => Promise<string | null>;
  /** Injectable pour les tests ; en production, la requête Supabase. */
  resoudreEnLigne?: () => Promise<TypeAcces>;
}): TypeAcces {
  const [accessType, setAccessType] = useState<TypeAcces>("coaching");

  useEffect(() => {
    let annule = false;
    (async () => {
      const client = createSupabaseBrowserClient();
      const resoudre = options?.resoudreEnLigne;
      // Ni client, ni résolution, ni identité connue : environnement de
      // démonstration. Comportement historique inchangé — on ne va surtout
      // pas fouiller le stockage pour trouver « quelqu'un ».
      if (!client && !resoudre && !options?.identite) return;

      const depot = options?.depot ?? new DepotOffline(new MoteurIndexedDB());
      const userId = options?.identite
        ? await options.identite()
        : client
          ? identiteDepuisSession((await client.auth.getSession()).data?.session ?? null)?.userId ?? null
          : null;

      try {
        // Sans résolution possible, on passe directement à la mémoire
        // locale : c'est le cas HORS LIGNE.
        if (!resoudre && !client) throw new Error("aucune résolution en ligne disponible");
        const resolu = resoudre ? await resoudre() : await getCurrentStudentAccessType(client!);
        if (annule) return;
        setAccessType(resolu);
        // ── MÉMORISATION, BEST-EFFORT ────────────────────────────────
        // Uniquement après une vraie résolution en ligne, et jamais une
        // valeur inventée : `ecrireTypeAcces` refuse déjà tout ce qui n'est
        // pas un `TypeAcces` connu. Un échec d'écriture ne change rien au
        // menu affiché maintenant.
        if (userId) {
          try {
            await depot.ecrireTypeAcces(userId, resolu, Date.now());
          } catch {
            /* stockage indisponible : le menu en ligne fonctionne quand même */
          }
        }
      } catch {
        // ── PAS DE RÉSEAU : ON RELIT CE QU'ON AVAIT MÉMORISÉ ─────────
        if (annule || !userId) return;
        try {
          const memorise = await depot.lireTypeAcces(userId);
          if (!annule && memorise) setAccessType(memorise);
        } catch {
          /* rien de mémorisé, ou stockage HS : on garde le défaut */
        }
      }
    })();
    return () => {
      annule = true;
    };
  }, [options]);

  return accessType;
}
