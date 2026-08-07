import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RECIPE_IMAGE_BUCKET,
  buildRecipeImagePath,
  isRecipeImagePathFor,
} from "@/lib/nutrition/recipe-image";
import type { Database } from "@/types/supabase";

/**
 * LA PHOTO D'UNE RECETTE — Storage et base, dans le bon ordre.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * IL N'Y A PAS DE TRANSACTION ENTRE POSTGRESQL ET STORAGE
 * ═════════════════════════════════════════════════════════════════════════
 * Ce sont deux services distincts, joignables par deux requêtes HTTP
 * distinctes. Aucune écriture ici n'est atomique, et prétendre le contraire
 * produirait le bug le plus désagréable qui soit : une recette qui affiche
 * une image disparue.
 *
 * Ce module choisit donc, à chaque opération, l'ORDRE dont le pire cas est
 * supportable. Deux issues seulement sont possibles après un échec :
 *
 *   - un OBJET ORPHELIN — un fichier que plus aucune recette ne désigne. Il
 *     est invisible, ne coûte que quelques centaines de kilo-octets, et reste
 *     supprimable plus tard ;
 *   - une RÉFÉRENCE CASSÉE — une recette qui pointe vers un fichier absent.
 *     Elle est visible par le coach ET par l'élève, et rien ne la répare
 *     automatiquement.
 *
 * Toutes les séquences ci-dessous sont construites pour ne produire QUE la
 * première. C'est le sens de chaque `await` dans l'ordre où il est écrit.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * REMPLACER : ENVOYER, PUIS COMMITTER, PUIS NETTOYER
 * ═════════════════════════════════════════════════════════════════════════
 *   1. envoyer la NOUVELLE image, sous un nom neuf. L'ancienne est intacte ;
 *   2. committer le nouveau chemin en base. La RPC rend l'ANCIEN ;
 *   3. supprimer l'ancien objet.
 *
 * Échec en 1 : rien n'a changé. Échec en 2 : on retire l'objet qu'on vient de
 * déposer — la recette garde sa photo d'avant. Échec en 3 : un orphelin, et
 * la recette est juste. À aucun instant la seule image valide n'est détruite
 * avant que la nouvelle soit confirmée des deux côtés.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE MODULE N'EST PAS L'AUTORITÉ
 * ═════════════════════════════════════════════════════════════════════════
 * Les chemins sont construits ici pour être justes, pas pour être sûrs. La
 * sûreté vient de la migration 20260819090000 : les policies Storage exigent
 * que la recette nommée dans le chemin appartienne réellement au coach nommé
 * dans le chemin, et la contrainte `nutrition_recipes_image_path_shape`
 * refuse toute autre forme dans la colonne. Un navigateur qui mentirait sur
 * `coachId` se ferait refuser par Storage, pas par ce fichier.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface RecipeImageOk {
  readonly ok: true;
  /** Le chemin désormais en base, ou `null` après un retrait. */
  readonly imagePath: string | null;
  /**
   * Vrai lorsque la base est juste mais qu'un ancien fichier n'a pas pu être
   * supprimé. L'appelant peut le dire discrètement ; ce n'est pas un échec.
   */
  readonly orphanLeft: boolean;
}

export interface RecipeImageKo {
  readonly ok: false;
  readonly message: string;
}

export type RecipeImageWriteResult = RecipeImageOk | RecipeImageKo;

/* ─────────────────────────── La RPC ─────────────────────────── */

type NomRpcImage = "set_nutrition_recipe_image";

