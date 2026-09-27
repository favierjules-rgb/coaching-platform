/**
 * Sélection d'élèves dans les modales d'assignation — fonctions PURES
 * (fix/program-assignment-checkbox).
 *
 * Bug corrigé : la modale écrivait l'assignation À CHAQUE CLIC et dérivait
 * l'état coché des données serveur du programme MODÈLE. Depuis
 * l'individualisation (PR #53), l'assignation d'un programme individuel vise
 * la COPIE de l'élève — jamais le modèle — donc la case ne se cochait
 * jamais, tout en écrivant réellement en base à chaque clic.
 *
 * Nouveau contrat : la sélection vit LOCALEMENT dans la modale (ces
 * fonctions), et les écritures ne partent qu'au clic sur « Terminer »
 * (diff ajouté/retiré). Toujours immuable : jamais de mutation du tableau
 * reçu — chaque bascule rend une NOUVELLE référence, sinon React ne
 * re-rend pas.
 */

/** Coche/décoche un élève — immuable, idempotent (double ajout impossible). */
export function toggleStudentSelection(ids: string[], studentId: string, checked: boolean): string[] {
  if (checked) {
    return ids.includes(studentId) ? ids : [...ids, studentId];
  }
  return ids.filter((id) => id !== studentId);
}

/**
 * POURQUOI `apply` REÇOIT UN MOTIF.
 *
 * Trois écritures traversent ce point et ne veulent pas la même chose :
 *   · `"ajout"`   — une attribution neuve. Elle déclenche l'email « contenu
 *     assigné », et c'est son rôle ;
 *   · `"retrait"` — une désassignation ;
 *   · `"date"`    — une CORRECTION de la date de début d'une affectation qui
 *     existe déjà. Rien n'est attribué, donc aucun email ne doit partir : le
 *     coach corrige une saisie, il ne réassigne pas un programme. Sans ce
 *     motif, l'appelant ne pourrait pas distinguer la correction de l'ajout, et
 *     chaque rectification de date enverrait un mail à l'élève.
 */
export type MotifAssignation = "ajout" | "retrait" | "date";

/**
 * Applique la sélection validée par « Terminer » : compare l'état initial
 * (assignations existantes à l'ouverture) et la sélection visible, puis
 * n'émet QUE les changements — jamais de ré-écriture des inchangés (pas de
 * ré-envoi d'email d'assignation, pas d'écriture inutile).
 *
 * ⚠️ « INCHANGÉ » NE VEUT PAS DIRE « RIEN À ÉCRIRE », et c'est le défaut que
 * `aReappliquer` ferme. Une affectation porte plus qu'un booléen : elle porte
 * une DATE DE DÉBUT. Un élève déjà coché et toujours coché produisait zéro
 * appel, donc la date saisie à côté de lui n'était jamais enregistrée — et la
 * modale confirmait quand même. Les identifiants listés dans `aReappliquer`
 * sont réémis avec le motif `"date"` s'ils sont présents AVANT et APRÈS ; un
 * identifiant qui vient d'être ajouté n'y est pas réémis (son ajout porte déjà
 * la date), et un identifiant retiré non plus (la ligne disparaît).
 */
export function applySelectionDiff(
  before: string[],
  after: string[],
  apply: (studentId: string, assigned: boolean, motif: MotifAssignation) => void,
  aReappliquer: readonly string[] = [],
): { added: string[]; removed: string[]; reappliques: string[] } {
  const avant = new Set(before);
  const apres = new Set(after);
  const added = after.filter((id) => !avant.has(id));
  const removed = before.filter((id) => !apres.has(id));
  const aReappliquerSet = new Set(aReappliquer);
  const reappliques = after.filter((id) => avant.has(id) && aReappliquerSet.has(id));
  for (const id of added) apply(id, true, "ajout");
  for (const id of removed) apply(id, false, "retrait");
  for (const id of reappliques) apply(id, true, "date");
  return { added, removed, reappliques };
}

/* ─── Sélection à CHOIX UNIQUE — nutrition (fix/nutrition-single-assigned-plan) ─── */

