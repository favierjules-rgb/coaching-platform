/**
 * MODE LIVE — QUELS ÉLÈVES UNE PROGRAMMATION CONCERNE-T-ELLE VRAIMENT ?
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE PIÈGE QUE CE MODULE EXISTE POUR FERMER
 * ════════════════════════════════════════════════════════════════════════════
 * `AdminProgramSummary.assignedStudentIds` MÉLANGE DEUX POPULATIONS QUI N'ONT
 * PAS LES MÊMES SÉANCES (voir `loadProgramsSummary` et `mergeAssignedStudentIds`) :
 *
 *   1. les AFFECTATIONS DIRECTES — une ligne `assignments` vers CE programme.
 *      L'élève s'entraîne sur les séances qu'on lit ici ;
 *   2. les PROPRIÉTAIRES DE COPIE (`assignedViaCopyStudentIds`) — rattachés à
 *      la carte du MODÈLE pour être nommés, alors qu'ils s'entraînent sur une
 *      AUTRE structure : leur copie, avec ses propres identifiants de séance.
 *
 * ⚠️ OUVRIR LE MODE LIVE POUR UN PROPRIÉTAIRE DE COPIE DEPUIS LA CARTE DU
 * MODÈLE SERAIT UNE ERREUR DE DONNÉES, PAS UNE SIMPLE MALADRESSE. On saisirait
 * une séance du modèle au nom d'un élève qui ne la fait pas. La base refuserait
 * d'ailleurs l'écriture : `student_owns_workout_session(student, session)`
 * n'accepte que le propriétaire du programme ou une affectation DIRECTE — un
 * propriétaire de copie n'a ni l'un ni l'autre sur le modèle. Le refus
 * arriverait en salle, au moment de valider, après la séance.
 *
 * La règle retenue est donc la même que celle de la base, mot pour mot :
 * MODE LIVE ne concerne que les affectations DIRECTES. Le propriétaire d'une
 * copie reste joignable — depuis la carte de SA copie, où il a bien une
 * affectation directe et où les séances sont les siennes.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE MODULE NE DÉCIDE AUCUN DROIT
 * ════════════════════════════════════════════════════════════════════════════
 * Il ne fait que trier des identifiants déjà chargés par l'écran. L'autorisation
 * est tranchée côté serveur, élève par élève, par `requireStaffForStudent`
 * (catégorie entraînement, niveau écriture) — voir la route
 * `/api/admin/presentiel/programmes/[programId]/eleves`. Ce qui est calculé ici
 * sert à SAVOIR S'IL FAUT AFFICHER L'ÉTIQUETTE, jamais à ouvrir une porte.
 */

/** Le minimum dont ce module a besoin d'une carte de programmation. */
export interface ProgrammeAffectable {
  readonly assignedStudentIds: readonly string[];
  /** Élèves présents sur la carte au seul titre d'une COPIE. */
  readonly assignedViaCopyStudentIds?: readonly string[];
  /** Copie individuelle : son propriétaire s'entraîne bien sur CE programme. */
  readonly ownerStudentId?: string | null;
}

/**
 * Les élèves qui s'entraînent RÉELLEMENT sur les séances de ce programme.
 *
 * ⚠️ SOUSTRACTION, PAS FILTRAGE PAR NOM NI PAR RESSEMBLANCE. On retire de
 * `assignedStudentIds` exactement les identifiants que la couche de données a
 * déclarés « présents au titre d'une copie ». Les deux listes viennent de la
 * même lecture, au même instant : aucune correspondance approximative, aucun
 * rapprochement par libellé de programme.
 *
 * ⚠️ `assignedViaCopyStudentIds` ABSENT N'EST PAS « AUCUNE COPIE ». Les
 * programmes de démonstration (Supabase non configuré) ne portent pas ce
 * champ ; on rend alors la liste telle quelle, et c'est l'appelant qui refuse
 * d'afficher l'étiquette hors d'une base réelle — il n'y a là ni compte, ni
 * droits, ni séance à saisir.
 */
export function elevesEnAffectationDirecte(programme: ProgrammeAffectable): string[] {
  const copies = new Set(programme.assignedViaCopyStudentIds ?? []);
  const directs = programme.assignedStudentIds.filter((id) => !copies.has(id));
  /*
   * Le propriétaire d'une copie, sur la carte de SA copie, s'entraîne bien
   * ici — la base l'accepte par `programs.owner_student_id`. Il a en principe
   * aussi une ligne `assignments` (une copie sans affectation active n'est
   * plus affichée, voir `keepCopiesWithActiveAssignment`), donc il est déjà
   * dans `directs` : l'ajouter ne fait que fermer le cas où la lecture des
   * affectations serait partielle.
   */
  if (programme.ownerStudentId) directs.push(programme.ownerStudentId);
  return [...new Set(directs)];
}

/** Une programmation mérite-t-elle l'étiquette MODE LIVE ? */
export function programmeEstLivrableEnLive(programme: ProgrammeAffectable): boolean {
  return elevesEnAffectationDirecte(programme).length > 0;
}

/** Un élève tel que la fenêtre de choix l'affiche. */
export interface EleveLive {
  readonly studentId: string;
  readonly prenom: string;
  readonly nom: string;
  /** Deuxième information de différenciation, quand elle existe. */
  readonly email: string | null;
  /** Date de début de SON affectation à ce programme, si elle est connue. */
  readonly debutProgramme: string | null;
}

/**
 * Prépare la liste affichée : dédoublonnée par identifiant, triée par nom.
 *
 * ⚠️ LA DÉDUPLICATION PORTE SUR `studentId`, JAMAIS SUR LE NOM. Deux élèves
 * peuvent s'appeler pareil — c'est explicitement l'un des cas à ne pas
 * confondre. Le nom ne sert qu'à l'affichage et au tri ; l'identité, c'est
 * l'identifiant. `homonymes` signale les noms partagés pour que la fenêtre
 * puisse ajouter de quoi les distinguer.
 */
export function listeElevesLive(eleves: readonly EleveLive[]): {
  readonly eleves: readonly EleveLive[];
  readonly homonymes: ReadonlySet<string>;
} {
  const parId = new Map<string, EleveLive>();
  for (const e of eleves) if (!parId.has(e.studentId)) parId.set(e.studentId, e);

  const comptesParNom = new Map<string, number>();
  for (const e of parId.values()) {
    const cle = `${e.prenom} ${e.nom}`.trim().toLowerCase();
    comptesParNom.set(cle, (comptesParNom.get(cle) ?? 0) + 1);
  }
  const homonymes = new Set(
    [...comptesParNom.entries()].filter(([, n]) => n > 1).map(([cle]) => cle),
  );

  const triees = [...parId.values()].sort((a, b) =>
    `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr"),
  );
  return { eleves: triees, homonymes };
}

/** Le nom affiché pour un élève, complété quand il est ambigu. */
export function libelleEleve(eleve: EleveLive, homonymes: ReadonlySet<string>): string {
  const nom = `${eleve.prenom} ${eleve.nom}`.trim() || "Élève";
  if (!homonymes.has(nom.toLowerCase())) return nom;
  // ⚠️ ON NE REND JAMAIS L'IDENTIFIANT TECHNIQUE VISIBLE À LA PLACE : il ne
  // dit rien au coach. L'e-mail distingue, et il est déjà à l'écran ailleurs
  // dans l'espace coach. À défaut, on le dit plutôt que de laisser croire que
  // deux lignes identiques sont un doublon.
  return eleve.email ? `${nom} · ${eleve.email}` : `${nom} · homonyme`;
}
