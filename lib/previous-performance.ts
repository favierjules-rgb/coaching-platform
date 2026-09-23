/**
 * Dernières performances par série — fonctions PURES
 * (feat/student-previous-set-performance). Aucune dépendance React ni
 * Supabase.
 *
 * Objectif produit : dans la séance actuelle, chaque série d'un exercice
 * affiche la dernière performance RÉALISÉE sur ce même exercice (ligne
 * « Dernières perfs : … » + placeholders dans les champs), sans jamais
 * confondre ces repères avec une saisie réelle.
 *
 * Source : l'historique COMPLET des retours de l'élève (mêmes lignes que
 * /entrainement/historique — lecture par student_id, indépendante des
 * assignations : une désassignation/réassignation du programme ne perd donc
 * jamais l'historique). Les retours sont déjà chargés en requêtes GROUPÉES
 * (workout_feedback + exercise_feedback + exercise_set_feedback, un `.in()`
 * par table) : l'index est ensuite construit ICI, en mémoire — AUCUNE
 * requête par exercice (pas de N+1).
 *
 * Correspondance d'exercice, dans l'ordre :
 *  1. exercise_library_id — identité stable de la banque, lue dans le
 *     prescribed_snapshot du retour passé (posé à la soumission) et sur
 *     l'exercice actuel (Exercise.libraryExerciseId) ;
 *  2. fallback : nom normalisé (minuscules, accents et espaces repliés).
 *
 * PRIORITÉ des valeurs affichées dans un champ (champ par champ) :
 *  1. saisie réelle de l'élève (value du champ — jamais touchée ici) ;
 *  2. prescription du coach de la séance ACTUELLE (placeholder existant) ;
 *  3. dernière performance passée (placeholder historique) ;
 *  4. champ vide.
 * Les placeholders ne sont JAMAIS écrits dans l'état du formulaire ni dans
 * le payload de sauvegarde : ils ne vivent que dans l'attribut placeholder
 * et la ligne d'affichage.
 */
import { isCardioResultEntryName } from "@/lib/cardio-feedback";
import {
  cleOccurrence,
  occurrenceDuRetour,
  type OccurrenceProgrammee,
  type ResoudreSeance,
} from "@/lib/occurrence-programmee";
import { formatRpeFr, lireRpe } from "@/lib/rpe";
import { isPrescribedSnapshot } from "@/lib/workout-history";
import type { AdminStudentFeedback } from "@/types";

/**
 * Bornes du RPE RESSENTI (élève et prescription d'exercice) : 1 à 10.
 * Ce sont celles des CHECK `exercise_feedback_rpe_check`,
 * `exercise_set_feedback_rpe_check` et `workout_feedback_global_rpe_check` —
 * la migration 20260830090000 n'a ajouté que le pas de 0,5, jamais élargi.
 * La cible d'un segment cardio a les SIENNES (0-10) et ne passe pas par ici.
 */
const RPE_ELEVE_MIN = 1;
const RPE_ELEVE_MAX = 10;

/* ─── Normalisation du nom (fallback de correspondance) ─── */

/** Nom d'exercice normalisé : minuscules, accents retirés, espaces repliés. */
export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ─── Formes ─── */

/** Réalisé passé d'UNE série (seuls les champs réellement présents). */
export interface PreviousSetPerf {
  loadUsed: string;
  repsDone: string;
  /**
   * RPE réellement ENREGISTRÉ POUR CETTE SÉRIE (exercise_set_feedback.rpe,
   * option B) — null pour tout retour antérieur : le RPE global d'exercice
   * n'est JAMAIS recopié ici.
   */
  rpe: number | null;
}

/** Dernière occurrence passée d'un exercice, séries indexées par setNumber. */
export interface PreviousExercisePerf {
  /** setNumber → réalisé. Une série absente du retour passé n'a PAS d'entrée. */
  sets: Record<number, PreviousSetPerf>;
  /**
   * RPE GLOBAL de l'exercice du retour passé (exercise_feedback.rpe —
   * anciens retours muscu). À afficher UNE seule fois au niveau de
   * l'exercice, libellé honnête : « RPE global de l'exercice : 9 ». Jamais
   * en placeholder de série.
   */
  exerciseRpe: number | null;
  performedAt: string | null;
  matchedBy: "library" | "name";
  /**
   * L'occurrence PROGRAMMÉE d'où vient cette performance — (semaine, jour).
   * `null` pour un retour dont l'occurrence n'est pas identifiable (ni
   * snapshot exploitable, ni séance vivante) : mesuré à 12 retours sur 125.
   * C'est elle qui permet d'afficher « mercredi dernier » plutôt qu'une date
   * nue, et de comparer deux occurrences successives du MÊME jour.
   *
   * ⚠️ OPTIONNELLE, ET C'EST DÉLIBÉRÉ. `buildPreviousPerformanceIndex` la
   * renseigne toujours ; la rendre obligatoire aurait forcé la réécriture de
   * quatre littéraux dans des tests d'affichage hors périmètre, qui décrivent
   * une performance sans se soucier de son occurrence. « Absente » et
   * « inconnue » veulent dire la même chose ici : aucune référence de
   * progression.
   */
  occurrence?: OccurrenceProgrammee | null;
}

