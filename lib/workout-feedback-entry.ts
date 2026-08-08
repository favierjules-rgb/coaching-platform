import type { ExerciseFeedbackPayload } from "@/types";

/**
 * QUAND UNE LIGNE D'EXERCICE MÉRITE-T-ELLE D'ÊTRE ENREGISTRÉE ?
 *
 * La règle tenait autrefois en une ligne dans la couche d'écriture :
 * `if (exercise.sets.length === 0) continue;`. Elle était juste tant qu'une
 * ligne d'exercice ne portait QUE des séries. Depuis F4 elle peut porter une
 * vidéo — et une vidéo sans série disparaissait silencieusement à l'envoi,
 * en laissant son fichier orphelin dans le bucket. Le cas est parfaitement
 * réaliste : « je filme mon squat, je ne note rien, j'envoie. »
 *
 * On remplace donc un test sur UN champ par une condition EXPLICITE, écrite
 * ici pour être lue et testée seule.
 *
 * CE QUI COMPTE COMME UNE DONNÉE UTILE
 *   - au moins une série saisie ;
 *   - un commentaire non vide ;
 *   - un RPE d'exercice (saisie historique, et RPE de bloc du cardio) ;
 *   - un remplacement déclaré — « je n'ai pas fait ce qui était prévu » est
 *     une information même sans aucun chiffre ;
 *   - une vidéo de technique.
 *
 * CE QUI NE COMPTE PAS
 *   `exerciseName`, `exerciseOrder` et `exerciseId` sont STRUCTURELS : ils
 *   sont présents sur tous les exercices de la séance, y compris ceux que
 *   l'élève n'a pas touchés. Les compter reviendrait à écrire une ligne par
 *   exercice prescrit à chaque envoi, et à noyer le coach sous des lignes
 *   vides.
 */
export function exerciseFeedbackWorthPersisting(exercise: ExerciseFeedbackPayload): boolean {
  if (exercise.sets.length > 0) return true;
  if (exercise.comment.trim() !== "") return true;
  if (exercise.rpe !== null && exercise.rpe !== undefined) return true;
  if (exercise.substituteExerciseLibraryId) return true;
  if (exercise.videoPath) return true;
  return false;
}
