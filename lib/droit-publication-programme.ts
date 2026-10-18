/**
 * LE DROIT DE PUBLIER ET DE VENDRE UN PROGRAMME, VU DE L'INTERFACE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Ce n'est PAS la protection. Elle est en base, dans le déclencheur
 * `programs_publication_reservee_admin` (migration 20261020090000) : toute
 * tentative d'ouvrir `is_public` ou de rattacher
 * `public_subscription_template_id` par un appelant qui n'est ni
 * l'administrateur ni le serveur lève `42501`, que la requête vienne du
 * formulaire, d'un appel PostgREST direct ou d'un état React modifié.
 * Mesuré : INSERT public refusé, UPDATE publiant refusé, mise en vente
 * refusée.
 *
 * Ce module sert à ne pas PROPOSER à un coach un parcours dont la dernière
 * étape sera refusée — le pôle « Programme public » du formulaire de
 * création enchaîne d'ailleurs sur `/api/admin/subscription-templates`, déjà
 * réservée à l'administrateur par `requireAdmin()`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DOUTE LAISSE PASSER, COMME POUR LES AUTRES INDICES D'INTERFACE
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ MÊME RÈGLE QUE `lib/droit-affectation.ts`, ET POUR LA MÊME RAISON. Tant
 * que les droits ne sont pas lus — premier rendu, migrations pas encore
 * appliquées sur cet environnement, lecture qui n'a pas abouti — on
 * n'escamote pas une option : masquer sur le doute retirerait à
 * l'administrateur, qui est l'utilisateur normal de cet écran, le seul pôle
 * qui lui appartient. On ne masque donc que sur un signal POSITIF : les
 * droits sont lus, et cet appelant n'est pas administrateur.
 *
 * La base refuse pendant ce temps, et c'est elle qui compte.
 */

export interface ContexteDroitPublication {
  /** Lecture des droits encore en cours. */
  readonly chargement: boolean;
  /** `profiles.role === "admin"` — la règle d'identification de l'administrateur dans tout le dépôt. */
  readonly estAdmin: boolean;
  /** Les fonctions du modèle P13-B sont introuvables, ou la lecture n'a pas abouti. */
  readonly mecanismeIndisponible: boolean;
}

/**
 * Faut-il proposer la publication publique et la mise en vente ?
 *
 * ⚠️ `coaches.role` N'INTERVIENT PAS, VOLONTAIREMENT. Un coach autonome porte
 * `coaches.role = 'assistant'`, et une fiche peut porter l'étiquette `admin`
 * par l'effet de l'ancien DEFAUT (voir migration 20261011120000) sans que le
 * compte soit administrateur. La seule règle d'identification de
 * l'administrateur dans ce dépôt est `profiles.role = 'admin'`, c'est-à-dire
 * `public.is_admin()` — et c'est exactement ce que le déclencheur contrôle en
 * base. Les deux décisions ne peuvent donc pas diverger car elles lisent le
 * même signal.
 */
export function peutPublierProgramme(contexte: ContexteDroitPublication): boolean {
  if (contexte.chargement) return true;
  if (contexte.mecanismeIndisponible) return true;
  return contexte.estAdmin;
}

/** Le message affiché à la place du pôle public — il nomme qui peut le faire. */
export const MESSAGE_PUBLICATION_RESERVEE =
  "La publication d'un programme sur le site public et sa mise en vente sont réservées à l'administrateur.";
