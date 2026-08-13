"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConsumedMeal, ConsumedUnit } from "@/lib/nutrition/consumed";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  ajouterAlimentCatalogue,
  ajouterAlimentManuel,
  ajouterAlimentProduit,
  creerRepasEleve,
  modifierQuantiteEntree,
  ouvrirRepasPrescrit,
  readConsumedMeals,
  renommerRepasEleve,
  supprimerEntree,
  supprimerRepasEleve,
} from "@/lib/supabase/consumed-meals";

/**
 * LA CONSOMMATION D'UNE PLAGE DE DATES (ALIMENTS A2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PAS D'UI OPTIMISTE — C'EST UN CHOIX, PAS UN OUBLI
 * ────────────────────────────────────────────────────────────────────────────
 * Les macros finales sont calculées PAR LE SERVEUR. Afficher un total
 * provisoire calculé côté navigateur reviendrait à entretenir une seconde
 * convention nutritionnelle le temps d'un aller-retour, et à montrer un
 * chiffre qui change tout seul une seconde plus tard.
 *
 * Le cycle est donc : action → état « en cours » → RPC → RELECTURE serveur →
 * affichage. Si la RPC échoue, RIEN n'apparaît comme enregistré.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOUBLE-TAP
 * ────────────────────────────────────────────────────────────────────────────
 * `enCours` est posé AVANT l'appel et n'est levé qu'après la relecture. Les
 * boutons s'en servent pour se désactiver — deux tapes rapprochées ne créent
 * donc pas deux entrées. Le garde est en plus dans le hook lui-même (`if
 * (enCoursRef.current) return null`), pour qu'un composant qui oublierait de
 * désactiver son bouton ne suffise pas à casser la règle.
 */

/** Le client une fois écarté le cas `null` — voir `écrire`. */
type ClientSupabase = NonNullable<ReturnType<typeof createSupabaseBrowserClient>>;

export interface ConsumedMealsState {
  readonly loading: boolean;
  readonly error: string | null;
  /** Vrai pendant une écriture : ajout, correction, suppression, création. */
  readonly enCours: boolean;
  readonly meals: readonly ConsumedMeal[];
  readonly refetch: () => Promise<void>;
  /** Efface le message d'erreur d'écriture, sans recharger. */
  readonly effacerErreur: () => void;

