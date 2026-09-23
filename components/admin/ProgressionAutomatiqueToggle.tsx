"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getProgressionReglages,
  setProgressionReglagesEnLot,
  type ReglagesLus,
} from "@/lib/supabase/progression-reglage";
import {
  cleReglageDeLExercice,
  indexApresBascule,
  indexerIdentifiants,
  indexerReglages,
  lotsDEcriture,
  progressionActivePour,
  type ExercicePourReglage,
  type IdentifiantsReglages,
  type IndexReglages,
} from "@/lib/progression-reglage";

/**
 * LE BOUTON « PROGRESSION AUTO » — UN RÉGLAGE, N BOUTONS, DEUX REQUÊTES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN CONTEXTE ET PAS DES PROPS
 * ════════════════════════════════════════════════════════════════════════
 * Le réglage est GLOBAL à l'exercice dans le programme : toutes ses
 * occurrences, toutes semaines confondues, doivent afficher le même état et
 * basculer ensemble. Plutôt que d'enfiler l'état à travers quatre niveaux de
 * composants en espérant que personne n'oublie de le transmettre, il n'existe
 * qu'UN index de réglages pour tout le builder : deux boutons du même exercice
 * ne PEUVENT pas diverger, parce qu'ils lisent la même entrée.
 *
 * ⚠️ LA CLÉ NE CONTIENT NI SEMAINE, NI SÉANCE, NI BLOC. Voir
 * lib/progression-reglage.ts : c'est ce qui rend le réglage global par
 * construction plutôt que par recopie.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE CLIC N'ÉCRIT RIEN — C'EST « ENREGISTRER » QUI ÉCRIT
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ DEUX ARCHITECTURES ONT PRÉCÉDÉ CELLE-CI, ET LES DEUX COÛTAIENT CHER.
 *
 *   1. UNE REQUÊTE PAR CLIC, EN TIR SANS ATTENTE. Régler 50 exercices
 *      lançait 50 à 100 requêtes en rafale (un `update`, puis un `insert`
 *      quand la ligne n'existait pas encore). Ces requêtes restaient en vol
 *      et faisaient la queue devant les 59 allers-retours SÉQUENTIELS de la
 *      sauvegarde du programme : la cause mesurée du passage de ~15 s à
 *      plusieurs minutes.
 *
 *   2. UN TAMPON VIDÉ APRÈS UN DÉLAI. Deux requêtes au lieu de cent, mais
 *      elles partaient toujours À UN MOMENT QUE PERSONNE NE CHOISIT — 400 ms
 *      après le dernier clic, donc très probablement PENDANT la sauvegarde
 *      que le coach venait de lancer. La contention restait possible.
 *
 * ⚠️ DÉSORMAIS, LE CLIC EST PUREMENT LOCAL. Il met l'index à jour
 * immédiatement (l'interface ne doit rien attendre), dépose la bascule dans
 * un tampon indexé par exercice, et SIGNALE au builder qu'il y a des
 * modifications non enregistrées. Aucune requête. La persistance est
 * déclenchée par `handleSave`, via `enregistrerRef`, AVANT la sauvegarde du
 * programme : deux requêtes, à un instant choisi, sans jamais concurrencer
 * les 56 RPC séquentielles.
 *
 * Le réglage se comporte donc comme TOUS LES AUTRES CHAMPS du builder : local
 * jusqu'à « Enregistrer ».
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE ET SIGNALÉE : une bascule faite puis abandonnée sans
 * enregistrer n'est PAS persistée. C'est un changement par rapport à la
 * version précédente, qui vidait le tampon au démontage — et c'est le prix de
 * l'alignement sur les autres champs. Le statut « Modifications non
 * enregistrées » le dit à l'écran.
 *
 * Le calcul de progression lui-même n'a AUCUNE empreinte dans le chemin de
 * sauvegarde — vérifié : la table n'est référencée ni par
 * `lib/supabase/programs.ts`, ni par la RPC `save_training_session_blocks`,
 * ni par aucun déclencheur.
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
const VIDE_IDS: IdentifiantsReglages = indexerIdentifiants([]);

/** Lecture des réglages d'un programme — remplaçable en test. */
export type LecteurReglages = (programId: string) => Promise<ReglagesLus>;
/** Écriture groupée — remplaçable en test. */
export type EcrivainReglages = (
  lots: Parameters<typeof setProgressionReglagesEnLot>[1],
) => Promise<{ ok: true; requetes: number } | { ok: false; message: string; requetes: number }>;

