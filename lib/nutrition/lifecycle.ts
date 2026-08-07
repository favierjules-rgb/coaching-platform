import type { RecipeStatus } from "@/lib/nutrition/recipe-rows";
import type { AdminContentStatus } from "@/types";

/**
 * LE CYCLE DE VIE des plans alimentaires et des recettes — logique PURE.
 *
 * CE MODULE NE DÉCIDE RIEN DE SENSIBLE. Il traduit en français, il ordonne
 * des boutons, il compose un nom de copie. Le VERDICT — « cette ressource
 * peut-elle être supprimée ? » — est calculé exclusivement par la base
 * (`nutrition_plan_deletion_block` / `nutrition_recipe_deletion_block`,
 * migration 20260815090000) et recalculé une seconde fois, dans la même
 * transaction, au moment de la suppression.
 *
 * Autrement dit : ce fichier peut mentir sans conséquence. C'est voulu. Un
 * `canDelete` fabriqué ici, ou par un navigateur modifié, n'ouvre rien.
 *
 * LES DEUX VOCABULAIRES DE STATUT NE SONT PAS FUSIONNÉS :
 *   - un PLAN est brouillon / actif / archivé (`AdminContentStatus`) ;
 *   - une RECETTE est draft / active / archived (`RecipeStatus`).
 * Ils ont trois états chacun, mais ce ne sont pas les mêmes objets, ils ne
 * sont pas stockés pareil, et les confondre reviendrait à traduire un statut
 * de plan avec le vocabulaire d'une recette. On les garde distincts.
 */

// ────────────────────────────────────────────────────────────────────────────
// Les motifs de blocage — miroir EXACT des codes SQL
// ────────────────────────────────────────────────────────────────────────────

/** Motifs retournés par les deux fonctions SQL `*_deletion_block`. */
export const DELETION_BLOCK_CODES = [
  "not_found",
  "forbidden",
  "assigned",
  "used_in_history",
] as const;

export type DeletionBlockCode = (typeof DELETION_BLOCK_CODES)[number];

/** Ce que la RPC de suppression peut répondre. `ok` = la ressource a disparu. */
export type DeletionOutcome = "ok" | DeletionBlockCode;

export function isDeletionBlockCode(valeur: unknown): valeur is DeletionBlockCode {
  return typeof valeur === "string" && (DELETION_BLOCK_CODES as readonly string[]).includes(valeur);
}

/** Dépendances comptées côté serveur, affichées telles quelles dans la modale. */
export interface PlanDeletionDependencies {
  readonly assignedStudents: number;
  readonly dailyLogs: number;
}

export interface RecipeDeletionDependencies {
  readonly studentsWithAccess: number;
}

/**
 * Le motif PRÉCIS, en français, pour un plan.
 *
 * On nomme la dépendance et son nombre : « 1 élève y est affecté » est
 * actionnable, « suppression impossible » ne l'est pas.
 */
export function describePlanDeletionBlock(
  code: DeletionBlockCode,
  deps: PlanDeletionDependencies,
): string {
  switch (code) {
    case "assigned":
      return deps.assignedStudents > 1
        ? `${deps.assignedStudents} élèves sont encore affectés à ce plan. Retire-les avant de pouvoir le supprimer — ou archive-le, ce qui leur laisse leur suivi.`
        : "Un élève est encore affecté à ce plan. Retire-lui avant de pouvoir le supprimer — ou archive-le, ce qui lui laisse son suivi.";
    case "used_in_history":
      return deps.dailyLogs > 1
        ? `${deps.dailyLogs} journées de suivi ont été enregistrées sur ce plan. Elles ne seront jamais effacées pour rendre une suppression possible : archive le plan à la place.`
        : "Une journée de suivi a été enregistrée sur ce plan. Elle ne sera jamais effacée pour rendre une suppression possible : archive le plan à la place.";
    case "forbidden":
      return "Ce plan appartient à un autre coach : tu ne peux pas le supprimer.";
    case "not_found":
      return "Ce plan est introuvable : il a peut-être déjà été supprimé. Recharge la page.";
  }
}

