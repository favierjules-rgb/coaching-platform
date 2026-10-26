import { toCanonicalSessionSaveData } from "@/lib/training-block-editing";
import { isUuid } from "@/lib/training-blocks";
import type { AdminProgram, AdminWorkoutSession, TrainingBlock } from "@/types";

/**
 * CE QUI A CHANGÉ DANS UNE PROGRAMMATION — et uniquement cela.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 * `diffProgramStructure` réécrivait TOUTES les séances à chaque enregistrement.
 * Mesuré par instrumentation du code réel sur une programmation de 12 semaines
 * (84 séances) : renommer UNE séance coûtait 87 requêtes dont 87 séquentielles,
 * exactement comme modifier dix séances. Le coût suivait la taille du
 * PROGRAMME, jamais la taille du CHANGEMENT.
 *
 * Ce module calcule le changement. La RPC groupée n'écrit plus que lui.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA COMPARAISON PORTE SUR LA CHARGE UTILE, PAS SUR LES OBJETS
 * ────────────────────────────────────────────────────────────────────────────
 * Deux séances sont « identiques » quand la charge que le moteur recevrait est
 * identique — pas quand leurs objets JavaScript se ressemblent. On sérialise
 * donc les DEUX côtés avec la MÊME fonction (`empreinteSeance`), dérivée de
 * `toCanonicalSessionSaveData`, et on compare les chaînes.
 *
 * C'est la seule comparaison qui répond à la vraie question : « cet appel
 * écrirait-il quelque chose de différent ? ». Comparer champ par champ aurait
 * demandé de maintenir une liste de champs en parallèle de la sérialisation —
 * une liste qui se périme au premier champ ajouté, en silence, et dont l'oubli
 * se traduirait par une modification du coach JAMAIS ENREGISTRÉE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ EN CAS DE DOUTE, ON ÉCRIT. C'EST LA RÈGLE, ET ELLE EST ASYMÉTRIQUE.
 * ────────────────────────────────────────────────────────────────────────────
 * Un faux « modifiée » coûte un appel inutile. Un faux « inchangée » PERD le
 * travail du coach, sans aucun signal. Les deux erreurs n'ont pas le même prix,
 * donc toute incertitude penche du même côté :
 *   · pas d'instantané fourni  → aucune séance n'est déclarée inchangée ;
 *   · séance absente de l'instantané → créée (jamais « inchangée ») ;
 *   · `updatedAt` manquant → modifiée, et la RPC tranchera sur le verrou ;
 *   · empreinte impossible à calculer → modifiée.
 *
 * ⚠️ LES SUPPRESSIONS SONT EXPLICITES, ET C'EST UN RENVERSEMENT. Dans l'ancien
 * modèle, « absent de la charge » valait « à supprimer » : une lecture tronquée
 * rendait des séances invisibles, et l'enregistrement suivant les détruisait
 * (incident du 25/08/2026). Ici une séance absente est INCHANGÉE ; seules les
 * séances nommées dans `sessionIdsASupprimer` disparaissent. Une lecture
 * partielle ne peut plus détruire de données — au pire elle n'en modifie pas
 * assez, ce qui se voit et se corrige.
 *
 * Fonctions PURES : aucune lecture réseau, aucune mutation.
 */

/** Une séance à créer : elle n'a pas encore de ligne en base. */
export interface SeanceACreer {
  /** Identifiant LOCAL du builder, renvoyé par la RPC pour réconcilier. */
  clientId: string;
  weekNumber: number;
  day: string;
  name: string;
  muscleGroup: string;
  durationMinutes: number | null;
  warmup: string;
  coachNotes: string;
  bannerUrl: string | null;
  isRestDay: boolean;
  sessionType: string;
  blocks: TrainingBlock[];
}

/** Une séance à modifier : sa ligne existe, et son `updatedAt` sert de verrou. */
export interface SeanceAModifier {
  sessionId: string;
  expectedUpdatedAt: string;
  blocks: TrainingBlock[];
  sessionPatch: {
    day: string;
    name: string;
    muscleGroup: string;
    durationMinutes: number | null;
    warmup: string;
    coachNotes: string;
    bannerUrl: string | null;
  };
}

