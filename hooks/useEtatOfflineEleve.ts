"use client";

import { useEffect, useMemo, useState } from "react";

import { DepotOffline } from "@/lib/offline/depot";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import { identiteDepuisSession, type IdentiteOffline } from "@/lib/offline/identite";
import { dateMetier } from "@/lib/offline/seance-du-jour";
import { lireSnapshotPourSeance, type ContenuSnapshot } from "@/lib/offline/snapshot-seance";
import { classerSource, diagnostiquer, type DiagnosticChargement } from "@/lib/offline/source-donnees";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * L'ÉTAT D'UN ÉCRAN ÉLÈVE QUAND LE SERVEUR N'A PAS RÉPONDU.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE HOOK EXISTE POUR FERMER
 * ════════════════════════════════════════════════════════════════════════
 * `useSupabaseTrainingProgram` rend `active: false` dès que
 * `getCurrentStudentId()` ne rend rien — et cette fonction rend `null` sur
 * TOUTE erreur, panne réseau comprise (`auth.getUser()` est une requête).
 * La page retombait donc, en avion, sur `data/student.ts` : « Force &
 * Hypertrophie », « Remise en route », une séance de démonstration et sa
 * progression inventée. Constaté sur iPhone le 09/08/2026.
 *
 * Le pire n'était pas l'affichage : c'était le LIEN. La carte du jour
 * pointait vers un identifiant de démonstration (`session-upper`), qui
 * n'est ni dans le cache du service worker, ni dans le snapshot — donc plus
 * rien ne correspondait ensuite.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'IL REND, ET CE QU'IL NE REND PAS
 * ════════════════════════════════════════════════════════════════════════
 * Uniquement la SÉANCE DU JOUR, telle qu'elle a été préparée en ligne. Pas
 * les programmes, pas la progression, pas l'historique : rien de tout cela
 * n'est dans le snapshot, et l'inventer serait exactement le défaut qu'on
 * corrige. Les sections qui ont besoin du serveur restent vides, et le
 * disent.
 *
 * Même discipline que `useSeanceHorsLigne` : il n'arbitre rien. C'est
 * `diagnostiquer` + `classerSource` qui tranchent, et `mock` n'est atteint
 * que si `createSupabaseBrowserClient()` ne rend rien.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN SEUL DIAGNOSTIC POUR TOUS LES ÉCRANS ÉLÈVE
 * ════════════════════════════════════════════════════════════════════════
 * /entrainement, /dashboard et /entrainement/[programId] posent la MÊME
 * question — « pourquoi le chargement n'a-t-il rien donné ? » — et doivent y
 * répondre de la même façon. Trois détections de réseau différentes, c'est
 * trois occasions de diverger. Il n'y en a qu'une, et elle est ici.
 *
 * Chaque écran décide ensuite QUOI MONTRER de son côté : la séance du jour
 * ne sert qu'à celui qui sait l'afficher, les autres se contentent de
 * l'état.
 */

export type EtatOfflineEleve =
  | "chargement"
  | "offline"
  /** Compte réel, mais rien d'exploitable sur cet appareil. */
  | "indisponible"
  /** Le serveur a répondu, et sa réponse est un refus ou un échec. */
  | "erreur"
  /** Environnement de démonstration assumé — jamais un vrai compte. */
  | "mock";

export interface ResultatOfflineEleve {
  etat: EtatOfflineEleve;
  diagnostic: DiagnosticChargement | null;
  /** La séance du jour, telle que l'écran de séance la lira. */
  contenu: ContenuSnapshot | null;
  /**
   * L'identifiant EXACT porté par le snapshot.
   *
   * C'est LUI que le lien de la carte du jour doit utiliser — pas
   * `contenu.session.id` recopié ailleurs, pas un identifiant reconstruit :
   * c'est cette clé que le service worker a mise en cache et que
   * `lireSnapshotPourSeance` exigera à l'ouverture.
   */
  sessionId: string | null;
  identite: IdentiteOffline | null;
  businessDate: string;
}

