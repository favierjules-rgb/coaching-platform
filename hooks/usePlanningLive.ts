"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAssignedProgramsForStudent } from "@/lib/supabase/programs";
import { getStudentById } from "@/lib/supabase/students";
import { seancesTermineesDeLEleve } from "@/lib/supabase/workout-feedback";
import type { AdminProgram, SupabaseStudent } from "@/types";

/**
 * MODE LIVE — LE PLANNING D'UN ÉLÈVE, VU PAR SON COACH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TROIS LECTURES, TOUTES DÉJÀ ÉCRITES AILLEURS
 * ════════════════════════════════════════════════════════════════════════════
 * Ce hook est le pendant coach de `useSupabaseTrainingProgram`, et il appelle
 * EXACTEMENT les mêmes fonctions de lecture — `getAssignedProgramsForStudent`,
 * `seancesTermineesDeLEleve` — en leur passant l'élève de la fiche au lieu du
 * compte connecté. C'est tout ce qui change.
 *
 * ⚠️ POURQUOI PAS RÉUTILISER `useSupabaseTrainingProgram` TEL QUEL ? Parce
 * qu'il dérive son élève de `getCurrentStudentId()`, qui vaut `null` pour un
 * coach : le hook rendrait « aucun programme » et l'écran serait vide. Le
 * paramétrer aurait voulu dire lui ajouter un mode, et son abonnement Realtime
 * avec — un flux temps réel sur les programmes de chaque élève ouvert par un
 * coach, pour une page qu'on garde ouverte une heure en salle. On lit une fois,
 * et on recharge sur demande.
 *
 * ⚠️ `getAssignedProgramsForStudent` EST LA SEULE LECTURE QUI PORTE LA DATE DE
 * DÉBUT DE L'AFFECTATION (`programStartDate`). C'est elle qui fait que la
 * semaine courante calculée ici est celle de CET élève, et non celle du
 * modèle — deux élèves sur la même programmation ne sont pas à la même semaine.
 * Lire le programme par `useSupabaseProgram(programId)` aurait perdu cette
 * date, et le planning aurait affiché la semaine 1 à tout le monde.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE HOOK N'ACCORDE AUCUN DROIT
 * ════════════════════════════════════════════════════════════════════════════
 * Les trois lectures passent par le client du NAVIGATEUR, donc sous la RLS du
 * compte connecté : un identifiant d'élève forgé ne rend rien. Et la page qui
 * monte ce hook est gardée côté serveur AVANT tout rendu
 * (`requirePresentielAccess` + vérification de l'affectation) — ce hook n'est
 * jamais le premier contrôle, il est le dernier filet.
 */

export interface EtatPlanningLive {
  readonly chargement: boolean;
  /** Le programme TEL QU'IL EST AFFECTÉ à cet élève, date de début comprise. */
  readonly programme: AdminProgram | null;
  /**
   * La fiche de l'élève, dans sa forme LÉGÈRE.
   *
   * ⚠️ `SupabaseStudent` ET PAS `AdminStudent` : on n'a besoin que du nom (pour
   * le bandeau) et de `startDate` (repli d'ancrage de la semaine quand
   * l'affectation ne porte pas de date). Charger la fiche complète aurait
   * voulu dire lire mesures, photos, paiements et historique pour afficher un
   * prénom.
   */
  readonly eleve: SupabaseStudent | null;
  /** Séances que l'élève a validées. `null` = pas encore su, ≠ « aucune ». */
  readonly seancesTerminees: ReadonlySet<string> | null;
  /**
   * `true` quand la programmation n'est PAS affectée à cet élève.
   *
   * ⚠️ DISTINCT DE « chargement terminé sans programme ». Le serveur a déjà
   * refusé ce cas avant le rendu ; si on le rencontre tout de même, c'est que
   * l'affectation a été retirée PENDANT la séance. On le dit plutôt que
   * d'afficher un planning vide qui ressemblerait à un programme sans séances.
   */
  readonly affectationIntrouvable: boolean;
  readonly recharger: () => void;
}

export function usePlanningLive(programId: string, studentId: string): EtatPlanningLive {
  const [chargement, setChargement] = useState(true);
  const [programme, setProgramme] = useState<AdminProgram | null>(null);
  const [eleve, setEleve] = useState<SupabaseStudent | null>(null);
  const [seancesTerminees, setSeancesTerminees] = useState<ReadonlySet<string> | null>(null);
  const [affectationIntrouvable, setAffectationIntrouvable] = useState(false);
  const [tour, setTour] = useState(0);

  const recharger = useCallback(() => setTour((t) => t + 1), []);

  useEffect(() => {
    let annule = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) setChargement(false);
        return;
      }
      const [programmes, fiche, validees] = await Promise.all([
        getAssignedProgramsForStudent(supabase, studentId),
        getStudentById(supabase, studentId),
        seancesTermineesDeLEleve(supabase, studentId),
      ]);
      if (annule) return;

      /* ⚠️ ON CHERCHE PAR IDENTIFIANT DANS LES PROGRAMMES AFFECTÉS À CET
         ÉLÈVE — jamais par nom, et jamais dans la liste générale des
         programmations. Absent de cette liste = non affecté à cet élève. */
      const trouve = programmes.find((p) => p.id === programId) ?? null;
      setProgramme(trouve);
      setAffectationIntrouvable(trouve === null);
      setEleve(fiche);
      // `complet: false` (lecture refusée ou partielle) reste `null` : une
      // barre de progression à 0 % mentirait sur un élève qui a tout fait.
      setSeancesTerminees(validees.complet ? validees.seances : null);
      setChargement(false);
    })();
    return () => {
      annule = true;
    };
  }, [programId, studentId, tour]);

  return {
    chargement,
    programme,
    eleve,
    seancesTerminees,
    affectationIntrouvable,
    recharger,
  };
}