export interface DiffDeProgrammation {
  semainesACreer: number[];
  semainesASupprimer: number[];
  sessionIdsASupprimer: string[];
  seancesACreer: SeanceACreer[];
  seancesAModifier: SeanceAModifier[];
  /** Séances reconnues identiques à l'instantané : aucun appel émis pour elles. */
  seancesInchangees: number;
}

/**
 * L'empreinte d'une séance : la charge utile que le moteur recevrait, rendue
 * comparable. `updatedAt` en est ABSENT — c'est une donnée de ligne (le verrou),
 * pas un contenu : l'inclure déclarerait modifiée toute séance que le serveur a
 * touchée pour une autre raison.
 *
 * `JSON.stringify` suffit parce que les deux côtés passent par
 * `toCanonicalSessionSaveData`, qui produit les clés dans un ordre fixe.
 */
export function empreinteSeance(session: AdminWorkoutSession): string {
  const canonique = toCanonicalSessionSaveData(session);
  return JSON.stringify({
    isRestDay: canonique.isRestDay,
    sessionType: canonique.sessionType,
    blocks: canonique.blocks,
    sessionPatch: canonique.sessionPatch,
  });
}

/** Vrai si les deux séances produiraient exactement la même écriture. */
export function seancesIdentiques(avant: AdminWorkoutSession, apres: AdminWorkoutSession): boolean {
  try {
    return empreinteSeance(avant) === empreinteSeance(apres);
  } catch {
    // Une empreinte qui ne se calcule pas ne prouve RIEN. On ne conclut jamais
    // « identiques » sur un échec : voir la règle asymétrique de l'en-tête.
    return false;
  }
}

/**
 * Le diff complet entre l'instantané chargé et les séances sortantes.
 *
 * `instantane` est le programme tel qu'il a été LU (la source des `updatedAt`
 * et des identifiants réels). `sortantes` est l'état du builder.
 *
 * ⚠️ `instantane` À `null` N'EST PAS UNE ERREUR, c'est le repli prudent : sans
 * référence, aucune séance ne peut être déclarée inchangée, donc toutes
 * repartent. Le gain disparaît, la correction reste.
 */
