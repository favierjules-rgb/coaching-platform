"use client";

import { useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { seancesTermineesParEleve } from "@/lib/supabase/workout-feedback";
import type { AdminProgramSummary } from "@/types";

/**
 * LES SÉANCES VALIDÉES DE TOUS LES ÉLÈVES, POUR LES PROGRAMMES AFFICHÉS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN HOOK SÉPARÉ DE `useSupabaseProgramsSummary`
 * ════════════════════════════════════════════════════════════════════════
 * Le hook de résumé porte un contrat documenté (lecture LÉGÈRE, `loading` du
 * premier chargement, `refetch` qui ne vide pas l'écran) et une suite qui le
 * vérifie (`test:lecture-programmes-legere`). Y greffer une seconde lecture
 * aurait mélangé deux échéances : la liste des programmes doit s'afficher même
 * si la progression, elle, n'est pas encore là.
 *
 * ⚠️ `complet` N'EST PAS DÉCORATIF. Une lecture partielle rend une progression
 * SOUS-ÉVALUÉE — « Sem. 2 / 8 » pour un élève à la semaine 5 — et rien à
 * l'écran ne le dirait. L'appelant s'en sert pour ne rien afficher plutôt que
 * d'afficher un chiffre faux.
 */
export interface SeancesTerminees {
  /** `studentId` → identifiants des séances validées. */
  readonly parEleve: ReadonlyMap<string, ReadonlySet<string>>;
  /** `false` tant que la lecture n'a pas abouti, ou si un lot a échoué. */
  readonly complet: boolean;
  readonly chargement: boolean;
}

const VIDE: ReadonlyMap<string, ReadonlySet<string>> = new Map();

export function useSeancesTerminees(programs: readonly AdminProgramSummary[]): SeancesTerminees {
  const [parEleve, setParEleve] = useState<ReadonlyMap<string, ReadonlySet<string>>>(VIDE);
  const [complet, setComplet] = useState(false);
  const [chargement, setChargement] = useState(true);

  /*
   * ⚠️ LA CLÉ EST LA LISTE DES IDENTIFIANTS, PAS LE TABLEAU `programs`.
   * `useSupabaseProgramsSummary` rend un nouveau tableau à chaque relecture ;
   * dépendre de son identité relancerait cette requête à chaque assignation,
   * chaque duplication, chaque suppression. Trier rend la clé stable quel que
   * soit l'ordre de lecture.
   */
  const cle = useMemo(
    () =>
      programs
        .flatMap((p) => p.sessions.filter((s) => !s.isRestDay).map((s) => s.id))
        .sort()
        .join(","),
    [programs],
  );

  useEffect(() => {
    let annule = false;
    const ids = cle === "" ? [] : cle.split(",");

    async function lire() {
      if (ids.length === 0) {
        if (!annule) {
          setParEleve(VIDE);
          // Aucune séance à interroger : la lecture est complète par vacuité.
          setComplet(true);
          setChargement(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setParEleve(VIDE);
          setComplet(false);
          setChargement(false);
        }
        return;
      }
      const lecture = await seancesTermineesParEleve(supabase, ids);
      if (!annule) {
        setParEleve(lecture.parEleve);
        setComplet(lecture.complet);
        setChargement(false);
      }
    }

    void lire();
    return () => {
      annule = true;
    };
  }, [cle]);

  return { parEleve, complet, chargement };
}
