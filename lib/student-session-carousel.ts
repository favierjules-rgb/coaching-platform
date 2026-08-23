/**
 * LE PARCOURS HORIZONTAL D'UNE SÉANCE — CALCUL PUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT SURTOUT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il APLATIT la liste ordonnée de blocs (`orderedStudentSessionBlocks`) en
 * une suite de CARTES, dans l'ordre exact où l'élève les rencontrera en
 * faisant glisser son doigt. Rien d'autre.
 *
 *   bloc musculation de 3 exercices  →  3 cartes
 *   bloc cardio                      →  2 cartes : la prescription, puis
 *                                       la validation du bloc
 *   bloc de repos / bloc vide        →  0 carte
 *
 * Il ne trie RIEN : l'ordre des blocs a déjà été arrêté en amont, et le
 * refaire ici créerait un second calendrier qui pourrait diverger du
 * premier. Il ne rend rien, n'importe ni React ni Tailwind, et ne connaît
 * aucune classe CSS — c'est ce qui le rend vérifiable dans Node, sans
 * navigateur.
 *
 * IDENTITÉ DES CARTES. `cleCarte` dérive de l'UUID du bloc (et de celui de
 * l'exercice pour une carte d'exercice), jamais de sa position ni de son
 * titre : deux blocs peuvent s'appeler tous les deux « Effort continu », et
 * réordonner une séance ne doit pas faire perdre son état à une carte.
 *
 * NUMÉROTATION. `indexGlobal` reproduit à l'identique le décalage que
 * `StudentSessionBlockList` calculait (`strengthOffsets`) : l'exercice
 * affiche toujours 01, 02, 03… sur l'ensemble de la séance, jamais 01 à
 * chaque nouveau bloc.
 */

import type { StudentCardioBlockView, StudentSessionBlockView } from "@/lib/student-session-blocks";
import type { Exercise } from "@/types";

/** Ce que toute carte porte, quel que soit son contenu. */
export interface CarteSeanceBase {
  /** Clé de rendu stable, dérivée des UUID — jamais de la position. */
  cleCarte: string;
  /** UUID du bloc auquel la carte appartient. */
  blockId: string;
  /** Rang du bloc dans la séance, 1-based, TOUS types confondus. */
  blocNumero: number;
  /** Rang de la carte À L'INTÉRIEUR de son bloc, 1-based. */
  positionDansBloc: number;
  /** Nombre de cartes que ce bloc produit. */
  totalDansBloc: number;
  /** Couleur canonique du bloc, reprise telle quelle (jamais recalculée). */
  colorKey: string;
  /** Titre du bloc tel que le coach l'a écrit, ou null. */
  blockTitle: string | null;
}

export type CarteSeance =
  | (CarteSeanceBase & {
      kind: "exercice";
      exercise: Exercise;
      /** Numéro d'affichage 0-based sur TOUTE la séance (01, 02, 03…). */
      indexGlobal: number;
    })
  | (CarteSeanceBase & { kind: "cardio"; view: StudentCardioBlockView })
  | (CarteSeanceBase & { kind: "cardio-validation"; view: StudentCardioBlockView });

/**
 * Aplatit les blocs en cartes, dans l'ordre du parcours.
 *
 * Aucune mutation : ni le tableau reçu, ni les blocs, ni les exercices ne
 * sont touchés. Les objets `exercise` et `view` sont passés PAR RÉFÉRENCE,
 * volontairement — les copier casserait l'égalité référentielle dont React
 * se sert pour éviter de re-rendre une carte que rien n'a changée.
 */
export function aplatirEnCartes(blocks: readonly StudentSessionBlockView[]): CarteSeance[] {
  const cartes: CarteSeance[] = [];
  let exercicesVus = 0;

  blocks.forEach((block, index) => {
    const blocNumero = index + 1;
    const base = {
      blockId: block.id,
      blocNumero,
      colorKey: block.colorKey,
      blockTitle: block.title,
    };

    if (block.kind === "strength") {
      const total = block.exercises.length;
      block.exercises.forEach((exercise, rang) => {
        cartes.push({
          ...base,
          kind: "exercice",
          cleCarte: `${block.id}:${exercise.id}`,
          positionDansBloc: rang + 1,
          totalDansBloc: total,
          exercise,
          indexGlobal: exercicesVus + rang,
        });
      });
      // Le décalage suit le NOMBRE d'exercices du bloc, y compris quand le
      // bloc est vide : c'est exactement ce que faisait `strengthOffsets`.
      exercicesVus += total;
      return;
    }

    // ── BLOC CARDIO : DEUX CARTES, JAMAIS UNE ────────────────────────────
    // La validation du bloc cardio appartient au parcours horizontal, elle
    // n'est plus rendue sous la totalité de la séance. C'est une vraie
    // carte : on l'atteint en glissant, comme n'importe quel exercice.
    cartes.push({
      ...base,
      kind: "cardio",
      cleCarte: `${block.id}:prescription`,
      positionDansBloc: 1,
      totalDansBloc: 2,
      view: block,
    });
    cartes.push({
      ...base,
      kind: "cardio-validation",
      cleCarte: `${block.id}:validation`,
      positionDansBloc: 2,
      totalDansBloc: 2,
      view: block,
    });
  });

  return cartes;
}

/** Catégorie affichée dans le bandeau et dans l'indicateur. */
export function categorieCarte(carte: CarteSeance): "MUSCULATION" | "CARDIO" | "VALIDATION" {
  if (carte.kind === "exercice") return "MUSCULATION";
  return carte.kind === "cardio-validation" ? "VALIDATION" : "CARDIO";
}

/**
 * Ce que l'élève lit sous le rail : « BLOC 2 · MUSCULATION » et « 1 / 3 ».
 * Deux chaînes séparées parce que l'interface les affiche à deux endroits
 * et avec deux graisses différentes — les concaténer ici obligerait le
 * composant à les redécouper.
 */
export function libelleCarte(carte: CarteSeance): { bloc: string; position: string } {
  return {
    bloc: `Bloc ${carte.blocNumero} · ${categorieCarte(carte)}`,
    position: `${carte.positionDansBloc} / ${carte.totalDansBloc}`,
  };
}
