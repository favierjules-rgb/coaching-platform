"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  calculerBudgetListe,
  indexerPrix,
  type BudgetDeLaListe,
  type PrixEstime,
} from "@/lib/nutrition/budget-courses";
import type { LigneAffichee, ListePersistee } from "@/lib/nutrition/liste-persistante";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  definirBudget,
  definirPrixArticleManuel,
  lirePrixEstimes,
  RpcPrixError,
} from "@/lib/supabase/prix-courses";

/**
 * COURSES C3 — LES PRIX D'UNE LISTE, ET SON BUDGET.
 *
 * ⚠️ UN HOOK SÉPARÉ DE `useListePersistante`, ET C'EST DÉLIBÉRÉ. C2 est en
 * production ; son hook porte la liste, les cases et les articles manuels.
 * Y greffer les prix mêlerait deux cycles de vie qui n'ont pas la même cadence
 * — la liste change quand l'élève coche, les prix quand l'admin les met à jour
 * — et rendrait une panne de prix capable de faire disparaître la liste.
 *
 * ⚠️ CE HOOK NE CALCULE RIEN LUI-MÊME. Il charge, et délègue à
 * `budget-courses.ts`, qui est pur. L'estimation est DÉRIVÉE à chaque rendu :
 * rien n'est persisté, donc rien ne peut devenir périmé (§19).
 */
export interface EtatBudgetCourses {
  readonly chargement: boolean;
  /** `false` = la lecture des PRIX a échoué. Ce n'est pas « aucun prix ». */
  readonly ok: boolean;
  readonly budget: BudgetDeLaListe;
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly definirBudget: (cents: number | null) => Promise<boolean>;
  readonly definirPrixManuel: (ligneId: string, cents: number | null) => Promise<boolean>;
  readonly recharger: () => void;
}

export function useBudgetCourses(
  liste: ListePersistee | null,
  lignes: readonly LigneAffichee[],
  onListeModifiee: () => void,
): EtatBudgetCourses {
  const [prix, setPrix] = useState<readonly PrixEstime[]>([]);
  const [ok, setOk] = useState(true);
  const [chargement, setChargement] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rafraichissement, setRafraichissement] = useState(0);
  const requete = useRef(0);

  /**
   * Les identités à tarifer, extraites des lignes PLAN de la liste.
   *
   * ⚠️ SÉRIALISÉES EN CHAÎNE POUR LA DÉPENDANCE D'EFFET. Deux tableaux au même
   * contenu sont deux références différentes : sans cette clé stable, l'effet
   * relancerait une requête réseau à chaque rendu.
   */
  const cle = useMemo(() => {
    if (liste === null) return "";
    const aliments = new Set<string>();
    const produits = new Set<string>();
    for (const l of liste.lignes) {
      if (l.source !== "plan") continue;
      if (l.catalogFoodId !== null) aliments.add(l.catalogFoodId);
      if (l.productId !== null) produits.add(l.productId);
    }
    return `${[...aliments].sort().join(",")}|${[...produits].sort().join(",")}`;
  }, [liste]);

  const charger = useCallback(async () => {
    const numero = ++requete.current;
    const [alimentsBruts, produitsBruts] = cle.split("|");
    const aliments = alimentsBruts ? alimentsBruts.split(",") : [];
    const produits = produitsBruts ? produitsBruts.split(",") : [];
    if (aliments.length === 0 && produits.length === 0) {
      setPrix([]);
      setOk(true);
      setChargement(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setOk(false);
      setChargement(false);
      return;
    }
    setChargement(true);
    const lecture = await lirePrixEstimes(supabase, aliments, produits);
    if (numero !== requete.current) return;
    setOk(lecture.ok);
    setPrix(lecture.prix);
    setChargement(false);
  }, [cle]);

  useEffect(() => {
    let annule = false;
    async function lire() {
      if (annule) return;
      await charger();
    }
    void lire();
    return () => {
      annule = true;
    };
  }, [charger, rafraichissement]);

  /** Les besoins bruts, par identifiant de ligne. Aucune quantité recalculée. */
  const besoins = useMemo(() => {
    const carte = new Map<string, { quantite: number | null; unite: string | null }>();
    for (const l of liste?.lignes ?? []) carte.set(l.id, { quantite: l.quantity, unite: l.unit });
    return carte;
  }, [liste]);

  const prixManuels = useMemo(() => {
    const carte = new Map<string, number | null>();
    for (const l of liste?.lignes ?? []) carte.set(l.id, l.estimatedPriceCents);
    return carte;
  }, [liste]);

  const budget = useMemo(
    () => calculerBudgetListe(lignes, indexerPrix(prix), liste?.budgetCents ?? null, besoins, prixManuels),
    [lignes, prix, liste, besoins, prixManuels],
  );

  const poserBudget = useCallback(
    async (cents: number | null): Promise<boolean> => {
      if (liste === null) return false;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setEnCours(true);
      setErreur(null);
      try {
        const reussi = await definirBudget(supabase, liste.id, cents);
        if (!reussi) setErreur("BUDGET_REFUSE");
        else onListeModifiee();
        return reussi;
      } finally {
        setEnCours(false);
      }
    },
    [liste, onListeModifiee],
  );

  const poserPrixManuel = useCallback(
    async (ligneId: string, cents: number | null): Promise<boolean> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setEnCours(true);
      setErreur(null);
      try {
        await definirPrixArticleManuel(supabase, ligneId, cents);
        onListeModifiee();
        return true;
      } catch (e) {
        setErreur(e instanceof RpcPrixError ? e.code : "ERREUR_INCONNUE");
        return false;
      } finally {
        setEnCours(false);
      }
    },
    [onListeModifiee],
  );

  return {
    chargement,
    ok,
    budget,
    enCours,
    erreur,
    definirBudget: poserBudget,
    definirPrixManuel: poserPrixManuel,
    recharger: () => setRafraichissement((n) => n + 1),
  };
}
