"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getProgressionReglages } from "@/lib/supabase/progression-reglage";
import { indexerReglages, type IndexReglages } from "@/lib/progression-reglage";

/** Index vide partagé — « aucun réglage lu », donc tout OFF. */
const VIDE: IndexReglages = indexerReglages([]);

/**
 * LES RÉGLAGES « PROGRESSION AUTOMATIQUE » DU PROGRAMME DE LA SÉANCE.
 *
 * UNE requête, à l'ouverture de la séance, pour tout le programme. Jamais une
 * par exercice : la page interroge ensuite l'index en mémoire
 * (`progressionActivePour`).
 *
 * ⚠️ HORS LIGNE, L'INDEX RESTE VIDE — DONC TOUT OFF.
 * Le réglage ne fait pas partie du snapshot de séance, et c'est un choix
 * assumé : la conséquence est l'ABSENCE d'indicateur, pas une recommandation
 * fausse. L'historique des performances, lui, reste intégralement lisible
 * hors ligne — il vient du snapshot. Porter le réglage dans le snapshot
 * changerait son schéma pour un gain purement cosmétique en salle ; à
 * décider séparément si le besoin se confirme.
 */
export function useProgressionReglages(programId: string | null): IndexReglages {
  const [index, setIndex] = useState<IndexReglages>(VIDE);

  useEffect(() => {
    if (!programId) return;
    const client = createSupabaseBrowserClient();
    if (!client) return;
    let annule = false;
    void getProgressionReglages(client, programId).then((lus) => {
      // Seul l'état affiché intéresse la page de séance ; les identifiants de
      // ligne ne servent qu'à l'écriture groupée du builder.
      if (!annule) setIndex(lus.index);
    });
    return () => {
      annule = true;
    };
  }, [programId]);

  return programId ? index : VIDE;
}
