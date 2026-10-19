"use client";

import { useCallback, useEffect, useState } from "react";

import {
  affecterEleve,
  definirPermission,
  getAffectations,
  getElevesAffectables,
  getPermissions,
  getResumesDroits,
  revoquerEleve,
  type EleveAffectable,
  type ResumeDroits,
} from "@/lib/supabase/collaborateurs";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AffectationCollaborateur, CategorieDroit, NiveauDroit, PermissionsCollaborateur } from "@/types";

/**
 * Droits réels d'UN collaborateur, pour la modale de configuration ouverte
 * depuis /admin/parametres : ses élèves explicitement affectés
 * (`collaborateur_eleves`) et son niveau par catégorie
 * (`collaborateur_permissions`).
 *
 * Même forme que `useSupabaseCoaches` : chargement par client de session
 * (les policies `..._manage_admin` / `..._select_self` rendent le verdict),
 * `recharger` après chaque écriture réelle, et aucune valeur inventée — une
 * catégorie absente de `permissions` signifie « aucun accès », elle n'est
 * pas pré-remplie.
 *
 * `erreur` porte le refus tel qu'il revient de PostgreSQL : si la policy
 * refuse (appelant non administrateur), l'interface l'affiche au lieu de
 * faire croire à un enregistrement.
 */
export function useCollaborateurAcces(collaborateurId: string, accordePar: string | null) {
  const [chargement, setChargement] = useState(true);
  const [permissions, setPermissions] = useState<PermissionsCollaborateur>({});
  const [affectations, setAffectations] = useState<AffectationCollaborateur[]>([]);
  const [eleves, setEleves] = useState<EleveAffectable[]>([]);
  const [erreur, setErreur] = useState("");

  const recharger = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErreur("Supabase non configuré.");
      setChargement(false);
      return;
    }
    const [permissionsLues, affectationsLues, elevesLus] = await Promise.all([
      getPermissions(supabase, collaborateurId),
      getAffectations(supabase, collaborateurId),
      getElevesAffectables(supabase),
    ]);
    setPermissions(permissionsLues);
    setAffectations(affectationsLues);
    setEleves(elevesLus);
    setChargement(false);
  }, [collaborateurId]);

  useEffect(() => {
    let annule = false;
    async function charger() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setErreur("Supabase non configuré.");
          setChargement(false);
        }
        return;
      }
      const [permissionsLues, affectationsLues, elevesLus] = await Promise.all([
        getPermissions(supabase, collaborateurId),
        getAffectations(supabase, collaborateurId),
        getElevesAffectables(supabase),
      ]);
      if (annule) return;
      setPermissions(permissionsLues);
      setAffectations(affectationsLues);
      setEleves(elevesLus);
      setChargement(false);
    }
    charger();
    return () => {
      annule = true;
    };
  }, [collaborateurId]);

  const changerNiveau = useCallback(
    async (categorie: CategorieDroit, niveau: NiveauDroit | null) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setErreur("");
      const resultat = await definirPermission(supabase, collaborateurId, categorie, niveau, accordePar);
      if (!resultat.ok) {
        setErreur(resultat.error);
        // On RECHARGE malgré l'échec : l'affichage doit montrer l'état
        // réellement enregistré, pas le choix refusé.
        await recharger();
        return false;
      }
      await recharger();
      return true;
    },
    [collaborateurId, accordePar, recharger],
  );

  const affecter = useCallback(
    async (studentId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setErreur("");
      const resultat = await affecterEleve(supabase, collaborateurId, studentId, accordePar);
      if (!resultat.ok) {
        setErreur(resultat.error);
        await recharger();
        return false;
      }
      await recharger();
      return true;
    },
    [collaborateurId, accordePar, recharger],
  );

  const revoquer = useCallback(
    async (studentId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setErreur("");
      const resultat = await revoquerEleve(supabase, collaborateurId, studentId);
      if (!resultat.ok) {
        setErreur(resultat.error);
        await recharger();
        return false;
      }
      await recharger();
      return true;
    },
    [collaborateurId, recharger],
  );

  return { chargement, permissions, affectations, eleves, erreur, changerNiveau, affecter, revoquer };
}

/**
 * Résumé des droits de tous les collaborateurs, pour la LISTE de
 * /admin/parametres. Séparé de `useCollaborateurAcces` à dessein : la liste
 * n'a besoin que d'un aperçu, et la modale d'un état complet rechargé après
 * chaque écriture.
 *
 * `recharger` est appelé à la fermeture de la modale, pour que la ligne
 * affiche immédiatement ce qui vient d'être enregistré.
 */
export function useResumesDroits() {
  const [resumes, setResumes] = useState<Record<string, ResumeDroits>>({});

  const recharger = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setResumes(await getResumesDroits(supabase));
  }, []);

  useEffect(() => {
    let annule = false;
    async function charger() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const lus = await getResumesDroits(supabase);
      if (!annule) setResumes(lus);
    }
    charger();
    return () => {
      annule = true;
    };
  }, []);

  return { resumes, recharger };
}