/**
 * Bascule à CHOIX UNIQUE : cocher remplace la sélection au lieu de s'y
 * ajouter. Utilisée pour la nutrition, où la règle produit est « un élève,
 * au plus un plan assigné ». Laisser une sélection multiple ferait miroiter
 * un état que la base refuse désormais (index unique partiel sur
 * `student_id`).
 *
 * Immuable comme `toggleStudentSelection` : toujours une nouvelle référence.
 */
export function toggleSingleSelection(ids: string[], id: string, checked: boolean): string[] {
  if (checked) {
    return ids.length === 1 && ids[0] === id ? ids : [id];
  }
  return ids.filter((autre) => autre !== id);
}

/**
 * Écritures à émettre pour une assignation à CHOIX UNIQUE.
 *
 * POINT CLÉ : quand un nouvel élément est sélectionné, AUCUN retrait n'est
 * émis. C'est la RPC `assign_nutrition_plan` qui retire l'ancien plan, dans
 * la MÊME transaction que l'assignation du nouveau. Émettre en plus un
 * retrait côté client recréerait exactement ce qu'on corrige : deux
 * écritures indépendantes, donc une fenêtre pendant laquelle l'élève n'a
 * aucun plan.
 *
 * Un retrait n'est émis que lorsque la sélection devient VIDE — c'est la
 * désassignation volontaire, qui reste autorisée.
 *
 * Fonction PURE.
 */
export function planSingleAssignmentWrites(
  before: string[],
  after: string[],
): { assign: string | null; unassign: string[] } {
  const avant = new Set(before);
  const ajoutes = after.filter((id) => !avant.has(id));
  if (ajoutes.length > 0) {
    // Choix unique : le dernier ajouté gagne. L'interface empêche déjà d'en
    // cocher deux (toggleSingleSelection), ce cas reste un filet.
    return { assign: ajoutes[ajoutes.length - 1], unassign: [] };
  }
  const apres = new Set(after);
  return { assign: null, unassign: before.filter((id) => !apres.has(id)) };
}

/**
 * Équivalent de `terminerAssignation` pour une assignation à choix unique :
 * même contrat de retour, mais AUCUN enchaînement « désassigner puis
 * assigner ». Une seule écriture part quand un élément est sélectionné.
 */
export async function terminerAssignationUnique(
  before: string[],
  after: string[],
  apply: (
    id: string,
    assigned: boolean,
    motif: MotifAssignation,
  ) => boolean | void | Promise<boolean | void>,
  /**
   * ⚠️ TOUJOURS VIDE EN PRATIQUE, ET DÉCLARÉ QUAND MÊME. La nutrition est le
   * seul usage du choix unique, et un plan alimentaire n'a pas de date de début
   * — il n'y a donc rien à réappliquer. Le paramètre existe pour que les deux
   * fonctions restent INTERCHANGEABLES dans la ternaire
   * `type === "nutrition" ? terminerAssignationUnique : terminerAssignation`
   * que deux tests structurels gardent. Le traiter (au lieu de l'ignorer)
   * évite un paramètre mort dont personne ne saurait s'il est honoré.
   */
  aReappliquer: readonly string[] = [],
): Promise<{ ok: boolean; added: string[]; removed: string[]; reappliques: string[] }> {
  const { assign, unassign } = planSingleAssignmentWrites(before, after);
  const résultats: Array<boolean | void | Promise<boolean | void>> = [];
  if (assign !== null) résultats.push(apply(assign, true, "ajout"));
  for (const id of unassign) résultats.push(apply(id, false, "retrait"));
  const avant = new Set(before);
  const aReappliquerSet = new Set(aReappliquer);
  const reappliques = after.filter(
    (id) => avant.has(id) && aReappliquerSet.has(id) && id !== assign,
  );
  for (const id of reappliques) résultats.push(apply(id, true, "date"));
  const issues = await Promise.all(résultats.map((r) => Promise.resolve(r).catch(() => false as const)));
  return {
    ok: issues.every((issue) => issue !== false),
    added: assign !== null ? [assign] : [],
    removed: unassign,
    reappliques,
  };
}

/**
 * Élèves « assignés » d'un programme tels qu'affichés (cases cochées à
 * l'ouverture) : les liens directs (mode groupe, héritage) PLUS les
 * propriétaires d'une copie individuelle issue de ce modèle — c'est là que
 * vit l'assignation réelle depuis l'individualisation. Dédupliqué, ordre
 * stable (directs d'abord).
 *
 * ATTENTION (bug de désassignation corrigé) : ne passer ici que les
 * propriétaires de copies portant un lien `assignments` ACTIF — voir
 * keepCopiesWithActiveAssignment. Une copie désassignée (conservée avec son
 * historique, owner_student_id toujours posé) ne doit JAMAIS apparaître
 * cochée sur le modèle.
 */