export interface PreviousPerformanceIndex {
  byLibraryId: Map<string, PreviousExercisePerf>;
  byName: Map<string, PreviousExercisePerf>;
  /**
   * TROISIÈME CARTE — « cet exercice, CE jour-là, CETTE semaine-là ».
   *
   * ⚠️ ELLE N'EST PAS UNE OPTIMISATION DES DEUX AUTRES, ELLE RÉPOND À UNE
   * AUTRE QUESTION. `byLibraryId` et `byName` rendent la performance la plus
   * RÉCENTE — ce qu'il faut pour la ligne « Dernières perfs ». Celle-ci rend
   * la performance d'une occurrence PRÉCISE : sans elle, le mercredi se
   * comparerait au lundi de la même semaine, qui est plus récent mais n'est
   * pas le bon repère.
   *
   * Clé : `cleOccurrence(identité, occurrence)` — l'identité étant
   * l'`exercise_library_id` ou le nom normalisé, les deux étant indexés.
   */
  byOccurrence: Map<string, PreviousExercisePerf>;
}

/* ─── Construction de l'index ─── */

/**
 * Saisie réelle d'une série ? (même filtre que le payload de sauvegarde).
 * Depuis l'option B, un RPE saisi seul est aussi une saisie réelle — les
 * trois champs sont indépendants.
 */
export function hasRealizedSetInput(set: { loadUsed: string; repsDone: string; rpe?: string }): boolean {
  return Boolean(set.loadUsed.trim() || set.repsDone.trim() || (set.rpe ?? "").trim());
}

/**
 * Saisie RPE d'un champ de série → valeur payload. "" = null (non saisi) ;
 * 1 à 10 par pas de 0,5 accepté, virgule ou point ; tout le reste = invalide
 * (erreur VISIBLE côté formulaire, jamais de valeur inventée/écrêtée — mêmes
 * bornes que le CHECK SQL et le schéma zod).
 */
export function parseRpeInput(value: string): { ok: true; rpe: number | null } | { ok: false } {
  const brut = value.trim();
  if (brut === "") return { ok: true, rpe: null };
  const valeur = lireRpe(brut);
  if (valeur === null || valeur < RPE_ELEVE_MIN || valeur > RPE_ELEVE_MAX) return { ok: false };
  return { ok: true, rpe: valeur };
}

function feedbackSortKey(feedback: AdminStudentFeedback): string {
  return `${feedback.performedAt ?? feedback.date ?? ""}|${feedback.createdAt ?? ""}`;
}

/**
 * Construit l'index des dernières performances à partir de l'historique des
 * retours. GARDE-FOUS (règles impératives du chantier) :
 * - seuls les retours de `studentId` sont considérés (défense en profondeur —
 *   la RLS workout_feedback limite déjà la lecture à l'élève connecté) ;
 * - seuls les retours d'entraînement TERMINÉS (`completed`) comptent ;
 * - le retour de la séance ACTUELLE est exclu (mode « modifier mon retour ») ;
 * - un retour daté dans le futur est exclu (défensif : un retour n'existe
 *   normalement qu'après la séance) ;
 * - les entrées cardio (enveloppe JSON) ne sont jamais des performances de
 *   musculation.
 * L'historique est parcouru du plus récent au plus ancien : la PREMIÈRE
 * occurrence rencontrée pour une clé est la dernière performance — la
 * recherche remonte naturellement au-delà de la semaine précédente.
 */
