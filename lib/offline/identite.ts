/**
 * HORS LIGNE — QUI EST L'ÉLÈVE, QUAND IL N'Y A PLUS DE RÉSEAU.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX IDENTIFIANTS, ET UN SEUL EST LISIBLE HORS LIGNE
 * ════════════════════════════════════════════════════════════════════════
 * L'application en manipule deux :
 *
 *   • l'id Supabase Auth — celui du compte connecté. Il vit dans la session
 *     locale, donc il est lisible sans réseau ;
 *   • `students.id` — la fiche élève. `getCurrentStudentId()` va la chercher
 *     par un `SELECT ... FROM students WHERE user_id = ...`. En avion, cette
 *     requête ne répond pas, et la fonction rend `null`.
 *
 * D'où la règle, décidée le 09/08/2026 et appliquée partout :
 *
 *   ► LA CLÉ DU DÉPÔT LOCAL EST L'ID AUTH. Toujours. C'est le seul dont on
 *     dispose au moment précis où on en a besoin.
 *   ► `studentId` est une DONNÉE mise en cache, jamais une clé.
 *
 * L'inverser aurait produit une application qui, hors ligne, ne sait pas de
 * qui sont les données qu'elle a elle-même écrites.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE N'EST TOUJOURS PAS UNE AUTORISATION
 * ════════════════════════════════════════════════════════════════════════
 * Mettre `studentId` en cache ne donne aucun droit : le serveur continue de
 * dériver l'identité élève de la session authentifiée et ignore ce que le
 * client prétend être (`app/api/student/workout-feedback/route.ts`). Ce
 * cache sert à COMPOSER un payload hors ligne, pas à convaincre qui que ce
 * soit. Un téléphone dont on aurait modifié cette valeur enverrait un
 * payload que le serveur réattribuerait à son vrai propriétaire.
 *
 * Et, comme partout dans ce dossier : aucun jeton, aucune session, aucun
 * `access_token`. Deux identifiants, rien de plus.
 */

export interface IdentiteOffline {
  /** Id Supabase Auth du compte connecté — CLÉ de tout ce qui est écrit localement. */
  readonly userId: string;
  /**
   * `students.id`, mis en cache lors d'un chargement en ligne réussi.
   *
   * `null` tant que ce compte n'a jamais chargé sa séance avec du réseau :
   * il n'y a alors rien à restaurer, et c'est exact — on ne fabrique pas une
   * identité élève pour faire tourner un écran.
   */
  readonly studentId: string | null;
}

/**
 * L'identité permet-elle de LIRE le dépôt local ?
 *
 * L'id Auth suffit : les clés n'ont jamais eu besoin d'autre chose.
 */
export function peutLire(identite: IdentiteOffline | null): identite is IdentiteOffline {
  return identite !== null && identite.userId !== "";
}

/**
 * L'identité permet-elle de COMPOSER un retour à envoyer ?
 *
 * Il faut cette fois `studentId`, parce que `WorkoutFeedbackPayload` le
 * porte. Sans lui, on ne bricole pas un payload approximatif : on refuse, et
 * l'écran le dit. Le cas ne se produit que si l'élève n'a jamais ouvert
 * cette séance en ligne — auquel cas il n'a de toute façon pas de snapshot.
 */
export function peutSoumettre(
  identite: IdentiteOffline | null,
): identite is IdentiteOffline & { studentId: string } {
  return peutLire(identite) && typeof identite.studentId === "string" && identite.studentId !== "";
}

/* ════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENT `authUserId` QUAND IL N'Y A PAS DE RÉSEAU
 * ════════════════════════════════════════════════════════════════════════
 * PAS de `getCurrentStudentId()` : cette fonction fait un `SELECT` et ne
 * répond pas hors ligne. PAS de `auth.getUser()` non plus — dans
 * `supabase-js` v2, il interroge `/auth/v1/user`.
 *
 * La source est la SESSION DÉJÀ PERSISTÉE LOCALEMENT par `@supabase/ssr`,
 * lue par `auth.getSession()`, qui n'émet aucune requête. On n'en extrait
 * qu'une chose : `session.user.id`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUI NE SORT JAMAIS DE LA SESSION
 * ────────────────────────────────────────────────────────────────────────
 * `access_token`, `refresh_token`, JWT, cookie : rien de tout cela n'est lu
 * ici, et rien ne peut donc être recopié dans IndexedDB. La signature
 * ci-dessous ne mentionne même pas ces champs — un identifiant, c'est tout.
 * Le stockage local reste ce que `schema.ts` a promis : des kilos, des
 * répétitions, un commentaire.
 */

/**
 * La forme minimale attendue d'une session auth locale.
 *
 * Volontairement réduite à ce qu'on lit. Accepter `Session` de
 * `@supabase/supabase-js` aurait mis les jetons à portée de main du premier
 * copier-coller.
 */
export interface SessionLocale {
  user?: { id?: string | null } | null;
}

/**
 * L'identité locale du compte connecté, ou `null`.
 *
 * `studentIdEnCache` vient du snapshot déjà écrit pour CE compte — jamais
 * d'un autre, jamais d'une requête.
 */
export function identiteDepuisSession(
  session: SessionLocale | null | undefined,
  studentIdEnCache: string | null = null,
): IdentiteOffline | null {
  const userId = session?.user?.id;
  if (typeof userId !== "string" || userId === "") {
    return null;
  }
  return { userId, studentId: studentIdEnCache };
}

/**
 * L'enregistrement local appartient-il bien à CETTE identité ?
 *
 * Dernier filet avant l'affichage. Les clés isolent déjà les comptes, et
 * `estCompatible` revérifie le contenu à chaque lecture ; ce contrôle-ci
 * couvre le seul chemin qui échappe aux deux : un composant qui aurait
 * conservé en mémoire l'identité de A pendant qu'une nouvelle session B
 * s'installe. Sans identité locale fiable, on ne rend RIEN de privé.
 */
export function appartientA(
  identite: IdentiteOffline | null,
  enregistrement: { userId: string } | null,
): boolean {
  if (!peutLire(identite) || enregistrement === null) return false;
  return enregistrement.userId === identite.userId;
}
