/**
 * LES REFUS D'AUTORISATION, DITS À L'UTILISATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT CORRIGÉ
 * ════════════════════════════════════════════════════════════════════════
 * Vérifié sur Vercel Preview : un collaborateur SANS permission d'écriture
 * consulte un plan nutritionnel, tente de l'enregistrer, et reçoit le code
 * technique brut de PostgreSQL — `PLAN_NOT_FOUND_OR_FORBIDDEN`. Côté
 * entraînement, le refus était bien appliqué mais le message lui demandait de
 * « se reconnecter en admin » et évoquait une perte de droits coach : un
 * diagnostic faux, qui envoyait chercher au mauvais endroit.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CES MESSAGES NE DISENT PAS, ET C'EST VOULU
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ `PLAN_NOT_FOUND_OR_FORBIDDEN` CONFOND DÉLIBÉRÉMENT DEUX CAS : le plan
 * n'existe pas, ou il existe et l'accès est refusé. La RPC les confond déjà —
 * c'est ce qui l'empêche de servir d'oracle d'existence. Le message affiché
 * doit conserver cette confusion : il parle de DROITS MANQUANTS, jamais de
 * l'existence ni de la non-existence de la cible.
 *
 * ⚠️ AUCUN CODE TECHNIQUE NE SORT. Ni `PLAN_NOT_FOUND_OR_FORBIDDEN`, ni
 * `NOT_AUTHORIZED`, ni `42501`, ni le nom d'une table ou d'une policy. Le code
 * d'origine reste utilisable EN INTERNE — il part en console et sert aux
 * tests — mais il ne traverse pas l'écran.
 *
 * ⚠️ CES MESSAGES NE REMPLACENT AUCUNE GARDE. Le refus vient de la base et de
 * lib/api/authz.ts ; ce module ne fait que l'énoncer. Changer un texte ici ne
 * peut pas ouvrir un accès.
 */

/** Refus d'écriture sur un plan nutritionnel. */
export const MESSAGE_REFUS_PLAN_NUTRITION =
  "Vous n'avez pas les autorisations nécessaires pour modifier ce plan.";

/** Refus d'écriture sur un programme d'entraînement. */
export const MESSAGE_REFUS_PROGRAMME =
  "Vous n'avez pas les autorisations nécessaires pour modifier ce programme.";

/**
 * Les signatures d'un refus d'autorisation, quelle que soit la couche qui l'a
 * produit.
 *
 * ⚠️ `PLAN_NOT_FOUND_OR_FORBIDDEN` EST DANS CETTE LISTE, et c'est le cœur du
 * correctif : la RPC nutrition lève ce code aussi bien pour un plan absent que
 * pour un plan refusé, et les deux doivent produire LE MÊME message.
 *
 * ⚠️ LA LISTE EST FERMÉE. Une erreur inconnue n'est pas traduite : elle garde
 * son chemin et son message d'origine. Traduire par défaut masquerait une
 * panne réelle derrière un faux refus de droits.
 */
const SIGNATURES_REFUS: readonly RegExp[] = [
  /PLAN_NOT_FOUND_OR_FORBIDDEN/,
  /SESSION_NOT_FOUND_OR_FORBIDDEN/,
  /NOT_AUTHORIZED/,
  /SAVE_FAILED/,
  /\b42501\b/,
  /insufficient_privilege/i,
  /row-level security/i,
  /violates row-level security policy/i,
  /permission denied/i,
];

/** Ce message technique est-il un refus d'autorisation ? */
export function estRefusAutorisationTechnique(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  return SIGNATURES_REFUS.some((signature) => signature.test(message));
}

/**
 * Traduit un message technique en message utilisateur, ou rend `null` quand
 * ce n'est pas un refus de droits — l'appelant garde alors son message.
 *
 * `cible` choisit la formulation : le plan nutritionnel ou le programme.
 */
export function messageRefusAutorisation(
  message: unknown,
  cible: "plan" | "programme",
): string | null {
  if (!estRefusAutorisationTechnique(message)) return null;
  return cible === "plan" ? MESSAGE_REFUS_PLAN_NUTRITION : MESSAGE_REFUS_PROGRAMME;
}

/**
 * Le message affichable, avec repli sur le message d'origine.
 *
 * ⚠️ LE REPLI EST VOLONTAIREMENT LE MESSAGE BRUT. Une erreur qui n'est pas un
 * refus doit rester lisible par celui qui la reçoit — une panne réseau ou une
 * contrainte violée n'a rien à voir avec des droits, et la masquer derrière
 * « vous n'avez pas les autorisations » enverrait chercher au mauvais endroit.
 */
export function messageUtilisateurOuBrut(message: string, cible: "plan" | "programme"): string {
  return messageRefusAutorisation(message, cible) ?? message;
}