export function useEtatOfflineEleve(enquerir: boolean): ResultatOfflineEleve {
  const depot = useMemo(() => new DepotOffline(new MoteurIndexedDB()), []);
  const [resultat, setResultat] = useState<ResultatOfflineEleve>({
    etat: "chargement",
    diagnostic: null,
    contenu: null,
    sessionId: null,
    identite: null,
    businessDate: dateMetier(),
  });

  useEffect(() => {
    // Tant que le chargement en ligne n'a pas rendu son verdict, il n'y a
    // rien à diagnostiquer — et surtout aucune requête à payer en double.
    if (!enquerir) return;

    let annule = false;
    const aujourdhui = dateMetier();

    void (async () => {
      const client = createSupabaseBrowserClient();
      if (!client) {
        const diagnostic = diagnostiquer({ clientDisponible: false, sessionLocale: false });
        if (!annule) {
          setResultat({
            etat: classerSource(diagnostic) === "mock" ? "mock" : "indisponible",
            diagnostic,
            contenu: null,
            sessionId: null,
            identite: null,
            businessDate: aujourdhui,
          });
        }
        return;
      }

      // Identité LOCALE : `getSession()` lit ce qui est déjà persisté, sans
      // requête. C'est la seule lecture qui réponde en avion.
      const { data } = await client.auth.getSession();
      const identite = identiteDepuisSession(data?.session ?? null);

      let erreur: unknown;
      let ficheEleve: boolean | null = null;
      if (identite) {
        const { data: fiche, error } = await client
          .from("students")
          .select("id")
          .eq("user_id", identite.userId)
          .maybeSingle();
        if (error) {
          erreur = error;
        } else {
          ficheEleve = Boolean(fiche);
        }
      }

      const diagnostic = diagnostiquer({
        clientDisponible: true,
        sessionLocale: identite !== null,
        erreur,
        ficheEleve,
      });
      const source = classerSource(diagnostic);

      if (source === "offline" && identite) {
        let contenu: ContenuSnapshot | null = null;
        let sessionId: string | null = null;
        try {
          const snapshot = await depot.lireSnapshot(identite.userId, aujourdhui);
          if (snapshot) {
            // On repasse par le MÊME lecteur que l'écran de séance, avec
            // l'identifiant que porte le snapshot : forme, compte et date
            // sont vérifiés par le code déjà éprouvé, pas ici.
            const lecture = lireSnapshotPourSeance(snapshot, {
              userId: identite.userId,
              sessionId: snapshot.sessionId,
              aujourdhui,
            });
            if (lecture.contenu) {
              contenu = lecture.contenu;
              sessionId = snapshot.sessionId;
            }
          }
        } catch {
          contenu = null;
        }
        if (!annule) {
          // `offline` DÈS QUE le transport est en panne, snapshot ou pas.
          //
          // La version précédente rendait `indisponible` quand le dépôt était
          // vide — ce qui revenait à dire « ton compte n'est pas configuré »
          // à quelqu'un qui était simplement dans le métro. Les écrans qui
          // n'ont rien à lire dans le snapshot (nutrition, documents) n'ont
          // pas à connaître son existence pour dire la vérité sur le réseau.
          //
          // Ce qui manque est porté par `contenu: null`, pas par l'état.
          setResultat({
            etat: "offline",
            diagnostic,
            contenu,
            sessionId,
            identite,
            businessDate: aujourdhui,
          });
        }
        return;
      }

      if (!annule) {
        setResultat({
          etat: source === "mock" ? "mock" : source === "erreur" ? "erreur" : "indisponible",
          diagnostic,
          contenu: null,
          sessionId: null,
          identite,
          businessDate: aujourdhui,
        });
      }
    })();

    return () => {
      annule = true;
    };
  }, [depot, enquerir]);

  return resultat;
}