export function buildPreviousPerformanceIndex(input: {
  feedbacks: AdminStudentFeedback[];
  studentId: string;
  currentSessionId: string | null;
  today?: string;
  /**
   * Résolveur d'occurrence depuis un identifiant de séance, INJECTÉ. Absent,
   * seule la photographie du prescrit est lue — ce module reste pur et
   * testable sans base. Voir `lib/occurrence-programmee.ts`.
   */
  resoudreSeance?: ResoudreSeance;
}): PreviousPerformanceIndex {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const byLibraryId = new Map<string, PreviousExercisePerf>();
  const byName = new Map<string, PreviousExercisePerf>();
  const byOccurrence = new Map<string, PreviousExercisePerf>();

  const retenus = input.feedbacks
    .filter((f) => f.studentId === input.studentId)
    .filter((f) => f.type === "entrainement")
    .filter((f) => f.completed === true)
    .filter((f) => input.currentSessionId === null || f.sessionId !== input.currentSessionId)
    .filter((f) => (f.performedAt ?? f.date ?? "") <= today)
    .sort((a, b) => (feedbackSortKey(a) < feedbackSortKey(b) ? 1 : -1));

  for (const feedback of retenus) {
    // L'occurrence de CE retour — (semaine, jour). `null` est un état normal
    // et non un échec : le retour alimente alors les deux cartes
    // chronologiques, mais aucune référence de progression.
    const occurrence = occurrenceDuRetour(
      { sessionId: feedback.sessionId, prescribedSnapshot: feedback.prescribedSnapshot },
      input.resoudreSeance,
    );

    // Nom normalisé → exercise_library_id, depuis la photographie du prescrit
    // posée à la soumission (source de l'identité stable). Lecture SEULE —
    // le snapshot n'est jamais modifié ni réécrit ici.
    const libraryIdByName = new Map<string, string>();
    if (isPrescribedSnapshot(feedback.prescribedSnapshot)) {
      for (const bloc of feedback.prescribedSnapshot.blocks) {
        for (const exercice of bloc.exercises) {
          if (exercice.exerciseLibraryId && exercice.name) {
            libraryIdByName.set(normalizeExerciseName(exercice.name), exercice.exerciseLibraryId);
          }
        }
      }
    }

    // Regroupe les entrées par exercice (une entrée = une série renseignée).
    const parExercice = new Map<string, PreviousExercisePerf>();
    for (const entry of feedback.exerciseEntries) {
      if (isCardioResultEntryName(entry.exerciseName)) continue;
      const cle = normalizeExerciseName(entry.exerciseName);
      if (!cle) continue;
      const perf = parExercice.get(cle) ?? {
        sets: {},
        exerciseRpe: null,
        performedAt: feedback.performedAt ?? feedback.date ?? null,
        matchedBy: "name" as const,
        occurrence,
      };
      // Donnée partielle conservée telle quelle : charge, répétitions ou RPE
      // peuvent manquer — on n'invente rien, on ne moyenne rien. `entry.rpe`
      // est le RPE de LA série (option B) : null pour tout l'historique
      // antérieur — le RPE global n'est JAMAIS recopié ici.
      perf.sets[entry.setNumber] = {
        loadUsed: entry.loadUsed ?? "",
        repsDone: entry.repsDone ?? "",
        rpe: entry.rpe ?? null,
      };
      // RPE global d'exercice (anciens retours) : mémorisé À PART, pour un
      // affichage unique au niveau de l'exercice.
      if (perf.exerciseRpe === null && entry.exerciseRpe !== null && entry.exerciseRpe !== undefined) {
        perf.exerciseRpe = entry.exerciseRpe;
      }
      parExercice.set(cle, perf);
    }

    // Premier arrivé (le plus récent) gagne — jamais de fusion entre séances.
    for (const [cle, perf] of parExercice) {
      const libraryId = libraryIdByName.get(cle);
      if (libraryId && !byLibraryId.has(libraryId)) {
        byLibraryId.set(libraryId, { ...perf, matchedBy: "library" });
      }
      if (!byName.has(cle)) {
        byName.set(cle, perf);
      }
      // Carte par occurrence : la même performance, rangée sous son
      // (semaine, jour). Les deux identités y sont indexées, pour que la
      // recherche par occurrence dispose des mêmes replis que la recherche
      // chronologique.
      if (occurrence) {
        const cleNom = cleOccurrence(cle, occurrence);
        if (!byOccurrence.has(cleNom)) byOccurrence.set(cleNom, perf);
        if (libraryId) {
          const cleBanque = cleOccurrence(libraryId, occurrence);
          if (!byOccurrence.has(cleBanque)) {
            byOccurrence.set(cleBanque, { ...perf, matchedBy: "library" });
          }
        }
      }
    }
  }

  return { byLibraryId, byName, byOccurrence };
}