export function mergeAssignedStudentIds(direct: string[], copyOwners: string[]): string[] {
  return [...new Set([...direct, ...copyOwners])];
}

/**
 * Filtre les copies individuelles sur l'existence d'un lien `assignments`
 * ACTIF vers la copie. La désassignation supprime le lien mais CONSERVE la
 * copie (owner_student_id + historique) : `owner_student_id` seul signifie
 * « a possédé un cycle », pas « est assigné aujourd'hui ». Une future
 * réassignation réutilise cette copie et la re-rend visible.
 */
export function keepCopiesWithActiveAssignment<T extends { id: string }>(
  copies: T[],
  activeContentIds: Iterable<string>,
): T[] {
  const actifs = new Set(activeContentIds);
  return copies.filter((copie) => actifs.has(copie.id));
}

/**
 * Validation du « Terminer » — ATOMICITÉ UI (2e correctif du chantier) :
 * TOUTES les écritures du diff sont collectées puis ATTENDUES
 * (Promise.all) ; un rejet ou un `false` (échec d'écriture Supabase,
 * ex. RPC refusée) rend `ok: false` — jamais d'erreur silencieuse, la
 * modale reste alors ouverte au lieu d'afficher un faux succès.
 *
 * Générique sur les identifiants : le premier argument de `apply` est l'id
 * basculé — un élève dans AssignStudentsModal, un CONTENU dans
 * AssignContentToStudentModal (fix/student-profile-content-assignment).
 */
export async function terminerAssignation(
  before: string[],
  after: string[],
  apply: (
    studentId: string,
    assigned: boolean,
    motif: MotifAssignation,
  ) => boolean | void | Promise<boolean | void>,
  /** Identifiants inchangés dont la DATE a été modifiée — voir `applySelectionDiff`. */
  aReappliquer: readonly string[] = [],
): Promise<{ ok: boolean; added: string[]; removed: string[]; reappliques: string[] }> {
  const résultats: Array<boolean | void | Promise<boolean | void>> = [];
  const { added, removed, reappliques } = applySelectionDiff(
    before,
    after,
    (studentId, assigned, motif) => {
      résultats.push(apply(studentId, assigned, motif));
    },
    aReappliquer,
  );
  const issues = await Promise.all(résultats.map((r) => Promise.resolve(r).catch(() => false as const)));
  return { ok: issues.every((issue) => issue !== false), added, removed, reappliques };
}

/* ─── LA DATE DE DÉBUT DANS LES MODALES — deux fonctions PURES ─── */

/**
 * CE QUE LE CHAMP « DATE DE DÉBUT » DOIT AFFICHER À L'OUVERTURE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE N'EST PLUS « AUJOURD'HUI »
 * ════════════════════════════════════════════════════════════════════════
 * Les deux modales posaient `dateDuJourLocale()` dans le champ, toujours, y
 * compris quand une date était enregistrée depuis trois semaines. Le coach
 * lisait donc une PROPOSITION en croyant lire un ENREGISTREMENT — et comme le
 * diff n'écrivait rien pour un élève déjà coché, il repartait convaincu d'avoir
 * vu et confirmé la bonne date. Un champ doit dire ce qui est stocké.
 *
 * La règle, cas par cas :
 *   · aucune affectation existante → la date du jour reste une proposition
 *     légitime : il n'y a rien à lire, et le coach assigne aujourd'hui ;
 *   · une seule date stockée → c'est elle, et elle est modifiable ;
 *   · une seule valeur stockée, mais VIDE → le champ est vide. « Pas de date »
 *     est un état réel (12 des 19 affectations de production), pas un trou à
 *     combler avec le jour courant ;
 *   · plusieurs dates différentes → le champ est vide et `divergentes` le dit.
 *     Choisir arbitrairement l'une des dates l'imposerait aux autres élèves au
 *     premier « Terminer », sans que personne l'ait demandé ;
 *   · rien de lu (lecture échouée) → champ vide. Une valeur inventée ici
 *     serait écrite sur de vraies lignes.
 */
