import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { construireWorkoutFeedbackPayload } from "@/lib/workout-feedback-payload";
import type { ExerciseFeedback } from "@/types";

/**
 * « LES DEUX CHEMINS D'ENVOI FILTRENT LES PLACEHOLDERS » — GARDE PARTAGÉE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA GARANTIE
 * ════════════════════════════════════════════════════════════════════════
 * Un repère « Dernières perfs » ne vit que dans l'attribut `placeholder` du
 * DOM. Il ne doit JAMAIS ressortir dans un payload : une série vide restée
 * vide n'est pas une série réalisée, et l'écrire en base fabriquerait un
 * historique que l'élève n'a pas produit. `hasRealizedSetInput` est le
 * filtre qui l'empêche, et il doit être appliqué sur CHACUN des deux
 * chemins d'envoi.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Quatre suites vérifiaient cette garantie, chacune de la même façon : en
 * comptant les occurrences de `.filter(hasRealizedSetInput)` dans
 * `SessionFeedbackSection.tsx`, et en exigeant 2.
 *
 * C'était vrai tant que les deux constructions de payload vivaient dans ce
 * composant. Le lot hors-ligne (commit 04e3b0b) a extrait celle du chemin
 * serveur/hors-ligne dans `lib/workout-feedback-payload.ts` — précisément
 * pour que les deux envois cessent de diverger. Le filtre a suivi la
 * construction. Il en reste donc UN dans le composant, et UN dans la
 * bibliothèque : la garantie est intacte, c'est la façon de la compter qui
 * ne l'était plus.
 *
 * Les quatre suites rougissaient depuis, pour la même raison. La compter à
 * un seul endroit évite de reproduire l'erreur une cinquième fois.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX NIVEAUX, ET LE SECOND EST LE VRAI
 * ════════════════════════════════════════════════════════════════════════
 * `verifierLesDeuxCheminsFiltrentEnSource()` lit le code : il dit OÙ le
 * filtre est posé, ce qu'aucun test de comportement ne peut dire.
 *
 * `verifierAucunPlaceholderDansLePayload()` appelle le vrai constructeur et
 * regarde ce qui sort. C'est lui qui protège réellement : un filtre pourrait
 * être présent et mal appliqué, la source resterait verte.
 *
 * Les deux sont nécessaires ; aucun ne remplace l'autre.
 */

/** Les DEUX chemins d'envoi, et le fichier qui construit chacun. */
export const CHEMINS_DENVOI = {
  /** Envoi serveur ET mise en file hors ligne — même constructeur depuis 04e3b0b. */
  serveurEtHorsLigne: "lib/workout-feedback-payload.ts",
  /** Repli mock/localStorage, construit encore sur place. */
  mockLocalStorage: "components/student/SessionFeedbackSection.tsx",
} as const;

const RACINE = new URL("../../../", import.meta.url);

/** Retire commentaires de bloc et de ligne — un test ne valide jamais un commentaire. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function occurrences(cheminRelatif: string): number {
  const source = sansCommentaires(readFileSync(new URL(cheminRelatif, RACINE), "utf8"));
  return source.split(".filter(hasRealizedSetInput)").length - 1;
}

/**
 * Chaque chemin d'envoi applique le filtre, exactement une fois — et le
 * total reste DEUX, comme avant l'extraction.
 */
export function verifierLesDeuxCheminsFiltrentEnSource(): void {
  const parChemin = Object.entries(CHEMINS_DENVOI).map(([nom, chemin]) => ({
    nom,
    chemin,
    compte: occurrences(chemin),
  }));

  for (const { nom, chemin, compte } of parChemin) {
    assert.equal(
      compte,
      1,
      `le chemin « ${nom} » (${chemin}) doit filtrer la saisie réelle exactement une fois — trouvé ${compte}`,
    );
  }

  assert.equal(
    parChemin.reduce((total, { compte }) => total + compte, 0),
    2,
    "les DEUX chemins d'envoi filtrent la saisie réelle",
  );
}

function serie(setNumber: number, loadUsed: string, repsDone: string, rpe: string) {
  return { setNumber, loadUsed, repsDone, rpe };
}

function exercice(sets: ReturnType<typeof serie>[]): ExerciseFeedback {
  return {
    studentId: "eleve-test",
    sessionId: "seance-test",
    exerciseId: "exercice-test",
    exerciseName: "Développé couché",
    sets,
    rpe: null,
    comment: "",
  } as unknown as ExerciseFeedback;
}

/**
 * LA PREUVE PAR LE PAYLOAD RÉELLEMENT PRODUIT.
 *
 * On appelle le constructeur partagé — celui du serveur et du hors-ligne —
 * avec deux séries vides et une seule remplie. Ce qui sort ne doit contenir
 * QUE la série remplie. Aucune lecture de source ici : si le filtre était
 * présent mais mal branché, ce test rougirait quand même.
 */
export function verifierAucunPlaceholderDansLePayload(): void {
  const construction = construireWorkoutFeedbackPayload(
    {
      exerciseFeedback: {
        "exercice-test": exercice([
          serie(1, "", "", ""),
          serie(2, "  ", "  ", "  "),
          serie(3, "52 kg", "8", "8"),
        ]),
      },
      cardioPayloads: [],
      substitutions: {},
      videosExercice: {},
      completed: true,
      globalRpe: "",
      globalComment: "",
      painText: "",
      durationMinutes: "",
    },
    {
      studentId: "eleve-test",
      sessionKey: "seance-test",
      sessionRefLabel: "Séance de test",
      sessionId: "seance-test",
      programId: null,
      performedAt: "2026-08-23",
    },
  );

  assert.equal(construction.ok, true, "la construction doit aboutir sur une saisie valide");
  if (!construction.ok) return;

  const exercices = construction.payload.exercises;
  assert.equal(exercices.length, 1, "un seul exercice porte une saisie réelle");
  const sets = exercices[0].sets;
  assert.equal(sets.length, 1, `seule la série réellement saisie doit partir — reçu ${JSON.stringify(sets)}`);
  assert.equal(sets[0].setNumber, 3, "et c'est bien la troisième");
  assert.equal(sets[0].loadUsed, "52 kg");

  // Un exercice ENTIÈREMENT vide ne doit produire aucune ligne du tout.
  const vide = construireWorkoutFeedbackPayload(
    {
      exerciseFeedback: { "exercice-test": exercice([serie(1, "", "", ""), serie(2, "", "", "")]) },
      cardioPayloads: [],
      substitutions: {},
      videosExercice: {},
      completed: true,
      globalRpe: "",
      globalComment: "",
      painText: "",
      durationMinutes: "",
    },
    {
      studentId: "eleve-test",
      sessionKey: "seance-test",
      sessionRefLabel: "Séance de test",
      sessionId: "seance-test",
      programId: null,
      performedAt: "2026-08-23",
    },
  );
  assert.equal(vide.ok, true);
  if (!vide.ok) return;
  assert.equal(
    vide.payload.exercises.length,
    0,
    "un exercice sans aucune saisie réelle ne doit produire aucune ligne",
  );
}

/** Les deux niveaux, en un appel — c'est ce qu'appellent les quatre suites. */
export function verifierLeFiltreDeSaisieReelle(): void {
  verifierLesDeuxCheminsFiltrentEnSource();
  verifierAucunPlaceholderDansLePayload();
}