/**
 * Dernière performance pour un exercice de la séance ACTUELLE :
 * exercise_library_id en priorité, nom normalisé en fallback (couvre les
 * retours sans snapshot et les exercices en texte libre), null sinon.
 */
export function findPreviousPerformance(
  index: PreviousPerformanceIndex,
  exercise: { name: string; libraryExerciseId?: string | null },
  occurrenceCible?: OccurrenceProgrammee | null,
): PreviousExercisePerf | null {
  // ⚠️ AVEC UNE OCCURRENCE CIBLE, LA RECHERCHE NE RETOMBE JAMAIS SUR LE
  // CHRONOLOGIQUE. C'est tout l'enjeu : si le mercredi de la semaine
  // précédente n'a pas été réalisé, la réponse est « aucune référence » — et
  // non « le lundi de cette semaine, qui traîne dans l'index ». Un repli
  // silencieux ici recréerait exactement le défaut corrigé.
  if (occurrenceCible) {
    if (exercise.libraryExerciseId) {
      const parBanque = index.byOccurrence.get(cleOccurrence(exercise.libraryExerciseId, occurrenceCible));
      if (parBanque) return parBanque;
    }
    return index.byOccurrence.get(cleOccurrence(normalizeExerciseName(exercise.name), occurrenceCible)) ?? null;
  }

  if (exercise.libraryExerciseId) {
    const parBanque = index.byLibraryId.get(exercise.libraryExerciseId);
    if (parBanque) return parBanque;
  }
  return index.byName.get(normalizeExerciseName(exercise.name)) ?? null;
}

/* ─── Affichage ─── */

