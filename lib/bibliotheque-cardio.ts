import { templateBlocksForApply } from "@/lib/session-template-content";
import type { AdminWorkoutSession, CardioTrainingBlock, SessionTemplate, SportCardio, TrainingBlock } from "@/types";

/**
 * LA BIBLIOTHÈQUE CARDIO — la banque de séances existante, lue par le cardio.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUNE TABLE NOUVELLE, ET C'EST LE POINT
 * ════════════════════════════════════════════════════════════════════════
 * `session_templates.content` est un jsonb qui porte déjà
 * `{ format: "canonical-blocks-v1", blocks: TrainingBlock[] }` — donc des blocs
 * cardio complets, prescriptions comprises. Créer une table
 * `cardio_templates` aurait dupliqué le stockage, les RLS, la duplication par
 * valeur et l'écran de gestion, pour la même donnée.
 *
 * ⚠️ UN MODÈLE EST UNE COPIE PAR VALEUR, PAS UNE RÉFÉRENCE VIVANTE. Appliquer
 * un modèle régénère les identifiants (`templateBlocksForApply`) : modifier le
 * modèle plus tard ne touche AUCUNE séance déjà construite depuis lui, et
 * modifier la séance ne touche pas le modèle. C'est la règle de la banque de
 * séances depuis juillet 2026, et elle vaut ici sans changement.
 *
 * ⚠️ 13 MODÈLES EN PRODUCTION, DONT 0 CARDIO (mesuré le 28/09/2026). Le filtre
 * ci-dessous rendra donc une liste vide au premier affichage — ce n'est pas une
 * panne, et l'écran doit le dire plutôt que d'afficher un cadre vide.
 */

/** Les blocs cardio d'un modèle. */
export function blocsCardioDuModele(template: SessionTemplate): CardioTrainingBlock[] {
  return template.blocks.filter((bloc): bloc is CardioTrainingBlock => bloc.category === "cardio");
}

/**
 * `true` quand le modèle contient AU MOINS un bloc cardio.
 *
 * ⚠️ LE FILTRE PORTE SUR LES BLOCS, PAS SUR `session_type`. La colonne peut
 * valoir « mixed » : une séance mixte est un modèle cardio légitime, et
 * l'exclure priverait le coach de ses séances les plus fréquentes (287 des 847
 * séances de production sont mixtes).
 */
export function estModeleCardio(template: SessionTemplate): boolean {
  return blocsCardioDuModele(template).length > 0;
}

/**
 * Le résumé d'un modèle QUELCONQUE de la banque — musculation, cardio ou mixte.
 *
 * ⚠️ LE CALENDRIER N'EST PAS RÉSERVÉ AU CARDIO. Le coach doit pouvoir poser
 * une séance de musculation existante sur une date : filtrer la banque sur le
 * cardio lui cacherait la moitié de ses séances, et l'obligerait à repasser par
 * le builder de programme pour une opération de calendrier.
 */
export interface ResumeModele {
  readonly id: string;
  readonly nom: string;
  readonly description: string;
  readonly dureeMinutes: number | null;
  /** « Musculation », « Cardio », « Mixte » — dérivé des BLOCS, jamais saisi. */
  readonly categorie: "Musculation" | "Cardio" | "Mixte" | "Vide";
  readonly nombreDeBlocsCardio: number;
  readonly nombreDeSegments: number;
  readonly nombreDExercices: number;
  readonly sports: readonly SportCardio[];
}

export function resumeDuModele(template: SessionTemplate): ResumeModele {
  const cardio = blocsCardioDuModele(template);
  const muscu = template.blocks.filter((bloc) => bloc.category === "strength");
  const sports: SportCardio[] = [];
  for (const bloc of cardio) {
    if (bloc.sport && !sports.includes(bloc.sport)) sports.push(bloc.sport);
  }
  const categorie =
    cardio.length > 0 && muscu.length > 0
      ? "Mixte"
      : cardio.length > 0
        ? "Cardio"
        : muscu.length > 0
          ? "Musculation"
          : "Vide";
  return {
    id: template.id,
    nom: template.name,
    description: template.description,
    dureeMinutes: template.durationMinutes,
    categorie,
    nombreDeBlocsCardio: cardio.length,
    nombreDeSegments: cardio.reduce((total, bloc) => total + bloc.prescriptions.length, 0),
    nombreDExercices: muscu.reduce((total, bloc) => total + (bloc.category === "strength" ? bloc.exercises.length : 0), 0),
    sports,
  };
}

