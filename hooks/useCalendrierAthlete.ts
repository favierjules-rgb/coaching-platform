"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { blocsDuModelePourApplication, seanceSyntheticPourModele } from "@/lib/bibliotheque-cardio";
import {
  creerSeanceCardio,
  deplacerSeance,
  lireCalendrierDeLEleve,
  supprimerSeance,
  type CalendrierDeLEleve,
  type SeanceDuCalendrier,
} from "@/lib/supabase/calendrier-seances";
import { createSessionTemplate, getSessionTemplates } from "@/lib/supabase/session-templates";
import { buildCanonicalSessionBlocksInput, saveTrainingSessionBlocks } from "@/lib/supabase/training-session-blocks";
import type { SessionTemplate, TrainingBlock } from "@/types";

/**
 * LE CALENDRIER D'UN ATHLÈTE, CÔTÉ ÉCRAN.
 *
 * ⚠️ APRÈS CHAQUE ÉCRITURE, ON RELIT TOUT. Recomposer l'état localement après un
 * déplacement afficherait la date demandée même si la base l'a refusée — et
 * elle la refuse tant que la migration 20260930100000 dort. La relecture est la
 * seule preuve que l'écran dit vrai.
 *
 * ⚠️ UN SEUL ATHLÈTE. `studentId` est le paramètre de tout : il n'y a pas
 * d'« athlète courant » implicite à confondre avec un autre.
 */
export interface EtatCalendrier {
  readonly calendrier: CalendrierDeLEleve;
  readonly modeles: readonly SessionTemplate[];
  readonly disponible: boolean;
  readonly chargement: boolean;
  readonly erreur: string | null;
}

const VIDE: CalendrierDeLEleve = { programme: null, debut: null, seances: [] };

export function useCalendrierAthlete(studentId: string) {
  const [calendrier, setCalendrier] = useState<CalendrierDeLEleve>(VIDE);
  const [modeles, setModeles] = useState<SessionTemplate[]>([]);
  const [disponible, setDisponible] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;

    async function lire() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setDisponible(false);
          setChargement(false);
        }
        return;
      }
      const [lu, banque] = await Promise.all([
        lireCalendrierDeLEleve(supabase, studentId),
        getSessionTemplates(supabase),
      ]);
      if (annule) return;
      setCalendrier(lu);
      setModeles(banque);
      setDisponible(true);
      setChargement(false);
    }

    void lire();
    return () => {
      annule = true;
    };
  }, [studentId, version]);

  const relire = useCallback(() => setVersion((n) => n + 1), []);

  const deplacer = useCallback(
    async (sessionId: string, date: string | null) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, erreur: "Supabase n'est pas configuré." };
      const resultat = await deplacerSeance(supabase, sessionId, date);
      setErreur(resultat.erreur);
      if (resultat.ok) relire();
      return resultat;
    },
    [relire],
  );

  const supprimer = useCallback(
    async (sessionId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, erreur: "Supabase n'est pas configuré." };
      const resultat = await supprimerSeance(supabase, sessionId);
      setErreur(resultat.erreur);
      if (resultat.ok) relire();
      return resultat;
    },
    [relire],
  );

  /**
   * Enregistre LES BLOCS CARDIO d'une séance existante.
   *
   * ⚠️ PORTÉE « cardio », ET LA MUSCULATION N'EST PAS DANS LE PAYLOAD. Ce n'est
   * pas l'écran qui promet de ne pas y toucher : la RPC n'a structurellement
   * aucun exercice à supprimer dans cette portée, et refuse même un bloc
   * `strength` qui s'y glisserait. Voir `SaveScope`.
   */
  const enregistrerSeance = useCallback(
    async (
      seance: SeanceDuCalendrier,
      blocksCardio: TrainingBlock[],
      meta: { name: string; durationMinutes: number | null; coachNotes: string },
    ) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, erreur: "Supabase n'est pas configuré." };
      if (!seance.updatedAt) {
        return { ok: false, erreur: "Version de la séance inconnue : rechargez la page avant d'enregistrer." };
      }
      try {
        // Même raison que dans `creerSeanceCardio` : les blocs ajoutés dans le
        // builder portent des identifiants clients, que seul cet adaptateur sait
        // traduire pour la RPC.
        await saveTrainingSessionBlocks(
          supabase,
          buildCanonicalSessionBlocksInput({
            sessionId: seance.id,
            expectedUpdatedAt: seance.updatedAt,
            blocks: blocksCardio,
            scope: "cardio",
            sessionPatch: {
              name: meta.name,
              durationMinutes: meta.durationMinutes,
              coachNotes: meta.coachNotes,
            },
          }),
        );
      } catch (erreurRpc) {
        const message = erreurRpc instanceof Error ? erreurRpc.message : String(erreurRpc);
        setErreur(message);
        return { ok: false, erreur: message };
      }
      relire();
      return { ok: true, erreur: null };
    },
    [relire],
  );

  const creer = useCallback(
    async (nouvelle: {
      programId: string;
      weekNumber: number;
      day: string;
      name: string;
      durationMinutes: number | null;
      coachNotes: string;
      scheduledDate: string | null;
      blocks: TrainingBlock[];
    }) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, sessionId: null, erreur: "Supabase n'est pas configuré." };
      const resultat = await creerSeanceCardio(supabase, nouvelle);
      setErreur(resultat.erreur);
      if (resultat.ok) relire();
      return resultat;
    },
    [relire],
  );

  /**
   * « Enregistrer également dans ma bibliothèque ».
   *
   * ⚠️ C'EST UNE COPIE, PAS UN LIEN. Le modèle créé ne suit jamais les
   * modifications ultérieures de la séance — et l'inverse est vrai aussi.
   */
  const enregistrerDansLaBibliotheque = useCallback(
    async (entree: { name: string; durationMinutes: number | null; coachNotes: string; blocks: TrainingBlock[] }) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, erreur: "Supabase n'est pas configuré." };
      const id = await createSessionTemplate(
        supabase,
        seanceSyntheticPourModele(entree),
        entree.name,
        "Séance cardio enregistrée depuis le calendrier.",
      );
      if (!id) {
        const message = "Le modèle n'a pas pu être enregistré dans la bibliothèque.";
        setErreur(message);
        return { ok: false, erreur: message };
      }
      relire();
      return { ok: true, erreur: null };
    },
    [relire],
  );

  const etat: EtatCalendrier = { calendrier, modeles, disponible, chargement, erreur };
  return { etat, deplacer, supprimer, enregistrerSeance, creer, enregistrerDansLaBibliotheque, blocsDuModelePourApplication, relire };
}