/**
 * Supabase non configuré rend `null` (chemin de démonstration) : la lecture
 * donne alors un index VIDE — tout OFF — et l'écriture refuse en le disant.
 * Jamais une exception qui viderait le builder.
 */
async function lecteurParDefaut(programId: string): Promise<ReglagesLus> {
  const client = createSupabaseBrowserClient();
  if (!client) return { index: VIDE, identifiants: VIDE_IDS };
  return getProgressionReglages(client, programId);
}

const ecrivainParDefaut: EcrivainReglages = async (lots) => {
  const client = createSupabaseBrowserClient();
  if (!client) return { ok: false, message: "base de données non configurée", requetes: 0 };
  return setProgressionReglagesEnLot(client, lots);
};

/**
 * LA PERSISTANCE DES RÉGLAGES, APPELÉE PAR LE BUILDER.
 *
 * Rendue par le fournisseur dans `enregistrerRef` : c'est la seule façon pour
 * `handleSave` de déclencher l'écriture, le builder rendant le fournisseur
 * comme son propre enfant et n'ayant donc pas accès au contexte.
 *
 * `requetes: 0` signifie « rien à écrire », pas « échec ».
 */
export type EnregistrerReglages = () => Promise<{ ok: boolean; requetes: number }>;

/** Une bascule en attente d'écriture. */
interface BasculeEnAttente {
  readonly exercice: ExercicePourReglage;
  readonly progressionActive: boolean;
}