function boundImageRpc(supabase: TypedSupabaseClient) {
  return (
    supabase.rpc as unknown as (
      fn: NomRpcImage,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
}

export interface SetRecipeImageOk {
  readonly ok: true;
  readonly imagePath: string | null;
  /** Le fichier devenu inutile — `null` s'il n'y a rien à nettoyer. */
  readonly previousPath: string | null;
}
export type SetRecipeImageResult = SetRecipeImageOk | RecipeImageKo;

/** Traduit le retour de `set_nutrition_recipe_image`. Fonction PURE. */
export function parseSetRecipeImageResult(data: unknown): SetRecipeImageResult {
  const ligne = (data ?? {}) as Record<string, unknown>;
  if (ligne.ok === true) {
    return {
      ok: true,
      imagePath: typeof ligne.image_path === "string" ? ligne.image_path : null,
      previousPath: typeof ligne.previous_path === "string" ? ligne.previous_path : null,
    };
  }
  switch (ligne.reason) {
    case "forbidden":
      return { ok: false, message: "Cette recette ne t'appartient pas." };
    case "not_found":
      return {
        ok: false,
        message: "Cette recette est introuvable : elle a peut-être été supprimée. Recharge la page.",
      };
    case "invalid_path":
      return {
        ok: false,
        message: "Le chemin de l'image a été refusé par la base. Recharge la page puis réessaie.",
      };
    default:
      return { ok: false, message: "La photo n'a pas pu être enregistrée. Rien n'a été modifié." };
  }
}

/** Pose ou retire le chemin en base. N'écrit AUCUN fichier. */
export async function setNutritionRecipeImage(
  supabase: TypedSupabaseClient,
  recipeId: string,
  imagePath: string | null,
): Promise<SetRecipeImageResult> {
  const { data, error } = await boundImageRpc(supabase)("set_nutrition_recipe_image", {
    p_recipe_id: recipeId,
    p_image_path: imagePath,
  });
  if (error) {
    return { ok: false, message: "La photo n'a pas pu être enregistrée. Rien n'a été modifié." };
  }
  return parseSetRecipeImageResult(data);
}

/* ────────────────────── Les objets Storage, à nu ────────────────────── */

/** Supprime un objet. Rend `false` sans lever : l'appelant décide de la suite. */
export async function removeRecipeImageObject(
  supabase: TypedSupabaseClient,
  path: string,
): Promise<boolean> {
  const { error } = await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([path]);
  if (error) {
    console.error(`[Storage] suppression de ${path} : ${error.message}`);
    return false;
  }
  return true;
}

/* ────────────────────────── Poser une photo ────────────────────────── */

export interface AttachRecipeImageInput {
  readonly coachId: string;
  readonly recipeId: string;
  readonly blob: Blob;
  readonly mime: string;
  /** Nom du fichier, sans extension. Injecté pour des tests déterministes. */
  readonly fileId: string;
}

/**
 * Pose (ou remplace) la photo d'une recette DÉJÀ enregistrée.
 *
 * `upsert: false` : le nom étant un UUID neuf, une collision signifierait un
 * problème réel — l'écraser silencieusement le masquerait.
 */
export async function attachRecipeImage(
  supabase: TypedSupabaseClient,
  input: AttachRecipeImageInput,
): Promise<RecipeImageWriteResult> {
  const chemin = buildRecipeImagePath(input.coachId, input.recipeId, input.fileId, input.mime);

  // Garde-fou de cohérence : si le chemin construit ne satisfait pas le
  // miroir de la contrainte SQL, inutile d'aller déranger Storage.
  if (!isRecipeImagePathFor(chemin, input.coachId, input.recipeId)) {
    return { ok: false, message: "Chemin d'image invalide. Recharge la page puis réessaie." };
  }

  // ── 1. La NOUVELLE image. L'ancienne est encore intacte. ──────────────
  const envoi = await supabase.storage
    .from(RECIPE_IMAGE_BUCKET)
    .upload(chemin, input.blob, { upsert: false, contentType: input.mime });

  if (envoi.error) {
    return { ok: false, message: messageStorage(envoi.error.message) };
  }

  // ── 2. Le commit en base, qui rend l'ancien chemin. ───────────────────
  const commit = await setNutritionRecipeImage(supabase, input.recipeId, chemin);
  if (!commit.ok) {
    // La base a refusé : on retire l'objet qu'on vient de déposer, sans quoi
    // il resterait orphelin dès la première tentative. La recette garde la
    // photo qu'elle avait — on n'a rien détruit.
    await removeRecipeImageObject(supabase, chemin);
    return commit;
  }

  // ── 3. L'ancien fichier, devenu inutile. ─────────────────────────────
  let orphelin = false;
  if (commit.previousPath !== null) {
    orphelin = !(await removeRecipeImageObject(supabase, commit.previousPath));
  }

  return { ok: true, imagePath: commit.imagePath, orphanLeft: orphelin };
}

/**
 * Retire la photo : la base d'abord, le fichier ensuite.
 *
 * L'inverse ouvrirait une fenêtre pendant laquelle la recette désigne un
 * fichier disparu — visible par l'élève.
 */
export async function detachRecipeImage(
  supabase: TypedSupabaseClient,
  recipeId: string,
): Promise<RecipeImageWriteResult> {
  const commit = await setNutritionRecipeImage(supabase, recipeId, null);
  if (!commit.ok) return commit;

  let orphelin = false;
  if (commit.previousPath !== null) {
    orphelin = !(await removeRecipeImageObject(supabase, commit.previousPath));
  }
  return { ok: true, imagePath: null, orphanLeft: orphelin };
}

/**
 * Nettoyage après la suppression DÉFINITIVE d'une recette.
 *
 * Appelé APRÈS le commit de `delete_nutrition_recipe`, qui rend le chemin.
 * Un échec ne remet rien en cause : la recette n'existe plus, le fichier
 * n'est plus atteignable par aucun écran.
 */
export async function cleanupRecipeImageAfterDeletion(
  supabase: TypedSupabaseClient,
  imagePath: string | null,
): Promise<boolean> {
  if (imagePath === null) return true;
  return removeRecipeImageObject(supabase, imagePath);
}

/* ────────────────────────── Dupliquer une photo ────────────────────── */

export interface CopyRecipeImageInput {
  readonly coachId: string;
  readonly sourcePath: string;
  readonly newRecipeId: string;
  readonly fileId: string;
}

/**
 * Donne à la COPIE d'une recette sa PROPRE photo.
 *
 * POURQUOI UNE VRAIE COPIE DE FICHIER. Partager le chemin coûterait moins
 * cher, mais retirer la photo de la copie supprimerait l'objet et casserait
 * l'original. La contrainte `nutrition_recipes_image_path_shape` l'interdit
 * de toute façon : le chemin contient l'identifiant de la recette.
 *
 * CE QUE `copy()` DEMANDE AUX POLICIES. L'API Storage lit la source puis
 * écrit la destination, sous l'identité de l'appelant : il lui faut donc
 * SELECT sur l'objet source ET INSERT sur l'objet cible. Les deux policies
 * existent (migration 20260819090000, §D) et portent le même prédicat
 * d'appartenance. Comme la copie hérite du coach de la source, les deux
 * chemins désignent des recettes du même coach : la copie passe. Un bucket
 * public n'y aurait rien changé — la lecture publique ne consulte pas la RLS,
 * l'API `copy` si.
 *
 * ÉCHEC = COPIE SANS PHOTO, jamais une photo partagée. L'appelant le signale
 * sans bloquer : la duplication du contenu, elle, a réussi.
 */
export async function copyRecipeImageForDuplicate(
  supabase: TypedSupabaseClient,
  input: CopyRecipeImageInput,
): Promise<RecipeImageWriteResult> {
  const extension = input.sourcePath.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  const cible = buildRecipeImagePath(input.coachId, input.newRecipeId, input.fileId, extension);

  const copie = await supabase.storage.from(RECIPE_IMAGE_BUCKET).copy(input.sourcePath, cible);
  if (copie.error) {
    return {
      ok: false,
      message: "La copie a été créée, mais sa photo n'a pas pu être dupliquée. Ajoute-la depuis sa fiche.",
    };
  }

  const commit = await setNutritionRecipeImage(supabase, input.newRecipeId, cible);
  if (!commit.ok) {
    // Le fichier existe mais aucune recette ne le désigne : on le retire
    // plutôt que de le laisser derrière nous.
    await removeRecipeImageObject(supabase, cible);
    return {
      ok: false,
      message: "La copie a été créée, mais sa photo n'a pas pu être enregistrée. Ajoute-la depuis sa fiche.",
    };
  }
  return { ok: true, imagePath: commit.imagePath, orphanLeft: false };
}

/* ────────────────────────── Messages ────────────────────────── */

/**
 * Traduit les refus de Storage en français.
 *
 * Les deux qui comptent viennent des plafonds du bucket : ils prouvent, en
 * production, que la limite n'est pas seulement celle du navigateur.
 */
function messageStorage(brut: string): string {
  const bas = brut.toLowerCase();
  if (bas.includes("exceeded the maximum allowed size") || bas.includes("payload too large")) {
    return "Le fichier dépasse la taille autorisée par le serveur. Rien n'a été enregistré.";
  }
  if (bas.includes("mime type") || bas.includes("not supported")) {
    return "Ce format d'image est refusé par le serveur. Rien n'a été enregistré.";
  }
  if (bas.includes("row-level security") || bas.includes("unauthorized") || bas.includes("violates")) {
    return "Tu n'as pas les droits nécessaires sur cette recette. Rien n'a été enregistré.";
  }
  if (bas.includes("already exists")) {
    return "Un fichier porte déjà ce nom. Réessaie.";
  }
  return "L'envoi de la photo a échoué. Rien n'a été enregistré.";
}
