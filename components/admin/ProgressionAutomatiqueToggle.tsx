"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getProgressionReglages, setProgressionReglage } from "@/lib/supabase/progression-reglage";
import {
  ecritureDuReglage,
  indexApresBascule,
  indexerReglages,
  progressionActivePour,
  type ExercicePourReglage,
  type IndexReglages,
} from "@/lib/progression-reglage";

/**
 * LE BOUTON « PROGRESSION AUTO » — UN RÉGLAGE, N BOUTONS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN CONTEXTE ET PAS DES PROPS
 * ════════════════════════════════════════════════════════════════════════
 * Le réglage est GLOBAL à l'exercice dans le programme : toutes ses
 * occurrences, toutes semaines confondues, doivent afficher le même état et
 * basculer ensemble. Deux façons de l'obtenir :
 *
 *   — enfiler l'état et le gestionnaire à travers quatre niveaux de
 *     composants (ProgramBuilderFullscreen → SessionBlockPanel →
 *     SessionBlockList → TrainingBlockCard → l'éditeur de bloc), puis
 *     espérer que personne n'oublie de les transmettre ;
 *   — ou poser UNE source unique que chaque bouton lit directement.
 *
 * C'est la seconde. Il n'existe qu'un index de réglages pour tout le
 * builder : deux boutons du même exercice ne PEUVENT pas diverger, parce
 * qu'ils lisent la même entrée de la même table. Aucune synchronisation à
 * écrire, donc aucune à oublier.
 *
 * ⚠️ LA CLÉ NE CONTIENT NI SEMAINE, NI SÉANCE, NI BLOC. Voir
 * lib/progression-reglage.ts : c'est ce qui rend le réglage global par
 * construction plutôt que par recopie.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ÉCRITURE OPTIMISTE, ET RETOUR EN ARRIÈRE EN CAS D'ÉCHEC
 * ────────────────────────────────────────────────────────────────────────
 * Le bouton change d'état immédiatement — c'est ce qui fait que les autres
 * occurrences se mettent à jour sous les yeux du coach. Si l'écriture
 * échoue, l'index revient à sa valeur précédente et le message est affiché :
 * jamais un bouton allumé sur un réglage que la base n'a pas reçu.
 */

interface ContexteProgression {
  /** `null` quand le programme n'existe pas encore en base. */
  readonly programId: string | null;
  readonly index: IndexReglages;
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly basculer: (exercice: ExercicePourReglage, actif: boolean) => void;
}

const Contexte = createContext<ContexteProgression | null>(null);

/** Index vide partagé — « aucun réglage lu », donc tout OFF. */
const VIDE: IndexReglages = indexerReglages([]);

/** Lecture des réglages d'un programme — remplaçable en test. */
export type LecteurReglages = (programId: string) => Promise<IndexReglages>;
/** Écriture d'un réglage — remplaçable en test. */
export type EcrivainReglage = (
  ecriture: ReturnType<typeof ecritureDuReglage>,
) => Promise<{ ok: true } | { ok: false; message: string }>;

/**
 * Supabase non configuré rend `null` (chemin de démonstration) : la lecture
 * donne alors un index VIDE — tout OFF — et l'écriture refuse en le disant.
 * Jamais une exception qui viderait le builder.
 */
async function lecteurParDefaut(programId: string): Promise<IndexReglages> {
  const client = createSupabaseBrowserClient();
  if (!client) return indexerReglages([]);
  return getProgressionReglages(client, programId);
}

const ecrivainParDefaut: EcrivainReglage = async (ecriture) => {
  if (!ecriture) return { ok: false, message: "exercice sans identité" };
  const client = createSupabaseBrowserClient();
  if (!client) return { ok: false, message: "base de données non configurée" };
  return setProgressionReglage(client, ecriture);
};