export function dateProposeeParLaModale(entree: {
  /** Identifiants DÉJÀ affectés à l'ouverture (élèves, ou contenus). */
  readonly dejaAffectes: readonly string[];
  /** `id` → date stockée. Une clé ABSENTE signifie « non lu », pas « pas de date ». */
  readonly debutsStockes: ReadonlyMap<string, string | null>;
  readonly dateDuJour: string;
}): { valeur: string; divergentes: boolean } {
  const { dejaAffectes, debutsStockes, dateDuJour } = entree;
  if (dejaAffectes.length === 0) {
    return { valeur: dateDuJour, divergentes: false };
  }
  const lues = dejaAffectes.filter((id) => debutsStockes.has(id)).map((id) => debutsStockes.get(id) ?? null);
  const distinctes = [...new Set(lues)];
  if (distinctes.length === 0) {
    return { valeur: "", divergentes: false };
  }
  if (distinctes.length > 1) {
    return { valeur: "", divergentes: true };
  }
  return { valeur: distinctes[0] ?? "", divergentes: false };
}

/**
 * LES AFFECTATIONS EXISTANTES DONT LA DATE A CHANGÉ — celles que « Terminer »
 * doit réémettre, et elles seules.
 *
 * ⚠️ UN IDENTIFIANT NON LU N'EST JAMAIS RÉÉCRIT. Si la lecture des dates a
 * échoué, la table est vide : réémettre tout le monde écraserait des dates
 * réelles avec le contenu d'un champ que personne n'a pu comparer à quoi que ce
 * soit. Ne rien faire est le seul comportement défendable.
 *
 * ⚠️ ET UNE DATE IDENTIQUE NON PLUS. Le contrat d'origine des modales — « pas
 * de ré-écriture des inchangés » — tient toujours : seule une VRAIE différence
 * produit une écriture.
 */
export function affectationsDontLaDateChange(entree: {
  readonly dejaAffectes: readonly string[];
  readonly debutsStockes: ReadonlyMap<string, string | null>;
  /** La valeur du champ, normalisée : `null` pour « pas de date ». */
  readonly dateSaisie: string | null;
}): string[] {
  const { dejaAffectes, debutsStockes, dateSaisie } = entree;
  return dejaAffectes.filter(
    (id) => debutsStockes.has(id) && (debutsStockes.get(id) ?? null) !== dateSaisie,
  );
}

/**
 * CE QUE « TERMINER » DOIT RÉÉCRIRE — le garde-fou complet, en une fonction.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE N'EST PAS `affectationsDontLaDateChange` TOUT SEUL
 * ════════════════════════════════════════════════════════════════════════
 * Cette fonction compare une valeur SAISIE à une valeur STOCKÉE. Elle ne sait
 * pas, et ne peut pas savoir, POURQUOI le champ vaut ce qu'il vaut. Deux
 * situations lui sont indiscernables :
 *   · le coach a vidé le champ pour RETIRER la date — une action légitime ;
 *   · le champ est vide parce que les élèves déjà assignés n'ont pas la même
 *     date, et que la modale refuse d'en imposer une arbitrairement.
 *
 * Mesuré sur la production du 27/09/2026 : la carte du modèle
 * « L'ULTIME UPPER / LOWER by SETH » porte Jules (07/09) et Trystan (sans date).
 * Ouvrir cette modale pour cocher un élève et cliquer « Terminer » sans rien
 * toucher réécrivait la ligne de Jules avec `null` — sa date disparaissait, en
 * silence, sur un geste qui ne parlait pas de dates.
 *
 * ⚠️ DEUX GARDES, ET AUCUNE NE SUFFIT SEULE.
 *   · `champDateTouche` — rien n'est réécrit tant que personne n'a touché le
 *     champ. Un clic sur « Terminer » pour cocher un élève ne parle pas de la
 *     date des autres ;
 *   · `datesDivergentes` — quand les dates diffèrent, AUCUNE écriture de date ne
 *     part de cette modale, même si le champ a été touché. C'est l'option C
 *     retenue le 27/09/2026 : la sémantique de groupe n'est explicite que
 *     lorsque les élèves partagent déjà la même date. Sinon, la correction passe
 *     par la fiche de l'élève, qui est individuelle par construction.
 *
 * ⚠️ ET LE GARDE « NON LU » RESTE, DERRIÈRE. `affectationsDontLaDateChange`
 * n'inclut jamais un identifiant absent de la table : une lecture échouée ne
 * peut pas écraser de vraies dates.
 */