export function ProgressionReglageProvider({
  programId,
  children,
  indexInitial,
  lire = lecteurParDefaut,
  ecrire = ecrivainParDefaut,
  enregistrerRef,
  onModificationLocale,
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
  ecrire?: EcrivainReglages;
  /**
   * LA POIGNÉE DE PERSISTANCE, remplie par le fournisseur et appelée par
   * `handleSave`.
   *
   * ⚠️ C'EST UNE RÉFÉRENCE ET NON UN RAPPEL, parce que le sens de l'appel est
   * inversé : ce n'est pas le fournisseur qui prévient le builder, c'est le
   * builder qui décide QUAND écrire. Le builder rend le fournisseur comme son
   * propre enfant, il ne peut donc pas lire le contexte.
   */
  enregistrerRef?: { current: EnregistrerReglages | null };
  /**
   * Prévient le builder qu'une bascule a changé l'état LOCAL — il passe alors
   * en « Modifications non enregistrées », comme pour n'importe quel autre
   * champ. Sans ce signal, le coach croirait son réglage déjà enregistré.
   */
  onModificationLocale?: () => void;
}) {
  const [lus, setLus] = useState<IndexReglages>(() => indexInitial ?? VIDE);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Les identifiants de ligne et le tampon de bascules vivent dans des refs :
  // ils ne changent jamais ce qui est AFFICHÉ, et les mettre dans l'état
  // provoquerait un rendu par clic sans rien ajouter à l'écran.
  const identifiants = useRef<IdentifiantsReglages>(VIDE_IDS);
  const enAttente = useRef(new Map<string, BasculeEnAttente>());

  // Le signal « c'est modifié » passe par une ref pour que `basculer` ne
  // dépende pas de l'identité d'un rappel recréé à chaque rendu du builder :
  // sinon chaque rendu recréerait le contexte et rerendrait tous les boutons.
  const signalerModification = useRef(onModificationLocale);
  useEffect(() => {
    signalerModification.current = onModificationLocale;
  }, [onModificationLocale]);

  // ⚠️ AUCUN `setState` SYNCHRONE DANS L'EFFET (règle react-hooks
  // `set-state-in-effect`). Sans programme, il n'y a rien à lire : l'index
  // effectif est simplement vide, calculé au rendu.
  const index = programId ? lus : VIDE;

  useEffect(() => {
    if (!programId) return;
    let annule = false;
    void lire(programId).then((resultat) => {
      if (annule) return;
      identifiants.current = resultat.identifiants;
      setLus(resultat.index);
    });
    return () => {
      annule = true;
    };
  }, [programId, lire]);

  /**
   * Vide le tampon en une écriture groupée.
   *
   * Le tampon est prélevé AVANT l'appel réseau : une bascule faite pendant
   * l'écriture entre dans le tampon suivant plutôt que d'être perdue ou
   * envoyée deux fois.
   */
  const enregistrerLesReglages = useCallback<EnregistrerReglages>(async () => {
    if (!programId || enAttente.current.size === 0) return { ok: true, requetes: 0 };
    const aEcrire = enAttente.current;
    enAttente.current = new Map();

    const lots = lotsDEcriture(programId, aEcrire, identifiants.current);
    if (lots.aMettreAJour.length === 0 && lots.aInserer.length === 0) return { ok: true, requetes: 0 };

    setEnCours(true);
    const resultat = await ecrire(lots);
    setEnCours(false);
    if (resultat.ok) {
      // Les lignes insérées ont reçu un identifiant que nous n'avons pas
      // demandé en retour : la prochaine lecture le ramènera. En attendant,
      // une nouvelle bascule du même exercice repartira en `insert` et
      // échouerait sur l'index d'unicité — donc on relit, une fois, et
      // seulement quand une insertion a réellement eu lieu.
      if (lots.aInserer.length > 0) {
        const relu = await lire(programId);
        identifiants.current = relu.identifiants;
      }
      return { ok: true, requetes: resultat.requetes };
    }
    // ÉCHEC : les bascules repartent dans le tampon pour ne pas être perdues,
    // et l'état affiché revient à ce que la base porte réellement.
    setErreur(`Réglage non enregistré : ${resultat.message}`);
    const relu = await lire(programId);
    identifiants.current = relu.identifiants;
    setLus(relu.index);
    return { ok: false, requetes: resultat.requetes };
  }, [programId, ecrire, lire]);

  // La poignée est posée DANS un effet, jamais pendant le rendu (règle
  // react-hooks/refs) : écrire `ref.current` au rendu rend le composant impur.
  useEffect(() => {
    if (!enregistrerRef) return;
    enregistrerRef.current = enregistrerLesReglages;
    return () => {
      enregistrerRef.current = null;
    };
  }, [enregistrerRef, enregistrerLesReglages]);

  const basculer = useCallback(
    (exercice: ExercicePourReglage, actif: boolean) => {
      if (!programId) {
        setErreur("Enregistrez le programme avant de régler la progression automatique.");
        return;
      }
      const cle = cleReglageDeLExercice(exercice);
      if (!cle) {
        setErreur("Cet exercice n'a pas de nom : impossible de lui attacher un réglage.");
        return;
      }
      // L'écran change TOUT DE SUITE — c'est ce qui fait que les autres
      // occurrences du même exercice se mettent à jour sous les yeux du coach.
      setLus((precedent) => indexApresBascule(precedent, exercice, actif));
      setErreur(null);
      // Indexé par exercice : deux bascules du même exercice n'écrivent que
      // son état final.
      enAttente.current.set(cle, { exercice, progressionActive: actif });
      // ⚠️ AUCUNE REQUÊTE ICI, ET AUCUNE MINUTERIE. La persistance appartient
      // à « Enregistrer » — voir l'en-tête du fichier. On se contente de dire
      // au builder qu'il a des modifications non enregistrées.
      signalerModification.current?.();
    },
    [programId],
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
