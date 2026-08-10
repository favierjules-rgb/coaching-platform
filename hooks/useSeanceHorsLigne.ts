"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DepotOffline } from "@/lib/offline/depot";
import { MoteurIndexedDB } from "@/lib/offline/idb";
import { identiteDepuisSession, type IdentiteOffline } from "@/lib/offline/identite";
import {
  assemblerSnapshot,
  charge,
  fichesRemplacables,
  lireSnapshotPourSeance,
  manque,
  type ContenuSnapshot,
} from "@/lib/offline/snapshot-seance";
import { dateMetier } from "@/lib/offline/seance-du-jour";
import {
  classerSource,
  diagnostiquer,
  type DiagnosticChargement,
} from "@/lib/offline/source-donnees";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listExerciseSubstitutes } from "@/lib/supabase/exercise-substitutes";
import { getAssignedProgramsForStudent } from "@/lib/supabase/programs";
import {
  getWorkoutFeedbackBySession,
  getWorkoutFeedbackForStudent,
} from "@/lib/supabase/workout-feedback";
import { toEleveWorkoutSession } from "@/lib/training-schedule";
import type { AdminStudentFeedback, ExerciseSubstituteOption } from "@/types";
import type { TypeAcces } from "@/lib/offline/schema";

/**
 * LA SÉANCE — EN LIGNE, HORS LIGNE, OU RIEN DU TOUT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL N'ARBITRE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Ce hook charge, observe, et TRANSMET ce qu'il a observé aux modules purs.
 * La question « faut-il basculer hors ligne ou afficher une erreur ? » est
 * tranchée par `diagnostiquer` + `classerSource`, dans `source-donnees.ts`,
 * et vérifiée dans Node. La question « ce snapshot est-il servable ? » est
 * tranchée par `lireSnapshotPourSeance`. La question « ce chargement est-il
 * complet ? » est tranchée par `assemblerSnapshot`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN VRAI COMPTE NE VOIT JAMAIS LA DÉMONSTRATION
 * ════════════════════════════════════════════════════════════════════════
 * `mock` n'est rendu que si `createSupabaseBrowserClient()` ne rend rien —
 * c'est-à-dire si l'environnement n'est pas configuré. Une session expirée,
 * un compte sans fiche élève, un 500, une erreur illisible : chacun a son
 * état. Aucun ne mène à `data/student.ts`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE SNAPSHOT EST UN BONUS, JAMAIS UNE CONDITION
 * ════════════════════════════════════════════════════════════════════════
 * En ligne, l'écriture du snapshot est du « best-effort » : si IndexedDB
 * est absent ou refuse, l'écran continue exactement comme avant. Le mode
 * hors ligne disparaît, il est SIGNALÉ (`cacheIndisponible`), et rien
 * d'autre ne change. L'application en ligne n'a jamais eu besoin de
 * stockage local et ne commence pas ici.
 */

export type EtatSeance =
  | "chargement"
  | "online"
  | "offline"
  /** Compte réel sans données exploitables : non authentifié, ou sans fiche élève. */
  | "indisponible"
  /** Le serveur a répondu, et sa réponse est un refus ou un échec. */
  | "erreur"
  /** Environnement de démonstration assumé — jamais un vrai compte. */
  | "mock";

export interface ResultatSeance {
  etat: EtatSeance;
  /** Le diagnostic brut, pour un message précis à l'écran. */
  diagnostic: DiagnosticChargement | null;
  /** Le contenu à afficher — présent en `online` et en `offline`, jamais ailleurs. */
  contenu: ContenuSnapshot | null;
  identite: IdentiteOffline | null;
  /** Date métier retenue pour cette séance. */
  businessDate: string;
  /** Le stockage local a refusé d'écrire le snapshot. N'empêche rien en ligne. */
  cacheIndisponible: boolean;
  /** Options de remplacement lisibles sans réseau (issues du snapshot). */
  chargerRemplacants: (exerciseLibraryId: string) => Promise<ExerciseSubstituteOption[]>;
  recharger: () => void;
}

