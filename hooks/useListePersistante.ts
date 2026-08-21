"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LigneDeCourses } from "@/lib/nutrition/liste-de-courses";
import type { PeriodeCourses } from "@/lib/nutrition/periode-courses";
import {
  etatDeLaListe,
  lignesAAfficher,
  lignesPourRpc,
  progression,
  type EtatDeLaListe,
  type LigneAffichee,
  type ListePersistee,
  type Progression,
} from "@/lib/nutrition/liste-persistante";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  ajouterArticleManuel,
  cocherLigne,
  lireListeDeCourses,
  modifierArticleManuel,
  regenererListeDeCourses,
  supprimerArticleManuel,
  RpcListeDeCoursesError,
  type ArticleManuel,
} from "@/lib/supabase/liste-de-courses";

/**
 * COURSES C2 — L'ÉTAT DE LA LISTE PERSISTANTE.
 *
 * ⚠️ OUVRIR N'ÉCRIT RIEN (§13). Ce hook LIT au montage et à chaque changement
 * de période ; il ne régénère jamais tout seul. `etat` dit seulement quel
 * bouton montrer — « GÉNÉRER », « METTRE À JOUR », ou aucun.
 *
 * ⚠️ LE COCHAGE EST OPTIMISTE, PUIS RÉCONCILIÉ. L'élève est debout dans un
 * rayon : attendre l'aller-retour réseau avant de noircir la case rendrait la
 * liste inutilisable. En cas de refus, la case revient — et le dit.
 */
export interface EtatListePersistante {
  readonly chargement: boolean;
  /** `false` = la LECTURE a échoué. Ce n'est pas « aucune liste ». */
  readonly ok: boolean;
  readonly liste: ListePersistee | null;
  readonly lignes: readonly LigneAffichee[];
  readonly progression: Progression;
  readonly etat: EtatDeLaListe;
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly recharger: () => void;
  readonly regenerer: () => Promise<boolean>;
  readonly basculer: (ligneId: string, coche: boolean) => Promise<boolean>;
  readonly ajouter: (article: ArticleManuel) => Promise<boolean>;
  readonly modifier: (ligneId: string, article: ArticleManuel) => Promise<boolean>;
  readonly supprimer: (ligneId: string) => Promise<boolean>;
}

export function useListePersistante(
  periode: PeriodeCourses | null,
  lignesDuPlan: readonly LigneDeCourses[],
  studentId: string | null,
): EtatListePersistante {
  const [liste, setListe] = useState<ListePersistee | null>(null);
  const [ok, setOk] = useState(true);
  const [chargement, setChargement] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rafraichissement, setRafraichissement] = useState(0);

  const debut = periode?.debut ?? null;
  const fin = periode?.fin ?? null;
  const actif = debut !== null && fin !== null && studentId !== null;

  // ⚠️ COMPTEUR DE REQUÊTE, comme `useConsumedMeals`. Deux périodes choisies
  // coup sur coup peuvent revenir dans le désordre : sans lui, la réponse de la
  // première écraserait celle de la seconde.
  const requete = useRef(0);

  const charger = useCallback(async () => {
    const numero = ++requete.current;
    if (!actif) {
      setListe(null);
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
    const lecture = await lireListeDeCourses(supabase, debut, fin);
    if (numero !== requete.current) return;
    setOk(lecture.ok);
    setListe(lecture.liste);
    setChargement(false);
  }, [actif, debut, fin]);

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

  const recharger = useCallback(() => setRafraichissement((n) => n + 1), []);

  const lignes = useMemo(() => lignesAAfficher(liste, lignesDuPlan), [liste, lignesDuPlan]);
  const prog = useMemo(() => progression(lignes), [lignes]);
  const etat = useMemo(() => etatDeLaListe(liste, lignesDuPlan), [liste, lignesDuPlan]);

  const regenerer = useCallback(async (): Promise<boolean> => {
    if (debut === null || fin === null) return false;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return false;
    setEnCours(true);
    setErreur(null);
    try {
      await regenererListeDeCourses(supabase, debut, fin, lignesPourRpc(lignesDuPlan));
      return true;
    } catch (e) {
      setErreur(e instanceof RpcListeDeCoursesError ? e.code : "ERREUR_INCONNUE");
      return false;
    } finally {
      setEnCours(false);
      setRafraichissement((n) => n + 1);
    }
  }, [debut, fin, lignesDuPlan]);

  /**
   * Coche / décoche. L'état local part en avant, la base confirme.
   *
   * ⚠️ EN CAS DE REFUS ON NE « REMET PAS COMME AVANT » À L'AVEUGLE : on
   * recharge. Restaurer localement supposerait qu'on sait ce que la base
   * contient, ce qui est précisément ce dont on vient de douter.
   */
  const basculer = useCallback(async (ligneId: string, coche: boolean): Promise<boolean> => {
    setListe((actuelle) =>
      actuelle === null
        ? actuelle
        : {
            ...actuelle,
            lignes: actuelle.lignes.map((l) => (l.id === ligneId ? { ...l, checked: coche } : l)),
          },
    );
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return false;
    const reussi = await cocherLigne(supabase, ligneId, coche);
    if (!reussi) {
      setErreur("COCHAGE_REFUSE");
      setRafraichissement((n) => n + 1);
    }
    return reussi;
  }, []);

  const ajouter = useCallback(
    async (article: ArticleManuel): Promise<boolean> => {
      if (liste === null || studentId === null) return false;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setEnCours(true);
      setErreur(null);
      try {
        const reussi = await ajouterArticleManuel(supabase, liste.id, studentId, article);
        if (!reussi) setErreur("AJOUT_REFUSE");
        return reussi;
      } finally {
        setEnCours(false);
        setRafraichissement((n) => n + 1);
      }
    },
    [liste, studentId],
  );

  const modifier = useCallback(
    async (ligneId: string, article: ArticleManuel): Promise<boolean> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setEnCours(true);
      setErreur(null);
      try {
        await modifierArticleManuel(supabase, ligneId, article);
        return true;
      } catch (e) {
        setErreur(e instanceof RpcListeDeCoursesError ? e.code : "ERREUR_INCONNUE");
        return false;
      } finally {
        setEnCours(false);
        setRafraichissement((n) => n + 1);
      }
    },
    [],
  );

  const supprimer = useCallback(async (ligneId: string): Promise<boolean> => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return false;
    setEnCours(true);
    setErreur(null);
    try {
      const reussi = await supprimerArticleManuel(supabase, ligneId);
      // ⚠️ « AUCUNE ERREUR » N'EST PAS « SUPPRIMÉ ». Une ligne PLAN passe la
      // requête sans être vue par la policy : zéro ligne rendue, aucune erreur.
      if (!reussi) setErreur("SUPPRESSION_REFUSEE");
      return reussi;
    } finally {
      setEnCours(false);
      setRafraichissement((n) => n + 1);
    }
  }, []);

  return {
    chargement,
    ok,
    liste,
    lignes,
    progression: prog,
    etat,
    enCours,
    erreur,
    recharger,
    regenerer,
    basculer,
    ajouter,
    modifier,
    supprimer,
  };
}
