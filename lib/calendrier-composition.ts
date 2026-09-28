import { addTrainingBlock, type BuilderWorkoutSession, type IdFactory } from "@/lib/training-block-editing";
import { blocsDuModelePourApplication } from "@/lib/bibliotheque-cardio";
import { deriveSessionType } from "@/lib/training-blocks";
import type { AdminWorkoutSession, DerivedSessionType, SessionTemplate, TrainingBlock } from "@/types";

/**
 * COMPOSER UNE SÉANCE À POSER DANS LE CALENDRIER D'UN ATHLÈTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE CALENDRIER N'EST PAS UN OUTIL CARDIO
 * ════════════════════════════════════════════════════════════════════════
 * Une séance posée sur une date est une liste ORDONNÉE de blocs : musculation
 * seule, cardio seul, ou les deux entrelacés. Le « genre » choisi au moment de
 * l'ajout ne fait qu'AMORCER cette liste — il n'est pas stocké, il ne restreint
 * pas la suite, et le coach peut ajouter un bloc cardio à une séance amorcée en
 * musculation sans rien « convertir ».
 *
 * ⚠️ `session_type` RESTE DÉRIVÉ. Il n'existe aucun champ « type de séance »
 * saisissable ici : `deriveSessionType(blocks)` le calcule, et c'est la RPC qui
 * l'écrit. Amorcer en « mixte » puis retirer le bloc cardio produit une séance
 * `strength` — automatiquement, sans divergence possible entre l'étiquette et le
 * contenu.
 *
 * ⚠️ TOUT EST PUR ICI. Aucune écriture, aucun client Supabase, aucun état React :
 * ces fonctions sont testables telles quelles, et c'est ce qui permet de vérifier
 * la conservation du contenu d'un modèle sans monter une base.
 */

/** Ce que le bouton « + » d'une journée propose. */
export type GenreDeSeance = "musculation" | "cardio" | "mixte" | "bibliotheque";

export interface ChoixDAjout {
  readonly cle: GenreDeSeance;
  readonly libelle: string;
  readonly description: string;
}

/**
 * Les quatre entrées du menu « + », dans l'ordre affiché.
 *
 * ⚠️ « BIBLIOTHÈQUE » N'EST PAS UN QUATRIÈME TYPE DE SÉANCE. C'est une origine :
 * le modèle appliqué peut être de la musculation, du cardio ou du mixte, et son
 * contenu décide du reste.
 */
export const CHOIX_DAJOUT: readonly ChoixDAjout[] = [
  {
    cle: "musculation",
    libelle: "Séance musculation",
    description: "Un bloc de musculation vide, à remplir avec la banque d'exercices.",
  },
  {
    cle: "cardio",
    libelle: "Séance cardio",
    description: "Un bloc cardio vide, avec les zones de l'athlète appliquées à ses segments.",
  },
  {
    cle: "mixte",
    libelle: "Séance mixte",
    description: "Un bloc de musculation puis un bloc cardio — l'ordre reste modifiable.",
  },
  {
    cle: "bibliotheque",
    libelle: "Depuis la bibliothèque",
    description: "N'importe quelle séance enregistrée : musculation, cardio ou mixte.",
  },
];

/**
 * Les blocs qui AMORCENT une séance neuve.
 *
 * ⚠️ « bibliotheque » N'AMORCE RIEN. Le contenu vient du modèle choisi, via
 * `blocsDuModelePourApplication` : renvoyer un bloc vide ici le ferait s'ajouter
 * AU modèle appliqué.
 */
export function blocsDeDepart(genre: GenreDeSeance, idFactory?: IdFactory): TrainingBlock[] {
  const vide: BuilderWorkoutSession = { ...SEANCE_NEUTRE, blocks: [] };
  if (genre === "bibliotheque") return [];
  if (genre === "musculation") return addTrainingBlock(vide, "strength", { idFactory }).session.blocks;
  if (genre === "cardio") return addTrainingBlock(vide, "cardio", { idFactory }).session.blocks;
  const avecMuscu = addTrainingBlock(vide, "strength", { idFactory }).session;
  return addTrainingBlock(avecMuscu, "cardio", { idFactory }).session.blocks;
}

/**
 * Les blocs d'un modèle de la bibliothèque, prêts à être posés.
 *
 * ⚠️ DÉLÈGUE, NE RECOPIE PAS. La régénération des identifiants et la
 * normalisation legacy vivent dans `blocsDuModelePourApplication` : un second
 * chemin d'application divergerait du premier.
 *
 * ⚠️ LE MODÈLE SOURCE N'EST PAS TOUCHÉ. Les blocs renvoyés portent de NOUVEAUX
 * identifiants : la séance posée est une copie, et modifier la copie ne peut pas
 * atteindre le modèle.
 */