export function useSeanceHorsLigne(sessionId: string): ResultatSeance {
  const depot = useMemo(() => new DepotOffline(new MoteurIndexedDB()), []);
  const [tour, setTour] = useState(0);
  const [resultat, setResultat] = useState<{
    etat: EtatSeance;
    diagnostic: DiagnosticChargement | null;
    contenu: ContenuSnapshot | null;
    identite: IdentiteOffline | null;
    businessDate: string;
    cacheIndisponible: boolean;
  }>({
    etat: "chargement",
    diagnostic: null,
    contenu: null,
    identite: null,
    businessDate: dateMetier(),
    cacheIndisponible: false,
  });

  useEffect(() => {
    let annule = false;
    const aujourdhui = dateMetier();

    (async () => {
      const client = createSupabaseBrowserClient();
      if (!client) {
        // SEUL chemin vers la démonstration.
        const diagnostic = diagnostiquer({ clientDisponible: false, sessionLocale: false });
        if (!annule) {
          setResultat({
            etat: classerSource(diagnostic) === "mock" ? "mock" : "indisponible",
            diagnostic,
            contenu: null,
            identite: null,
            businessDate: aujourdhui,
            cacheIndisponible: false,
          });
        }
        return;
      }

      // ── IDENTITÉ LOCALE ────────────────────────────────────────────
      // `getSession()` lit la session DÉJÀ persistée : aucune requête, donc
      // une réponse même en avion. Ni `getUser()` (qui interroge le
      // serveur), ni `getCurrentStudentId()` (qui fait un SELECT).
      const { data: donneesSession } = await client.auth.getSession();
      const identite = identiteDepuisSession(donneesSession?.session ?? null);

      // ── CHARGEMENT SERVEUR ─────────────────────────────────────────
      let erreur: unknown;
      let ficheEleve: boolean | null = null;
      let studentId: string | null = null;
      let accessType: TypeAcces | null = null;

      if (identite) {
        const { data, error } = await client
          .from("students")
          .select("id, access_type")
          .eq("user_id", identite.userId)
          .maybeSingle();
        if (error) {
          erreur = error;
        } else if (!data) {
          ficheEleve = false;
        } else {
          ficheEleve = true;
          studentId = data.id as string;
          accessType = (data.access_type as TypeAcces | null) ?? null;
        }
      }

      let programmes: Awaited<ReturnType<typeof getAssignedProgramsForStudent>> | null = null;
      let feedbackExistant: AdminStudentFeedback | null = null;
      let historique: AdminStudentFeedback[] | null = null;
      if (erreur === undefined && studentId) {
        try {
          const [p, f, h] = await Promise.all([
            getAssignedProgramsForStudent(client, studentId),
            getWorkoutFeedbackBySession(client, studentId, sessionId),
            getWorkoutFeedbackForStudent(client, studentId),
          ]);
          programmes = p;
          feedbackExistant = f;
          historique = h;
        } catch (e) {
          erreur = e;
        }
      }

      const diagnostic = diagnostiquer({
        clientDisponible: true,
        sessionLocale: identite !== null,
        erreur,
        ficheEleve,
      });
      const source = classerSource(diagnostic);

      /* ── HORS LIGNE ────────────────────────────────────────────────
       * On ne lit le dépôt que si une identité locale existe. Il n'y a
       * AUCUN repli sur « le dernier compte connu » : sans session
       * exploitable, aucune donnée privée n'est rendue. */
      if (source === "offline") {
        if (!identite) {
          if (!annule) {
            setResultat({
              etat: "indisponible", diagnostic, contenu: null, identite: null,
              businessDate: aujourdhui, cacheIndisponible: false,
            });
          }
          return;
        }
        let contenu: ContenuSnapshot | null = null;
        let cacheIndisponible = false;
        try {
          const snapshot = await depot.lireSnapshot(identite.userId, aujourdhui);
          const lecture = lireSnapshotPourSeance(
            snapshot ? { ...snapshot, payload: snapshot.payload } : null,
            { userId: identite.userId, sessionId, aujourdhui },
          );
          contenu = lecture.contenu;
        } catch {
          cacheIndisponible = true;
        }
        if (!annule) {
          setResultat({
            etat: contenu ? "offline" : "indisponible",
            diagnostic,
            contenu,
            identite: contenu ? { ...identite, studentId: contenu.studentId } : identite,
            businessDate: aujourdhui,
            cacheIndisponible,
          });
        }
        return;
      }

      if (source !== "supabase") {
        if (!annule) {
          setResultat({
            etat: source === "mock" ? "mock" : source === "erreur" ? "erreur" : "indisponible",
            diagnostic,
            contenu: null,
            identite,
            businessDate: aujourdhui,
            cacheIndisponible: false,
          });
        }
        return;
      }

      /* ── EN LIGNE ──────────────────────────────────────────────────── */
      let seance: ReturnType<typeof toEleveWorkoutSession> | null = null;
      let programId: string | null = null;
      let programName: string | null = null;
      for (const programme of programmes ?? []) {
        const trouvee = programme.sessions.find((s) => s.id === sessionId);
        if (trouvee) {
          seance = toEleveWorkoutSession(trouvee);
          programId = programme.id;
          programName = programme.name;
          break;
        }
      }

      if (!seance) {
        if (!annule) {
          setResultat({
            etat: "indisponible", diagnostic, contenu: null, identite,
            businessDate: aujourdhui, cacheIndisponible: false,
          });
        }
        return;
      }

      // Préchargement des remplaçants admissibles : sans eux, le sélecteur
      // serait vide en salle, là où un appareil occupé oblige justement à
      // changer d'exercice. Un tableau vide est une réponse LÉGITIME (cet
      // exercice n'a pas de substitut) — et à ce stade le réseau est
      // nécessairement debout, puisque les trois chargements précédents ont
      // abouti.
      // Les clés viennent de `fichesRemplacables` : une fonction pure,
      // typée, testée dans Node. Ce qui vivait ici était une boucle avec un
      // cast qui inventait le nom du champ — voir son en-tête.
      const fiches = fichesRemplacables(seance);

      const remplacants: Record<string, ExerciseSubstituteOption[]> = {};
      let remplacantsCharges = true;
      try {
        await Promise.all(
          fiches.map(async (fiche) => {
            remplacants[fiche] = await listExerciseSubstitutes(client, fiche);
          }),
        );
      } catch {
        remplacantsCharges = false;
      }

      const assemblage = assemblerSnapshot({
        studentId: studentId ? charge(studentId) : manque("identité élève absente"),
        session: charge(seance),
        programId: charge(programId),
        programName: charge(programName),
        feedbackExistant: charge(feedbackExistant),
        historique: historique ? charge(historique) : manque("historique non chargé"),
        remplacants: remplacantsCharges ? charge(remplacants) : manque("remplaçants non chargés"),
        accessType: charge(accessType),
      });

      let cacheIndisponible = false;
      if (assemblage.ok && identite) {
        // BEST-EFFORT, et uniquement si l'assemblage est ENTIÈREMENT valide :
        // un snapshot amputé remplacerait une séance complète au pire
        // moment — celui où le réseau se dégrade.
        try {
          await depot.ecrireSnapshot({
            userId: identite.userId,
            businessDate: aujourdhui,
            sessionId,
            payload: assemblage.contenu,
            maintenant: Date.now(),
          });
        } catch {
          cacheIndisponible = true;
        }
      } else if (!assemblage.ok) {
        // Rien n'est écrit — le snapshot précédent, complet, reste en place.
        cacheIndisponible = true;
      }

      if (!annule) {
        setResultat({
          etat: "online",
          diagnostic,
          contenu: assemblage.ok
            ? assemblage.contenu
            : {
                studentId: studentId ?? "",
                session: seance,
                programId,
                programName,
                feedbackExistant,
                historique: historique ?? [],
                remplacants,
                accessType,
              },
          identite: identite ? { ...identite, studentId } : null,
          businessDate: aujourdhui,
          cacheIndisponible,
        });
      }
    })();

    return () => {
      annule = true;
    };
  }, [depot, sessionId, tour]);

  /**
   * Remplaçants lisibles SANS réseau.
   *
   * Injecté tel quel dans `ExerciseSubstitutionPicker`, qui accepte déjà un
   * `chargerRemplacants` — aucune modification du sélecteur n'est
   * nécessaire.
   */
  const chargerRemplacants = useCallback(
    async (exerciseLibraryId: string): Promise<ExerciseSubstituteOption[]> => {
      const preCharges = resultat.contenu?.remplacants?.[exerciseLibraryId];
      if (preCharges) return preCharges;
      if (resultat.etat !== "online") return [];
      const client = createSupabaseBrowserClient();
      if (!client) return [];
      return listExerciseSubstitutes(client, exerciseLibraryId);
    },
    [resultat.contenu, resultat.etat],
  );

  return {
    ...resultat,
    chargerRemplacants,
    recharger: useCallback(() => setTour((t) => t + 1), []),
  };
}