export function ProgressionReglageProvider({
  programId,
  children,
  indexInitial,
  lire = lecteurParDefaut,
  ecrire = ecrivainParDefaut,
}: {
  programId: string | null;
  /** Optionnel pour que `createElement(Provider, props, ...enfants)` type. */
  children?: ReactNode;
  /**
   * Réglages connus AVANT le premier rendu.
   *
   * En production, personne ne le passe : l'index arrive par `lire`, dans un
   * effet. Il existe parce qu'un rendu serveur n'exécute AUCUN effet — un
   * test de rendu ne pourrait donc jamais observer un bouton allumé, et la
   * propriété « toutes les occurrences affichent le même état » serait
   * invérifiable autrement qu'en la paraphrasant.
   */
  indexInitial?: IndexReglages;
  lire?: LecteurReglages;
  ecrire?: EcrivainReglage;
}) {
  const [lus, setLus] = useState<IndexReglages>(() => indexInitial ?? indexerReglages([]));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // ⚠️ AUCUN `setState` SYNCHRONE DANS L'EFFET (règle react-hooks
  // `set-state-in-effect`). Sans programme, il n'y a rien à lire : l'index
  // effectif est simplement vide, calculé au rendu — pas remis à zéro par un
  // effet, ce qui provoquerait un second rendu inutile à chaque montage.
  const index = programId ? lus : VIDE;

  useEffect(() => {
    if (!programId) return;
    let annule = false;
    void lire(programId).then((resultat) => {
      if (!annule) setLus(resultat);
    });
    return () => {
      annule = true;
    };
  }, [programId, lire]);

  const basculer = useCallback(
    (exercice: ExercicePourReglage, actif: boolean) => {
      if (!programId) {
        setErreur("Enregistrez le programme avant de régler la progression automatique.");
        return;
      }
      const ecriture = ecritureDuReglage(programId, exercice, actif);
      if (!ecriture) {
        setErreur("Cet exercice n'a pas de nom : impossible de lui attacher un réglage.");
        return;
      }
      const precedent = index;
      setLus(indexApresBascule(index, exercice, actif));
      setErreur(null);
      setEnCours(true);
      void ecrire(ecriture).then((resultat) => {
        setEnCours(false);
        if (!resultat.ok) {
          // RETOUR EN ARRIÈRE : l'état affiché ne survit pas à l'échec.
          setLus(precedent);
          setErreur(`Réglage non enregistré : ${resultat.message}`);
        }
      });
    },
    [programId, index, ecrire],
  );

  const valeur = useMemo<ContexteProgression>(
    () => ({ programId, index, enCours, erreur, basculer }),
    [programId, index, enCours, erreur, basculer],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/**
 * Le bouton d'UNE occurrence.
 *
 * Hors du fournisseur, il ne rend RIEN plutôt que de s'afficher inerte : un
 * interrupteur qui ne commande rien est pire qu'un interrupteur absent.
 */
export function ProgressionAutomatiqueToggle({ exercise }: { exercise: ExercicePourReglage }) {
  const contexte = useContext(Contexte);
  if (!contexte) return null;

  const actif = progressionActivePour(contexte.index, exercise);
  const nom = exercise.name?.trim() || "(sans nom)";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={`Progression automatique de ${nom} — réglage commun à toutes les semaines du programme`}
      title={
        contexte.programId
          ? "Réglage commun à toutes les occurrences de cet exercice dans le programme"
          : "Enregistrez le programme pour régler la progression automatique"
      }
      disabled={!contexte.programId}
      onClick={() => contexte.basculer(exercise, !actif)}
      className={`inline-flex min-h-11 items-center gap-1.5 px-1 text-[11px] uppercase tracking-widest transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${
        actif ? "text-primary" : "text-muted-foreground hover:text-primary"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${actif ? "bg-primary" : "bg-muted-foreground/40"}`}
      />
      Progression auto {actif ? "activée" : "désactivée"}
    </button>
  );
}

/** Le message d'échec du dernier réglage, à afficher une fois par builder. */
export function ProgressionReglageErreur() {
  const contexte = useContext(Contexte);
  if (!contexte?.erreur) return null;
  return (
    <p role="status" className="px-1 text-[11px] text-red-600 dark:text-red-400">
      {contexte.erreur}
    </p>
  );
}