/** « 45 kg × 10 · RPE 9 » — uniquement les champs présents ; null si rien. */
export function formatPreviousSetLabel(set: PreviousSetPerf | null | undefined): string | null {
  if (!set) return null;
  const charge = set.loadUsed.trim();
  const reps = set.repsDone.trim();
  const principal = charge && reps ? `${charge} × ${reps}` : charge || reps;
  const morceaux = [principal, set.rpe !== null ? `RPE ${formatRpeFr(set.rpe)}` : ""].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

/* ─── Prescription RPE CIBLE du coach (workout_exercises.recommended_rpe) ─── */

/**
 * Analyse le RPE CIBLE prescrit : "" / null = aucune prescription (ok,
 * values null) ; "8" = valeur unique ; "8-8-9" = séquence par série
 * (séparateur tiret, espaces tolérés — même esprit que les répétitions
 * "8-10", mais ici une SÉQUENCE par index de série). Chaque valeur doit
 * être de 1 à 10 par pas de 0,5, sinon la prescription est invalide
 * (ok: false) — jamais écrêtée, jamais devinée.
 *
 * Le séparateur reste le TIRET, et il ne devient pas ambigu avec le
 * demi-point : la partie décimale s'écrit avec une virgule ou un point,
 * jamais avec un tiret. « 8,5-9 » se découpe donc proprement en 8,5 et 9.
 */
export function parsePrescribedRpe(
  value: string | null | undefined,
): { ok: true; values: number[] | null } | { ok: false } {
  const brut = (value ?? "").trim();
  if (brut === "") return { ok: true, values: null };
  const morceaux = brut.split("-").map((part) => part.trim());
  const values: number[] = [];
  for (const part of morceaux) {
    const valeur = lireRpe(part);
    if (valeur === null || valeur < RPE_ELEVE_MIN || valeur > RPE_ELEVE_MAX) return { ok: false };
    values.push(valeur);
  }
  return { ok: true, values };
}

/**
 * RPE prescrit pour LA série `setNumber` (1-based) :
 * - valeur unique → toutes les séries ;
 * - séquence → N-ième valeur ; au-delà de la séquence → aucune prescription ;
 * - vide ou invalide → null (une prescription illisible n'est jamais
 *   appliquée — elle est signalée côté builder, pas côté élève).
 */
export function prescribedRpeForSet(value: string | null | undefined, setNumber: number): number | null {
  const parsed = parsePrescribedRpe(value);
  if (!parsed.ok || parsed.values === null) return null;
  if (parsed.values.length === 1) return parsed.values[0];
  return parsed.values[setNumber - 1] ?? null;
}

/**
 * LA RECOMMANDATION AUTOMATIQUE, quand elle existe — déjà formatée.
 *
 * ⚠️ CE MODULE NE LA CALCULE PAS ET NE SAIT PAS D'OÙ ELLE VIENT. Il reçoit
 * deux textes prêts à écrire (« 47 kg », « 11 ») et se contente de les placer
 * en tête de priorité. Toute la règle — quel incrément, quel espace de
 * charge, quelle référence — reste dans lib/progression-automatique.ts et
 * lib/indicateurs-progression.ts.
 */
export interface RecommandationAffichable {
  readonly load: string;
  readonly reps: string;
}

/**
 * Placeholders d'une série, PRIORITÉ champ par champ (la saisie réelle de
 * l'élève est portée par `value` — un placeholder n'apparaît que dans un
 * champ vide, par construction du DOM) :
 * - charge :      RECOMMANDATION AUTOMATIQUE > prescription coach > dernière
 *                 charge passée > « Charge » ;
 * - répétitions : RECOMMANDATION AUTOMATIQUE > prescription coach >
 *                 dernières reps passées > « Reps » ;
 * - RPE :         prescription coach (RPE CIBLE, par série) > « RPE » —
 *   le RPE PASSÉ n'est JAMAIS un placeholder : il reste cantonné à la
 *   ligne « Dernières perfs » (règle produit du volet builder).
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI LA RECOMMANDATION PASSE DEVANT LA PRESCRIPTION
 * ────────────────────────────────────────────────────────────────────────
 * Règle posée le 23/09/2026 : progression automatique ACTIVÉE → la cible
 * calculée est prioritaire dans les champs. Sans cette priorité, un
 * `recommendedLoad` valant « RIR 1 » et un `reps` valant « 8-13 » gagnaient
 * toujours, et la cible calculée (47 kg × 11) n'atteignait jamais l'écran :
 * le moteur travaillait pour rien.
 *
 * ⚠️ `recommandation` ABSENTE = COMPORTEMENT D'AVANT, À L'IDENTIQUE. C'est
 * ce qui rend la règle réversible : la progression désactivée ne fournit
 * aucune recommandation, donc la prescription du coach est intacte. Le
 * paramètre est optionnel pour que les appelants qui n'ont rien à voir avec
 * la progression (récapitulatif, démonstration, tests d'historique) ne
 * changent pas d'un caractère.
 *
 * Le libellé « Reco » distingue les deux origines : un coach ne doit jamais
 * croire qu'il a écrit lui-même une charge que le moteur a calculée.
 */
export function resolveSetPlaceholders(
  exercise: { recommendedLoad: string; reps: string; recommendedRpe?: string | null },
  previousSet: PreviousSetPerf | null | undefined,
  setNumber: number,
  recommandation?: RecommandationAffichable | null,
): { load: string; reps: string; rpe: string } {
  const prescriptionCharge = exercise.recommendedLoad.trim();
  const prescriptionReps = exercise.reps.trim();
  const prescriptionRpe = prescribedRpeForSet(exercise.recommendedRpe, setNumber);
  const histoCharge = previousSet?.loadUsed.trim() ?? "";
  const histoReps = previousSet?.repsDone.trim() ?? "";
  const recoCharge = recommandation?.load.trim() ?? "";
  const recoReps = recommandation?.reps.trim() ?? "";
  return {
    load: recoCharge
      ? `Reco ${recoCharge}`
      : prescriptionCharge
        ? `Charge (${prescriptionCharge})`
        : histoCharge || "Charge",
    reps: recoReps
      ? `Reco ${recoReps} reps`
      : prescriptionReps
        ? `Reps (${prescriptionReps})`
        : histoReps || "Reps",
    rpe: prescriptionRpe !== null ? `RPE ${formatRpeFr(prescriptionRpe)}` : "RPE",
  };
}

/**
 * Mentions honnêtes du RPE GLOBAL d'exercice pour un retour affiché (élève
 * ou coach) : une mention par exercice de musculation dont le retour porte
 * un exercise_feedback.rpe — anciens retours (pré-option B) surtout. Jamais
 * répété par série ; le cardio (enveloppe JSON) est exclu, son RPE de bloc
 * a déjà son propre rendu.
 */
export function exerciseGlobalRpeMentions(
  entries: Array<{ exerciseName: string; exerciseRpe?: number | null }>,
): Array<{ exerciseName: string; rpe: number }> {
  const vus = new Map<string, number>();
  for (const entry of entries) {
    if (isCardioResultEntryName(entry.exerciseName)) continue;
    if (entry.exerciseRpe === null || entry.exerciseRpe === undefined) continue;
    if (!vus.has(entry.exerciseName)) vus.set(entry.exerciseName, entry.exerciseRpe);
  }
  return [...vus.entries()].map(([exerciseName, rpe]) => ({ exerciseName, rpe }));
}
