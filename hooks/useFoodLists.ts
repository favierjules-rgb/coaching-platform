"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type FoodListDetail,
  type FoodListSummary,
  listerFoodLists,
  lireFoodList,
} from "@/lib/supabase/food-lists";

/**
 * N1.2 — LES DEUX LECTEURS DE LA BIBLIOTHÈQUE.
 *
 * ⚠️ `chargement` NE REPASSE JAMAIS À VRAI après le premier chargement. C'est
 * la règle de `useNutritionRecipes`, et elle existe parce qu'un `refetch` qui
 * remet l'écran en « Chargement… » démonterait le formulaire que le coach est
 * en train de remplir. Le compteur de requêtes suit la même convention que
 * partout ailleurs : la réponse arrivée en retard est jetée, jamais appliquée.
 */

export interface EtatFoodLists {
  readonly listes: readonly FoodListSummary[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly avecArchivees: boolean;
  readonly setAvecArchivees: (valeur: boolean) => void;
  readonly refetch: () => Promise<void>;
}

export function useFoodLists(): EtatFoodLists {
  const [listes, setListes] = useState<readonly FoodListSummary[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avecArchivees, setAvecArchivees] = useState(false);
  const requête = useRef(0);

  const lire = useCallback(
    async (premier: boolean, archivees: boolean) => {
      const numéro = ++requête.current;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (requête.current === numéro) {
          setErreur("Connexion indisponible.");
          setChargement(false);
        }
        return;
      }
      try {
        const trouvées = await listerFoodLists(supabase, { avecArchivees: archivees });
        if (requête.current !== numéro) return;
        setListes(trouvées);
        setErreur(null);
      } catch {
        if (requête.current !== numéro) return;
        setErreur("Les listes n'ont pas pu être chargées.");
      } finally {
        if (requête.current === numéro && premier) setChargement(false);
      }
    },
    [],
  );

  // Chargement initial isolé : l'appel qui met l'état à jour reste imbriqué
  // dans une fonction locale à l'effet plutôt qu'appelé directement, comme
  // partout ailleurs dans ce dépôt (règle react-hooks/set-state-in-effect).
  useEffect(() => {
    let annulé = false;
    async function charger() {
      if (annulé) return;
      await lire(true, avecArchivees);
    }
    void charger();
    return () => {
      annulé = true;
    };
  }, [lire, avecArchivees]);

  const refetch = useCallback(() => lire(false, avecArchivees), [lire, avecArchivees]);

  return { listes, chargement, erreur, avecArchivees, setAvecArchivees, refetch };
}

export interface EtatFoodList {
  readonly liste: FoodListDetail | null;
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly introuvable: boolean;
  readonly refetch: () => Promise<void>;
}

export function useFoodList(listId: string | null): EtatFoodList {
  const [liste, setListe] = useState<FoodListDetail | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [introuvable, setIntrouvable] = useState(false);
  const requête = useRef(0);

  const lire = useCallback(
    async (premier: boolean) => {
      const numéro = ++requête.current;
      if (!listId) {
        if (requête.current === numéro) setChargement(false);
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (requête.current === numéro) {
          setErreur("Connexion indisponible.");
          setChargement(false);
        }
        return;
      }
      try {
        const trouvée = await lireFoodList(supabase, listId);
        if (requête.current !== numéro) return;
        setListe(trouvée);
        // ⚠️ « introuvable » N'EST PAS UNE ERREUR : la RLS rend `null` pour la
        // liste d'un autre coach exactement comme pour une liste supprimée.
        // Les deux méritent le même écran, et surtout pas un message qui
        // révélerait laquelle des deux c'est.
        setIntrouvable(trouvée === null);
        setErreur(null);
      } catch {
        if (requête.current !== numéro) return;
        setErreur("La liste n'a pas pu être chargée.");
      } finally {
        if (requête.current === numéro && premier) setChargement(false);
      }
    },
    [listId],
  );

  // Même convention que ci-dessus (règle react-hooks/set-state-in-effect).
  useEffect(() => {
    let annulé = false;
    async function charger() {
      if (annulé) return;
      await lire(true);
    }
    void charger();
    return () => {
      annulé = true;
    };
  }, [lire]);

  const refetch = useCallback(() => lire(false), [lire]);

  return { liste, chargement, erreur, introuvable, refetch };
}
