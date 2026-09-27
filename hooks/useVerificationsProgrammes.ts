"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  lireVerifications,
  marquerVerifie,
  retirerVerification,
} from "@/lib/supabase/verification-programme";
import type { EtatVerification } from "@/lib/verification-programme";

/**
 * LE PENSE-BÊTE « À JOUR / À VÉRIFIER » DE CHAQUE PROGRAMME.
 *
 * ⚠️ AUCUN ÉTAT « À JOUR » N'EST GARDÉ EN MÉMOIRE — seulement la SEMAINE
 * validée, telle qu'elle est en base. L'état affiché s'en dérive à chaque
 * rendu (voir lib/verification-programme.ts), ce qui fait du retour à
 * « À vérifier » le lundi une conséquence du calendrier et non d'un réveil.
 *
 * ⚠️ L'ÉCRITURE EST OPTIMISTE, MAIS PAS AVEUGLE : la carte locale est mise à
 * jour tout de suite pour que le clic réponde, et la ligne est REMISE dans son
 * état précédent si la base refuse. Un pense-bête qui affiche « À jour » sans
 * l'avoir enregistré est exactement le genre de mensonge qui fait sauter une
 * vérification la semaine suivante.
 */
export function useVerificationsProgrammes(programIds: readonly string[]) {
  const [parProgramme, setParProgramme] = useState<ReadonlyMap<string, string>>(new Map());

  // Clé stable : l'identité du tableau change à chaque relecture des programmes.
  const cle = useMemo(() => [...programIds].sort().join(","), [programIds]);

  useEffect(() => {
    let annule = false;
    const ids = cle === "" ? [] : cle.split(",");

    async function lire() {
      if (ids.length === 0) {
        if (!annule) setParProgramme(new Map());
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) setParProgramme(new Map());
        return;
      }
      const carte = await lireVerifications(supabase, ids);
      if (!annule) setParProgramme(carte);
    }

    void lire();
    return () => {
      annule = true;
    };
  }, [cle]);

  const basculer = useCallback(
    async (programId: string, versEtat: EtatVerification, semaineCourante: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;

      const avant = parProgramme;
      const apres = new Map(avant);
      if (versEtat === "a-jour") apres.set(programId, semaineCourante);
      else apres.delete(programId);
      setParProgramme(apres);

      const ok =
        versEtat === "a-jour"
          ? await marquerVerifie(supabase, programId, semaineCourante)
          : await retirerVerification(supabase, programId);
      // Refus de la base (RLS, réseau, table absente) : on remet ce qu'on savait.
      if (!ok) setParProgramme(avant);
    },
    [parProgramme],
  );

  return { parProgramme, basculer };
}