/** Le motif PRÉCIS, en français, pour une recette. */
export function describeRecipeDeletionBlock(
  code: DeletionBlockCode,
  deps: RecipeDeletionDependencies,
): string {
  switch (code) {
    case "assigned":
      return deps.studentsWithAccess > 1
        ? `${deps.studentsWithAccess} élèves peuvent encore ouvrir cette recette depuis leur plan alimentaire. Dépublie-la ou archive-la d'abord.`
        : "Un élève peut encore ouvrir cette recette depuis son plan alimentaire. Dépublie-la ou archive-la d'abord.";
    case "used_in_history":
      return "Cette recette est référencée par un historique conservé : elle ne peut pas être supprimée.";
    case "forbidden":
      return "Cette recette appartient à un autre coach : tu ne peux pas la supprimer.";
    case "not_found":
      return "Cette recette est introuvable : elle a peut-être déjà été supprimée. Recharge la page.";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Quelles actions proposer, selon le statut courant
// ────────────────────────────────────────────────────────────────────────────

/**
 * Les actions de cycle de vie d'un PLAN.
 *
 * `delete` n'apparaît jamais dans cette liste : ce n'est pas une action de
 * cycle de vie parmi d'autres, elle vit dans la zone dangereuse et son
 * autorisation vient du serveur, pas d'ici.
 */
export type PlanLifecycleAction = "activate" | "archive" | "restore" | "duplicate";

export function planLifecycleActions(status: AdminContentStatus): readonly PlanLifecycleAction[] {
  switch (status) {
    case "brouillon":
      // Un brouillon n'est visible par personne : rien à restaurer, tout à
      // activer.
      return ["activate", "duplicate"];
    case "actif":
      return ["archive", "duplicate"];
    case "archivé":
      // « Restaurer » ramène en BROUILLON, pas en actif : réactiver un plan
      // archivé le rendrait immédiatement assignable, ce qui n'est jamais ce
      // qu'on veut sans l'avoir relu.
      return ["restore", "duplicate"];
  }
}

/** Le statut qu'atteint une action de plan. */
export function planStatusAfter(action: PlanLifecycleAction): AdminContentStatus | null {
  switch (action) {
    case "activate":
      return "actif";
    case "archive":
      return "archivé";
    case "restore":
      return "brouillon";
    case "duplicate":
      return null;
  }
}

/** Les actions de cycle de vie d'une RECETTE. */
export type RecipeLifecycleAction =
  | "publish"
  | "unpublish"
  | "archive"
  | "restore"
  | "duplicate";

export function recipeLifecycleActions(status: RecipeStatus): readonly RecipeLifecycleAction[] {
  switch (status) {
    case "draft":
      return ["publish", "archive", "duplicate"];
    case "active":
      return ["unpublish", "archive", "duplicate"];
    case "archived":
      return ["restore", "duplicate"];
  }
}

export function recipeStatusAfter(action: RecipeLifecycleAction): RecipeStatus | null {
  switch (action) {
    case "publish":
      return "active";
    case "unpublish":
    case "restore":
      return "draft";
    case "archive":
      return "archived";
    case "duplicate":
      return null;
  }
}

/** Libellés des boutons — un seul endroit, pour que l'écran et les tests s'accordent. */
export const PLAN_ACTION_LABELS_FR: Readonly<Record<PlanLifecycleAction, string>> = {
  activate: "Activer",
  archive: "Archiver",
  restore: "Restaurer",
  duplicate: "Dupliquer",
};

export const RECIPE_ACTION_LABELS_FR: Readonly<Record<RecipeLifecycleAction, string>> = {
  publish: "Publier",
  unpublish: "Dépublier",
  archive: "Archiver",
  restore: "Restaurer",
  duplicate: "Dupliquer",
};

/** Le libellé UNIQUE de la suppression définitive, partout dans l'interface. */
export const DELETE_ACTION_LABEL_FR = "Supprimer définitivement";

// ────────────────────────────────────────────────────────────────────────────
// L'action qui retire un plan à son élève
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ce changement de statut va-t-il faire DISPARAÎTRE le plan de l'espace d'un
 * élève ?
 *
 * Un seul statut le fait : `brouillon`. La policy
 * `nutrition_plans_select_self_or_assigned` (migration 20260815090000) exclut
 * `prochain` sans condition — l'affectation reste en place, mais l'élève ne
 * voit plus rien : ni objectifs, ni semaine, ni recettes.
 *
 * `archivé` NE le fait PAS : c'est tout l'intérêt de l'archivage, qui conserve
 * l'accès de l'élève déjà affecté. Confondre les deux ferait apparaître une
 * confirmation là où il n'y a rien à confirmer, et on cesserait de la lire.
 */
export function hidesPlanFromAssignedStudent(
  cible: AdminContentStatus,
  nombreÉlèvesAffectés: number,
): boolean {
  return cible === "brouillon" && nombreÉlèvesAffectés > 0;
}

/**
 * La phrase de la confirmation. Elle NOMME l'élève : « un élève » est une
 * abstraction, « Marie Dupont » est une conséquence.
 */
export function describeHidingFromStudent(noms: readonly string[]): string {
  const qui =
    noms.length === 0
      ? "L'élève affecté"
      : noms.length === 1
        ? noms[0]
        : `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
  const verbe = noms.length > 1 ? "ne verront" : "ne verra";
  return `${qui} ${verbe} plus ce plan : ni les objectifs, ni la semaine, ni les recettes. L'affectation, elle, reste en place — repasser le plan en « actif » le rend de nouveau visible. Pour conserver l'accès de l'élève, archive-le plutôt que de le remettre en brouillon.`;
}

// ────────────────────────────────────────────────────────────────────────────
// La confirmation par saisie du nom
// ────────────────────────────────────────────────────────────────────────────

/**
 * Le nom saisi correspond-il EXACTEMENT à celui de la ressource ?
 *
 * On normalise en NFC et on retire les espaces de bord — un accent composé
 * autrement par le clavier, ou un espace collé par un copier-coller, n'est pas
 * une erreur de l'utilisateur. Tout le reste (casse, ponctuation, accents)
 * doit correspondre : c'est ce qui fait de cette saisie une confirmation et
 * non une formalité.
 */
export function matchesExactName(saisi: string, attendu: string): boolean {
  const normaliser = (v: string) => v.normalize("NFC").trim();
  const cible = normaliser(attendu);
  if (cible === "") return false;
  return normaliser(saisi) === cible;
}

/**
 * Le nom d'une copie. Suffixe explicite plutôt que « (1) » : dans une liste
 * triée par nom, « Semaine sèche (copie) » se lit sans ouvrir la fiche.
 */
export function duplicateName(nom: string): string {
  const base = nom.trim() === "" ? "Sans nom" : nom.trim();
  return `${base} (copie)`;
}