/**
 * TOUS les modèles de la banque, triés par nom.
 *
 * ⚠️ AUCUN FILTRE. `modelesCardio` reste disponible là où seul le cardio a du
 * sens ; le calendrier, lui, pose n'importe quelle séance.
 */
export function modelesDuCalendrier(templates: readonly SessionTemplate[]): SessionTemplate[] {
  return templates.slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export interface ResumeModeleCardio {
  readonly id: string;
  readonly nom: string;
  readonly description: string;
  readonly dureeMinutes: number | null;
  readonly nombreDeBlocs: number;
  readonly nombreDeSegments: number;
  readonly sports: readonly SportCardio[];
  /** `true` si le modèle porte aussi de la musculation. */
  readonly avecMusculation: boolean;
}

export function resumeDuModeleCardio(template: SessionTemplate): ResumeModeleCardio {
  const cardio = blocsCardioDuModele(template);
  const sports: SportCardio[] = [];
  for (const bloc of cardio) {
    if (bloc.sport && !sports.includes(bloc.sport)) sports.push(bloc.sport);
  }
  return {
    id: template.id,
    nom: template.name,
    description: template.description,
    dureeMinutes: template.durationMinutes,
    nombreDeBlocs: cardio.length,
    nombreDeSegments: cardio.reduce((total, bloc) => total + bloc.prescriptions.length, 0),
    sports,
    avecMusculation: template.blocks.some((bloc) => bloc.category === "strength"),
  };
}

/** Les modèles cardio de la banque, triés par nom. */
export function modelesCardio(templates: readonly SessionTemplate[]): SessionTemplate[] {
  return templates.filter(estModeleCardio).slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/**
 * Les blocs d'un modèle, prêts à être posés dans une séance.
 *
 * ⚠️ DÉLÈGUE À `templateBlocksForApply` — c'est là que vivent la normalisation
 * legacy/canonique et la régénération des identifiants. Recopier ce traitement
 * ici produirait une seconde façon d'appliquer un modèle, et donc deux
 * comportements divergents.
 */
export function blocsDuModelePourApplication(template: SessionTemplate): TrainingBlock[] {
  return templateBlocksForApply({ format: "canonical-blocks-v1", blocks: template.blocks });
}

/**
 * La séance SYNTHÉTIQUE qu'attend `createSessionTemplate`.
 *
 * ⚠️ ELLE N'EST JAMAIS PERSISTÉE. `createSessionTemplate` lit `blocks`,
 * `muscleGroup`, `durationMinutes`, `warmup` et `coachNotes` et n'écrit que dans
 * `session_templates` : les champs de position (`programId`, `weekNumber`,
 * `day`) n'ont aucun sens pour un modèle et sont neutres. Passer par cette
 * fonction évite d'écrire un second INSERT dans `session_templates`, qui
 * divergerait du premier.
 */
export function seanceSyntheticPourModele(entree: {
  readonly name: string;
  readonly durationMinutes: number | null;
  readonly coachNotes: string;
  readonly blocks: readonly TrainingBlock[];
}): AdminWorkoutSession {
  return {
    id: "modele-cardio",
    programId: "",
    weekNumber: 1,
    day: "Lundi",
    isRestDay: false,
    name: entree.name,
    muscleGroup: "",
    durationMinutes: entree.durationMinutes ?? 0,
    warmup: "",
    coachNotes: entree.coachNotes,
    exercises: [],
    blocks: entree.blocks.map((bloc) => ({ ...bloc })),
  };
}