  readonly ouvrirPrescrit: (mealId: string, date: string) => Promise<string | null>;
  readonly creerRepas: (date: string, libellé: string) => Promise<string | null>;
  readonly renommerRepas: (consumedMealId: string, libellé: string) => Promise<boolean>;
  readonly supprimerRepas: (consumedMealId: string) => Promise<boolean>;
  readonly ajouterCatalogue: (
    consumedMealId: string,
    foodId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  readonly ajouterManuel: (
    consumedMealId: string,
    libellé: string,
    quantité: number,
    unité: "g" | "ml",
    protéinesPour100: number,
    glucidesPour100: number,
    lipidesPour100: number,
  ) => Promise<boolean>;
  readonly ajouterProduit: (
    consumedMealId: string,
    productId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  readonly corrigerQuantité: (
    entryId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  readonly supprimerAliment: (entryId: string) => Promise<boolean>;
}

/**
 * Traduit un code d'erreur serveur en phrase française.
 *
 * Un code INCONNU n'est pas absorbé en « une erreur est survenue » : il est
 * affiché tel quel, pour qu'un incident reste diagnosticable depuis une
 * capture d'écran d'élève.
 */
function messageDErreur(brut: string): string {
  const codes: Readonly<Record<string, string>> = {
    ELEVE_INCONNU: "Ton compte élève n'a pas été reconnu. Reconnecte-toi puis réessaie.",
    DATE_MANQUANTE: "La date du repas est manquante.",
    REPAS_PRESCRIT_INACCESSIBLE: "Ce repas ne fait pas partie de ton plan.",
    REPAS_INACCESSIBLE: "Ce repas n'est pas le tien.",
    REPAS_INVALIDE: "Donne un nom à ce repas.",
    REPAS_NON_MODIFIABLE: "Un repas prescrit par ton coach ne peut pas être renommé.",
    REPAS_NON_SUPPRIMABLE: "Un repas prescrit par ton coach ne peut pas être supprimé.",
    LIBELLE_VIDE: "Le nom ne peut pas être vide.",
    ALIMENT_INACCESSIBLE: "Cet aliment n'est plus disponible dans le catalogue.",
    PRODUIT_INACCESSIBLE: "Ce produit n'est plus disponible. Recherche-le à nouveau.",
    ENTREE_INACCESSIBLE: "Cet aliment n'est pas le tien.",
    QUANTITE_INVALIDE: "La quantité doit être supérieure à zéro.",
    MACROS_INVALIDES: "Les valeurs nutritionnelles doivent être positives.",
    UNITE_INCOMPATIBLE: "Cette unité ne convient pas à cet aliment.",
    PIECE_SANS_POIDS: "Cet aliment n'indique pas ce que pèse une pièce : saisis un poids en grammes.",
    PIECE_UNIQUEMENT_EN_GRAMMES:
      "La pièce n'est disponible que pour un aliment mesuré en grammes.",
    ENTREE_SANS_REFERENCE: "Cet aliment n'a pas de référence exploitable : supprime-le et resaisis-le.",
    SUPABASE_INDISPONIBLE: "La connexion à ton espace est indisponible.",
  };
  for (const [code, phrase] of Object.entries(codes)) {
    if (brut.includes(code)) return phrase;
  }
  return `L'enregistrement a échoué (${brut}).`;
}

export function useConsumedMeals(dates: readonly string[], actif: boolean): ConsumedMealsState {
  const [loading, setLoading] = useState(actif);
  const [error, setError] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [meals, setMeals] = useState<readonly ConsumedMeal[]>([]);

  const requête = useRef(0);
  const enCoursRef = useRef(false);
  // Les dates sont un tableau littéral recréé à chaque rendu : on compare leur
  // CONTENU, sinon l'effet se relancerait indéfiniment.
  const clé = dates.join(",");

  const charger = useCallback(async (): Promise<void> => {
    if (!actif || clé === "") {
      setMeals([]);
      setLoading(false);
      return;
    }
    const numéro = ++requête.current;
    try {
      const supabase = createSupabaseBrowserClient();
      // `createSupabaseBrowserClient` rend `null` quand la configuration
      // Supabase est absente. On le dit, plutôt que d'afficher une journée
      // vide qui se lirait comme « tu n'as rien mangé ».
      if (!supabase) {
        setError("La connexion à ton espace est indisponible.");
        return;
      }
      const lus = await readConsumedMeals(supabase, clé.split(","));
      if (requête.current !== numéro) return;
      setMeals(lus);
      setError(null);
    } catch (erreur) {
      if (requête.current !== numéro) return;
      console.error("[useConsumedMeals]", erreur);
      setError("Ta consommation n'a pas pu être chargée. Vérifie ta connexion puis réessaie.");
    } finally {
      if (requête.current === numéro) setLoading(false);
    }
  }, [actif, clé]);

  // Chargement initial isolé : l'appel qui met l'état à jour reste imbriqué
  // dans une fonction locale à l'effet plutôt qu'appelé directement, comme
  // partout ailleurs dans ce dépôt (règle react-hooks/set-state-in-effect).
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

  /**
   * Exécute une écriture, puis RELIT le serveur.
   *
   * Le résultat n'est rendu à l'appelant qu'après la relecture : quand une
   * fonction rend `true`, ce qui est affiché vient déjà du serveur.
   */
  const écrire = useCallback(
    async <T,>(action: (client: ClientSupabase) => Promise<T>): Promise<T | null> => {
      if (enCoursRef.current) return null;
      enCoursRef.current = true;
      setEnCours(true);
      setError(null);
      try {
        const supabase = createSupabaseBrowserClient();
        if (!supabase) throw new Error("SUPABASE_INDISPONIBLE");
        const résultat = await action(supabase);
        await charger();
        return résultat;
      } catch (erreur) {
        const brut = erreur instanceof Error ? erreur.message : String(erreur);
        console.error("[useConsumedMeals] écriture", erreur);
        setError(messageDErreur(brut));
        return null;
      } finally {
        enCoursRef.current = false;
        setEnCours(false);
      }
    },
    [charger],
  );

  return {
    loading,
    error,
    enCours,
    meals,
    refetch: charger,
    effacerErreur: () => setError(null),

    ouvrirPrescrit: (mealId, date) => écrire((c) => ouvrirRepasPrescrit(c, mealId, date)),
    creerRepas: (date, libellé) => écrire((c) => creerRepasEleve(c, date, libellé)),
    renommerRepas: async (id, libellé) =>
      (await écrire((c) => renommerRepasEleve(c, id, libellé).then(() => true))) === true,
    supprimerRepas: async (id) =>
      (await écrire((c) => supprimerRepasEleve(c, id).then(() => true))) === true,
    ajouterCatalogue: async (repas, food, quantité, unité) =>
      (await écrire((c) =>
        ajouterAlimentCatalogue(c, repas, food, quantité, unité).then(() => true),
      )) === true,
    ajouterManuel: async (repas, libellé, quantité, unité, p, g, l) =>
      (await écrire((c) =>
        ajouterAlimentManuel(c, repas, libellé, quantité, unité, p, g, l).then(() => true),
      )) === true,
    ajouterProduit: async (repas, produit, quantité, unité) =>
      (await écrire((c) =>
        ajouterAlimentProduit(c, repas, produit, quantité, unité).then(() => true),
      )) === true,
    corrigerQuantité: async (entryId, quantité, unité) =>
      (await écrire((c) => modifierQuantiteEntree(c, entryId, quantité, unité).then(() => true))) ===
      true,
    supprimerAliment: async (entryId) =>
      (await écrire((c) => supprimerEntree(c, entryId).then(() => true))) === true,
  };
}