export function calculerDiffProgrammation(
  instantane: AdminProgram | null,
  sortantes: readonly AdminWorkoutSession[],
): DiffDeProgrammation {
  const seancesInstantane = instantane?.sessions ?? [];

  const parId = new Map<string, AdminWorkoutSession>(seancesInstantane.map((s) => [s.id, s]));
  const semainesInstantane = new Set<number>(seancesInstantane.map((s) => s.weekNumber));
  const semainesSortantes = new Set<number>(sortantes.map((s) => s.weekNumber));

  const semainesACreer = [...semainesSortantes].filter((n) => !semainesInstantane.has(n)).sort((a, b) => a - b);
  const semainesASupprimer = [...semainesInstantane].filter((n) => !semainesSortantes.has(n)).sort((a, b) => a - b);

  const seancesACreer: SeanceACreer[] = [];
  const seancesAModifier: SeanceAModifier[] = [];
  const idsConserves = new Set<string>();
  let seancesInchangees = 0;

  for (const session of sortantes) {
    const ligne = parId.get(session.id);

    /*
     * ⚠️ UNE SÉANCE QUI CHANGE DE SEMAINE EST RECRÉÉE, PAS PATCHÉE.
     * `session_patch` n'accepte pas `program_week_id` : patcher la ligne la
     * laisserait dans son ancienne semaine, en silence. L'ancienne ligne part
     * donc dans les suppressions et une neuve est créée dans la semaine cible.
     * Même décision que l'ancien `diffProgramStructure`, pour la même raison.
     */
    const memeLigne = ligne !== undefined && ligne.weekNumber === session.weekNumber;

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ⚠️ « ABSENTE DE L'INSTANTANÉ » NE VEUT PAS DIRE « À CRÉER ».
     * ════════════════════════════════════════════════════════════════════════
     * Ce raccourci était un DÉFAUT NET, trouvé par la sonde d'instrumentation :
     * sans instantané, les 84 séances d'une programmation de 12 semaines
     * partaient toutes en CRÉATION. Elles existaient déjà en base — elles
     * auraient donc été DUPLIQUÉES, et le repli censé être prudent devenait le
     * plus destructeur des chemins.
     *
     * La ligne existe-t-elle ? La séance le dit elle-même, et sans instantané :
     *   · son `id` est un UUID — les identifiants fabriqués par le builder
     *     (`generateId("sess")`) n'en sont pas, voir lib/admin.ts ; ET
     *   · elle porte un `updatedAt` — une séance jamais persistée n'en a pas.
     * Les deux réunis ne s'obtiennent QUE par une lecture de la base. C'est
     * donc la preuve que la ligne existe, et le `updatedAt` est en même temps
     * le verrou à présenter.
     *
     * Reste le cas où la séance existe mais où l'on n'en sait rien : il est
     * impossible ici, puisque ces deux marques voyagent avec la séance.
     */
    const ligneDejaPersistee = isUuid(session.id) && Boolean(session.updatedAt);

    if (!memeLigne && ligne === undefined && ligneDejaPersistee) {
      // Pas dans l'instantané (absent ou partiel), mais la séance porte les
      // marques d'une ligne existante : on MODIFIE, et la RPC tranchera sur le
      // verrou si cette ligne a bougé entre-temps.
      seancesAModifier.push(enModification(session, session.updatedAt as string));
      idsConserves.add(session.id);
      continue;
    }

    if (!memeLigne) {
      seancesACreer.push({
        clientId: session.id,
        weekNumber: session.weekNumber,
        day: session.day,
        name: session.name,
        muscleGroup: session.muscleGroup,
        durationMinutes: session.durationMinutes ?? null,
        warmup: session.warmup,
        coachNotes: session.coachNotes,
        bannerUrl: session.bannerUrl ?? null,
        isRestDay: (session.blocks ?? []).length === 0,
        sessionType: session.sessionType ?? "strength",
        blocks: session.blocks ?? [],
      });
      continue;
    }

    idsConserves.add(session.id);

    // Pas de verrou fiable : on n'invente pas de version, on écrit et la RPC
    // tranchera. Deviner un `updatedAt` par relecture romprait le verrou.
    if (!session.updatedAt) {
      seancesAModifier.push(enModification(session, ligne.updatedAt ?? ""));
      continue;
    }

    if (seancesIdentiques(ligne, session)) {
      seancesInchangees += 1;
      continue;
    }

    seancesAModifier.push(enModification(session, session.updatedAt));
  }

  /*
   * Les séances de l'instantané qui ne sont plus là : le coach a supprimé une
   * semaine, ou une séance a changé de semaine (sa ligne est recréée ailleurs).
   * ⚠️ On ne liste QUE des séances vues dans l'instantané — jamais une
   * déduction par absence sur un jeu qu'on n'a pas lu en entier.
   */
  const sessionIdsASupprimer = seancesInstantane
    .filter((s) => !idsConserves.has(s.id))
    .map((s) => s.id);

  return {
    semainesACreer,
    semainesASupprimer,
    sessionIdsASupprimer,
    seancesACreer,
    seancesAModifier,
    seancesInchangees,
  };
}

function enModification(session: AdminWorkoutSession, expectedUpdatedAt: string): SeanceAModifier {
  const canonique = toCanonicalSessionSaveData(session);
  return {
    sessionId: session.id,
    expectedUpdatedAt,
    blocks: canonique.blocks,
    sessionPatch: {
      day: canonique.sessionPatch.day,
      name: canonique.sessionPatch.name,
      muscleGroup: canonique.sessionPatch.muscleGroup,
      durationMinutes: canonique.sessionPatch.durationMinutes ?? null,
      warmup: canonique.sessionPatch.warmup,
      coachNotes: canonique.sessionPatch.coachNotes,
      bannerUrl: canonique.sessionPatch.bannerUrl ?? null,
    },
  };
}

/** Vrai si le diff n'écrirait RIEN : utile pour ne pas émettre d'appel inutile. */
export function diffVide(diff: DiffDeProgrammation): boolean {
  return (
    diff.semainesACreer.length === 0 &&
    diff.semainesASupprimer.length === 0 &&
    diff.sessionIdsASupprimer.length === 0 &&
    diff.seancesACreer.length === 0 &&
    diff.seancesAModifier.length === 0
  );
}