export function datesAReecrireDepuisLaModale(entree: {
  readonly dejaAffectes: readonly string[];
  readonly debutsStockes: ReadonlyMap<string, string | null>;
  /** La valeur du champ, normalisée : `null` pour « pas de date ». */
  readonly dateSaisie: string | null;
  /** `true` dès que le coach a modifié le champ à la main, jamais avant. */
  readonly champDateTouche: boolean;
  /** `true` quand les élèves déjà assignés n'ont pas tous la même date. */
  readonly datesDivergentes: boolean;
}): string[] {
  if (!entree.champDateTouche) return [];
  if (entree.datesDivergentes) return [];
  return affectationsDontLaDateChange({
    dejaAffectes: entree.dejaAffectes,
    debutsStockes: entree.debutsStockes,
    dateSaisie: entree.dateSaisie,
  });
}

/* ─── Modale « Attribuer un contenu à [élève] » (fiche élève) —
   fix/student-profile-content-assignment ─── */

/** Sélection locale de la modale fiche élève, un tableau d'ids par type de contenu. */
export interface ContentSelection {
  programme: string[];
  nutrition: string[];
  document: string[];
}

/**
 * Programmes PROPOSABLES dans la modale : uniquement les MODÈLES. Une copie
 * individuelle (`ownerStudentId` posé, table `programs.owner_student_id`)
 * n'est jamais proposée à l'attribution — c'est un artefact d'exécution du
 * modèle pour UN élève, la lister ferait apparaître le même programme en
 * double (modèle + copie) et attribuer une copie d'un élève à un autre
 * serait un non-sens produit. Les programmes mock (sans le champ) restent
 * proposables.
 */
export function filterAssignableProgramModels<T extends { ownerStudentId?: string | null }>(programs: T[]): T[] {
  return programs.filter((p) => !p.ownerStudentId);
}

/**
 * Un modèle est coché pour un élève si une assignation ACTIVE pointe vers
 * lui — directement, OU vers la copie individuelle de l'élève :
 * - `program.assignedStudentIds` porte déjà cette fusion côté Supabase
 *   (liens directs + propriétaires de copies à lien actif, voir
 *   loadPrograms/mergeAssignedStudentIds/keepCopiesWithActiveAssignment) ;
 * - `student.assignedProgramIds` (liens `assignments` par élève) couvre le
 *   chemin mock et le lien direct — un id de copie qu'il contiendrait ne
 *   matche jamais un modèle de la liste proposable, l'union est donc sûre.
 * Une copie conservée SANS lien actif (owner seul) ne coche rien.
 */
export function isProgramCheckedForStudent(
  program: { id: string; assignedStudentIds: string[] },
  student: { id: string; assignedProgramIds: string[] },
): boolean {
  return program.assignedStudentIds.includes(student.id) || student.assignedProgramIds.includes(program.id);
}

/**
 * Sélection INITIALE de la modale fiche élève, calculée à CHAQUE ouverture
 * depuis l'état réel (fermer/rouvrir recharge donc les vraies coches).
 * Nutrition et documents sont intersectés avec les listes AFFICHÉES : le
 * diff du « Terminer » ne peut ainsi jamais toucher un contenu non proposé.
 */
export function initialContentSelection(
  student: {
    id: string;
    assignedProgramIds: string[];
    assignedNutritionPlanIds: string[];
    assignedDocumentIds: string[];
  },
  contents: {
    programs: Array<{ id: string; ownerStudentId?: string | null; assignedStudentIds: string[] }>;
    nutritionPlanIds: string[];
    documentIds: string[];
  },
): ContentSelection {
  return {
    programme: filterAssignableProgramModels(contents.programs)
      .filter((p) => isProgramCheckedForStudent(p, student))
      .map((p) => p.id),
    nutrition: contents.nutritionPlanIds.filter((id) => student.assignedNutritionPlanIds.includes(id)),
    document: contents.documentIds.filter((id) => student.assignedDocumentIds.includes(id)),
  };
}
