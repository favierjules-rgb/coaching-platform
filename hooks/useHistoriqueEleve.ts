"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConsumedMeal } from "@/lib/nutrition/consumed";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readConsumedMeals } from "@/lib/supabase/consumed-meals";

/**
 * L'HISTORIQUE D'UN ÉLÈVE, VU PAR SON COACH (ALIMENTS A5.8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN HOOK SÉPARÉ, ET C'EST TOUT L'INTÉRÊT
 * ────────────────────────────────────────────────────────────────────────────
 * `useConsumedMeals` aurait pu recevoir un élève en paramètre. On ne l'a pas
 * fait, parce qu'il expose ONZE fonctions d'écriture — ouvrir, créer, renommer,
 * supprimer, ajouter, corriger… Les passer à un écran coach en espérant qu'il
 * ne les appelle pas, c'est fonder une garantie de sécurité sur une intention.
 *
 * Ce hook-ci n'en expose AUCUNE. Il n'importe aucune RPC d'écriture. « Le coach
 * ne peut rien modifier » n'est donc pas une promesse de revue de code : il n'y
 * a rien à appeler. Un test le vérifie sur ce fichier, et la base le refuserait
 * de toute façon — `revoke insert, update, delete … from authenticated`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * L'ÉLÈVE EST NOMMÉ, JAMAIS DEVINÉ
 * ────────────────────────────────────────────────────────────────────────────
 * `studentId` est obligatoire et voyage jusqu'au `.eq("student_id", …)`. Ce
 * filtre ne PROTÈGE rien — la RLS s'en charge, et nommer l'élève d'un confrère
 * rendrait simplement une liste vide. Ce qu'il fait est différent et
 * indispensable : DÉSAMBIGUÏSER. Sans lui, un coach de dix athlètes recevrait
 * dix journaux dans un seul tas, et l'écran additionnerait des inconnus.
 */

export interface HistoriqueEleveState {
  readonly loading: boolean;
  readonly error: string | null;
  readonly meals: readonly ConsumedMeal[];
  readonly refetch: () => Promise<void>;
}

export function useHistoriqueEleve(
  /** `students.id`. `null` tant que la fiche n'est pas chargée. */
  studentId: string | null,
  dates: readonly string[],
  actif: boolean,
): HistoriqueEleveState {
  const [loading, setLoading] = useState(actif);
  const [error, setError] = useState<string | null>(null);
  const [meals, setMeals] = useState<readonly ConsumedMeal[]>([]);

  const requête = useRef(0);
  // Le contenu, pas la référence : un tableau littéral recréé à chaque rendu
  // relancerait l'effet indéfiniment. Même convention que `useConsumedMeals`.
  const clé = dates.join(",");

  const charger = useCallback(async (): Promise<void> => {
    if (!actif || clé === "" || studentId === null) {
      setMeals([]);
      setLoading(false);
      return;
    }
    // ⚠️ LE COMPTEUR EST CE QUI REND LE CHANGEMENT D'ÉLÈVE SÛR. Deux lectures
    // peuvent se chevaucher — le coach passe d'un athlète à l'autre pendant que
    // la première réponse est en vol. Sans ce garde, la réponse LENTE du
    // premier élève écraserait celle du second, et la fiche de B afficherait
    // les repas de A. Aucune erreur, aucun indice à l'écran.
    const numéro = ++requête.current;
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setError("La connexion est indisponible.");
        return;
      }
      const lus = await readConsumedMeals(supabase, clé.split(","), {
        portee: "eleve",
        studentId,
      });
      if (requête.current !== numéro) return;
      setMeals(lus);
      setError(null);
    } catch (erreur) {
      if (requête.current !== numéro) return;
      console.error("[useHistoriqueEleve]", erreur);
      setError("L'historique n'a pas pu être chargé.");
    } finally {
      if (requête.current === numéro) setLoading(false);
    }
  }, [actif, clé, studentId]);

  useEffect(() => {
    let annulé = false;
    async function lire() {
      if (annulé) return;
      await charger();
    }
    void lire();
    return () => {
      annulé = true;
    };
  }, [charger]);

  return { loading, error, meals, refetch: charger };
}