export function blocsDepuisModele(template: SessionTemplate): TrainingBlock[] {
  return blocsDuModelePourApplication(template);
}

/** Séance de travail neutre — aucun champ de position n'a de sens avant l'écriture. */
const SEANCE_NEUTRE: BuilderWorkoutSession = {
  id: "",
  programId: "",
  weekNumber: 1,
  day: "",
  isRestDay: false,
  name: "",
  muscleGroup: "",
  durationMinutes: 0,
  warmup: "",
  coachNotes: "",
  exercises: [],
  blocks: [],
};

export interface MetaSeance {
  readonly name: string;
  readonly durationMinutes: number | null;
  readonly coachNotes: string;
}

/**
 * La séance que `SessionBlockList` sait éditer, construite pour le calendrier.
 *
 * ⚠️ RÉUTILISE LE BUILDER EXISTANT PLUTÔT QUE D'EN ÉCRIRE UN SECOND. Musculation,
 * exercices, drag des blocs, couleurs : tout existe déjà dans
 * `SessionBlockList`. Ce qu'il faut, c'est une `BuilderWorkoutSession` bien
 * formée — pas un deuxième éditeur de musculation qui divergerait du premier au
 * premier correctif.
 */
export function seanceDeTravail(entree: {
  readonly id?: string;
  readonly programId?: string;
  readonly weekNumber?: number;
  readonly day?: string;
  readonly meta: MetaSeance;
  readonly blocks: readonly TrainingBlock[];
}): BuilderWorkoutSession {
  const blocks = entree.blocks.map((bloc) => ({ ...bloc }));
  return {
    ...SEANCE_NEUTRE,
    id: entree.id ?? "",
    programId: entree.programId ?? "",
    weekNumber: entree.weekNumber ?? 1,
    day: entree.day ?? "",
    name: entree.meta.name,
    durationMinutes: entree.meta.durationMinutes ?? 0,
    coachNotes: entree.meta.coachNotes,
    blocks,
    isRestDay: blocks.length === 0,
  };
}

/** Le type de séance AFFICHÉ — dérivé des blocs, jamais saisi. */
export function typeAffiche(blocks: readonly TrainingBlock[]): DerivedSessionType {
  return deriveSessionType(blocks);
}

export const LIBELLE_TYPE: Readonly<Record<DerivedSessionType, string>> = {
  rest: "Vide",
  strength: "Musculation",
  cardio: "Cardio",
  mixed: "Mixte",
};

/**
 * Ce qui empêche d'enregistrer, en français — ou `null` quand rien n'empêche.
 *
 * ⚠️ AUCUN REPLI SILENCIEUX. Une séance sans nom, sans bloc, ou dont un bloc
 * cardio n'a aucun segment est REFUSÉE : la laisser passer créerait une ligne que
 * l'athlète verrait vide, sans que personne ne sache pourquoi.
 *
 * ⚠️ UN BLOC DE MUSCULATION SANS EXERCICE EST TOLÉRÉ. C'est l'état normal d'une
 * séance que le coach vient d'amorcer et remplira dans la foulée — et le builder
 * de programme l'accepte déjà. Le refuser ici créerait deux règles pour la même
 * donnée.
 */
export function refusDEnregistrement(session: BuilderWorkoutSession): string | null {
  if (session.name.trim() === "") return "La séance a besoin d'un nom.";
  if (session.blocks.length === 0) return "Ajoute au moins un bloc à la séance, ou annule.";
  const cardioVide = session.blocks.find((bloc) => bloc.category === "cardio" && bloc.prescriptions.length === 0);
  if (cardioVide) return "Chaque bloc cardio a besoin d'au moins un segment.";
  return null;
}

/**
 * La séance SYNTHÉTIQUE à passer à `createSessionTemplate`.
 *
 * ⚠️ C'EST UNE COPIE, PAS UN LIEN. Le modèle créé ne suivra jamais les
 * modifications ultérieures de la séance du calendrier, et l'inverse est vrai
 * aussi.
 */
export function modeleDepuisSeance(session: BuilderWorkoutSession): AdminWorkoutSession {
  return {
    ...SEANCE_NEUTRE,
    name: session.name,
    durationMinutes: session.durationMinutes,
    coachNotes: session.coachNotes,
    blocks: session.blocks.map((bloc) => ({ ...bloc })),
    isRestDay: session.blocks.length === 0,
  };
}
