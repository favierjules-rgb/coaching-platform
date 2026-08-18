"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BudgetObserve, ComparaisonBudget } from "@/lib/nutrition/budget-observe";

/**
 * COURSES C4.6 — LE MINIMUM OBSERVÉ D'UNE LISTE, CÔTÉ ÉCRAN.
 *
 * ⚠️ UN HOOK SÉPARÉ DE `useBudgetCourses`, ET POUR LA MÊME RAISON QUI AVAIT
 * SÉPARÉ CE DERNIER DE `useListePersistante` : deux cycles de vie différents.
 * L'estimation C3 se recalcule à chaque coche, sans réseau ; le minimum observé
 * demande un aller-retour vers un service tiers. Les mêler ferait dépendre
 * l'affichage d'une estimation d'une panne d'Open Prices, et rendrait chaque
 * case cochée coûteuse.
 *
 * ⚠️ ET IL NE CALCULE RIEN. Tout le raisonnement est dans la route serveur et
 * dans `budget-observe.ts`, qui est pur. Ce hook charge, garde l'état, et sait
 * dire qu'il ne sait pas.
 *
 * ⚠️ `ok: false` N'EST PAS « AUCUN PRIX ». Une route injoignable afficherait
 * sinon « minimum observé : — » comme si aucun relevé n'existait.
 */
export interface EtatBudgetObserve {
  readonly chargement: boolean;
  /** `false` = la lecture a ÉCHOUÉ. Ce n'est pas « aucun minimum ». */
  readonly ok: boolean;
  readonly budget: BudgetObserve | null;
  readonly comparaison: ComparaisonBudget | null;
  readonly magasinChoisi: boolean;
  readonly recharger: () => void;
}

interface Reponse {
  readonly budget?: BudgetObserve;
  readonly comparaison?: ComparaisonBudget;
  readonly magasinChoisi?: boolean;
}

export function useBudgetObserve(listId: string | null): EtatBudgetObserve {
  const [budget, setBudget] = useState<BudgetObserve | null>(null);
  const [comparaison, setComparaison] = useState<ComparaisonBudget | null>(null);
  const [magasinChoisi, setMagasinChoisi] = useState(false);
  const [ok, setOk] = useState(true);
  const [chargement, setChargement] = useState(false);
  const [rafraichissement, setRafraichissement] = useState(0);
  const requete = useRef(0);

  const charger = useCallback(async () => {
    if (listId === null) {
      setBudget(null);
      setComparaison(null);
      setOk(true);
      return;
    }
    const numero = ++requete.current;
    setChargement(true);
    try {
      const reponse = await fetch("/api/student/shopping-list/observed-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId }),
        cache: "no-store",
      });
      if (numero !== requete.current) return;
      if (!reponse.ok) {
        setOk(false);
        setBudget(null);
        setComparaison(null);
        return;
      }
      const corps = (await reponse.json()) as Reponse;
      if (numero !== requete.current) return;
      setOk(true);
      setBudget(corps.budget ?? null);
      setComparaison(corps.comparaison ?? null);
      setMagasinChoisi(corps.magasinChoisi === true);
    } catch {
      if (numero !== requete.current) return;
      setOk(false);
      setBudget(null);
      setComparaison(null);
    } finally {
      if (numero === requete.current) setChargement(false);
    }
  }, [listId]);

  // ⚠️ LE CHARGEMENT NE SUIT PAS LES COCHES. La dépendance est l'identifiant de
  // la liste, pas son contenu : cocher un article ne change aucun prix, et
  // relancer l'amont à chaque case serait payer un service bénévole pour rien.
  //
  // ⚠️ LE CHARGEMENT PASSE PAR UNE FONCTION LOCALE ET UN DRAPEAU D'ANNULATION,
  // exactement comme `useBudgetCourses` : appeler `charger()` à nu dans
  // l'effet déclenche des rendus en cascade (`react-hooks/set-state-in-effect`),
  // et laisse une réponse tardive écrire dans un composant démonté.
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

  return {
    chargement,
    ok,
    budget,
    comparaison,
    magasinChoisi,
    recharger: () => setRafraichissement((n) => n + 1),
  };
}
