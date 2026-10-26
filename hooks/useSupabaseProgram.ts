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
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ UNE RELECTURE QUI ÉCHOUE NE VIDE PLUS `program`, ET C'EST UNE CORRECTION
 * DE PERTE DE DONNÉES
 * ════════════════════════════════════════════════════════════════════════════
 * `refetch` faisait `setProgram(frais)` sans condition. Or `getProgramById`
 * rend `null` quand la LECTURE ÉCHOUE — il ne lève pas. Enchaînement constaté
 * (démontré par scripts/tests/reprise-interface-desynchronisee.mts) :
 *
 *   sauvegarde réussie → relecture en échec → `setProgram(null)` → le cache de
 *   la page est vide → `savedProgram` vaut encore `null` s'il s'agit de la
 *   première sauvegarde du montage → `activeProgram` tombe à `undefined` → la
 *   page affiche « Programme introuvable. » → LE BUILDER EST DÉMONTÉ, et les
 *   modifications locales non enregistrées partent avec lui, en même temps que
 *   le message qui demandait de recharger.
 *
 * Désormais : si une valeur était déjà chargée et que la relecture rend `null`,
 * on CONSERVE la valeur précédente et on rend `null` à l'appelant, qui sait
 * ainsi que la relecture a échoué. L'état affiché est périmé — c'est précisément
 * pour cela que la page bascule en « désynchronisé » et interdit une nouvelle
 * sauvegarde jusqu'à une relecture réussie.
 *
 * ⚠️ LE COMPROMIS EST ASSUMÉ. Si le programme avait RÉELLEMENT été supprimé
 * entre-temps, le builder resterait ouvert sur un instantané périmé au lieu
 * d'afficher « introuvable ». C'est volontaire : `getProgramById` ne distingue
 * pas « supprimé » de « illisible », et entre afficher trop longtemps un
 * programme disparu et détruire le travail en cours d'un coach, seul le second
 * est irréparable. Aucune écriture n'est possible dans cet état (la page la
 * refuse), donc rien ne peut être écrit par-dessus une suppression réelle.
 * Le chargement INITIAL garde l'ancien comportement : à ce moment-là il n'y a
 * aucune modification locale à perdre, et « introuvable » est la bonne réponse.
 */
/**
 * Le réducteur de `refetch`, extrait pour être appelé TEL QUEL par les tests
 * plutôt que décrit par eux. Voir l'avertissement de l'en-tête : une relecture
 * vide ne doit jamais effacer un programme déjà chargé.
 */
export function conserverProgrammeSiRelectureVide(
  precedent: AdminProgram | null,
  frais: AdminProgram | null,
): AdminProgram | null {
  return frais ?? precedent;
}

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
    // Voir l'avertissement de l'en-tête : on n'écrase JAMAIS une valeur déjà
    // chargée par un `null` de relecture. Le `null` rendu signale l'échec à
    // l'appelant, qui en tire les conséquences (état désynchronisé).
    setProgram((precedent) => conserverProgrammeSiRelectureVide(precedent, frais));
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
