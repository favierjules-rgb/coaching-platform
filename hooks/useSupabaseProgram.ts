"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getProgramById } from "@/lib/supabase/programs";
import type { AdminProgram } from "@/types";

/**
 * UN programme Supabase, complet, par son identifiant — pour la page de détail
 * et pour le builder.
 *
 * ⚠️ CE HOOK REMPLACE `useSupabasePrograms` SUR CES DEUX ÉCRANS, ET CE N'EST
 * PAS UNE SIMPLE OPTIMISATION. Ils lisaient la totalité des programmes pour en
 * afficher un seul, ce qui faisait grossir la liste d'identifiants envoyée
 * dans l'URL PostgREST jusqu'au rejet par la passerelle (voir `lireParLots`
 * dans lib/supabase/programs.ts). Lire le seul programme demandé supprime la
 * cause ; le découpage en lots couvre le reste.
 *
 * ⚠️ `program === null` NE SIGNIFIE PAS « SUPABASE EST INACTIF ». Il signifie
 * « ce programme n'existe pas », ce qui est une réponse légitime. L'appelant
 * décide du repli mock à partir de `isSupabaseConfigured()`, jamais à partir
 * de ce `null` — sinon un identifiant inconnu ferait réapparaître les données
 * de démonstration, exactement le clignotement corrigé en 65be51b.
 *
 * `refetch` rend le programme FRAIS, sans repasser `loading` à vrai : le
 * builder s'en sert après un enregistrement et ne doit pas être démonté.
 */
export function useSupabaseProgram(programId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState<AdminProgram | null>(null);

  const refetch = useCallback(async (): Promise<AdminProgram | null> => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !programId) {
      setProgram(null);
      setLoading(false);
      return null;
    }
    const frais = await getProgramById(supabase, programId);
    setProgram(frais);
    setLoading(false);
    return frais;
  }, [programId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !programId) {
        if (!cancelled) {
          setProgram(null);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      const charge = await getProgramById(supabase, programId);
      if (!cancelled) {
        setProgram(charge);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  return { loading, program, refetch };
}
