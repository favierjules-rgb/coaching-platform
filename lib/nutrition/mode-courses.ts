/**
 * COURSES C1.1 — LES DEUX MANIÈRES DE PRÉPARER SA SEMAINE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUN MODE PAR DÉFAUT, POUR LA MÊME RAISON QUE LA DURÉE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ `null` = L'ÉLÈVE N'A PAS CHOISI. Pré-sélectionner « Rapide » enverrait la
 * moitié des élèves dans un parcours qu'ils n'ont pas demandé, sans qu'ils
 * s'en aperçoivent. « Aucun choix » et « le choix Rapide » sont deux états
 * différents.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA LISTE EST EXTENSIBLE, ET C'EST TOUT CE QU'ELLE FAIT
 * ────────────────────────────────────────────────────────────────────────────
 * Un troisième mode viendra — « COMME LA SEMAINE PASSÉE ». Il n'existe PAS
 * aujourd'hui : ni ici, ni ailleurs. Ajouter une entrée à `MODES_COURSES` et
 * un membre à `ModeCoursesChoisi` suffira ; l'écran de choix les rend en
 * boucle, il n'a aucune connaissance des modes qu'il affiche.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau.
 */

/** Les modes RÉELLEMENT disponibles. Le futur mode n'y est pas. */
export type ModeCoursesChoisi = "rapide" | "personnalise";

/** `null` = aucun mode choisi. Il n'existe aucune valeur par défaut. */
export type ModeCourses = ModeCoursesChoisi | null;

export interface DescriptionDeMode {
  readonly cle: ModeCoursesChoisi;
  readonly titre: string;
  readonly description: string;
}

/**
 * Les cartes de l'écran de choix, dans leur ordre d'affichage.
 *
 * ⚠️ « RAPIDE » EN PREMIER, ET CE N'EST PAS NEUTRE : c'est le chemin le plus
 * court pour la plupart des élèves. Ce n'est pas pour autant une
 * pré-sélection — aucune carte n'est cochée à l'ouverture.
 */
export const MODES_COURSES: readonly DescriptionDeMode[] = [
  {
    cle: "rapide",
    titre: "RAPIDE",
    description:
      "Donne-nous tes préférences, on prépare une proposition que tu pourras modifier.",
  },
  {
    cle: "personnalise",
    titre: "PERSONNALISÉ",
    description: "Choisis toi-même tes aliments pour chaque repas.",
  },
];

/** `true` si `valeur` est un mode réellement disponible. `null` est FAUX. */
export function estModeCourses(valeur: unknown): valeur is ModeCoursesChoisi {
  return valeur === "rapide" || valeur === "personnalise";
}
